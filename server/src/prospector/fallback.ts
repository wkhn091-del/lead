import { DiscoveryError, type DiscoveryFailure } from './discovery.js';
import type { DiscoveredPlace, DiscoveryProvider, ProspectProviderName } from './types.js';

/**
 * Searching with more than one provider: the first in line (SerpApi by default) does the search, and when it
 * can't (its monthly searches ran out, its key was refused, it's down) the next one (Google Places) takes over,
 * mid-search if need be, so the search still comes back with businesses. Both read Google Maps, so a business
 * found by one isn't added again by the other.
 *
 * A provider that failed rests for a while before it's tried again. SerpApi's Account API (free, and not
 * counted as a search) says how many searches are left, so an exhausted month is skipped without a wasted
 * request, and noticed as soon as the plan renews.
 */

export const PROVIDER_LABEL: Record<ProspectProviderName, string> = { google: 'Google Places', serpapi: 'SerpApi' };

/** How long a provider rests after a failure, by kind. A query it rejected says nothing about the next one. */
const REST_MS: Record<DiscoveryFailure, number> = {
  quota: 15 * 60_000,
  auth: 30 * 60_000,
  unavailable: 2 * 60_000,
  rejected: 0,
};

/** This month's searches, from SerpApi's Account API */
export interface SearchAllowance {
  left: number;
  perMonth: number | null;
  /** When the plan renews, if SerpApi says */
  renews: Date | null;
}

export interface AllowanceSource {
  /** Null when it can't tell (the Account API didn't answer) */
  check(): Promise<SearchAllowance | null>;
  /** Drops the cached answer, after a search used some */
  forget(): void;
}

interface AccountBody {
  total_searches_left?: unknown;
  plan_searches_left?: unknown;
  searches_per_month?: unknown;
  plan_renewal_date?: unknown;
}

/** SerpApi's Account API, asked at most once a minute */
export function createSerpApiAccount(options: { apiKey: string; baseUrl?: string; timeoutMs?: number; clock?: () => Date }): AllowanceSource {
  const baseUrl = (options.baseUrl ?? 'https://serpapi.com').replace(/\/+$/, '');
  const clock = options.clock ?? (() => new Date());
  let cached: { at: number; value: SearchAllowance | null } | null = null;
  const remember = (value: SearchAllowance | null) => {
    cached = { at: clock().getTime(), value };
    return value;
  };

  return {
    async check() {
      if (cached && clock().getTime() - cached.at < 60_000) return cached.value;
      try {
        const response = await fetch(`${baseUrl}/account.json?${new URLSearchParams({ api_key: options.apiKey })}`, {
          signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
        });
        if (!response.ok) return remember(null);
        const body = (await response.json()) as AccountBody;
        const left = typeof body.total_searches_left === 'number' ? body.total_searches_left : typeof body.plan_searches_left === 'number' ? body.plan_searches_left : null;
        if (left === null) return remember(null);
        const renews = typeof body.plan_renewal_date === 'string' ? new Date(body.plan_renewal_date) : null;
        return remember({
          left: Math.max(0, Math.floor(left)),
          perMonth: typeof body.searches_per_month === 'number' ? body.searches_per_month : null,
          renews: renews && !Number.isNaN(renews.getTime()) ? renews : null,
        });
      } catch {
        return remember(null);
      }
    },
    forget() {
      cached = null;
    },
  };
}

export interface DiscoveryResult {
  places: DiscoveredPlace[];
  /** The provider that found most of them */
  provider: ProspectProviderName;
  /** The provider first in line, when another one had to take over */
  fallbackFrom: ProspectProviderName | null;
  /** What happened, in words for the app, when it wasn't a plain search: who took over and why, or why it stopped early */
  notice: string | null;
}

export interface ProviderStatus {
  name: ProspectProviderName;
  role: 'primary' | 'backup';
  /** ready, out of searches for now, or resting after a failure */
  state: 'ready' | 'exhausted' | 'resting';
  /** SerpApi: searches left this month and the monthly allowance, when known */
  searchesLeft: number | null;
  searchesPerMonth: number | null;
  renews: Date | null;
  /** Why it isn't ready, in words for the app */
  note: string | null;
}

export interface Discovery {
  readonly primary: ProspectProviderName;
  readonly backup: ProspectProviderName | null;
  search(query: string, limit: number, signal: AbortSignal): Promise<DiscoveryResult>;
  status(): Promise<ProviderStatus[]>;
}

const renewDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'Asia/Jerusalem' });

const exhausted = (renews: Date | null) => `נגמרו החיפושים בחבילת SerpApi החודש${renews ? ` (הם מתחדשים ב-${renewDate.format(renews)})` : ''}.`;

interface Attempt {
  name: ProspectProviderName;
  /** empty: it searched and found nothing */
  outcome: DiscoveryFailure | 'empty';
  message: string;
}

/**
 * Providers in the order to try them: the first is the primary. With one provider this is simply that provider,
 * plus the SerpApi allowance check and clearer messages.
 */
