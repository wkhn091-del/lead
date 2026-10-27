/**
 * The Prospector: finds local businesses by niche and area, looks at each one's website, and scores how much
 * they need a new one (1–5). Everything it does outside this server is reading: a search on SerpApi or Google
 * Places (one takes over when the other can't, see fallback.ts), one visit to each business's public homepage,
 * and the AI call that scores it. It never contacts a business.
 */

export const PROSPECT_PROVIDERS = ['google', 'serpapi'] as const;
export type ProspectProviderName = (typeof PROSPECT_PROVIDERS)[number];

/** Results one search may ask for. Google Places stops at 60 per query. */
export const RESULT_LIMITS = [20, 40, 60] as const;
export type ResultLimit = (typeof RESULT_LIMITS)[number];

/** A business as the search provider returns it, before its website is checked */
export interface DiscoveredPlace {
  /** Google's place id: the one thing Google lets us keep indefinitely */
  placeId: string;
  name: string;
  /** As written locally, e.g. "03-555-0101". Empty when unknown. */
  phone: string;
  /** International digits, e.g. "97235550101", for matching leads already in the CRM. Empty when unknown. */
  phoneIntl: string;
  /** The website on the business's Google listing. Empty when there is none. */
  website: string;
  address: string;
  mapsUrl: string;
  /** "Gym", "חדר כושר"… in the search language */
  category: string;
  rating: number | null;
  reviews: number | null;
  /** Temporarily closed, per Google. Permanently closed businesses are dropped. */
  closed: boolean;
  /** The owner never claimed the Google listing (SerpApi only) */
  unclaimed: boolean;
}

export interface DiscoveryProvider {
  readonly name: ProspectProviderName;
  /** Up to `limit` businesses, in the provider's order */
  search(query: string, limit: number, signal: AbortSignal): Promise<DiscoveredPlace[]>;
}

/**
 * What the website check found:
 * - none: no website on the listing
 * - social: the "website" is a Facebook, Instagram, Linktree or WhatsApp page
 * - broken: dead domain, errors, an expired certificate, a parked or placeholder page
 * - blocked: the site turned the check away (bot protection), so it couldn't be judged
 * - ok: a working site, scored on what it shows
 */
export const SITE_STATES = ['none', 'social', 'broken', 'blocked', 'ok'] as const;
export type SiteState = (typeof SITE_STATES)[number];

/** What a look at the homepage found. Stored with the analysis and shown in the app. */
export interface SiteSignals {
  finalUrl: string;
  httpStatus: number | null;
  https: boolean;
  /** Time to the first byte, and to the whole page */
  responseMs: number | null;
  loadMs: number | null;
  htmlKb: number | null;
  /** A legacy encoding (windows-1255, iso-8859-8) dates a Hebrew site to the 2000s */
  charset: string | null;
  title: string;
  description: string;
  lang: string | null;
  /** <meta name="viewport" content="width=device-width…">: the page is built for phones */
  viewport: boolean;
  generator: string | null;
  /** Platforms and libraries found, with versions where they show ("WordPress 4.9", "jQuery 1.11") */
  tech: string[];
  /** A modern framework or builder (Next.js, Framer, Webflow…) */
  modern: boolean;
  /** Signs of an old site ("Flash", "frames", "table layout", "old jQuery"…) */
  legacy: string[];
  /** The latest year in the copyright line */
  copyrightYear: number | null;
  scripts: number;
  stylesheets: number;
  images: number;
  /** WebP/AVIF images, srcset or <picture> */
  modernImages: boolean;
  h1: boolean;
  openGraph: boolean;
  structuredData: boolean;
  favicon: boolean;
  /** Ways to get in touch from the page */
  clickToCall: boolean;
  whatsappButton: boolean;
  contactForm: boolean;
  /** Israeli sites must link an accessibility statement (IS 5568) */
  accessibilityStatement: boolean;
  accessibilityWidget: boolean;
  privacyPolicy: boolean;
  /** Business addresses from mailto: links */
  emails: string[];
  headings: string[];
  /** The page's visible text, trimmed, for the AI */
  text: string;
  /** From the headless browser, when it's on */
  rendered: boolean;
  /** Wider than a phone screen: the page scrolls sideways on a phone */
  mobileOverflow: boolean | null;
  renderMs: number | null;
  lcpMs: number | null;
  consoleErrors: number | null;
}

export type AnalysisStatus = 'pending' | 'checking' | 'scoring' | 'done' | 'failed' | 'skipped';
export type Confidence = 'high' | 'medium' | 'low';

