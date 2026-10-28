import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proto, WAMessageStubType, type WAMessage } from 'baileys';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createMemoryStores } from '../src/stores/memory.js';
import type { LeadRecord, MediaRecord, Stores } from '../src/stores/types.js';
import type { TranscriptionQueue } from '../src/transcription/queue.js';
import { createSealer, parseAuthKey } from '../src/whatsapp/auth-key.js';
import { AuthKeyMismatchError, isLinked, openAuthState } from '../src/whatsapp/auth-state.js';
import { renderConversation } from '../src/whatsapp/chat.js';
import type { LinkedAccount } from '../src/whatsapp/link.js';
import { internationalDigits, LeadPhoneIndex } from '../src/whatsapp/phone.js';
import type { WhatsAppService } from '../src/whatsapp/service.js';
import { WhatsAppSync } from '../src/whatsapp/sync.js';
import { TEST_EMAIL, TEST_PASSWORD } from './credentials.js';

const TZ = 'Asia/Jerusalem';
const ME = '972500000001';
const NOW = new Date('2026-10-22T09:00:00Z'); // 12:00 in Israel
const silent = { warn: () => {}, error: () => {} };
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let n = 0;
function message(remoteJid: string, content: proto.IMessage, iso: string, extra: Partial<WAMessage> = {}, key: Partial<WAMessage['key']> = {}): WAMessage {
  n += 1;
  return { key: { remoteJid, fromMe: false, id: `3EB0${String(n).padStart(8, '0')}`, ...key }, message: content, messageTimestamp: seconds(iso), ...extra };
}
const voice = (secs: number): proto.IMessage => ({
  audioMessage: {
    ptt: true,
    seconds: secs,
    mimetype: 'audio/ogg; codecs=opus',
    url: 'https://mmg.whatsapp.net/v/t62/voice.enc',
    directPath: '/v/t62/voice.enc',
    mediaKey: Buffer.from('k'.repeat(32)),
    fileEncSha256: Buffer.from('e'.repeat(32)),
    fileSha256: Buffer.from('s'.repeat(32)),
    fileLength: 4_000,
  },
});

function lead(stores: Stores, overrides: Partial<Pick<LeadRecord, 'name' | 'contactName'>> & { phone: string }) {
  return stores.leads.create({
    id: randomUUID(),
    name: 'Galilee Bakery',
    contactName: 'Amir Cohen',
    email: '',
    website: '',
    campaign: 'Bakeries',
    approach: '',
    method: 'whatsapp',
    currency: 'ILS',
    notes: [],
    ...overrides,
  });
}

interface Harness {
  stores: Stores;
  sync: WhatsAppSync;
  account: LinkedAccount & { requestOlderMessages: ReturnType<typeof vi.fn>; requestMessage: ReturnType<typeof vi.fn> };
  queued: string[];
}

async function harness(): Promise<Harness> {
  const stores = createMemoryStores();
  const storage = createLocalStorage(await mkdtemp(join(tmpdir(), 'omek-wa-')));
  const queued: string[] = [];
  const transcription = {
    async enqueue(id: string) {
      queued.push(id);
      return stores.media.get(id);
    },
    cancel: () => {},
  } as unknown as TranscriptionQueue;
  const sync = new WhatsAppSync({ stores, storage, transcription, timeZone: TZ, countryCode: '972', voiceNoteDays: 30, log: silent, clock: () => NOW });
  const account = {
    ownUsers: () => new Set([ME]),
    phoneForLid: async (jid: string) => (jid === '99887766@lid' ? '972541112233' : null),
    downloadVoiceNote: async () => Buffer.from('OggS voice bytes'),
    requestOlderMessages: vi.fn(async () => {}),
    requestMessage: vi.fn(async () => {}),
  };
  sync.connected(account);
  current = sync;
  return { stores, sync, account, queued };
}

/** The sync the test is using, so settle() can wait for its voice notes */
let current: WhatsAppSync | null = null;

