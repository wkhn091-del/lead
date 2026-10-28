import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WAMessageStubType, type BaileysEventMap, type WAMessage } from 'baileys';
import { mediaKey, type MediaStorage } from '../media/storage.js';
import type { ChatLine, InteractionRecord, LeadRecord, MediaRecord, Stores, WhatsAppChatRecord } from '../stores/types.js';
import type { TranscriptionQueue } from '../transcription/queue.js';
import {
  contactLabel,
  dayEntryId,
  dayOf,
  editedText,
  isDayEntryId,
  isDirectChat,
  messageFromRef,
  messageTime,
  mimeTypeOfRef,
  phoneOfJid,
  renderConversation,
  toChatLine,
} from './chat.js';
import { jidUser, type GuardLogSink } from './guard.js';
import type { LinkedAccount } from './link.js';
import { internationalDigits, LeadPhoneIndex } from './phone.js';
import type { FetchHistoryResult } from './service.js';

/**
 * Mirrors WhatsApp conversations with leads onto their timelines, read-only. Chats with anyone who isn't a
 * lead are never stored: only the chat's id and its last message's id and time, so a lead added later can
 * ask your phone for the conversation.
 */

export interface SyncOptions {
  stores: Stores;
  storage: MediaStorage;
  transcription: TranscriptionQueue | null;
  timeZone: string;
  /** For lead numbers typed without one: 972 turns 054… into 97254… */
  countryCode: string;
  /** Voice notes newer than this many days are downloaded (and transcribed) as they arrive */
  voiceNoteDays: number;
  log: GuardLogSink;
  clock?: () => Date;
}

interface VoiceJob {
  leadId: string;
  entryId: string;
  messageId: string;
  message: WAMessage;
}

/** How many older messages one "fetch history" asks your phone for */
const HISTORY_PAGE = 50;
const LEAD_INDEX_TTL_MS = 60_000;

export class WhatsAppSync {
  private account: LinkedAccount | null = null;
  private index: { built: number; phones: LeadPhoneIndex; leads: Map<string, LeadRecord> } | null = null;
  private readonly lidPhones = new Map<string, string>();
  /** Privacy ids WhatsApp had no number for, and when to ask again (a big history repeats them thousands of times) */
  private readonly lidUnknown = new Map<string, number>();
  private readonly voiceJobs: VoiceJob[] = [];
  private voiceRunning = false;
  private readonly backfills: string[] = [];
  private backfillRunning = false;
  private messagesSynced = 0;
  private lastMessageAt: Date | null = null;
  private historyProgress: number | null = null;
  private readonly clock: () => Date;

