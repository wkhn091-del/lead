import { existsSync } from 'node:fs';
import type { CoachProvider } from '../coach/providers.js';
import type { MediaStorage } from '../media/storage.js';
import type { Stores } from '../stores/types.js';
import { createRenderer } from './browser.js';
import { createGooglePlaces, createSerpApi } from './discovery.js';
import { ProspectorEngine } from './engine.js';
import { createDiscovery, createSerpApiAccount } from './fallback.js';
import type { DiscoveryProvider, ProspectProviderName } from './types.js';

/** A phone browser's user agent: sites show the check what they show a visitor on a phone */
export const PHONE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

export interface ProviderSettings {
  name: ProspectProviderName;
  apiKey: string;
  /** Another address for its API: a gateway, or a stand-in for tests */
  baseUrl?: string;
}

export interface ProspectorOptions {
  /** First choice first; the next one takes over when it can't search */
  providers: ProviderSettings[];
  /** Null checks the HTML only */
  chromePath: string | null;
  /** Null scores by the rules alone */
  coach: CoachProvider | null;
  businessContext: string;
  retentionDays: number;
  language: 'he' | 'en';
  region: string;
  countryCode: string;
  allowPrivateNetwork: boolean;
}

export interface ProspectorDepsBase {
  stores: Stores;
  storage: MediaStorage;
  clock?: () => Date;
}

export function createProspector(base: ProspectorDepsBase, options: ProspectorOptions): ProspectorEngine {
  const build = (settings: ProviderSettings): DiscoveryProvider =>
    settings.name === 'google'
      ? createGooglePlaces({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          languageCode: options.language,
          regionCode: options.region,
          countryCode: options.countryCode,
        })
      : createSerpApi({
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          // SerpApi's code for Hebrew
          hl: options.language === 'he' ? 'iw' : 'en',
          googleDomain: options.region === 'IL' ? 'google.co.il' : 'google.com',
          countryCode: options.countryCode,
        });
  const serpapi = options.providers.find((settings) => settings.name === 'serpapi');
  const discovery = createDiscovery(options.providers.map(build), {
    // How many SerpApi searches are left this month: free to ask, and not counted as a search
    allowance: serpapi ? createSerpApiAccount({ apiKey: serpapi.apiKey, baseUrl: serpapi.baseUrl, clock: base.clock }) : null,
    clock: base.clock,
  });

  let renderer = null;
  if (options.chromePath) {
    if (existsSync(options.chromePath)) {
      renderer = createRenderer({ executablePath: options.chromePath, allowPrivateNetwork: options.allowPrivateNetwork, userAgent: PHONE_USER_AGENT });
    } else {
      console.warn(`PROSPECTOR_CHROME_PATH points to ${options.chromePath}, which doesn't exist. Sites are checked without the browser.`);
    }
  }

  return new ProspectorEngine({
    stores: base.stores,
    storage: base.storage,
    discovery,
    coach: options.coach,
    renderer,
    clock: base.clock ?? (() => new Date()),
    settings: {
      businessContext: options.businessContext,
      countryCode: options.countryCode,
      reuseDays: 14,
      retentionDays: options.retentionDays,
      fetch: {
        allowPrivateNetwork: options.allowPrivateNetwork,
        maxBytes: 1_500_000,
        maxRedirects: 6,
        userAgent: PHONE_USER_AGENT,
        acceptLanguage: 'he-IL,he;q=0.9,en-US;q=0.6,en;q=0.5',
      },
      // Gemini's free tier allows a handful of requests a minute, so its sites are scored one at a time
      concurrency: { fetch: 6, render: 2, ai: options.coach?.name === 'gemini' ? 1 : 3 },
    },
  });
}
