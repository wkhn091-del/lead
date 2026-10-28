import type {
  CoachingReport,
  CoachLanguage,
  DailyQueue,
  Features,
  Grade,
  Interaction,
  Lead,
  LeadAction,
  LeadPatch,
  LeadPulse,
  LeadTimeline,
  MediaFile,
  MessageKind,
  NewLead,
  NewProspectSearch,
  NicheVariants,
  ObjectionCard,
  Prospect,
  ProspectImport,
  ProspectorStatus,
  ProspectSearch,
  ProspectSearchResults,
  StepDetails,
  TrainingDeck,
  TrainingNiche,
  WhatsAppStatus,
} from '../../types';

export interface BulkCreateResult {
  /** Leads stored by this call */
  created: Lead[];
  /** Ids that were already stored, for example by an earlier attempt whose answer never arrived */
  skippedIds: string[];
}

export interface NewMessage {
  /** Client-generated, so a retried request is saved once */
  id: string;
  kind: MessageKind;
  body: string;
  /** When it was written, for one sent after the phone got its connection back */
  at?: string;
}

/** A step's details, and when it was taken (sent late from the outbox, it keeps that time) */
export type StepWrite = StepDetails & { at?: string };

export interface UploadOptions {
  /** The timeline entry the recording belongs to, or null for the lead as a whole */
  interactionId: string | null;
  /** Called with 0–1 as the file goes up */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Storage contract for leads and their timelines. Write one implementation per backend.
 * The client creates ids and timestamps, so an implementation stores what it receives
 * and returns the saved record.
 */
export interface LeadRepository {
  readonly kind: 'local' | 'remote';
  list(): Promise<Lead[]>;
  /** A new lead always starts at Cold Call. Its notes become its first timeline entries. */
  create(lead: NewLead): Promise<Lead>;
  /** Stores up to 500 leads at once; ids that already exist are skipped, not overwritten */
  createMany(leads: NewLead[]): Promise<BulkCreateResult>;
  /** Details only. A value can be set once the deal is closed. */
  update(id: string, patch: LeadPatch): Promise<Lead>;
  /**
   * Advance, log a call (answered or not), or mark not relevant. Each step also becomes a timeline entry
   * with the action's id and the notes passed in. Applying the same action twice changes nothing.
   */
  act(id: string, action: LeadAction, details?: StepWrite): Promise<Lead>;
  /** Reverses the lead's most recent action within 10 minutes. Its notes stay on the timeline as a note. */
  undo(id: string, actionId: string): Promise<Lead>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
  /** Today's queue, drawn on the first request of the day */
  daily(): Promise<DailyQueue>;
  /** For the dashboard: when each lead in play was last touched, and the gist of its deal analysis */
  dashboard(): Promise<{ pulses: LeadPulse[] }>;

  /** The lead's timeline, recordings and latest coaching report */
  timeline(leadId: string): Promise<LeadTimeline>;
  /** A note, WhatsApp message or email */
  addInteraction(leadId: string, message: NewMessage): Promise<Interaction>;
  /**
   * Edits the notes or transcript of any entry. With `expectedUpdatedAt`, fails with a 409 ApiError when
   * the entry changed since then (a transcript was added), instead of overwriting it.
   */
  updateInteraction(leadId: string, interactionId: string, body: string, expectedUpdatedAt?: string): Promise<Interaction>;
  /** Notes and messages only; recordings on it stay on the lead */
  removeInteraction(leadId: string, interactionId: string): Promise<void>;
  /** Stores a recording; with transcripts on, it comes back queued for transcription */
  uploadMedia(leadId: string, file: File, options: UploadOptions): Promise<MediaFile>;
  /** The lead's recordings with their transcript progress (cheap enough to poll) */
  mediaStatus(leadId: string): Promise<MediaFile[]>;
  /** Transcribes a recording again from scratch */
  transcribe(media: MediaFile): Promise<MediaFile>;
  /** A URL an audio or video element can play. Pass it to releaseMediaSource when done. */
  mediaSource(media: MediaFile): Promise<string>;
  releaseMediaSource(url: string): void;
  removeMedia(media: MediaFile): Promise<void>;
  /** Runs the AI coach on the lead's whole history and stores the report */
  coach(leadId: string, language: CoachLanguage): Promise<CoachingReport>;
  features(): Promise<Features>;
  /** Adds the sample leads with their timelines. Only where leads are kept in this browser. */
  addSamples?(): Promise<Lead[]>;

  /** The read-only WhatsApp link: its state, the guard's report and the sync's progress */
  whatsappStatus(): Promise<WhatsAppStatus>;
  /** Starts linking: a QR code, or a code to type on the phone when `phone` is given */
  linkWhatsApp(phone?: string): Promise<WhatsAppStatus>;
  reconnectWhatsApp(): Promise<WhatsAppStatus>;
  /** Removes this server from your phone's linked devices. Mirrored conversations stay. */
  unlinkWhatsApp(): Promise<WhatsAppStatus & { removedFromPhone?: boolean }>;
  /** Asks your phone for older messages with this lead. Resolves to what to tell you. */
  fetchWhatsAppHistory(leadId: string): Promise<{ requested: boolean; message: string }>;
  /** Downloads (and transcribes) an older voice note */
  fetchVoiceNote(leadId: string, messageId: string): Promise<void>;

  /** The objection deck */
  trainingDeck(): Promise<TrainingDeck>;
  /** Builds or refreshes the deck from past conversations (an AI call) */
  generateDeck(language: CoachLanguage): Promise<TrainingDeck>;
  /**
   * Records one practice answer and returns the card with its next review date. `at`: when it was answered; the
   * same answer sent twice with the same time counts once.
   */
  reviewCard(cardId: string, grade: Grade, at?: string): Promise<ObjectionCard>;
  /** Saves your own version of a card's answer */
  saveCardResponse(cardId: string, myResponse: string): Promise<ObjectionCard>;
  /** Your leads' niches and the ones with tailored answers; `tailoring` lists niche keys being written now */
  trainingNiches(): Promise<{ niches: TrainingNiche[]; tailoring: string[] }>;
  /** A niche's tailored answers (cheap enough to poll while they're written) */
  nicheVariants(niche: string): Promise<NicheVariants>;
  /** Starts rewriting the deck's answers for a niche (an AI call, in the background) */
  tailorDeck(niche: string, language: CoachLanguage): Promise<NicheVariants>;

  /** The Prospector: whether it's on, and the recent searches */
  prospector(): Promise<ProspectorStatus>;
  /** Starts a search. Google finds the businesses; their websites are checked and scored in the background. */
  startProspectSearch(input: NewProspectSearch): Promise<ProspectSearch>;
  /** A search and its businesses, as far as they've been checked (cheap enough to poll) */
  prospectSearch(id: string): Promise<ProspectSearchResults>;
  cancelProspectSearch(id: string): Promise<ProspectSearch>;
  /** Deletes a search and its results. Leads imported from it stay. */
  removeProspectSearch(id: string): Promise<void>;
  /** Checks one business's website again */
  recheckProspect(id: string): Promise<Prospect>;
  /** Where the homepage screenshot (as a phone shows it) loads from, or null when there is none */
  prospectScreenshot(prospect: Prospect): string | null;
  /** Adds businesses as leads at Cold Call, so they join the Daily 10 pool */
  importProspects(ids: string[]): Promise<ProspectImport>;
}