  constructor(private readonly options: SyncOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  // ---- connection ---------------------------------------------------------------------------------------

  connected(account: LinkedAccount) {
    this.account = account;
    void this.pumpVoice();
    void this.pumpBackfill();
  }

  disconnected() {
    this.account = null;
  }

  stats() {
    return {
      messages: this.messagesSynced,
      lastMessageAt: this.lastMessageAt?.toISOString() ?? null,
      historyProgress: this.historyProgress,
      voiceNotesWaiting: this.voiceJobs.length,
    };
  }

  // ---- leads --------------------------------------------------------------------------------------------

  leadsChanged(created: string[] = []) {
    this.index = null;
    for (const id of created) if (!this.backfills.includes(id)) this.backfills.push(id);
    void this.pumpBackfill();
  }

  private async leadIndex() {
    if (!this.index || Date.now() - this.index.built > LEAD_INDEX_TTL_MS) {
      const leads = await this.options.stores.leads.list();
      this.index = {
        built: Date.now(),
        phones: new LeadPhoneIndex(leads, this.options.countryCode),
        leads: new Map(leads.map((lead) => [lead.id, lead])),
      };
    }
    return this.index;
  }

  // ---- incoming -----------------------------------------------------------------------------------------

  lidMappings(pairs: { lid: string; pn: string }[]) {
    for (const { lid, pn } of pairs) {
      const phone = jidUser(pn);
      if (!lid || !phone) continue;
      this.lidPhones.set(jidUser(lid), phone);
      this.lidUnknown.delete(jidUser(lid));
    }
  }

  /** The phone number behind a chat: its own number, the alternate id WhatsApp sent along, or the LID mapping */
  private async phoneOf(key: WAMessage['key']): Promise<string | null> {
    for (const jid of [key.remoteJid, key.remoteJidAlt]) {
      const phone = phoneOfJid(jid);
      if (phone) return phone;
    }
    for (const jid of [key.remoteJid, key.remoteJidAlt]) {
      if (!jid?.endsWith('@lid')) continue;
      const user = jidUser(jid);
      const known = this.lidPhones.get(user);
      if (known) return known;
      if ((this.lidUnknown.get(user) ?? 0) > Date.now()) continue;
      const found = await this.account?.phoneForLid(jid);
      if (found) {
        this.lidPhones.set(user, found);
        this.lidUnknown.delete(user);
        return found;
      }
      this.lidUnknown.set(user, Date.now() + 10 * 60_000);
    }
    return null;
  }

  async history(batch: BaileysEventMap['messaging-history.set']) {
    this.historyProgress = batch.progress ?? null;
    if (batch.isLatest || (batch.progress ?? 0) >= 100) this.historyProgress = null;
    await this.messages(batch.messages, 'history');
  }

  async upsert(batch: BaileysEventMap['messages.upsert']) {
    await this.messages(batch.messages, 'live');
  }

  /** Stores the messages that belong to leads, one timeline entry per lead per day. */
  async messages(messages: WAMessage[], origin: 'live' | 'history') {
    const { phones, leads } = await this.leadIndex();
    const own = this.account?.ownUsers() ?? new Set<string>();
    const chats: WhatsAppChatRecord[] = [];
    const byEntry = new Map<string, { lead: LeadRecord; lines: ChatLine[]; messages: Map<string, WAMessage> }>();

    for (const message of messages) {
      const jid = message.key?.remoteJid;
      if (!isDirectChat(jid) || !message.key.id) continue;
      const at = messageTime(message);
      if (!at) continue;
      const phone = await this.phoneOf(message.key);
      if (phone && own.has(phone)) continue; // notes to yourself
      chats.push({ jid, phone, lastId: message.key.id, lastFromMe: Boolean(message.key.fromMe), lastAt: at });

      const leadIds = phones.leadsFor(phone);
      if (!leadIds.length) continue;
      const line = toChatLine(message, at);
      if (!line) continue;
      for (const leadId of leadIds) {
        const lead = leads.get(leadId);
        if (!lead) continue;
        const entryId = dayEntryId(leadId, dayOf(at, this.options.timeZone));
        const group = byEntry.get(entryId) ?? { lead, lines: [] as ChatLine[], messages: new Map<string, WAMessage>() };
        group.lines.push(line);
        group.messages.set(line.id, message);
        byEntry.set(entryId, group);
      }
    }

    if (chats.length) await this.options.stores.whatsapp.saveChats(chats);

    for (const [entryId, group] of byEntry) {
      const added = await this.addLines(group.lead, entryId, group.lines);
      this.messagesSynced += added.length;
      for (const line of added) {
        if (!this.lastMessageAt || line.at > this.lastMessageAt) this.lastMessageAt = line.at;
        if (line.type === 'voice' && this.shouldFetchVoice(line, origin)) {
          this.voiceJobs.push({ leadId: group.lead.id, entryId, messageId: line.id, message: group.messages.get(line.id)! });
        }
      }
    }
    void this.pumpVoice();
  }

  private shouldFetchVoice(line: ChatLine, origin: 'live' | 'history') {
    if (origin === 'live') return true;
    const days = this.options.voiceNoteDays;
    return days > 0 && this.clock().getTime() - line.at.getTime() <= days * 86_400_000;
  }

  /** Adds new lines to the day's entry. Lines already there are kept as they are. Returns the new ones. */
  private async addLines(lead: LeadRecord, entryId: string, incoming: ChatLine[]): Promise<ChatLine[]> {
    const added: ChatLine[] = [];
    await this.options.stores.interactions.writeChat(lead.id, entryId, (current) => {
      // Runs again when another write got in first
      added.length = 0;
      if (current && current.source !== 'whatsapp') return null;
      const lines = new Map((current?.chat ?? []).map((line) => [line.id, line]));
      for (const line of incoming) {
        if (lines.has(line.id)) continue;
        lines.set(line.id, line);
        added.push(line);
      }
      if (!added.length) return null;
      return this.chatWrite(lead, entryId, [...lines.values()]);
    });
    return added;
  }

  private chatWrite(lead: LeadRecord, entryId: string, lines: ChatLine[]) {
    const chat = [...lines].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    const at = chat[chat.length - 1].at;
    return {
      create: { id: entryId, leadId: lead.id, kind: 'whatsapp' as const, outcome: null, body: '', step: null, stage: lead.stage, stageTo: null, at },
      chat,
      body: renderConversation(chat, contactLabel(lead.contactName), this.options.timeZone),
      at,
    };
  }

  /** Changes lines already stored (edited, deleted, voice note saved or transcribed), and renders the text again */
  private async changeLines(leadId: string, entryId: string, change: (line: ChatLine) => ChatLine | null): Promise<InteractionRecord | null> {
    const lead = (await this.leadIndex()).leads.get(leadId) ?? (await this.options.stores.leads.get(leadId));
    if (!lead) return null;
    return this.options.stores.interactions.writeChat(leadId, entryId, (current) => {
      if (!current || current.source !== 'whatsapp') return null;
      let changed = false;
      const lines = current.chat.map((line) => {
        const next = change(line);
        if (!next) return line;
        changed = true;
        return next;
      });
      return changed ? this.chatWrite(lead, entryId, lines) : null;
    });
  }

  /** Edits and "deleted for everyone" */
  async updates(updates: BaileysEventMap['messages.update']) {
    const { phones } = await this.leadIndex();
    for (const { key, update } of updates) {
      if (!key.id || !isDirectChat(key.remoteJid)) continue;
      const edit = update.message?.editedMessage?.message;
      const revoked = update.messageStubType === WAMessageStubType.REVOKE;
      if (!edit && !revoked) continue;
      const leadIds = phones.leadsFor(await this.phoneOf(key));
      for (const leadId of leadIds) {
        const entry = await this.options.stores.interactions.findChatEntry(leadId, key.id);
        if (!entry) continue;
        const removedMedia: string[] = [];
        await this.changeLines(leadId, entry.id, (line) => {
          if (line.id !== key.id) return null;
          if (revoked) {
            // The sender deleted it for everyone: keep that it existed, not what it said
            if (line.mediaId) removedMedia.push(line.mediaId);
            return { ...line, deleted: true, text: '', transcript: null, mediaId: null, ref: null };
          }
          const parsed = editedText(edit);
          return parsed && parsed.text !== line.text ? { ...line, text: parsed.text, edited: true } : null;
        });
        for (const mediaId of removedMedia) await this.removeMedia(mediaId);
      }
    }
  }

  private async removeMedia(mediaId: string) {
    const media = await this.options.stores.media.get(mediaId);
    if (!media) return;
    this.options.transcription?.cancel(mediaId);
    await this.options.stores.media.remove(mediaId);
    await this.options.storage.remove([media.storageKey]).catch(() => {});
  }

  // ---- voice notes ------------------------------------------------------------------------------------

  private async pumpVoice() {
    if (this.voiceRunning) return;
    this.voiceRunning = true;
    try {
      while (this.voiceJobs.length && this.account) {
        const job = this.voiceJobs[0];
        try {
          await this.saveVoiceNote(job, this.account);
        } catch (error) {
          this.options.log.error(`[whatsapp] Saving voice note ${job.messageId} failed: ${String(error)}`);
          await this.changeLines(job.leadId, job.entryId, (item) =>
            item.id === job.messageId ? { ...item, mediaError: 'לא הצלחנו לשמור את ההודעה הקולית. נסו שוב.' } : null,
          ).catch(() => {});
        }
        this.voiceJobs.shift();
      }
    } finally {
      this.voiceRunning = false;
    }
  }

  private async saveVoiceNote(job: VoiceJob, account: LinkedAccount) {
    const entry = await this.options.stores.interactions.get(job.leadId, job.entryId);
    const line = entry?.chat.find((item) => item.id === job.messageId);
    if (!entry || !line || line.mediaId || line.deleted) return;

    let audio: Buffer;
    try {
      audio = await account.downloadVoiceNote(job.message);
    } catch (error) {
      this.options.log.warn(`[whatsapp] Voice note ${job.messageId} couldn't be downloaded: ${String(error)}`);
      await this.changeLines(job.leadId, job.entryId, (item) =>
        item.id === job.messageId ? { ...item, mediaError: 'ההודעה הקולית כבר לא נמצאת בוואטסאפ, והטלפון לא שלח אותה שוב.' } : null,
      );
      return;
    }

    const mediaId = randomUUID();
    const storageKey = mediaKey(job.leadId, mediaId, '.ogg');
    const folder = await mkdtemp(join(tmpdir(), 'omek-voice-'));
    const mimeType = mimeTypeOfRef(line.ref);
    try {
      const file = join(folder, 'voice.ogg');
      await writeFile(file, audio);
      await this.options.storage.save(storageKey, file, mimeType);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    const stamp = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.options.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(line.at)
      .replace(', ', ' ')
      .replace(':', '.');
    await this.options.stores.media.create({
      id: mediaId,
      leadId: job.leadId,
      interactionId: job.entryId,
      kind: 'audio',
      fileName: `הודעה קולית מוואטסאפ ${stamp}.ogg`,
      mimeType,
      size: audio.length,
      storageKey,
      transcription: null,
    });
    await this.changeLines(job.leadId, job.entryId, (item) => (item.id === job.messageId ? { ...item, mediaId, mediaError: null } : null));
    await this.options.transcription?.enqueue(mediaId);
  }

  /** "Get voice note" on an older one that wasn't downloaded on arrival */
  async fetchVoiceNote(leadId: string, messageId: string) {
    const entry = await this.options.stores.interactions.findChatEntry(leadId, messageId);
    const line = entry?.chat.find((item) => item.id === messageId);
    if (!entry || !line || line.type !== 'voice') throw new Error('ההודעה הקולית הזו כבר לא בציר הזמן.');
    if (line.mediaId) return;
    if (!line.ref) throw new Error('אי אפשר להוריד את ההודעה הקולית: וואטסאפ לא שלח את פרטי הקובץ.');
    if (!this.account) throw new Error('וואטסאפ לא מחובר כרגע.');
    await this.changeLines(leadId, entry.id, (item) => (item.id === messageId ? { ...item, mediaError: null } : null));
    if (!this.voiceJobs.some((job) => job.messageId === messageId && job.leadId === leadId)) {
      this.voiceJobs.push({ leadId, entryId: entry.id, messageId, message: messageFromRef(line.ref) });
    }
    void this.pumpVoice();
  }

  /** Transcripts of voice notes go into their line of the conversation, not after it. */
  async deliverTranscript(media: MediaRecord, text: string): Promise<boolean> {
    if (!isDayEntryId(media.interactionId)) return false;
    const entry = await this.options.stores.interactions.get(media.leadId, media.interactionId!);
    if (!entry || entry.source !== 'whatsapp') return false;
    await this.changeLines(media.leadId, entry.id, (line) => (line.mediaId === media.id ? { ...line, transcript: text.trim() } : null));
    return true;
  }

  // ---- history on request -----------------------------------------------------------------------------

  /** Asks your phone for messages older than the oldest one stored, or for the chat of a lead added later. */
  async fetchHistory(leadId: string): Promise<FetchHistoryResult> {
    const account = this.account;
    if (!account) return { requested: false, message: 'וואטסאפ לא מחובר כרגע.' };
    const lead = await this.options.stores.leads.get(leadId);
    if (!lead) return { requested: false, message: 'הליד הזה כבר לא קיים.' };
    const phone = internationalDigits(lead.phone, this.options.countryCode);
    if (!phone) return { requested: false, message: 'הוסיפו את מספר הטלפון של הליד כדי למצוא את השיחה שלו בוואטסאפ.' };

    const [chat] = await this.options.stores.whatsapp.findChatsByPhone([phone]);
    const oldest = await this.options.stores.interactions.oldestChat(leadId);
    const first = oldest?.chat[0];
    const chatJid = chat?.jid ?? `${phone}@s.whatsapp.net`;
    if (first) {
      await account.requestOlderMessages({ chatJid, id: first.id, fromMe: first.fromMe, at: first.at }, HISTORY_PAGE);
      return { requested: true, message: 'ביקשנו מהטלפון הודעות קודמות. הן יופיעו כאן תוך כמה שניות, אם הטלפון מחובר.' };
    }
    if (!chat) return { requested: false, message: 'עדיין אין שיחת וואטסאפ עם המספר הזה.' };
    const anchor = { chatJid: chat.jid, id: chat.lastId, fromMe: chat.lastFromMe, at: chat.lastAt };
    await account.requestOlderMessages(anchor, HISTORY_PAGE);
    // The anchor itself isn't part of "older messages": ask for it separately
    await account.requestMessage({ remoteJid: chat.jid, id: chat.lastId, fromMe: chat.lastFromMe }).catch(() => {});
    return { requested: true, message: 'ביקשנו מהטלפון את השיחה הזו. היא תופיע כאן תוך כמה שניות, אם הטלפון מחובר.' };
  }

  /** New leads with an existing chat get its recent history, one request every few seconds. */
  private async pumpBackfill() {
    if (this.backfillRunning) return;
    this.backfillRunning = true;
    try {
      while (this.backfills.length && this.account) {
        const leadId = this.backfills.shift()!;
        const lead = await this.options.stores.leads.get(leadId);
        const phone = lead ? internationalDigits(lead.phone, this.options.countryCode) : null;
        if (!phone || !(await this.options.stores.whatsapp.findChatsByPhone([phone])).length) continue;
        if (await this.options.stores.interactions.oldestChat(leadId)) continue;
        await this.fetchHistory(leadId).catch((error: unknown) => this.options.log.warn(`[whatsapp] History for a new lead failed: ${String(error)}`));
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    } finally {
      this.backfillRunning = false;
    }
  }
}
