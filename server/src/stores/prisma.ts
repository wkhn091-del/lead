import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ActivityRecord, DealTerms } from '../leads/workflow.js';
import {
  ConflictError,
  freshPractice,
  newLeadState,
  notesAsInteractions,
  splitById,
  type ChatLine,
  type CoachingStore,
  type DailyStore,
  type InteractionRecord,
  type InteractionStore,
  type LatestEntries,
  type LeadRecord,
  type MediaRecord,
  type LeadStore,
  type MediaStore,
  type NewInteraction,
  type ObjectionCardDraft,
  type ObjectionCardRecord,
  type SessionStore,
  type Stores,
  type TrainingStore,
  type WhatsAppChatRecord,
  type WhatsAppStore,
} from './types.js';
import type { ProspectAnalysis, ProspectorStore, ProspectRecord, ProspectSearchRecord, SiteSignals } from '../prospector/types.js';
import { sameWording, wordingOf } from '../training/starter.js';

const leadSelect = {
  id: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  website: true,
  campaign: true,
  approach: true,
  method: true,
  stage: true,
  stageChangedAt: true,
  archivedAt: true,
  attemptCount: true,
  lastAttemptAt: true,
  deal: true,
  legacyValue: true,
  currency: true,
  activity: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

/**
 * A lead's deal amounts. Leads stored before deal terms existed have one amount (`value`); a closed one
 * reads as the deal's setup fee until the lead is saved again.
 */
export function leadDeal(row: Pick<LeadRow, 'deal' | 'legacyValue' | 'stage'>): DealTerms {
  if (row.deal) return { setupFee: row.deal.setupFee, monthlyRetainer: row.deal.monthlyRetainer, hostingYearly: row.deal.hostingYearly };
  return { setupFee: row.stage === 'closed' ? (row.legacyValue ?? 0) : 0, monthlyRetainer: 0, hostingYearly: 0 };
}

const toLead = ({ deal: _deal, legacyValue: _legacyValue, ...row }: LeadRow): LeadRecord => ({
  ...row,
  deal: leadDeal({ deal: _deal, legacyValue: _legacyValue, stage: row.stage }),
  archivedAt: row.archivedAt ?? null,
  lastAttemptAt: row.lastAttemptAt ?? null,
  activity: row.activity
    .map((entry) => ({
      ...entry,
      to: entry.to ?? null,
      before: { ...entry.before, lastAttemptAt: entry.before.lastAttemptAt ?? null },
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime()),
});

type InteractionRow = Prisma.InteractionGetPayload<object>;
type MediaRow = Prisma.MediaGetPayload<object>;

const toMedia = (row: MediaRow): MediaRecord => ({
  ...row,
  interactionId: row.interactionId ?? null,
  transcription: row.transcription
    ? { ...row.transcription, error: row.transcription.error ?? null, text: row.transcription.text ?? null }
    : null,
});
const toChatLine = (line: Prisma.ChatLineGetPayload<object> | ChatLine): ChatLine => ({
  id: line.id,
  at: line.at,
  fromMe: line.fromMe,
  type: line.type,
  text: line.text,
  seconds: line.seconds ?? null,
  mediaId: line.mediaId ?? null,
  mediaError: line.mediaError ?? null,
  transcript: line.transcript ?? null,
  edited: line.edited,
  deleted: line.deleted,
  ref: line.ref ?? null,
});

const toInteraction = ({ createdAt: _created, ...row }: InteractionRow): InteractionRecord => ({
  ...row,
  outcome: row.outcome ?? null,
  step: row.step ?? null,
  stageTo: row.stageTo ?? null,
  source: row.source ?? null,
  chat: (row.chat ?? []).map(toChatLine),
});

/** A new entry's document: logged in the app unless it says otherwise */
const interactionData = (record: NewInteraction) => ({
  ...record,
  source: record.source ?? null,
  chat: (record.chat ?? []).map(toChatLine),
});

/** Splits long id lists, so a query never grows past what the database takes comfortably */
function chunks<T>(items: readonly T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

const toActivityDoc = (entry: ActivityRecord) => ({
  id: entry.id,
  type: entry.type,
  at: entry.at,
  from: entry.from,
  to: entry.to,
  before: entry.before,
});

/** The Prisma error code (P2002 duplicate key, P2025 record not found), if there is one. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export function createPrismaStores(prisma: PrismaClient): Stores {
  const findLead = async (id: string) => {
    const row = await prisma.lead.findUnique({ where: { id }, select: leadSelect });
    return row ? toLead(row) : null;
  };

  const leads: LeadStore = {
    async list() {
      const rows = await prisma.lead.findMany({ select: leadSelect, orderBy: { createdAt: 'desc' } });
      return rows.map(toLead);
    },
    get: findLead,
    async create(input) {
      try {
        const row = await prisma.lead.create({ data: newLeadState(input, new Date()), select: leadSelect });
        await interactions.createMany(notesAsInteractions(input));
        return toLead(row);
      } catch (error) {
        if (errorCode(error) === 'P2002') throw new ConflictError('כבר קיים ליד עם המזהה הזה.');
        throw error;
      }
    },
    async createMany(inputs) {
      const existing = await prisma.lead.findMany({
        where: { id: { in: inputs.map((input) => input.id) } },
        select: { id: true },
      });
      const { fresh, skippedIds } = splitById(inputs, new Set(existing.map((row) => row.id)));
      if (fresh.length === 0) return { created: [], skippedIds };

      const now = new Date();
      const documents = fresh.map((input) => newLeadState(input, now));
      try {
        await prisma.lead.createMany({ data: documents });
      } catch (error) {
        if (errorCode(error) !== 'P2002') throw error;
        // Another request stored some of these ids first (a retried import). Save the rest one by one.
        for (const data of documents) {
          try {
            await prisma.lead.create({ data, select: { id: true } });
          } catch (inner) {
            if (errorCode(inner) !== 'P2002') throw inner;
          }
        }
      }
      await interactions.createMany(fresh.flatMap(notesAsInteractions));
      const rows = await prisma.lead.findMany({
        where: { id: { in: fresh.map((input) => input.id) } },
        select: leadSelect,
        orderBy: { createdAt: 'desc' },
      });
      return { created: rows.map(toLead), skippedIds };
    },
    async update(id, { deal, ...details }) {
      // Writing the amounts replaces the older single value, if the lead still had one: the field goes away
      const data = deal ? { ...details, deal: { set: deal }, legacyValue: { unset: true } } : details;
      try {
        return toLead(await prisma.lead.update({ where: { id }, data, select: leadSelect }));
      } catch (error) {
        if (errorCode(error) === 'P2025') return null;
        throw error;
      }
    },
    async saveWorkflow(id, expectedUpdatedAt, state) {
      const { count } = await prisma.lead.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: {
          stage: state.stage,
          stageChangedAt: state.stageChangedAt,
          archivedAt: state.archivedAt,
          attemptCount: state.attemptCount,
          lastAttemptAt: state.lastAttemptAt,
          deal: { set: state.deal },
          legacyValue: { unset: true },
          activity: { set: state.activity.map(toActivityDoc) },
        },
      });
      return count === 1 ? findLead(id) : null;
    },
    async removeMany(ids) {
      await prisma.lead.deleteMany({ where: { id: { in: ids } } });
    },
    async poolCandidates() {
      // Filtered in code rather than in the query: MongoDB treats a missing field and null differently.
      const rows = await prisma.lead.findMany({
        where: { stage: 'cold_call' },
        select: { id: true, archivedAt: true, lastAttemptAt: true, activity: { select: { type: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        archivedAt: row.archivedAt ?? null,
        lastAttemptAt: row.lastAttemptAt ?? null,
        answered: row.activity.some((entry) => entry.type === 'answered'),
      }));
    },
    async ping() {
      await prisma.$runCommandRaw({ ping: 1 });
    },
  };

  const interactions: InteractionStore = {
    async list(leadId) {
      const rows = await prisma.interaction.findMany({ where: { leadId }, orderBy: [{ at: 'desc' }, { createdAt: 'desc' }] });
      return rows.map(toInteraction);
    },
    async create(record) {
      try {
        return toInteraction(await prisma.interaction.create({ data: interactionData(record) }));
      } catch (error) {
        if (errorCode(error) !== 'P2002') throw error;
        const existing = await prisma.interaction.findUniqueOrThrow({ where: { id: record.id } });
        return toInteraction(existing);
      }
    },
    async createMany(records) {
      if (records.length === 0) return;
      const taken = await prisma.interaction.findMany({ where: { id: { in: records.map((r) => r.id) } }, select: { id: true } });
      const { fresh } = splitById(records, new Set(taken.map((row) => row.id)));
      if (fresh.length) await prisma.interaction.createMany({ data: fresh.map(interactionData) });
    },
    async get(leadId, id) {
      const row = await prisma.interaction.findFirst({ where: { id, leadId } });
      return row ? toInteraction(row) : null;
    },
    async update(leadId, id, change, expectedUpdatedAt) {
      const where = expectedUpdatedAt ? { id, leadId, updatedAt: expectedUpdatedAt } : { id, leadId };
      const { count } = await prisma.interaction.updateMany({ where, data: change });
      if (count === 0) {
        if (expectedUpdatedAt && (await prisma.interaction.count({ where: { id, leadId } }))) {
          throw new ConflictError('הרשומה השתנתה בזמן שערכת אותה.');
        }
        return null;
      }
      return toInteraction(await prisma.interaction.findUniqueOrThrow({ where: { id } }));
    },
    async appendBody(leadId, id, text) {
      // Read, append, and write back only if nothing changed in between; otherwise read again.
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await prisma.interaction.findFirst({ where: { id, leadId } });
        if (!row) return null;
        if (row.body.includes(text)) return toInteraction(row);
        const body = row.body.trim() ? `${row.body.trimEnd()}\n\n${text}` : text;
        const { count } = await prisma.interaction.updateMany({ where: { id, leadId, updatedAt: row.updatedAt }, data: { body } });
        if (count === 1) return toInteraction(await prisma.interaction.findUniqueOrThrow({ where: { id } }));
      }
      throw new ConflictError('הרשומה המשיכה להשתנות, אז לא הצלחנו להוסיף את הטקסט.');
    },
    async remove(leadId, id) {
      await prisma.interaction.deleteMany({ where: { id, leadId } });
    },
    async removeForLeads(leadIds) {
      await prisma.interaction.deleteMany({ where: { leadId: { in: leadIds } } });
    },
    async writeChat(leadId, id, change) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const row = await prisma.interaction.findFirst({ where: { id, leadId } });
        const current = row ? toInteraction(row) : null;
        const next = change(current);
        if (!next) return current;
        const chat = next.chat.map(toChatLine);
        if (!row) {
          try {
            const data = { ...interactionData(next.create), source: 'whatsapp' as const, chat, body: next.body, at: next.at };
            return toInteraction(await prisma.interaction.create({ data }));
          } catch (error) {
            // Created by another write in the meantime: read it and apply the change on top
            if (errorCode(error) === 'P2002') continue;
            throw error;
          }
        }
        const { count } = await prisma.interaction.updateMany({
          where: { id, leadId, updatedAt: row.updatedAt },
          data: { chat: { set: chat }, body: next.body, at: next.at },
        });
        if (count === 1) return toInteraction(await prisma.interaction.findUniqueOrThrow({ where: { id } }));
      }
      throw new ConflictError('השיחה המשיכה להשתנות, אז לא הצלחנו לשמור אותה. היא תישמר עם ההודעה הבאה.');
    },
    async findChatEntry(leadId, messageId) {
      const row = await prisma.interaction.findFirst({ where: { leadId, chat: { some: { id: messageId } } } });
      return row ? toInteraction(row) : null;
    },
    async oldestChat(leadId) {
      const row = await prisma.interaction.findFirst({ where: { leadId, source: 'whatsapp' }, orderBy: { at: 'asc' } });
      return row ? toInteraction(row) : null;
    },
    async latestByLead(leadIds) {
      const found = new Map<string, LatestEntries>();
      for (const batch of chunks(leadIds)) {
        // Only the fields that matter: no bodies or chats
        const rows = await prisma.interaction.findMany({
          where: { leadId: { in: batch } },
          select: { leadId: true, at: true, kind: true, outcome: true },
          orderBy: { at: 'desc' },
        });
        for (const row of rows) {
          const known = found.get(row.leadId);
          const outcome = row.outcome ?? null;
          if (!known) found.set(row.leadId, { last: { at: row.at, kind: row.kind, outcome }, zoom: row.kind === 'zoom' ? { at: row.at, outcome } : null });
          else if (!known.zoom && row.kind === 'zoom') known.zoom = { at: row.at, outcome };
        }
      }
      return found;
    },
  };

  const findMedia = async (id: string) => {
    const row = await prisma.media.findUnique({ where: { id } });
    return row ? toMedia(row) : null;
  };

  const media: MediaStore = {
    async list(leadId) {
      const rows = await prisma.media.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } });
      return rows.map(toMedia);
    },
    get: findMedia,
    async create({ transcription, ...record }) {
      const row = await prisma.media.create({ data: { ...record, ...(transcription ? { transcription: { set: transcription } } : {}) } });
      return toMedia(row);
    },
    async detach(interactionId) {
      await prisma.media.updateMany({ where: { interactionId }, data: { interactionId: null } });
    },
    async attach(id, interactionId) {
      await prisma.media.updateMany({ where: { id }, data: { interactionId } });
    },
    async setTranscription(id, transcription) {
      const { count } = await prisma.media.updateMany({
        where: { id },
        data: { transcription: transcription ? { set: transcription } : { unset: true } },
      });
      return count === 1 ? findMedia(id) : null;
    },
    async pendingTranscriptions() {
      const rows = await prisma.media.findMany({
        where: { transcription: { is: { status: { in: ['queued', 'running'] } } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toMedia);
    },
    async remove(id) {
      await prisma.media.deleteMany({ where: { id } });
    },
    async removeForLeads(leadIds) {
      const rows = await prisma.media.findMany({ where: { leadId: { in: leadIds } } });
      await prisma.media.deleteMany({ where: { leadId: { in: leadIds } } });
      return rows.map(toMedia);
    },
  };

  const coaching: CoachingStore = {
    async latest(leadId) {
      return prisma.coachingReport.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } });
    },
    async latestForLeads(leadIds) {
      const found = new Map<string, Prisma.CoachingReportGetPayload<object>>();
      for (const batch of chunks(leadIds)) {
        const rows = await prisma.coachingReport.findMany({ where: { leadId: { in: batch } }, orderBy: { createdAt: 'desc' }, distinct: ['leadId'] });
        for (const row of rows) if (!found.has(row.leadId)) found.set(row.leadId, row);
      }
      return found;
    },
    async create(record) {
      return prisma.coachingReport.create({ data: { ...record, analysis: record.analysis as Prisma.InputJsonValue } });
    },
    async removeForLeads(leadIds) {
      await prisma.coachingReport.deleteMany({ where: { leadId: { in: leadIds } } });
    },
  };

  const daily: DailyStore = {
    find(date) {
      return prisma.dailyQueue.findUnique({ where: { date }, select: { leadIds: true, version: true } });
    },
    async create(date, leadIds) {
      try {
        await prisma.dailyQueue.create({ data: { date, leadIds } });
        return true;
      } catch (error) {
        if (errorCode(error) === 'P2002') return false;
        throw error;
      }
    },
    async extend(date, version, leadIds) {
      const { count } = await prisma.dailyQueue.updateMany({
        where: { date, version },
        data: { leadIds: { set: leadIds }, version: { increment: 1 } },
      });
      return count === 1;
    },
  };

  const sessions: SessionStore = {
    async create(session) {
      await prisma.session.create({ data: session });
    },
    findByTokenHash(tokenHash) {
      return prisma.session.findUnique({ where: { tokenHash }, select: { id: true, expiresAt: true } });
    },
    async extend(id, expiresAt) {
      await prisma.session.update({ where: { id }, data: { expiresAt } });
    },
    async deleteByTokenHash(tokenHash) {
      await prisma.session.deleteMany({ where: { tokenHash } });
    },
    async deleteExpired(now) {
      await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    },
  };

  const toChat = (row: Prisma.WhatsAppChatGetPayload<object>): WhatsAppChatRecord => ({
    jid: row.id,
    phone: row.phone ?? null,
    lastId: row.lastId,
    lastFromMe: row.lastFromMe,
    lastAt: row.lastAt,
  });

  const whatsapp: WhatsAppStore = {
    async saveChats(chats) {
      const newest = new Map<string, WhatsAppChatRecord>();
      for (const chat of chats) {
        const seen = newest.get(chat.jid);
        if (!seen || seen.lastAt < chat.lastAt) newest.set(chat.jid, { ...chat, phone: chat.phone ?? seen?.phone ?? null });
      }
      for (const batch of chunks([...newest.values()])) {
        const rows = await prisma.whatsAppChat.findMany({ where: { id: { in: batch.map((chat) => chat.jid) } } });
        const known = new Map(rows.map((row) => [row.id, row]));
        for (const chat of batch) {
          const row = known.get(chat.jid);
          const data = { phone: chat.phone, lastId: chat.lastId, lastFromMe: chat.lastFromMe, lastAt: chat.lastAt };
          if (!row) {
            await prisma.whatsAppChat.upsert({ where: { id: chat.jid }, create: { id: chat.jid, ...data }, update: {} });
          } else if (row.lastAt < chat.lastAt) {
            await prisma.whatsAppChat.update({ where: { id: chat.jid }, data: { ...data, phone: chat.phone ?? row.phone } });
          } else if (chat.phone && !row.phone) {
            await prisma.whatsAppChat.update({ where: { id: chat.jid }, data: { phone: chat.phone } });
          }
        }
      }
    },
    async findChatsByPhone(phones) {
      if (!phones.length) return [];
      const rows = await prisma.whatsAppChat.findMany({ where: { phone: { in: phones } }, orderBy: { lastAt: 'desc' } });
      return rows.map(toChat);
    },
    async readAuth(ids) {
      const values = new Map<string, string>();
      for (const batch of chunks(ids)) {
        const rows = await prisma.whatsAppAuth.findMany({ where: { id: { in: batch } } });
        for (const row of rows) values.set(row.id, row.value);
      }
      return values;
    },
    async writeAuth(entries) {
      // One write per key: a failure leaves every other key as it was.
      for (const batch of chunks(entries, 50)) {
        await Promise.all(
          batch.map(({ id, value }) =>
            value === null
              ? prisma.whatsAppAuth.deleteMany({ where: { id } })
              : prisma.whatsAppAuth.upsert({ where: { id }, create: { id, value }, update: { value } }),
          ),
        );
      }
    },
    async clearAuth() {
      await prisma.whatsAppAuth.deleteMany({});
    },
  };

  type CardRow = Prisma.ObjectionCardGetPayload<object>;
  const toCard = (row: CardRow): ObjectionCardRecord => ({
    ...row,
    practice: {
      ...row.practice,
      lastGrade: row.practice.lastGrade ?? null,
      lastReviewedAt: row.practice.lastReviewedAt ?? null,
    },
  });
  const draftData = (draft: ObjectionCardDraft) => ({
    category: draft.category,
    objection: draft.objection,
    insight: draft.insight,
    response: draft.response,
    alternatives: draft.alternatives,
    followUp: draft.followUp,
    leadCount: draft.leadCount,
    mentions: draft.mentions,
  });

  const training: TrainingStore = {
    async cards() {
      const rows = await prisma.objectionCard.findMany({ orderBy: [{ leadCount: 'desc' }, { mentions: 'desc' }, { createdAt: 'asc' }] });
      return rows.map(toCard);
    },
    async card(id) {
      const row = await prisma.objectionCard.findUnique({ where: { id } });
      return row ? toCard(row) : null;
    },
    async saveRun(drafts, run, now) {
      const existing = new Map((await prisma.objectionCard.findMany({ select: { id: true, key: true } })).map((row) => [row.key, row.id]));
      for (const draft of drafts) {
        const id = existing.get(draft.key);
        if (id) {
          await prisma.objectionCard.update({ where: { id }, data: { ...draftData(draft), sources: { set: draft.sources }, retired: false } });
        } else {
          await prisma.objectionCard.create({
            data: { id: randomUUID(), key: draft.key, ...draftData(draft), sources: draft.sources, practice: freshPractice(now), myResponse: '', retired: false },
          });
        }
      }
      await prisma.objectionCard.updateMany({ where: { key: { notIn: drafts.map((draft) => draft.key) }, retired: false }, data: { retired: true } });
      return prisma.trainingRun.create({ data: run });
    },
    latestRun() {
      return prisma.trainingRun.findFirst({ orderBy: { createdAt: 'desc' } });
    },
    async updateCard(id, change) {
      const { count } = await prisma.objectionCard.updateMany({
        where: { id },
        data: {
          ...(change.practice ? { practice: { set: change.practice } } : {}),
          ...(change.myResponse !== undefined ? { myResponse: change.myResponse } : {}),
        },
      });
      return count === 1 ? training.card(id) : null;
    },
    async removeLeadSources(leadIds) {
      const rows = await prisma.objectionCard.findMany({ where: { sources: { some: { leadId: { in: leadIds } } } } });
      for (const row of rows) {
        const sources = row.sources.filter((source) => !leadIds.includes(source.leadId));
        await prisma.objectionCard.update({
          where: { id: row.id },
          data: { sources: { set: sources }, leadCount: new Set(sources.map((source) => source.leadId)).size, mentions: sources.length },
        });
      }
    },
    async rewordCommon(common) {
      const byKey = new Map(common.map((card) => [card.key, card]));
      const rows = await prisma.objectionCard.findMany({ where: { key: { in: [...byKey.keys()] }, leadCount: 0 } });
      const reworded: string[] = [];
      for (const row of rows) {
        const starter = byKey.get(row.key)!;
        if (sameWording(row, starter)) continue;
        await prisma.objectionCard.update({ where: { id: row.id }, data: wordingOf(starter) });
        reworded.push(row.key);
      }
      if (reworded.length) await prisma.objectionVariant.deleteMany({ where: { cardKey: { in: reworded } } });
      return reworded;
    },
    variants(niche) {
      return prisma.objectionVariant.findMany({ where: { niche } });
    },
    async saveVariants(niche, drafts, by) {
      await prisma.objectionVariant.deleteMany({ where: { niche: niche.key } });
      if (drafts.length) {
        await prisma.objectionVariant.createMany({
          data: drafts.map((draft) => ({ id: randomUUID(), niche: niche.key, label: niche.label, ...draft, ...by })),
        });
      }
      return prisma.objectionVariant.findMany({ where: { niche: niche.key } });
    },
    async tailoredNiches() {
      // A few dozen rows per niche at most, so they are grouped here rather than in the database
      const rows = await prisma.objectionVariant.findMany({ select: { niche: true, label: true, updatedAt: true } });
      const found = new Map<string, { niche: string; label: string; cards: number; updatedAt: Date }>();
      for (const row of rows) {
        const known = found.get(row.niche);
        if (!known) found.set(row.niche, { ...row, cards: 1 });
        else {
          known.cards += 1;
          if (row.updatedAt > known.updatedAt) known.updatedAt = row.updatedAt;
        }
      }
      return [...found.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },
  };

  type SearchRow = Prisma.ProspectSearchGetPayload<object>;
  type ProspectRow = Prisma.ProspectGetPayload<object>;
  const toSearch = (row: SearchRow): ProspectSearchRecord => ({
    ...row,
    provider: row.provider === 'serpapi' ? 'serpapi' : 'google',
    fallbackFrom: row.fallbackFrom === 'serpapi' || row.fallbackFrom === 'google' ? row.fallbackFrom : null,
    notice: row.notice ?? null,
    language: row.language === 'en' ? 'en' : 'he',
    error: row.error ?? null,
    finishedAt: row.finishedAt ?? null,
  });
  const toAnalysis = (analysis: ProspectRow['analysis']): ProspectAnalysis => ({
    status: analysis.status as ProspectAnalysis['status'],
    siteState: (analysis.siteState ?? null) as ProspectAnalysis['siteState'],
    score: analysis.score ?? null,
    ruleScore: analysis.ruleScore ?? null,
    scoredBy: (analysis.scoredBy ?? null) as ProspectAnalysis['scoredBy'],
    verdict: analysis.verdict,
    reasons: analysis.reasons,
    pitch: analysis.pitch,
    confidence: (analysis.confidence ?? null) as ProspectAnalysis['confidence'],
    signals: (analysis.signals ?? null) as unknown as SiteSignals | null,
    screenshotKey: analysis.screenshotKey ?? null,
    error: analysis.error ?? null,
    analyzedAt: analysis.analyzedAt ?? null,
    reusedFrom: analysis.reusedFrom ?? null,
  });
  const analysisData = (analysis: ProspectAnalysis) => ({
    ...analysis,
    signals: (analysis.signals ?? undefined) as Prisma.InputJsonValue | undefined,
  });
  const toProspect = (row: ProspectRow): ProspectRecord => ({
    ...row,
    rating: row.rating ?? null,
    reviews: row.reviews ?? null,
    existingLeadId: row.existingLeadId ?? null,
    importedLeadId: row.importedLeadId ?? null,
    importedAt: row.importedAt ?? null,
    analysis: toAnalysis(row.analysis),
  });

  const prospector: ProspectorStore = {
    async createSearch(record) {
      return toSearch(await prisma.prospectSearch.create({ data: record }));
    },
    async getSearch(id) {
      const row = await prisma.prospectSearch.findUnique({ where: { id } });
      return row ? toSearch(row) : null;
    },
    async listSearches(limit) {
      const rows = await prisma.prospectSearch.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
      return rows.map(toSearch);
    },
    async updateSearch(id, change) {
      try {
        return toSearch(await prisma.prospectSearch.update({ where: { id }, data: change }));
      } catch (error) {
        if (errorCode(error) === 'P2025') return null;
        throw error;
      }
    },
    async unfinishedSearches() {
      const rows = await prisma.prospectSearch.findMany({ where: { status: { in: ['discovering', 'analyzing'] } }, orderBy: { createdAt: 'asc' } });
      return rows.map(toSearch);
    },
    async searchesBefore(before) {
      const rows = await prisma.prospectSearch.findMany({ where: { createdAt: { lt: before } }, orderBy: { createdAt: 'asc' } });
      return rows.map(toSearch);
    },
    async removeSearch(id) {
      const rows = await prisma.prospect.findMany({ where: { searchId: id }, select: { analysis: { select: { screenshotKey: true } } } });
      await prisma.prospect.deleteMany({ where: { searchId: id } });
      await prisma.prospectSearch.deleteMany({ where: { id } });
      return rows.flatMap((row) => (row.analysis.screenshotKey ? [row.analysis.screenshotKey] : []));
    },
    async addProspects(records) {
      if (!records.length) return;
      const existing = await prisma.prospect.findMany({
        where: { searchId: records[0].searchId, placeId: { in: records.map((record) => record.placeId) } },
        select: { placeId: true },
      });
      const taken = new Set(existing.map((row) => row.placeId));
      const fresh = records.filter((record) => {
        if (taken.has(record.placeId)) return false;
        taken.add(record.placeId);
        return true;
      });
      for (const batch of chunks(fresh, 100)) {
        await prisma.prospect.createMany({ data: batch.map((record) => ({ ...record, analysis: analysisData(record.analysis) })) });
      }
    },
    async listProspects(searchId) {
      const rows = await prisma.prospect.findMany({ where: { searchId }, orderBy: { position: 'asc' } });
      return rows.map(toProspect);
    },
    async getProspect(id) {
      const row = await prisma.prospect.findUnique({ where: { id } });
      return row ? toProspect(row) : null;
    },
    async getProspects(ids) {
      const rows: ProspectRow[] = [];
      for (const batch of chunks(ids)) rows.push(...(await prisma.prospect.findMany({ where: { id: { in: batch } } })));
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toProspect(row)] : [];
      });
    },
    async setAnalysis(id, analysis) {
      try {
        return toProspect(await prisma.prospect.update({ where: { id }, data: { analysis: { set: analysisData(analysis) } } }));
      } catch (error) {
        if (errorCode(error) === 'P2025') return null;
        throw error;
      }
    },
    async setExistingLead(id, leadId) {
      await prisma.prospect.updateMany({ where: { id }, data: { existingLeadId: leadId } });
    },
    async markImported(id, leadId, at) {
      await prisma.prospect.updateMany({ where: { id }, data: { importedLeadId: leadId, importedAt: at } });
    },
    async recentAnalysis(domain, since, excludeId) {
      const row = await prisma.prospect.findFirst({
        where: { domain, id: { not: excludeId }, analysis: { is: { status: 'done', analyzedAt: { gte: since } } } },
        orderBy: { updatedAt: 'desc' },
      });
      return row ? toProspect(row) : null;
    },
  };

  return { leads, interactions, media, coaching, sessions, daily, whatsapp, training, prospector };
}