export interface ProspectAnalysis {
  status: AnalysisStatus;
  siteState: SiteState | null;
  /** The need score, 1–5: 5 has no working site, 1 already has a premium one. Null until scored, or when the site couldn't be judged. */
  score: number | null;
  /** The score the signals alone give */
  ruleScore: number | null;
  scoredBy: 'rules' | 'ai' | null;
  /** One line on the site, for the table */
  verdict: string;
  /** What the score rests on, each one something you can check */
  reasons: string[];
  /** An opening line for the call, built on one concrete observation */
  pitch: string;
  confidence: Confidence | null;
  signals: SiteSignals | null;
  /** The phone-sized screenshot, in media storage */
  screenshotKey: string | null;
  /** Why the check or the AI failed, in words for the app */
  error: string | null;
  analyzedAt: Date | null;
  /** Another prospect with the same website whose fresh analysis this one reuses */
  reusedFrom: string | null;
}

export type SearchStatus = 'discovering' | 'analyzing' | 'done' | 'failed' | 'cancelled';

export interface ProspectSearchRecord {
  id: string;
  niche: string;
  location: string;
  /** The text sent to the provider */
  query: string;
  /** The provider that found the businesses (most of them, when two did) */
  provider: ProspectProviderName;
  /** The provider first in line, when another one had to take over */
  fallbackFrom: ProspectProviderName | null;
  /** What happened, when it wasn't a plain search: who took over and why, or why it stopped early */
  notice: string | null;
  limit: number;
  /** The language the AI writes in */
  language: 'he' | 'en';
  status: SearchStatus;
  error: string | null;
  /** Businesses found (after dropping permanently closed ones) */
  found: number;
  createdAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface ProspectRecord extends DiscoveredPlace {
  id: string;
  searchId: string;
  /** Order in the provider's results */
  position: number;
  /** The website's registrable host without "www.", for spotting the same site twice */
  domain: string;
  /** A lead already in the CRM with this phone number or website */
  existingLeadId: string | null;
  importedLeadId: string | null;
  importedAt: Date | null;
  analysis: ProspectAnalysis;
  createdAt: Date;
  updatedAt: Date;
}

export type NewProspect = Omit<ProspectRecord, 'createdAt' | 'updatedAt'>;

export const emptyAnalysis = (): ProspectAnalysis => ({
  status: 'pending',
  siteState: null,
  score: null,
  ruleScore: null,
  scoredBy: null,
  verdict: '',
  reasons: [],
  pitch: '',
  confidence: null,
  signals: null,
  screenshotKey: null,
  error: null,
  analyzedAt: null,
  reusedFrom: null,
});

export interface ProspectorStore {
  createSearch(record: Omit<ProspectSearchRecord, 'createdAt' | 'updatedAt'>): Promise<ProspectSearchRecord>;
  getSearch(id: string): Promise<ProspectSearchRecord | null>;
  /** Newest first */
  listSearches(limit: number): Promise<ProspectSearchRecord[]>;
  /** Null when the search is gone */
  updateSearch(
    id: string,
    change: Partial<Pick<ProspectSearchRecord, 'status' | 'error' | 'found' | 'finishedAt' | 'provider' | 'fallbackFrom' | 'notice'>>,
  ): Promise<ProspectSearchRecord | null>;
  /** Searches the server was still working on when it stopped */
  unfinishedSearches(): Promise<ProspectSearchRecord[]>;
  /** Searches started before `before`, oldest first */
  searchesBefore(before: Date): Promise<ProspectSearchRecord[]>;
  /** Removes the search and its prospects; returns their screenshot keys so the files can go too */
  removeSearch(id: string): Promise<string[]>;
  /** A business already in the search (same place id) is skipped */
  addProspects(records: NewProspect[]): Promise<void>;
  /** In the provider's order */
  listProspects(searchId: string): Promise<ProspectRecord[]>;
  getProspect(id: string): Promise<ProspectRecord | null>;
  getProspects(ids: string[]): Promise<ProspectRecord[]>;
  /** Null when the prospect is gone */
  setAnalysis(id: string, analysis: ProspectAnalysis): Promise<ProspectRecord | null>;
  setExistingLead(id: string, leadId: string | null): Promise<void>;
  markImported(id: string, leadId: string, at: Date): Promise<void>;
  /** The newest finished analysis of this domain since `since`, from any search */
  recentAnalysis(domain: string, since: Date, excludeId: string): Promise<ProspectRecord | null>;
}
