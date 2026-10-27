import { appConfig } from '../../config';
import { eligibleForDraw, localDay, sample } from '../../lib/daily';
import { inPlay, pulseFrom } from '../../lib/dashboard';
import { dealFromStored } from '../../lib/deal';
import { ltr } from '../../lib/hebrew';
import { createId } from '../../lib/id';
import { patchLead } from '../../lib/leads';
import { recordingKind, recordingProblem } from '../../lib/media';
import { nicheCounts, nicheKey, nicheOf } from '../../lib/niche';
import { review } from '../../lib/practice';
import { safeStorage } from '../../lib/storage';
import { phoneDigits } from '../../lib/phone';
import { canImport, leadFromProspect } from '../../lib/prospects';
import { applyAction, entryAfterUndo, timelineEntryFor, undoAction } from '../../lib/workflow';
import type {
  CoachingReport,
  Interaction,
  Lead,
  LeadNote,
  MediaFile,
  NewLead,
  ObjectionCard,
  ProspectImport,
  ProspectSearchResults,
  Stage,
  TrainingDeck,
} from '../../types';
import { createSampleData } from '../sampleLeads';
import { createDemoSearch, DEMO_SEARCH_ID } from '../sampleProspector';
import { createStarterDeck, rewordCommon } from '../starterDeck';
import { createBlobStore } from './blobs';
import type { LeadRepository } from './types';

const STORAGE_KEY = 'omek-crm:leads:v1';
const DAILY_KEY = 'omek-crm:daily:v1';
const TIMELINE_KEY = 'omek-crm:timeline:v1';
const MEDIA_KEY = 'omek-crm:media:v1';
const COACHING_KEY = 'omek-crm:coaching:v1';
const TRAINING_KEY = 'omek-crm:training:v1';
/** Which businesses of the example Prospector search were imported, and as which lead */
const PROSPECTOR_DEMO_KEY = 'omek-crm:prospector-demo:v1';

const SERVER_ONLY_WHATSAPP =
  'האפליקציה לא מחוברת לשרת. סנכרון הוואטסאפ פועל בשרת: הוא מתקשר כאחד המכשירים שלך ומשקף שיחות עם לידים, לקריאה בלבד.';

const SERVER_ONLY_TAILORING =
  'האפליקציה לא מחוברת לשרת. את התשובות לכל סוג עסק כותב מאמן ה-AI בשרת (יש גם חינמי, של Gemini). בינתיים התשובות כלליות.';

const SERVER_ONLY_PROSPECTOR = `האפליקציה לא מחוברת לשרת, ולכן אפשר רק לנסות חיפוש לדוגמה. את החיפוש בגוגל ואת בדיקת האתרים עושה השרת: מפעילים אותו, מגדירים ${ltr('VITE_API_URL=/api')} בקובץ ה-${ltr('.env')} של האפליקציה ומריצים אותה מחדש.`;

/** Recordings kept in this browser are capped well below what browsers allow a site. */
const LOCAL_UPLOAD_MB = 200;

type StoredLead = Partial<Lead> &
  Pick<Lead, 'id' | 'name' | 'createdAt' | 'updatedAt'> & { status?: string; notes?: LeadNote[]; value?: number };

/**
 * Leads saved by an earlier version used statuses, and kept notes on the lead; this maps them onto the funnel.
 * Before deal terms, a closed deal had one amount, `value`: it becomes the setup fee.
 */
function upgrade(stored: StoredLead): Lead {
  const { notes: _notes, status: _status, value: _value, ...lead } = stored;
  if (lead.stage) {
    return { email: '', website: '', campaign: '', approach: '', activity: [], ...lead, deal: dealFromStored(stored) } as Lead;
  }
  const status = stored.status ?? 'new';
  const stage: Stage = status === 'in_talks' ? 'zoom' : status === 'won' ? 'closed' : 'cold_call';
  return {
    contactName: '',
    phone: '',
    method: 'call',
    currency: 'ILS',
    ...lead,
    email: lead.email ?? '',
    website: '',
    campaign: '',
    approach: '',
    stage,
    stageChangedAt: lead.updatedAt,
    archivedAt: status === 'lost' ? lead.updatedAt : null,
    attemptCount: status === 'no_answer' ? 1 : 0,
    lastAttemptAt: status === 'no_answer' ? lead.updatedAt : null,
    deal: dealFromStored({ ...stored, stage }),
    activity: [],
  };
}

