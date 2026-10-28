import type { LeadInput, LeadPatch } from '../leads/leads.schemas.js';
import type { ActivityRecord, DealTerms, InteractionOutcome, Stage, WorkflowState } from '../leads/workflow.js';
import type { ProspectorStore } from '../prospector/types.js';

/** A lead as the API returns it (the frontend's Lead type, once serialized). */
export interface LeadRecord extends WorkflowState {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  campaign: string;
  approach: string;
  method: LeadInput['method'];
  currency: LeadInput['currency'];
  activity: ActivityRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export type InteractionKind = 'call' | 'zoom' | 'whatsapp' | 'email' | 'note';

export type ChatLineType =
  | 'text'
  | 'voice'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'reaction'
  | 'call'
  | 'other';

/** One message of a WhatsApp conversation mirrored onto the timeline (src/whatsapp) */
export interface ChatLine {
  /** WhatsApp's id for the message */
  id: string;
  at: Date;
  /** Sent from your phone (or another device on your number); otherwise by the lead */
  fromMe: boolean;
  type: ChatLineType;
  /** The text, a caption, or a short description such as "Location: Tiberias" */
  text: string;
  /** Voice notes and audio: length in seconds */
  seconds: number | null;
  /** Voice notes: the recording kept for it, once downloaded */
  mediaId: string | null;
  /** Why a voice note couldn't be downloaded */
  mediaError: string | null;
  /** Voice notes: the automatic transcript */
  transcript: string | null;
  edited: boolean;
  deleted: boolean;
  /** What's needed to download the voice note later. Never sent to the browser. */
  ref: string | null;
}

export interface InteractionRecord {
  id: string;
  leadId: string;
  kind: InteractionKind;
  outcome: InteractionOutcome | null;
  /** Notes or a transcript of what was said */
  body: string;
  /** The workflow step this entry records, or null for notes and messages */
  step: ActivityRecord['type'] | null;
  stage: Stage;
  stageTo: Stage | null;
  at: Date;
  /** Null for entries logged in the app; 'whatsapp' for a conversation mirrored from WhatsApp (read-only) */
  source: 'whatsapp' | null;
  /** The mirrored conversation, oldest message first (empty for everything else) */
  chat: ChatLine[];
  updatedAt: Date;
}

export type TranscriptStatus = 'queued' | 'running' | 'done' | 'failed';

/** A recording's automatic transcript job (see src/transcription) */
export interface TranscriptionRecord {
  status: TranscriptStatus;
  /** Parts sent so far, out of partsTotal (0 while the audio is being prepared) */
  partsDone: number;
  partsTotal: number;
  /** Runs started; a job that keeps failing stops being resumed after restarts */
  attempts: number;
  /** Why it failed, in words for the timeline */
  error: string | null;
  /** The finished transcript, kept so a retried job never adds it to the entry twice */
  text: string | null;
  words: number;
  updatedAt: Date;
}

export interface MediaRecord {
  id: string;
  leadId: string;
  interactionId: string | null;
  kind: 'audio' | 'video';
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  /** Null when no transcript was asked for */
  transcription: TranscriptionRecord | null;
  createdAt: Date;
}

export interface CoachingRecord {
  id: string;
  leadId: string;
  provider: string;
  model: string;
  interactionCount: number;
  analysis: unknown;
  createdAt: Date;
}

export interface BulkCreateResult {
  created: LeadRecord[];
  /** Ids that already existed, or appeared twice in the request */
  skippedIds: string[];
}

/** What the daily draw needs to know about a Cold Call lead */
export interface PoolCandidate {
  id: string;
  archivedAt: Date | null;
  lastAttemptAt: Date | null;
  /** Picked up at least once: contacted, so no longer drawn at random */
  answered: boolean;
}

/** A change to a lead's details, with the deal's amounts already merged into a whole set */
export type LeadUpdate = Omit<LeadPatch, 'deal'> & { deal?: DealTerms };

/** Data access for leads. Production uses the Prisma store; tests and STORAGE=memory use the in-memory one. */
export interface LeadStore {
  list(): Promise<LeadRecord[]>;
  get(id: string): Promise<LeadRecord | null>;
  /** Throws ConflictError when the id is taken */
  create(input: LeadInput): Promise<LeadRecord>;
  /** Creates every lead with a new id in one write */
  createMany(inputs: LeadInput[]): Promise<BulkCreateResult>;
  /** Null when the lead doesn't exist */
  update(id: string, patch: LeadUpdate): Promise<LeadRecord | null>;
  /** Writes a workflow change, only if the lead hasn't changed since `expectedUpdatedAt`. Null otherwise. */
  saveWorkflow(id: string, expectedUpdatedAt: Date, state: WorkflowState): Promise<LeadRecord | null>;
  removeMany(ids: string[]): Promise<void>;
  /** Every lead at Cold Call, archived or not */
  poolCandidates(): Promise<PoolCandidate[]>;
  /** Throws when the database can't be reached */
  ping(): Promise<void>;
}

export type NewInteraction = Omit<InteractionRecord, 'updatedAt' | 'source' | 'chat'> &
  Partial<Pick<InteractionRecord, 'source' | 'chat'>>;

/** A mirrored conversation's new state. `create` is used when the entry doesn't exist yet. */
export interface ChatWrite {
  create: NewInteraction;
  chat: ChatLine[];
  body: string;
  at: Date;
}
export type InteractionChange = Partial<Pick<InteractionRecord, 'body' | 'kind' | 'outcome' | 'step' | 'stageTo'>>;

export interface InteractionStore {
  /** Newest first */
  list(leadId: string): Promise<InteractionRecord[]>;
  get(leadId: string, id: string): Promise<InteractionRecord | null>;
  /** Saving the same id twice keeps the first copy, so retried requests are safe. */
  create(record: NewInteraction): Promise<InteractionRecord>;
  createMany(records: NewInteraction[]): Promise<void>;
  /**
   * Null when the entry doesn't exist on this lead. With `expectedUpdatedAt`, throws ConflictError
   * when the entry changed since then (a transcript was added while the text was being edited).
   */
  update(leadId: string, id: string, change: InteractionChange, expectedUpdatedAt?: Date): Promise<InteractionRecord | null>;
  /**
   * Adds text after the entry's body, safely alongside other writes. Adding the same text twice
   * changes nothing, so a retried transcript job is harmless. Null when the entry is gone.
   */
  appendBody(leadId: string, id: string, text: string): Promise<InteractionRecord | null>;
  remove(leadId: string, id: string): Promise<void>;
  removeForLeads(leadIds: string[]): Promise<void>;
  /**
   * Creates or rewrites a mirrored conversation. `change` gets the entry as it is now (null when there is
   * none yet) and returns its new state, or null to leave it; it runs again if another write got in first.
   */
  writeChat(leadId: string, id: string, change: (current: InteractionRecord | null) => ChatWrite | null): Promise<InteractionRecord | null>;
  /** The mirrored entry holding a WhatsApp message */
  findChatEntry(leadId: string, messageId: string): Promise<InteractionRecord | null>;
  /** The lead's oldest mirrored conversation */
  oldestChat(leadId: string): Promise<InteractionRecord | null>;
  /** For the dashboard: each lead's newest entry, and its newest Zoom meeting. Leads without entries are left out. */
  latestByLead(leadIds: string[]): Promise<Map<string, LatestEntries>>;
}

export interface LatestEntries {
  last: Pick<InteractionRecord, 'at' | 'kind' | 'outcome'>;
  zoom: Pick<InteractionRecord, 'at' | 'outcome'> | null;
}

export interface MediaStore {
  /** Newest first */
  list(leadId: string): Promise<MediaRecord[]>;
  get(id: string): Promise<MediaRecord | null>;
  create(record: Omit<MediaRecord, 'createdAt'>): Promise<MediaRecord>;
  /** Keeps recordings when their timeline entry goes away (an undone step), attached to the lead instead */
  detach(interactionId: string): Promise<void>;
  /** Moves a recording onto a timeline entry */
  attach(id: string, interactionId: string): Promise<void>;
  /** Null when the recording is gone */
  setTranscription(id: string, transcription: TranscriptionRecord | null): Promise<MediaRecord | null>;
  /** Recordings whose transcript was queued or running, oldest first: picked up again after a restart */
  pendingTranscriptions(): Promise<MediaRecord[]>;
  remove(id: string): Promise<void>;
  /** Removes the records and returns them, so their files can be deleted */
  removeForLeads(leadIds: string[]): Promise<MediaRecord[]>;
}

export interface CoachingStore {
  latest(leadId: string): Promise<CoachingRecord | null>;
  /** Each lead's newest report, for the dashboard. Leads without one are left out. */
  latestForLeads(leadIds: string[]): Promise<Map<string, CoachingRecord>>;
  create(record: Omit<CoachingRecord, 'id' | 'createdAt'>): Promise<CoachingRecord>;
  removeForLeads(leadIds: string[]): Promise<void>;
}

export interface DailyStore {
  find(date: string): Promise<{ leadIds: string[]; version: number } | null>;
  /** False when another request created the day first */
  create(date: string, leadIds: string[]): Promise<boolean>;
  /** False when the queue changed since `version` was read */
  extend(date: string, version: number, leadIds: string[]): Promise<boolean>;
}

/** A chat seen on the linked WhatsApp account: ids and times only, never text */
export interface WhatsAppChatRecord {
  /** How WhatsApp addresses the chat: a phone number or a privacy id (…@lid) */
  jid: string;
  /** International digits, when known */
  phone: string | null;
  lastId: string;
  lastFromMe: boolean;
  lastAt: Date;
}

export interface WhatsAppStore {
  /** Saves chats, keeping each one's newest last message */
  saveChats(chats: WhatsAppChatRecord[]): Promise<void>;
  /** Newest first */
  findChatsByPhone(phones: string[]): Promise<WhatsAppChatRecord[]>;
  /** Sealed values of the linked device's credentials and keys, by id */
  readAuth(ids: string[]): Promise<Map<string, string>>;
  /** A null value deletes the key */
  writeAuth(entries: { id: string; value: string | null }[]): Promise<void>;
  /** Forgets the linked device entirely */
  clearAuth(): Promise<void>;
}

export const OBJECTION_CATEGORIES = ['price', 'timing', 'trust', 'need', 'authority', 'competition', 'diy', 'other'] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

/** Where an objection was heard: one quote from one lead's timeline */
export interface ObjectionSource {
  leadId: string;
  leadName: string;
  interactionId: string;
  at: Date;
  /** The prospect's words, as transcribed or noted */
  quote: string;
}

/** Spaced repetition (Leitner boxes): box 1 comes up every session, box 5 every two weeks */
export interface PracticeState {
  box: number;
  dueAt: Date;
  reviews: number;
  /** Times it was graded "Missed" */
  lapses: number;
  /** 1 missed, 2 hard, 3 good, 4 easy */
  lastGrade: number | null;
  lastReviewedAt: Date | null;
}

/** A flashcard: an objection prospects keep raising, and how to answer it */
export interface ObjectionCardRecord {
  id: string;
  /** Stable across analyses ("price-too-high"), so a fresh analysis updates the card instead of adding a copy */
  key: string;
  category: ObjectionCategory;
  /** The objection as prospects say it */
  objection: string;
  /** What usually sits behind it */
  insight: string;
  /** The answer to practise, in spoken words */
  response: string;
  alternatives: string[];
  /** A question that keeps the conversation going after the answer */
  followUp: string;
  /** Leads that raised it, and how many times it came up */
  leadCount: number;
  mentions: number;
  sources: ObjectionSource[];
  /** Your own version of the answer */
  myResponse: string;
  practice: PracticeState;
  /** No longer found by the latest analysis; kept with its practice history */
  retired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ObjectionCardDraft = Pick<
  ObjectionCardRecord,
  'key' | 'category' | 'objection' | 'insight' | 'response' | 'alternatives' | 'followUp' | 'leadCount' | 'mentions' | 'sources'
>;

/** A card's words: what the deck shows and practises */
export type ObjectionWording = Pick<ObjectionCardRecord, 'key' | 'category' | 'objection' | 'insight' | 'response' | 'alternatives' | 'followUp'>;

/** A card's answer tailored to one niche: the same objection, answered in that kind of business's terms */
export interface ObjectionVariantRecord {
  id: string;
  /** The niche as compared (nicheKey): "מסעדות", "restaurants" */
  niche: string;
  /** The niche as it was written */
  label: string;
  /** The card it tailors */
  cardKey: string;
  /** How an owner in this niche says it */
  objection: string;
  insight: string;
  response: string;
  alternatives: string[];
  followUp: string;
  provider: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ObjectionVariantDraft = Pick<ObjectionVariantRecord, 'cardKey' | 'objection' | 'insight' | 'response' | 'alternatives' | 'followUp'>;

/** A niche whose answers were tailored */
export interface TailoredNiche {
  niche: string;
  label: string;
  cards: number;
  updatedAt: Date;
}

/** One analysis of past conversations that built or refreshed the deck */
export interface TrainingRunRecord {
  id: string;
  provider: string;
  model: string;
  language: string;
  leadsAnalyzed: number;
  entriesAnalyzed: number;
  /** Call transcripts and WhatsApp conversations among the entries */
  conversations: number;
  cards: number;
  createdAt: Date;
}

export interface TrainingStore {
  /** Most raised first */
  cards(): Promise<ObjectionCardRecord[]>;
  card(id: string): Promise<ObjectionCardRecord | null>;
  /**
   * Saves a fresh analysis. A card whose key is already in the deck keeps its practice history and your
   * answer; cards the analysis no longer finds are retired.
   */
  saveRun(drafts: ObjectionCardDraft[], run: Omit<TrainingRunRecord, 'id' | 'createdAt'>, now: Date): Promise<TrainingRunRecord>;
  latestRun(): Promise<TrainingRunRecord | null>;
  /** Null when the card is gone */
  updateCard(id: string, change: Partial<Pick<ObjectionCardRecord, 'practice' | 'myResponse'>>): Promise<ObjectionCardRecord | null>;
  /** Drops quotes from deleted leads */
  removeLeadSources(leadIds: string[]): Promise<void>;
  /**
   * Gives the common objections (training/starter.ts) their current wording, on every card no lead of yours has
   * raised, since its words are the starter's and not the AI's. Practice and your own answer stay. The niches'
   * tailored answers to a reworded card are removed: they were written from the old words. Returns the keys reworded.
   */
  rewordCommon(cards: readonly ObjectionWording[]): Promise<string[]>;
  /** The deck's answers tailored to a niche (by nicheKey), in no particular order */
  variants(niche: string): Promise<ObjectionVariantRecord[]>;
  /** Replaces a niche's tailored answers with these */
  saveVariants(
    niche: { key: string; label: string },
    drafts: ObjectionVariantDraft[],
    by: { provider: string; model: string },
  ): Promise<ObjectionVariantRecord[]>;
  /** Every niche with tailored answers, the most recently tailored first */
  tailoredNiches(): Promise<TailoredNiche[]>;
}

/** A new card's practice state: due now, in the first box */
export const freshPractice = (now: Date): PracticeState => ({
  box: 1,
  dueAt: now,
  reviews: 0,
  lapses: 0,
  lastGrade: null,
  lastReviewedAt: null,
});

export interface SessionRecord {
  id: string;
  expiresAt: Date;
}

export interface SessionStore {
  create(session: { tokenHash: string; userAgent: string; expiresAt: Date }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  extend(id: string, expiresAt: Date): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
}

export interface Stores {
  leads: LeadStore;
  interactions: InteractionStore;
  media: MediaStore;
  coaching: CoachingStore;
  sessions: SessionStore;
  daily: DailyStore;
  whatsapp: WhatsAppStore;
  training: TrainingStore;
  prospector: ProspectorStore;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Keeps the first copy of each id that isn't taken yet; everything else is reported as skipped. */
export function splitById<T extends { id: string }>(items: readonly T[], taken: ReadonlySet<string>) {
  const fresh: T[] = [];
  const skippedIds: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id) || taken.has(item.id)) skippedIds.push(item.id);
    else fresh.push(item);
    seen.add(item.id);
  }
  return { fresh, skippedIds };
}

/** The stored form of a new lead: Cold Call, no calls, no deal amounts. Its notes become timeline entries. */
export function newLeadState(input: LeadInput, now: Date) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : now;
  return {
    id: input.id,
    name: input.name,
    contactName: input.contactName,
    phone: input.phone,
    email: input.email,
    website: input.website,
    campaign: input.campaign,
    approach: input.approach,
    method: input.method,
    currency: input.currency,
    stage: 'cold_call' as const,
    stageChangedAt: createdAt,
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
    activity: [] as ActivityRecord[],
    createdAt,
  };
}

/** Timeline notes for a new lead's `notes` */
export function notesAsInteractions(input: LeadInput): NewInteraction[] {
  return input.notes.map((note) => ({
    id: note.id,
    leadId: input.id,
    kind: 'note' as const,
    outcome: null,
    body: note.body,
    step: null,
    stage: 'cold_call' as const,
    stageTo: null,
    at: new Date(note.createdAt),
  }));
}