/** Lets background work finish: at least 30 ms, then until no voice note is waiting (up to 2 s, on a busy machine) */
async function settle() {
  const deadline = Date.now() + 2000;
  await new Promise((resolve) => setTimeout(resolve, 30));
  while ((current?.stats().voiceNotesWaiting ?? 0) > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('matching chats to leads', () => {
  it('reads numbers the way they are typed in the CRM', () => {
    expect(internationalDigits('054-123-4567', '972')).toBe('972541234567');
    expect(internationalDigits('+972 54 123 4567', '972')).toBe('972541234567');
    expect(internationalDigits('00972541234567', '972')).toBe('972541234567');
    expect(internationalDigits('541234567', '972')).toBe('972541234567');
    expect(internationalDigits('+1 (415) 555-0100', '972')).toBe('14155550100');
    expect(internationalDigits('', '972')).toBeNull();
    expect(internationalDigits('123', '972')).toBeNull();
    const index = new LeadPhoneIndex(
      [
        { id: 'a', phone: '054-123-4567' },
        { id: 'b', phone: '+972541234567' },
        { id: 'c', phone: '' },
      ],
      '972',
    );
    expect(index.leadsFor('972541234567')).toEqual(['a', 'b']);
  });
});

describe('mirroring WhatsApp conversations', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('puts a lead’s messages on its timeline, one read-only entry per day', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    await h.sync.messages(
      [
        message('972541234567@s.whatsapp.net', { conversation: 'היי, ראיתי את האתר שלכם' }, '2026-10-22T08:02:00Z'),
        message('972541234567@s.whatsapp.net', { extendedTextMessage: { text: 'היי אמיר! מתי נוח לדבר?' } }, '2026-10-22T08:05:00Z', {}, { fromMe: true }),
        message('972541234567@s.whatsapp.net', { imageMessage: { caption: 'התפריט שלנו' } }, '2026-10-22T08:06:00Z'),
        message('972541234567@s.whatsapp.net', { conversation: 'אתמול' }, '2026-10-21T15:00:00Z'),
      ],
      'live',
    );
    const timeline = await h.stores.interactions.list(amir.id);
    expect(timeline.map((entry) => entry.id)).toEqual([`wa-${amir.id}-2026-10-22`, `wa-${amir.id}-2026-10-21`]);
    const today = timeline[0];
    expect(today).toMatchObject({ kind: 'whatsapp', source: 'whatsapp', step: null, stage: 'cold_call' });
    expect(today.at).toEqual(new Date('2026-10-22T08:06:00Z'));
    expect(today.chat.map((line) => [line.type, line.fromMe, line.text])).toEqual([
      ['text', false, 'היי, ראיתי את האתר שלכם'],
      ['text', true, 'היי אמיר! מתי נוח לדבר?'],
      ['image', false, 'התפריט שלנו'],
    ]);
    expect(today.body).toBe(['11:02 Amir: היי, ראיתי את האתר שלכם', '11:05 Me: היי אמיר! מתי נוח לדבר?', '11:06 Amir: [Photo] התפריט שלנו'].join('\n'));
  });

  it('keeps nothing from chats with people who aren’t leads, except the chat’s id and last message time', async () => {
    await lead(h.stores, { phone: '054-123-4567' });
    const stranger = message('972529998877@s.whatsapp.net', { conversation: 'Dinner tonight?' }, '2026-10-22T08:00:00Z');
    await h.sync.messages([stranger, message('120363000000000001@g.us', { conversation: 'group chat' }, '2026-10-22T08:00:00Z')], 'live');
    const everything = JSON.stringify(await Promise.all((await h.stores.leads.list()).map((item) => h.stores.interactions.list(item.id))));
    expect(everything).not.toContain('Dinner');
    expect(await h.stores.whatsapp.findChatsByPhone(['972529998877'])).toEqual([
      { jid: '972529998877@s.whatsapp.net', phone: '972529998877', lastId: stranger.key.id, lastFromMe: false, lastAt: new Date('2026-10-22T08:00:00Z') },
    ]);
  });

  it('finds the lead behind WhatsApp’s privacy ids', async () => {
    const dana = await lead(h.stores, { phone: '052-777-6655', contactName: 'Dana' });
    const yossi = await lead(h.stores, { phone: '054-111-2233', contactName: 'Yossi' });
    const noa = await lead(h.stores, { phone: '053-444-5566', contactName: 'Noa' });
    h.sync.lidMappings([{ lid: '55555@lid', pn: '972537775566@s.whatsapp.net' }]);
    h.sync.lidMappings([{ lid: '44444@lid', pn: '972534445566@s.whatsapp.net' }]);
    await h.sync.messages(
      [
        // The phone number came along with the privacy id
        message('11111@lid', { conversation: 'from Dana' }, '2026-10-22T08:00:00Z', {}, { remoteJidAlt: '972527776655@s.whatsapp.net' }),
        // Resolved through WhatsApp's own mapping
        message('99887766@lid', { conversation: 'from Yossi' }, '2026-10-22T08:01:00Z'),
        // Resolved through a mapping that came with the history
        message('44444@lid', { conversation: 'from Noa' }, '2026-10-22T08:02:00Z'),
      ],
      'history',
    );
    for (const [item, text] of [[dana, 'from Dana'], [yossi, 'from Yossi'], [noa, 'from Noa']] as const) {
      expect((await h.stores.interactions.list(item.id))[0].chat[0].text).toBe(text);
    }
  });

  it('stores a message once, however often it arrives, and skips notes to yourself', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    const hello = message('972541234567@s.whatsapp.net', { conversation: 'hello' }, '2026-10-22T08:00:00Z');
    await h.sync.messages([hello], 'history');
    await h.sync.messages([hello, { ...hello }], 'live');
    await h.sync.messages([message(`${ME}@s.whatsapp.net`, { conversation: 'note to self' }, '2026-10-22T08:00:00Z')], 'live');
    expect((await h.stores.interactions.list(amir.id))[0].chat).toHaveLength(1);
    expect(h.sync.stats().messages).toBe(1);
  });

  it('shows edits, and keeps only that a message existed when it is deleted for everyone', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    const offer = message('972541234567@s.whatsapp.net', { conversation: 'אפשר 5000?' }, '2026-10-22T08:00:00Z');
    const oops = message('972541234567@s.whatsapp.net', { conversation: 'wrong chat, sorry' }, '2026-10-22T08:01:00Z');
    await h.sync.messages([offer, oops], 'live');
    await h.sync.updates([
      { key: offer.key, update: { message: { editedMessage: { message: { conversation: 'אפשר 6000?' } } } } },
      { key: oops.key, update: { message: null, messageStubType: WAMessageStubType.REVOKE } },
    ]);
    const [entry] = await h.stores.interactions.list(amir.id);
    expect(entry.chat.map((line) => [line.text, line.edited, line.deleted])).toEqual([
      ['אפשר 6000?', true, false],
      ['', false, true],
    ]);
    expect(entry.body).toBe('11:00 Amir: אפשר 6000? (edited)\n11:01 Amir: [Deleted message]');
  });

  it('downloads new voice notes, transcribes them, and puts the transcript inside the conversation', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    await h.sync.messages([message('972541234567@s.whatsapp.net', voice(42), '2026-10-22T08:10:00Z')], 'live');
    await settle();
    const [entry] = await h.stores.interactions.list(amir.id);
    const [line] = entry.chat;
    expect(line).toMatchObject({ type: 'voice', seconds: 42, mediaError: null });
    expect(line.mediaId).toBeTruthy();
    const media = (await h.stores.media.get(line.mediaId!)) as MediaRecord;
    expect(media).toMatchObject({ leadId: amir.id, interactionId: entry.id, kind: 'audio', mimeType: 'audio/ogg' });
    expect(media.fileName).toBe('הודעה קולית מוואטסאפ 2026-10-22 11.10.ogg');
    expect(h.queued).toEqual([media.id]);

    expect(await h.sync.deliverTranscript(media, 'שלום, רציתי לשאול על המחיר')).toBe(true);
    const [after] = await h.stores.interactions.list(amir.id);
    expect(after.chat[0].transcript).toBe('שלום, רציתי לשאול על המחיר');
    expect(after.body).toBe('11:10 Amir: [Voice note 0:42] «שלום, רציתי לשאול על המחיר»');
    // Recordings on ordinary entries keep the usual delivery
    expect(await h.sync.deliverTranscript({ ...media, interactionId: 'call-1' }, 'x')).toBe(false);
  });

  it('leaves old voice notes for later, and fetches one when asked', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    await h.sync.messages([message('972541234567@s.whatsapp.net', voice(9), '2026-05-01T08:00:00Z')], 'history');
    await settle();
    let [entry] = await h.stores.interactions.list(amir.id);
    expect(entry.chat[0].mediaId).toBeNull();
    expect(entry.chat[0].ref).toBeTruthy();
    expect(h.queued).toEqual([]);

    await h.sync.fetchVoiceNote(amir.id, entry.chat[0].id);
    await settle();
    [entry] = await h.stores.interactions.list(amir.id);
    expect(entry.chat[0].mediaId).toBeTruthy();
    expect(h.queued).toHaveLength(1);
  });

  it('removes a deleted voice note’s recording too', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    const note = message('972541234567@s.whatsapp.net', voice(5), '2026-10-22T08:10:00Z');
    await h.sync.messages([note], 'live');
    await settle();
    const mediaId = (await h.stores.interactions.list(amir.id))[0].chat[0].mediaId!;
    await h.sync.updates([{ key: note.key, update: { message: null, messageStubType: WAMessageStubType.REVOKE } }]);
    expect(await h.stores.media.get(mediaId)).toBeNull();
  });

  it('asks your phone for older messages, starting from the oldest one it has', async () => {
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    const first = message('972541234567@s.whatsapp.net', { conversation: 'first' }, '2026-10-20T08:00:00Z');
    await h.sync.messages([first, message('972541234567@s.whatsapp.net', { conversation: 'later' }, '2026-10-22T08:00:00Z')], 'live');
    expect(await h.sync.fetchHistory(amir.id)).toMatchObject({ requested: true });
    expect(h.account.requestOlderMessages).toHaveBeenCalledWith(
      { chatJid: '972541234567@s.whatsapp.net', id: first.key.id, fromMe: false, at: new Date('2026-10-20T08:00:00Z') },
      50,
    );
  });

  it('pulls the chat of a lead added after the conversation started', async () => {
    const last = message('972541234567@s.whatsapp.net', { conversation: 'שלום, אפשר הצעת מחיר?' }, '2026-10-22T07:00:00Z');
    await h.sync.messages([last], 'live'); // not a lead yet: only the chat's id is kept
    const amir = await lead(h.stores, { phone: '054-123-4567' });
    h.sync.leadsChanged([amir.id]);
    await settle();
    expect(h.account.requestOlderMessages).toHaveBeenCalledWith(
      { chatJid: '972541234567@s.whatsapp.net', id: last.key.id, fromMe: false, at: new Date('2026-10-22T07:00:00Z') },
      50,
    );
    expect(h.account.requestMessage).toHaveBeenCalledWith({ remoteJid: '972541234567@s.whatsapp.net', id: last.key.id, fromMe: false });
    // The phone answers with a history batch, which lands on the new lead's timeline
    await h.sync.history({ chats: [], contacts: [], messages: [last], syncType: proto.HistorySync.HistorySyncType.ON_DEMAND, progress: 100 });
    expect((await h.stores.interactions.list(amir.id))[0].chat[0].text).toBe('שלום, אפשר הצעת מחיר?');
  });

  it('explains when history can’t be fetched', async () => {
    const nobody = await lead(h.stores, { phone: '' });
    expect(await h.sync.fetchHistory(nobody.id)).toEqual({ requested: false, message: 'הוסיפו את מספר הטלפון של הליד כדי למצוא את השיחה שלו בוואטסאפ.' });
    const fresh = await lead(h.stores, { phone: '058-000-0000' });
    expect(await h.sync.fetchHistory(fresh.id)).toMatchObject({ requested: false });
    h.sync.disconnected();
    expect(await h.sync.fetchHistory(fresh.id)).toEqual({ requested: false, message: 'וואטסאפ לא מחובר כרגע.' });
  });

  it('renders a conversation for the coach', () => {
    const at = new Date('2026-10-22T08:00:00Z');
    const base = { at, fromMe: false, seconds: null, mediaId: null, mediaError: null, transcript: null, edited: false, deleted: false, ref: null };
    expect(
      renderConversation(
        [
          { ...base, id: '1', type: 'text', text: 'line one\nline two' },
          { ...base, id: '2', type: 'voice', text: '', seconds: 75 },
          { ...base, id: '3', type: 'reaction', text: '👍', fromMe: true },
          { ...base, id: '4', type: 'call', text: 'Missed voice call' },
        ],
        'Amir',
        TZ,
      ),
    ).toBe(['11:00 Amir: line one\n  line two', '11:00 Amir: [Voice note 1:15, not transcribed]', '11:00 Me: [Reacted 👍]', '11:00 Amir: [Missed voice call]'].join('\n'));
  });
});