const notesToTimeline = (lead: Pick<Lead, 'id' | 'stage'>, notes: readonly LeadNote[] = []): Interaction[] =>
  notes.map((note) => ({
    id: note.id,
    leadId: lead.id,
    kind: 'note',
    outcome: null,
    body: note.body,
    step: null,
    stage: lead.stage,
    stageTo: null,
    at: note.createdAt,
    updatedAt: note.createdAt,
  }));

/** Leads saved before the timeline existed: their steps and notes become its first entries. */
const legacyTimeline = (stored: readonly StoredLead[], leads: readonly Lead[]): Interaction[] =>
  leads.flatMap((lead, index) => [
    ...lead.activity.map((step) => timelineEntryFor(step, lead.id)),
    ...notesToTimeline(lead, stored[index]?.notes),
  ]);

function readJson<T>(key: string): T | null {
  const raw = safeStorage.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const byNewest = <T extends { at?: string; createdAt?: string }>(items: T[]) =>
  // Entries saved at the same moment keep the later one first, like the server.
  [...items].reverse().sort((a, b) => Date.parse(b.at ?? b.createdAt ?? '') - Date.parse(a.at ?? a.createdAt ?? ''));

/**
 * Keeps leads, timelines and recordings in this browser (localStorage, and IndexedDB for the files)
 * and seeds the sample leads on first run. When storage is blocked it keeps working in memory for the session.
 */
export function createLocalRepository(): LeadRepository {
  let cache: Lead[] | null = null;
  let timelineCache: Interaction[] | null = null;
  let mediaCache: MediaFile[] | null = null;
  let coachingCache: CoachingReport[] | null = null;
  let dailyCache: { date: string; leadIds: string[] } | null = null;
  let deckCache: TrainingDeck | null = null;
  const blobs = createBlobStore();

  /**
   * The starter deck on first use: the common cold-call objections. An earlier version kept a sample deck built
   * from the made-up sample leads; that one is replaced too.
   */
  const readDeck = (): TrainingDeck => {
    if (deckCache) return deckCache;
    const stored = readJson<TrainingDeck>(TRAINING_KEY);
    if (stored && Array.isArray(stored.cards) && stored.run?.provider !== 'sample') {
      // The common objections in their current words, if an update reworded them
      const reworded = rewordCommon(stored);
      if (reworded) saveDeck(reworded);
      return (deckCache = reworded ?? stored);
    }
    const deck = createStarterDeck();
    saveDeck(deck);
    return deck;
  };
  const saveDeck = (deck: TrainingDeck) => {
    deckCache = deck;
    safeStorage.set(TRAINING_KEY, JSON.stringify(deck));
  };
  const changeCard = (cardId: string, change: (card: ObjectionCard) => ObjectionCard) => {
    const deck = readDeck();
    const card = deck.cards.find((item) => item.id === cardId);
    if (!card) throw new Error('הכרטיסייה הזו כבר לא בחפיסה.');
    const next = { ...change(card), updatedAt: new Date().toISOString() };
    saveDeck({ ...deck, cards: deck.cards.map((item) => (item.id === cardId ? next : item)) });
    return structuredClone(next);
  };

  const save = (leads: Lead[]) => {
    cache = leads;
    safeStorage.set(STORAGE_KEY, JSON.stringify(leads));
  };
  const saveTimeline = (entries: Interaction[]) => {
    timelineCache = entries;
    safeStorage.set(TIMELINE_KEY, JSON.stringify(entries));
  };
  const saveMedia = (files: MediaFile[]) => {
    mediaCache = files;
    safeStorage.set(MEDIA_KEY, JSON.stringify(files));
  };
  const saveCoaching = (reports: CoachingReport[]) => {
    coachingCache = reports;
    safeStorage.set(COACHING_KEY, JSON.stringify(reports));
  };

  const read = (): Lead[] => {
    if (cache) return cache;
    const stored = readJson<unknown>(STORAGE_KEY);
    if (Array.isArray(stored)) {
      const leads = (stored as StoredLead[]).map(upgrade);
      cache = leads;
      if (!Array.isArray(readJson(TIMELINE_KEY))) saveTimeline(legacyTimeline(stored as StoredLead[], leads));
      return leads;
    }
    const seeded = createSampleData();
    save(seeded.leads);
    saveTimeline(seeded.interactions);
    saveCoaching(seeded.coaching);
    saveMedia([]);
    return seeded.leads;
  };
  const readTimeline = (): Interaction[] => {
    read();
    return (timelineCache ??= readJson<Interaction[]>(TIMELINE_KEY) ?? []);
  };
  const readMedia = (): MediaFile[] => (mediaCache ??= readJson<MediaFile[]>(MEDIA_KEY) ?? []);
  const readCoaching = (): CoachingReport[] => (coachingCache ??= readJson<CoachingReport[]>(COACHING_KEY) ?? []);

  const find = (id: string) => {
    const lead = read().find((item) => item.id === id);
    if (!lead) throw new Error('הליד הזה כבר לא קיים.');
    return lead;
  };

  const replace = (next: Lead) => {
    save(read().map((item) => (item.id === next.id ? next : item)));
    return structuredClone(next);
  };
  const touched = (lead: Lead): Lead => ({ ...lead, updatedAt: new Date().toISOString() });

  const addEntries = (entries: Interaction[]) => {
    const taken = new Set(readTimeline().map((entry) => entry.id));
    const fresh = entries.filter((entry) => !taken.has(entry.id));
    if (fresh.length) saveTimeline([...readTimeline(), ...fresh]);
  };
  const findEntry = (leadId: string, id: string) => {
    const entry = readTimeline().find((item) => item.id === id && item.leadId === leadId);
    if (!entry) throw new Error('הרשומה הזו כבר לא קיימת בציר הזמן.');
    return entry;
  };

  const forget = async (ids: readonly string[]) => {
    const doomed = new Set(ids);
    save(read().filter((item) => !doomed.has(item.id)));
    saveTimeline(readTimeline().filter((entry) => !doomed.has(entry.leadId)));
    saveCoaching(readCoaching().filter((report) => !doomed.has(report.leadId)));
    const files = readMedia().filter((file) => doomed.has(file.leadId));
    if (files.length) {
      saveMedia(readMedia().filter((file) => !doomed.has(file.leadId)));
      await blobs.remove(files.map((file) => file.id)).catch(() => {});
    }
  };

  const readDaily = (date: string) => {
    if (dailyCache?.date === date) return dailyCache;
    try {
      const stored = JSON.parse(safeStorage.get(DAILY_KEY) ?? 'null') as typeof dailyCache;
      if (stored?.date === date && Array.isArray(stored.leadIds)) return (dailyCache = stored);
    } catch {
      // A fresh draw follows.
    }
    return null;
  };

  const strip = ({ notes: _notes, ...lead }: NewLead): Lead => lead;

  const createMany = async (newLeads: NewLead[]) => {
    const taken = new Set(read().map((lead) => lead.id));
    const created: Lead[] = [];
    const skippedIds: string[] = [];
    for (const newLead of newLeads) {
      if (taken.has(newLead.id)) skippedIds.push(newLead.id);
      else {
        created.push(strip(newLead));
        addEntries(notesToTimeline(newLead, newLead.notes));
      }
      taken.add(newLead.id);
    }
    save([...created, ...read()]);
    return { created: structuredClone(created), skippedIds };
  };

  /** The example Prospector search, with what was imported from it */
  const readDemo = (): ProspectSearchResults => {
    const imported = readJson<Record<string, { leadId: string; at: string }>>(PROSPECTOR_DEMO_KEY) ?? {};
    const demo = createDemoSearch();
    const prospects = demo.prospects.map((prospect) => {
      const done = imported[prospect.id];
      return done ? { ...prospect, importedLeadId: done.leadId, importedAt: done.at } : prospect;
    });
    return { search: { ...demo.search, imported: prospects.filter((prospect) => prospect.importedLeadId).length }, prospects };
  };

  return {
    kind: 'local',
    async list() {
      return structuredClone(read());
    },
    async create(newLead) {
      const lead = strip(newLead);
      save([lead, ...read().filter((item) => item.id !== lead.id)]);
      addEntries(notesToTimeline(lead, newLead.notes));
      return lead;
    },
    createMany,
    async update(id, patch) {
      const lead = find(id);
      if ((patch.deal !== undefined || patch.currency !== undefined) && lead.stage !== 'closed') {
        throw new Error('אפשר להוסיף את סכומי העסקה רק אחרי שהעסקה נסגרה.');
      }
      return replace(touched(patchLead(lead, patch)));
    },
    async act(id, action, details = {}) {
      const saved = replace(applyAction(find(id), action, details.at ? new Date(details.at) : new Date()));
      const step = saved.activity.find((entry) => entry.id === action.id);
      if (step) addEntries([timelineEntryFor(step, id, details.body, details.channel)]);
      return saved;
    },
    async undo(id, actionId) {
      const saved = replace(undoAction(find(id), actionId, new Date()));
      const entry = readTimeline().find((item) => item.id === actionId && item.leadId === id);
      if (entry?.step) {
        const after = entryAfterUndo(entry, readMedia().some((file) => file.interactionId === actionId));
        saveTimeline(
          after
            ? readTimeline().map((item) => (item.id === actionId ? after : item))
            : readTimeline().filter((item) => item.id !== actionId),
        );
      }
      return saved;
    },
    async remove(id) {
      await forget([id]);
    },
    async removeMany(ids) {
      await forget(ids);
    },
    async daily() {
      const quota = appConfig.dailyQuota;
      const { date, startsAt, endsAt } = localDay();
      const leads = read();
      const existing = readDaily(date);
      const queued = existing?.leadIds ?? [];
      const pool = eligibleForDraw(leads, startsAt, new Set(queued));
      const picked = sample(pool, Math.max(0, quota - queued.length));
      const leadIds = [...queued, ...picked];
      if (!existing || picked.length > 0) {
        dailyCache = { date, leadIds };
        safeStorage.set(DAILY_KEY, JSON.stringify(dailyCache));
      }
      return {
        date,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        leadIds,
        poolSize: pool.length - picked.length,
        quota,
      };
    },

    async dashboard() {
      const entries = readTimeline();
      const reports = readCoaching();
      return structuredClone({
        pulses: read()
          .filter(inPlay)
          .map((lead) =>
            pulseFrom(
              lead.id,
              byNewest(entries.filter((entry) => entry.leadId === lead.id)),
              byNewest(reports.filter((report) => report.leadId === lead.id))[0] ?? null,
            ),
          ),
      });
    },

    async timeline(leadId) {
      find(leadId);
      const reports = readCoaching().filter((report) => report.leadId === leadId);
      return structuredClone({
        interactions: byNewest(readTimeline().filter((entry) => entry.leadId === leadId)),
        media: byNewest(readMedia().filter((file) => file.leadId === leadId)),
        coaching: byNewest(reports)[0] ?? null,
      });
    },
    async addInteraction(leadId, message) {
      const lead = find(leadId);
      const existing = readTimeline().find((entry) => entry.id === message.id);
      if (existing) return structuredClone(existing);
      const at = message.at ?? new Date().toISOString();
      const entry: Interaction = {
        id: message.id,
        leadId,
        kind: message.kind,
        outcome: null,
        body: message.body.trim(),
        step: null,
        stage: lead.stage,
        stageTo: null,
        at,
        updatedAt: at,
      };
      addEntries([entry]);
      return structuredClone(entry);
    },
    async updateInteraction(leadId, interactionId, body, expectedUpdatedAt) {
      const current = findEntry(leadId, interactionId);
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) throw new Error('הרשומה השתנתה בזמן שערכת אותה.');
      const entry = { ...current, body: body.trim(), updatedAt: new Date().toISOString() };
      saveTimeline(readTimeline().map((item) => (item.id === interactionId ? entry : item)));
      return structuredClone(entry);
    },
    async removeInteraction(leadId, interactionId) {
      const entry = readTimeline().find((item) => item.id === interactionId && item.leadId === leadId);
      if (!entry) return;
      if (entry.step) throw new Error('הרשומה הזו מתעדת צעד במשפך. אפשר לבטל את הצעד תוך 10 דקות, או למחוק את הסיכום שלה.');
      saveTimeline(readTimeline().filter((item) => item.id !== interactionId));
      saveMedia(readMedia().map((file) => (file.interactionId === interactionId ? { ...file, interactionId: null } : file)));
    },
    async uploadMedia(leadId, file, { interactionId, onProgress }) {
      find(leadId);
      const problem = recordingProblem(file, LOCAL_UPLOAD_MB);
      if (problem) throw new Error(problem);
      if (interactionId) findEntry(leadId, interactionId);
      const media: MediaFile = {
        id: createId(),
        leadId,
        interactionId,
        kind: recordingKind(file) ?? 'audio',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        // Transcripts need the server (ffmpeg and an OpenAI key), so recordings kept here have none.
        transcription: null,
        createdAt: new Date().toISOString(),
      };
      await blobs.put(media.id, file);
      saveMedia([...readMedia(), media]);
      onProgress?.(1);
      return structuredClone(media);
    },
    async mediaStatus(leadId) {
      find(leadId);
      return structuredClone(byNewest(readMedia().filter((file) => file.leadId === leadId)));
    },
    async transcribe() {
      throw new Error('התמלול נעשה בשרת. חברו את השרת כדי לתמלל הקלטות.');
    },
    async mediaSource(media) {
      const blob = await blobs.get(media.id);
      if (!blob) throw new Error('ההקלטה הזו כבר לא שמורה בדפדפן הזה.');
      return URL.createObjectURL(blob);
    },
    releaseMediaSource(url) {
      URL.revokeObjectURL(url);
    },
    async removeMedia(media) {
      saveMedia(readMedia().filter((file) => file.id !== media.id));
      await blobs.remove([media.id]).catch(() => {});
    },
    async coach() {
      throw new Error('האפליקציה לא מחוברת לשרת. מאמן ה-AI פועל בשרת, עם מפתח AI (יש גם חינמי, של Gemini).');
    },
    async features() {
      return {
        coach: null,
        media: { storage: 'browser', maxUploadMb: LOCAL_UPLOAD_MB },
        transcription: { enabled: false, reason: 'התמלול נעשה בשרת, עם ffmpeg ומפתח של OpenAI.' },
        whatsapp: { enabled: false, reason: SERVER_ONLY_WHATSAPP },
        prospector: { enabled: false, reason: SERVER_ONLY_PROSPECTOR },
      };
    },
    async whatsappStatus() {
      return { enabled: false, reason: SERVER_ONLY_WHATSAPP };
    },
    async linkWhatsApp() {
      throw new Error(SERVER_ONLY_WHATSAPP);
    },
    async reconnectWhatsApp() {
      throw new Error(SERVER_ONLY_WHATSAPP);
    },
    async unlinkWhatsApp() {
      throw new Error(SERVER_ONLY_WHATSAPP);
    },
    async fetchWhatsAppHistory() {
      return { requested: false, message: SERVER_ONLY_WHATSAPP };
    },
    async fetchVoiceNote() {
      throw new Error(SERVER_ONLY_WHATSAPP);
    },
    async trainingDeck() {
      return structuredClone(readDeck());
    },
    async generateDeck() {
      throw new Error('האפליקציה לא מחוברת לשרת. מאמן ה-AI בשרת מוסיף לחפיסה את ההתנגדויות שהלקוחות שלך אומרים, מתוך השיחות שלך. בינתיים אפשר להתאמן על ההתנגדויות הנפוצות.');
    },
    async reviewCard(cardId, grade, at) {
      return changeCard(cardId, (card) =>
        at && card.practice.lastReviewedAt === at ? card : { ...card, practice: review(card.practice, grade, at ? new Date(at) : new Date()) },
      );
    },
    async saveCardResponse(cardId, myResponse) {
      return changeCard(cardId, (card) => ({ ...card, myResponse: myResponse.trim() }));
    },
    async trainingNiches() {
      return { niches: nicheCounts(read()).map(({ key, niche, count }) => ({ key, label: niche, leads: count, tailored: null })), tailoring: [] };
    },
    async nicheVariants(niche) {
      const label = nicheOf(niche);
      return { niche: { key: nicheKey(label), label }, variants: [], provider: null, model: null, updatedAt: null, tailoring: false, error: null };
    },
    async tailorDeck() {
      throw new Error(SERVER_ONLY_TAILORING);
    },
    async prospector() {
      return { enabled: false, reason: SERVER_ONLY_PROSPECTOR, searches: [readDemo().search] };
    },
    async startProspectSearch() {
      throw new Error(SERVER_ONLY_PROSPECTOR);
    },
    async prospectSearch(id) {
      if (id !== DEMO_SEARCH_ID) throw new Error('החיפוש הזה כבר לא קיים.');
      return readDemo();
    },
    async cancelProspectSearch() {
      throw new Error(SERVER_ONLY_PROSPECTOR);
    },
    async removeProspectSearch() {
      throw new Error('את החיפוש לדוגמה אי אפשר למחוק.');
    },
    async recheckProspect() {
      throw new Error(SERVER_ONLY_PROSPECTOR);
    },
    prospectScreenshot: () => null,
    async importProspects(ids) {
      const { search, prospects } = readDemo();
      const byPhone = new Map(read().flatMap((lead) => (phoneDigits(lead.phone) ? [[phoneDigits(lead.phone), lead.id] as const] : [])));
      const result: ProspectImport = { created: [], skipped: [] };
      const planned: { prospectId: string; lead: NewLead }[] = [];
      for (const id of new Set(ids)) {
        const prospect = prospects.find((item) => item.id === id);
        const digits = prospect ? phoneDigits(prospect.phone) : '';
        if (!prospect) result.skipped.push({ id, reason: 'missing' });
        else if (!canImport(prospect)) result.skipped.push({ id, reason: 'imported', leadId: prospect.importedLeadId ?? undefined });
        else if (digits && byPhone.has(digits)) result.skipped.push({ id, reason: 'exists', leadId: byPhone.get(digits) });
        else {
          const lead = leadFromProspect(prospect, search);
          planned.push({ prospectId: id, lead });
          if (digits) byPhone.set(digits, lead.id);
        }
      }
      if (planned.length) {
        result.created = (await createMany(planned.map((item) => item.lead))).created;
        const imported = readJson<Record<string, { leadId: string; at: string }>>(PROSPECTOR_DEMO_KEY) ?? {};
        for (const { prospectId, lead } of planned) imported[prospectId] = { leadId: lead.id, at: lead.createdAt };
        safeStorage.set(PROSPECTOR_DEMO_KEY, JSON.stringify(imported));
      }
      return result;
    },
    async addSamples() {
      const taken = new Set(read().map((lead) => lead.id));
      const samples = createSampleData();
      const leads = samples.leads.filter((lead) => !taken.has(lead.id));
      const ids = new Set(leads.map((lead) => lead.id));
      save([...leads, ...read()]);
      addEntries(samples.interactions.filter((entry) => ids.has(entry.leadId)));
      saveCoaching([...readCoaching(), ...samples.coaching.filter((report) => ids.has(report.leadId))]);
      return structuredClone(leads);
    },
  };
}