export function createDiscovery(
  providers: readonly DiscoveryProvider[],
  options: { allowance?: AllowanceSource | null; clock?: () => Date } = {},
): Discovery {
  if (!providers.length) throw new Error('createDiscovery needs at least one provider');
  const clock = options.clock ?? (() => new Date());
  const allowance = options.allowance ?? null;
  /** Providers resting after a failure: until when, and why */
  const resting = new Map<ProspectProviderName, { until: number; kind: DiscoveryFailure; message: string }>();
  const backup = providers[1]?.name ?? null;

  /** Why a provider shouldn't be asked now, or null when it can be */
  async function blocked(provider: DiscoveryProvider): Promise<{ kind: DiscoveryFailure; message: string } | null> {
    const rest = resting.get(provider.name);
    if (provider.name === 'serpapi' && allowance) {
      const account = await allowance.check();
      if (account) {
        if (account.left <= 0) return { kind: 'quota', message: exhausted(account.renews) };
        // Searches are back (the plan renewed): no need to wait out the rest
        if (rest?.kind === 'quota') resting.delete(provider.name);
        else if (rest && rest.until > clock().getTime()) return rest;
        return null;
      }
    }
    return rest && rest.until > clock().getTime() ? rest : null;
  }

  function failed(provider: DiscoveryProvider, error: DiscoveryError) {
    const ms = REST_MS[error.kind];
    if (ms > 0) resting.set(provider.name, { until: clock().getTime() + ms, kind: error.kind, message: error.message });
    const next = providers[providers.indexOf(provider) + 1];
    console.warn(`Prospector: ${PROVIDER_LABEL[provider.name]} failed (${error.kind})${next ? `; ${PROVIDER_LABEL[next.name]} takes over` : ''}.`);
  }

  /** The message when nothing at all was found because every provider failed */
  function finalError(attempts: Attempt[]): DiscoveryError {
    const failures = attempts.filter((attempt): attempt is Attempt & { outcome: DiscoveryFailure } => attempt.outcome !== 'empty');
    const [first, second] = failures;
    if (second) return new DiscoveryError(`${first.message} גם ${PROVIDER_LABEL[second.name]} נכשל: ${second.message}`, first.outcome);
    // Out of SerpApi searches with no backup: say how to keep searching meanwhile
    const hint =
      first.outcome === 'quota' && first.name === 'serpapi' && !backup
        ? ' כדי להמשיך לחפש בינתיים, אפשר להוסיף בשרת מפתח של Google Places (GOOGLE_PLACES_API_KEY): עד 1,000 בקשות בחודש בחינם, והחיפוש יעבור אליו לבד.'
        : '';
    return new DiscoveryError(`${first.message}${hint}`, first.outcome);
  }

  return {
    primary: providers[0].name,
    backup,

    async search(query, limit, signal) {
      const found: DiscoveredPlace[] = [];
      const seen = new Set<string>();
      const counts = new Map<ProspectProviderName, number>();
      const attempts: Attempt[] = [];
      const add = (places: readonly DiscoveredPlace[], name: ProspectProviderName) => {
        for (const place of places) {
          if (found.length >= limit) return;
          if (seen.has(place.placeId)) continue;
          seen.add(place.placeId);
          found.push(place);
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      };

      // Each provider in turn, until one answers in full: one with businesses ends the search, unless it stopped
      // partway, when the next one fills in the rest
      let stoppedPartway = false;
      for (const provider of providers) {
        if (found.length >= limit || (found.length > 0 && !stoppedPartway)) break;
        const reason = await blocked(provider);
        if (reason) {
          attempts.push({ name: provider.name, outcome: reason.kind, message: reason.message });
          continue;
        }
        try {
          const places = await provider.search(query, limit, signal);
          resting.delete(provider.name);
          add(places, provider.name);
          stoppedPartway = false;
          if (!places.length) attempts.push({ name: provider.name, outcome: 'empty', message: `${PROVIDER_LABEL[provider.name]} לא מצא עסקים לחיפוש הזה.` });
        } catch (error) {
          if (signal.aborted || !(error instanceof DiscoveryError)) throw error;
          failed(provider, error);
          add(error.partial, provider.name);
          stoppedPartway = error.partial.length > 0;
          attempts.push({ name: provider.name, outcome: error.kind, message: error.message });
        } finally {
          if (provider.name === 'serpapi') allowance?.forget();
        }
      }

      if (!found.length) {
        if (attempts.some((attempt) => attempt.outcome !== 'empty')) throw finalError(attempts);
        return { places: [], provider: providers[0].name, fallbackFrom: null, notice: null };
      }

      const served = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const first = attempts[0];
      // Another provider found some or all of them
      const helper = first ? [...counts.keys()].find((name) => name !== first.name) : undefined;
      let notice: string | null = null;
      if (first && helper && !counts.has(first.name)) notice = `${first.message} החיפוש עבר ל-${PROVIDER_LABEL[helper]}.`;
      else if (first && helper) notice = `${first.message} את שאר העסקים מצא ${PROVIDER_LABEL[helper]}.`;
      else if (first && first.outcome !== 'empty' && found.length < limit) {
        notice = `${first.message} לכן ${found.length === 1 ? 'נמצא רק עסק אחד' : `נמצאו רק ${found.length} עסקים`}.`;
      }
      return { places: found, provider: served, fallbackFrom: first && helper ? first.name : null, notice };
    },

    async status() {
      const now = clock().getTime();
      return Promise.all(
        providers.map(async (provider, index): Promise<ProviderStatus> => {
          const account = provider.name === 'serpapi' && allowance ? await allowance.check() : null;
          const rest = resting.get(provider.name);
          const out = account ? account.left <= 0 : rest?.kind === 'quota' && rest.until > now;
          const restingNow = !out && Boolean(rest && rest.until > now);
          return {
            name: provider.name,
            role: index === 0 ? 'primary' : 'backup',
            state: out ? 'exhausted' : restingNow ? 'resting' : 'ready',
            searchesLeft: account?.left ?? null,
            searchesPerMonth: account?.perMonth ?? null,
            renews: account?.renews ?? null,
            note: out ? (provider.name === 'serpapi' ? exhausted(account?.renews ?? null) : (rest?.message ?? null)) : restingNow ? (rest?.message ?? null) : null,
          };
        }),
      );
    },
  };
}