describe('the linked device’s keys', () => {
  const key = parseAuthKey(Buffer.alloc(32, 7).toString('base64'))!;

  it('accepts 32-byte keys only', () => {
    expect(parseAuthKey('a'.repeat(64))).toHaveLength(32);
    expect(parseAuthKey('too short')).toBeNull();
  });

  it('are sealed in the database, and open only with the same key and id', async () => {
    const stores = createMemoryStores();
    const auth = await openAuthState(stores.whatsapp, key);
    expect(isLinked(auth.state.creds)).toBe(false);
    auth.state.creds.me = { id: `${ME}:3@s.whatsapp.net`, name: 'Rozen' };
    await auth.saveCreds();
    await auth.state.keys.set({ 'pre-key': { '1': { public: Buffer.from('pub'), private: Buffer.from('secret-private-key') } } });

    const raw = await stores.whatsapp.readAuth(['creds', 'pre-key-1']);
    expect([...raw.values()].join(' ')).not.toMatch(/secret-private-key|Rozen|972500000001/);

    const again = await openAuthState(stores.whatsapp, key);
    expect(again.state.creds.me?.name).toBe('Rozen');
    expect(Buffer.from((await again.state.keys.get('pre-key', ['1']))['1'].private).toString()).toBe('secret-private-key');

    await expect(openAuthState(stores.whatsapp, Buffer.alloc(32, 9))).rejects.toThrow(AuthKeyMismatchError);
    const sealer = createSealer(key);
    expect(() => sealer.open('creds', raw.get('pre-key-1')!)).toThrow();
  });
});

