/** The sales funnel, in order. A lead moves forward one stage at a time. */
export const STAGES = ['cold_call', 'zoom', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

export const CONTACT_METHODS = ['call', 'whatsapp'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const CURRENCIES = ['ILS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** A note that comes with a new lead (typed in or imported). It becomes the lead's first timeline entry. */
export interface LeadNote {
  id: string;
  body: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

export type ActivityType = 'advanced' | 'no_answer' | 'answered' | 'archived';

/** One logged step on a lead */
export interface Activity {
  id: string;
  type: ActivityType;
  /** ISO 8601 timestamp */
  at: string;
  /** The stage the lead was at */
  from: Stage;
  /** Where it moved to, for "advanced" */
  to: Stage | null;
  /** Values from before the step, so it can be undone */
  before: { stageChangedAt: string; lastAttemptAt: string | null; attemptCount: number };
}

/**
 * Advance to the next stage, log a call nobody picked up, log a conversation that didn't move the deal
 * ("call me next month"), or mark not relevant
 */
export type ActionType = 'advance' | 'no_answer' | 'answered' | 'archive';

/** How a conversation happened. By default a phone call at Cold Call and a Zoom meeting at Zoom Meeting. */
export type Channel = 'call' | 'zoom';

export interface LeadAction {
  /** Client-generated, so a retried request is applied once. Also the id of the timeline entry it creates. */
  id: string;
  type: ActionType;
  /** The stage the lead was at when the action was taken */
  from: Stage;
}

/** What gets written down with a step */
export interface StepDetails {
  /** What was said: notes or a pasted transcript */
  body?: string;
  channel?: Channel;
}

/**
 * What a closed deal brings in, in whole units of the lead's currency: the build, the monthly retainer for
 * maintenance and management, and the yearly domain and hosting renewal. All zero until the deal closes.
 */
export interface DealTerms {
  /** One-time payment for building the site */
  setupFee: number;
  /** Maintenance and management, per month */
  monthlyRetainer: number;
  /** Domain and hosting, renewed every year */
  hostingYearly: number;
}

export interface Lead {
  id: string;
  /** The business or person you are selling to */
  name: string;
  /** The person you speak with. Empty string when unknown. */
  contactName: string;
  /** Stored as typed. Empty string when unknown. */
  phone: string;
  email: string;
  /** A domain or http(s) address */
  website: string;
  /** Topic or niche of the batch the lead came in with, e.g. "Dentists" */
  campaign: string;
  /** How to talk to this lead */
  approach: string;
  method: ContactMethod;
  stage: Stage;
  stageChangedAt: string;
  /** Set when marked not relevant. Archived leads never return to the daily pool. */
  archivedAt: string | null;
  /** Calls that went unanswered */
  attemptCount: number;
  lastAttemptAt: string | null;
  /** Only a closed deal has amounts */
  deal: DealTerms;
  currency: Currency;
  /** Newest first. The timeline (calls, meetings, notes) is loaded separately, per lead. */
  activity: Activity[];
  createdAt: string;
  updatedAt: string;
}

/** A lead to store, with the notes that start its timeline */
export type NewLead = Lead & { notes: LeadNote[] };

export type InteractionKind = 'call' | 'zoom' | 'whatsapp' | 'email' | 'note';
export type InteractionOutcome = 'no_answer' | 'answered' | 'held' | 'no_show';
/** Entries written by hand. Calls and Zoom meetings are logged through steps. */
export type MessageKind = 'note' | 'whatsapp' | 'email';

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

/** One message of a WhatsApp conversation mirrored onto the timeline */
export interface ChatLine {
  /** WhatsApp's id for the message */
  id: string;
  at: string;
  /** Sent from your phone (or another device on your number) */
  fromMe: boolean;
  type: ChatLineType;
  /** The text, a caption or a short description */
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
  /** An older voice note that can be downloaded on request */
  canFetch: boolean;
}

/** One event on a lead's timeline */
export interface Interaction {
  id: string;
  leadId: string;
  kind: InteractionKind;
  /** For calls and meetings */
  outcome: InteractionOutcome | null;
  /** Notes or a transcript of what was said */
  body: string;
  /** The pipeline step this entry records, or null for notes and messages */
  step: ActivityType | null;
  /** The lead's stage at the time */
  stage: Stage;
  /** Where the step moved the lead */
  stageTo: Stage | null;
  at: string;
  /** 'whatsapp' for a conversation mirrored from WhatsApp (read-only); null or missing for everything else */
  source?: 'whatsapp' | null;
  /** The mirrored conversation, oldest message first */
  chat?: ChatLine[];
  updatedAt: string;
}

/** Where a recording's automatic transcript stands */
export interface Transcription {
  status: 'queued' | 'running' | 'done' | 'failed';
  /** Parts transcribed so far, out of partsTotal (0 while the audio is being prepared) */
  partsDone: number;
  partsTotal: number;
  /** Why it failed */
  error: string | null;
  /** Length of the finished transcript; 0 means no speech was found */
  words: number;
  updatedAt: string;
}

/** A call or Zoom recording */
export interface MediaFile {
  id: string;
  leadId: string;
  /** The timeline entry it belongs to, or null for the lead as a whole */
  interactionId: string | null;
  kind: 'audio' | 'video';
  fileName: string;
  mimeType: string;
  /** Bytes */
  size: number;
  /** Null when no transcript was asked for (transcripts off, or uploaded before they were on) */
  transcription: Transcription | null;
  createdAt: string;
}

export type DealHealth = 'won' | 'hot' | 'warm' | 'cold' | 'stalled' | 'lost';
export type Likelihood = 'high' | 'medium' | 'low';

/** What to quote this client, from the deal analysis. Amounts are whole units of `currency`. */
export interface CoachPricing extends DealTerms {
  /** The lowest setup fee worth taking; below it, cut scope rather than price */
  walkAwaySetupFee: number;
  /** What the package includes at this price */
  scope: string[];
  rationale: string;
  /** The words to present the price with */
  howToPresent: string;
  currency: Currency;
  /**
   * How many of your closed deals (in this currency, with amounts) the price was anchored on. 0: the AI's general
   * estimate. Missing on analyses saved before it was recorded.
   */
  basedOnDeals?: number;
}

/**
 * What the AI coach returns (server/src/coach/schema.ts). The plan, the price, the closing objections and
 * `nextCall.inDays` came later: reports from before them don't have them.
 */
export interface CoachAnalysis {
  summary: string;
  dealHealth: DealHealth;
  /** From today to the next commitment, in order */
  actionPlan?: { step: string; when: string; why: string }[];
  pricing?: CoachPricing | null;
  /** What to expect when asking this prospect to commit, most likely first */
  closingObjections?: { objection: string; likelihood: Likelihood; why: string; response: string }[];
  wentWell: string[];
  wentWrong: string[];
  mistakes: { mistake: string; evidence: string; fix: string }[];
  objections: { objection: string; status: 'resolved' | 'open'; response: string }[];
  openQuestions: string[];
  tips: string[];
  nextCall: {
    goal: string;
    timing: string;
    /** Days after the analysis until the next contact */
    inDays?: number | null;
    script: { step: string; say: string }[];
    fallbackMessage: string;
  };
}

export interface CoachingReport {
  id: string;
  leadId: string;
  provider: string;
  model: string;
  /** Timeline entries the analysis was based on */
  interactionCount: number;
  analysis: CoachAnalysis;
  createdAt: string;
}

export type CoachLanguage = 'auto' | 'he' | 'en';

/** Everything on a lead's profile besides the lead itself */
export interface LeadTimeline {
  /** Newest first */
  interactions: Interaction[];
  /** Newest first */
  media: MediaFile[];
  /** The latest analysis, if any */
  coaching: CoachingReport | null;
}

/** What the backend has turned on */
export interface Features {
  /** Null when no AI provider is set up */
  coach: { provider: string; model: string } | null;
  media: { storage: 'local' | 's3' | 'browser'; maxUploadMb: number };
  /** Automatic transcripts of uploaded recordings, or why they are off */
  transcription: { enabled: true; service: string; model: string } | { enabled: false; reason: string };
  /** The read-only WhatsApp sync, or why it is off. Missing on servers from before it existed. */
  whatsapp?: { enabled: true } | { enabled: false; reason: string };
  /** The Prospector, or why it is off. Missing on servers from before it existed. */
  prospector?: { enabled: true; provider: ProspectProvider; backup?: ProspectProvider | null; browser: boolean; ai: boolean } | { enabled: false; reason: string };
}

/** Where the WhatsApp link stands (server/src/whatsapp/service.ts) */
export type WhatsAppLinkState =
  | { state: 'unlinked'; reason?: string }
  | { state: 'linking'; method: 'qr'; qr: string; expiresAt: string }
  | { state: 'linking'; method: 'code'; code: string | null; phone: string }
  | { state: 'connecting' }
  | { state: 'connected'; since: string; phone: string; name: string | null }
  | { state: 'reconnecting'; attempt: number; retryAt: string; reason: string }
  | { state: 'stopped'; reason: string };

export interface WhatsAppGuardStatus {
  /** The guard proved on the live connection that it stops outgoing messages */
  selfTest: 'pending' | 'passed' | 'failed';
  blocked: number;
  critical: number;
  recent: { at: string; severity: 'quiet' | 'critical'; what: string; layer: 'method' | 'message' | 'wire' }[];
}

export type WhatsAppStatus =
  | {
      enabled: true;
      link: WhatsAppLinkState;
      guard: WhatsAppGuardStatus;
      sync: { messages: number; lastMessageAt: string | null; historyProgress: number | null; voiceNotesWaiting: number };
      settings: { history: 'full' | 'recent'; voiceNoteDays: number; transcribes: boolean };
    }
  | { enabled: false; reason: string };

export type ObjectionCategory = 'price' | 'timing' | 'trust' | 'need' | 'authority' | 'competition' | 'diy' | 'other';

/** Where an objection was heard */
export interface ObjectionSource {
  leadId: string;
  leadName: string;
  interactionId: string;
  at: string;
  quote: string;
}

/** Spaced repetition: box 1 comes up every session, box 5 every two weeks */
export interface PracticeState {
  box: number;
  dueAt: string;
  reviews: number;
  lapses: number;
  /** 1 missed, 2 hard, 3 good, 4 easy */
  lastGrade: number | null;
  lastReviewedAt: string | null;
}

/** A flashcard: an objection prospects keep raising, and how to answer it (server/src/stores/types.ts) */
export interface ObjectionCard {
  id: string;
  key: string;
  category: ObjectionCategory;
  objection: string;
  insight: string;
  response: string;
  alternatives: string[];
  followUp: string;
  leadCount: number;
  mentions: number;
  sources: ObjectionSource[];
  /** Your own version of the answer */
  myResponse: string;
  practice: PracticeState;
  /** No longer found by the latest analysis */
  retired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingRun {
  id: string;
  provider: string;
  model: string;
  language: string;
  leadsAnalyzed: number;
  entriesAnalyzed: number;
  conversations: number;
  cards: number;
  createdAt: string;
}

export interface TrainingDeck {
  run: TrainingRun | null;
  /** Most raised first */
  cards: ObjectionCard[];
}

/** A card's answer tailored to one niche: the same objection, in that kind of business's terms (server/src/training/tailor.ts) */
export interface ObjectionVariant {
  cardKey: string;
  /** How an owner in this niche says it */
  objection: string;
  insight: string;
  response: string;
  alternatives: string[];
  followUp: string;
}

/** One niche's tailored answers */
export interface NicheVariants {
  niche: { key: string; label: string };
  variants: ObjectionVariant[];
  provider: string | null;
  model: string | null;
  updatedAt: string | null;
  /** New answers are being written right now */
  tailoring: boolean;
  /** Why the last attempt failed; reported once */
  error: string | null;
}

/** A niche among your leads, or one you tailored the deck to */
export interface TrainingNiche {
  /** As compared: lowercase, without the area */
  key: string;
  /** As written: "מסעדות" */
  label: string;
  leads: number;
  tailored: { cards: number; updatedAt: string } | null;
}

export type Grade = 1 | 2 | 3 | 4;

/** Details that can be edited directly. The stage only changes through actions. */
export type LeadPatch = Partial<
  Pick<Lead, 'name' | 'contactName' | 'phone' | 'email' | 'website' | 'campaign' | 'approach' | 'method' | 'currency'>
> & {
  /** Any of the amounts; the rest stay as they are. Only on a closed deal. */
  deal?: Partial<DealTerms>;
};

export interface NewLeadInput {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  campaign: string;
  approach: string;
  method: ContactMethod;
  /** Optional first note, saved to the timeline */
  note: string;
}

/**
 * What the dashboard knows about a lead beyond the lead itself (server/src/dashboard): when it was last
 * touched, how its last Zoom went, and the gist of its latest deal analysis
 */
export interface LeadPulse {
  leadId: string;
  /** The newest timeline entry: a call, meeting, message or note */
  lastEntry: { at: string; kind: InteractionKind; outcome: InteractionOutcome | null } | null;
  /** The newest Zoom meeting */
  lastZoom: { at: string; outcome: InteractionOutcome | null } | null;
  coaching: {
    /** When the analysis was made */
    at: string;
    dealHealth: DealHealth;
    nextCall: { goal: string; timing: string; inDays: number | null };
    /** The action plan's first step */
    firstStep: string | null;
    pricing: (DealTerms & { currency: Currency }) | null;
    /** The made-up analysis on a sample lead */
    sample: boolean;
  } | null;
}

/** The leads drawn for one day's calls */
export interface DailyQueue {
  /** "2026-10-22" */
  date: string;
  startsAt: string;
  endsAt: string;
  /** In the order they were drawn */
  leadIds: string[];
  /** Uncontacted leads still waiting for another day */
  poolSize: number;
  quota: number;
}

// ---- Prospector (server/src/prospector) ------------------------------------------------------------------

export type ProspectProvider = 'google' | 'serpapi';

/** Businesses one search asks for. Google Places stops at 60 per query. */
export const RESULT_LIMITS = [20, 40, 60] as const;
export type ResultLimit = (typeof RESULT_LIMITS)[number];

/**
 * What the website check found: no site, only a social page, a site that doesn't work, one that turned the
 * check away, or a working site that was scored
 */
export type SiteState = 'none' | 'social' | 'broken' | 'blocked' | 'ok';
export type AnalysisStatus = 'pending' | 'checking' | 'scoring' | 'done' | 'failed' | 'skipped';
export type SearchStatus = 'discovering' | 'analyzing' | 'done' | 'failed' | 'cancelled';

/** What one look at the homepage found */
export interface SiteSignals {
  finalUrl: string;
  httpStatus: number | null;
  https: boolean;
  responseMs: number | null;
  loadMs: number | null;
  htmlKb: number | null;
  /** A legacy encoding (windows-1255) dates a Hebrew site to the 2000s */
  charset: string | null;
  title: string;
  description: string;
  lang: string | null;
  /** Built for phones */
  viewport: boolean;
  generator: string | null;
  /** "WordPress 4.9", "jQuery 1.11", "Next.js"… */
  tech: string[];
  /** A modern framework or builder */
  modern: boolean;
  /** Signs of an old site */
  legacy: string[];
  copyrightYear: number | null;
  scripts: number;
  stylesheets: number;
  images: number;
  modernImages: boolean;
  h1: boolean;
  openGraph: boolean;
  structuredData: boolean;
  favicon: boolean;
  clickToCall: boolean;
  whatsappButton: boolean;
  contactForm: boolean;
  /** Israeli sites must link an accessibility statement (IS 5568) */
  accessibilityStatement: boolean;
  accessibilityWidget: boolean;
  privacyPolicy: boolean;
  emails: string[];
  headings: string[];
  /** From the headless browser, when the server has one */
  rendered: boolean;
  /** Wider than a phone screen */
  mobileOverflow: boolean | null;
  renderMs: number | null;
  lcpMs: number | null;
  consoleErrors: number | null;
}

export interface ProspectAnalysis {
  status: AnalysisStatus;
  siteState: SiteState | null;
  /** The need score, 1–5: 5 has no working site, 1 already has a premium one. Null until scored, or when the site couldn't be judged. */
  score: number | null;
  /** The score the site's signals alone give */
  ruleScore: number | null;
  scoredBy: 'rules' | 'ai' | null;
  /** One line on the site */
  verdict: string;
  /** What the score rests on */
  reasons: string[];
  /** An opening line for the call */
  pitch: string;
  confidence: 'high' | 'medium' | 'low' | null;
  signals: SiteSignals | null;
  /** A phone-sized screenshot of the homepage is stored */
  hasScreenshot: boolean;
  /** Why the check or the AI failed */
  error: string | null;
  analyzedAt: string | null;
  /** Another business with the same website whose recent check this one reuses */
  reusedFrom: string | null;
}

/** A business a search found */
export interface Prospect {
  id: string;
  searchId: string;
  /** Order in Google's results */
  position: number;
  placeId: string;
  name: string;
  /** As written locally; empty when unknown */
  phone: string;
  phoneIntl: string;
  /** The website on the Google listing; empty when there is none */
  website: string;
  address: string;
  mapsUrl: string;
  category: string;
  rating: number | null;
  reviews: number | null;
  /** Temporarily closed, per Google */
  closed: boolean;
  /** The owner never claimed the Google listing */
  unclaimed: boolean;
  domain: string;
  /** A lead already in the CRM with this phone number or website */
  existingLeadId: string | null;
  importedLeadId: string | null;
  importedAt: string | null;
  analysis: ProspectAnalysis;
  createdAt: string;
  updatedAt: string;
}

export type ScoreCounts = Record<'1' | '2' | '3' | '4' | '5', number>;

export interface ProspectSearch {
  id: string;
  niche: string;
  location: string;
  /** The text sent to Google */
  query: string;
  /** Who found the businesses (most of them, when both providers did) */
  provider: ProspectProvider;
  /** The provider first in line, when the other one had to take over */
  fallbackFrom?: ProspectProvider | null;
  /** What happened, when it wasn't a plain search: who took over and why, or why it stopped early */
  notice?: string | null;
  limit: number;
  /** The language the AI writes in */
  language: 'he' | 'en';
  status: SearchStatus;
  error: string | null;
  /** Businesses found */
  found: number;
  createdAt: string;
  finishedAt: string | null;
  updatedAt: string;
  total: number;
  /** Websites checked so far */
  checked: number;
  imported: number;
  scores: ScoreCounts;
  /** A made-up search that shows how the Prospector works, where there is no server */
  demo?: boolean;
}

export interface ProspectSearchResults {
  search: ProspectSearch;
  /** In Google's order */
  prospects: Prospect[];
}

/** A search provider's state (server/src/prospector/fallback.ts) */
export interface ProviderStatus {
  name: ProspectProvider;
  role: 'primary' | 'backup';
  /** ready, out of searches for now, or resting after a failure */
  state: 'ready' | 'exhausted' | 'resting';
  /** SerpApi: searches left this month and the monthly allowance, when known */
  searchesLeft: number | null;
  searchesPerMonth: number | null;
  renews: string | null;
  note: string | null;
}

export type ProspectorStatus =
  | {
      enabled: true;
      /** The first choice, and the one that takes over when it can't search */
      provider: ProspectProvider;
      backup?: ProspectProvider | null;
      providers?: ProviderStatus[];
      browser: boolean;
      ai: boolean;
      retentionDays: number;
      searches: ProspectSearch[];
    }
  | { enabled: false; reason: string; searches?: ProspectSearch[] };

export interface NewProspectSearch {
  niche: string;
  location: string;
  limit: ResultLimit;
  language: 'he' | 'en';
}

export interface ProspectImport {
  /** The new leads, at Cold Call: they join the Daily 10 pool */
  created: Lead[];
  /** Businesses that weren't added: imported before, already a lead, or gone */
  skipped: { id: string; reason: 'imported' | 'exists' | 'missing'; leadId?: string }[];
}