describe('WhatsApp in the API', () => {
  it('keeps mirrored conversations read-only and their download details on the server', async () => {
    const stores = createMemoryStores();
    const fakeService: WhatsAppService = {
      status: () => ({
        enabled: true,
        link: { state: 'unlinked' },
        guard: { selfTest: 'pending', blocked: 0, critical: 0, recent: [] },
        sync: { messages: 0, lastMessageAt: null, historyProgress: null, voiceNotesWaiting: 0 },
        settings: { history: 'full', voiceNoteDays: 30, transcribes: false },
      }),
      link: vi.fn(async () => fakeService.status()),
      reconnect: async () => fakeService.status(),
      unlink: async () => ({ ...fakeService.status(), removedFromPhone: true }),
      fetchHistory: async () => ({ requested: true, message: 'Asked your phone.' }),
      fetchVoiceNote: async () => {},
      leadsChanged: vi.fn(),
      stop: () => {},
    };
    const app = createApp({ stores, storage: createLocalStorage(await mkdtemp(join(tmpdir(), 'omek-wa-api-'))), coach: null, whatsapp: fakeService });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);

    const created = await agent
      .post('/api/leads')
      .send({ id: randomUUID(), name: 'Galilee Bakery', phone: '054-123-4567', method: 'whatsapp' })
      .expect(201);
    expect(fakeService.leadsChanged).toHaveBeenCalledWith([created.body.id]);

    const h = new WhatsAppSync({ stores, storage: createLocalStorage(tmpdir()), transcription: null, timeZone: TZ, countryCode: '972', voiceNoteDays: 0, log: silent, clock: () => NOW });
    h.connected({ ownUsers: () => new Set([ME]), phoneForLid: async () => null, downloadVoiceNote: async () => Buffer.alloc(0), requestOlderMessages: async () => {}, requestMessage: async () => {} });
    await h.messages([message('972541234567@s.whatsapp.net', voice(3), '2026-10-01T08:00:00Z')], 'history');

    const timeline = await agent.get(`/api/leads/${created.body.id}/timeline`).expect(200);
    const [entry] = timeline.body.interactions;
    expect(entry.chat[0]).toMatchObject({ type: 'voice', canFetch: true });
    expect(entry.chat[0]).not.toHaveProperty('ref');
    expect(JSON.stringify(timeline.body)).not.toContain('mediaKey');

    await agent.patch(`/api/leads/${created.body.id}/interactions/${entry.id}`).send({ body: 'changed' }).expect(409);
    await agent.delete(`/api/leads/${created.body.id}/interactions/${entry.id}`).expect(409);
    await agent.post(`/api/leads/${created.body.id}/interactions`).send({ id: entry.id, kind: 'note', body: 'x' }).expect(400);

    expect((await agent.get('/api/features').expect(200)).body.whatsapp).toEqual({ enabled: true });
    await agent.post('/api/whatsapp/link').send({ phone: '054-123-4567' }).expect(200);
    expect(fakeService.link).toHaveBeenCalledWith('972541234567');
    await agent.post('/api/whatsapp/link').send({ phone: '12' }).expect(400);
    await agent.post(`/api/leads/${created.body.id}/whatsapp/history`).expect(202);
  });

  it('explains that WhatsApp is off', async () => {
    const app = createApp({ stores: createMemoryStores(), storage: createLocalStorage(tmpdir()), coach: null });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
    expect((await agent.get('/api/whatsapp').expect(200)).body).toEqual({ enabled: false, reason: 'הסנכרון עם וואטסאפ כבוי בשרת. הגדירו WHATSAPP=on כדי להפעיל אותו.' });
    await agent.post('/api/whatsapp/link').send({}).expect(503);
  });
});

it('reads voice note files it saved', async () => {
  const h = await harness();
  const amir = await lead(h.stores, { phone: '054-123-4567' });
  await h.sync.messages([message('972541234567@s.whatsapp.net', voice(2), '2026-10-22T08:10:00Z')], 'live');
  await settle();
  const mediaId = (await h.stores.interactions.list(amir.id))[0].chat[0].mediaId!;
  const media = (await h.stores.media.get(mediaId))!;
  const storage = (h.sync as unknown as { options: { storage: { withLocalFile: <T>(key: string, use: (path: string) => Promise<T>) => Promise<T> } } }).options.storage;
  expect(await storage.withLocalFile(media.storageKey, (path) => readFile(path, 'utf8'))).toBe('OggS voice bytes');
});
