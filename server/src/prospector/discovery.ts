import { internationalDigits } from '../whatsapp/phone.js';
import type { DiscoveredPlace, DiscoveryProvider } from './types.js';

/**
 * Finding businesses: Google Places API (New) Text Search, or SerpApi's Google Maps engine. Both return
 * up to 20 businesses a page; a search asks for 1–3 pages (Google stops at 60 per query). Both read the same
 * Google Maps listings, so their place ids match, and one can finish a search the other started (fallback.ts).
 */

/**
 * Why a provider couldn't finish a search, which decides what happens next (see fallback.ts):
 * - quota: out of searches or requests for now; the next provider takes over, and this one rests
 * - auth: the key was refused
 * - unavailable: down, slow or unreachable, or an error it didn't explain
 * - rejected: it didn't accept the query itself
 */
export type DiscoveryFailure = 'quota' | 'auth' | 'unavailable' | 'rejected';

/** A reason the search failed, in words for the app. The provider's own error is logged, not shown. */
export class DiscoveryError extends Error {
  readonly kind: DiscoveryFailure;
  /** Businesses found before it stopped (a later page failed), so another provider can add to them */
  readonly partial: DiscoveredPlace[];

  constructor(message: string, kind: DiscoveryFailure = 'unavailable', partial: DiscoveredPlace[] = []) {
    super(message);
    this.name = 'DiscoveryError';
    this.kind = kind;
    this.partial = partial;
  }
}

/** The same failure, carrying what was found before it */
function withPartial(error: unknown, found: DiscoveredPlace[]): unknown {
  return error instanceof DiscoveryError && found.length ? new DiscoveryError(error.message, error.kind, [...found]) : error;
}

/**
 * "חדרי כושר" + "תל אביב" → "חדרי כושר בתל אביב". A place that already starts with ב (באר שבע, בני ברק) is
 * left as it is, and Latin text gets "in".
 */
export function buildQuery(niche: string, location: string): string {
  const what = niche.trim().replace(/\s+/g, ' ');
  const where = location.trim().replace(/\s+/g, ' ');
  if (/^[֐-׿]/.test(where)) return where.startsWith('ב') ? `${what} ${where}` : `${what} ב${where}`;
  return `${what} in ${where}`;
}

/** "+972 3-555-0101" reads as "03-555-0101" at home; numbers from abroad stay international */
export function localPhone(phone: string, countryCode: string): string {
  const trimmed = phone.trim();
  const prefix = new RegExp(`^\\+${countryCode}[\\s-]*`);
  return prefix.test(trimmed) ? `0${trimmed.replace(prefix, '')}` : trimmed;
}

const PAGE = 20;
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** A permanent close drops the business; a temporary one is kept and flagged */
const permanentlyClosed = (status: string | undefined) => status === 'CLOSED_PERMANENTLY';

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
}

/**
 * Text Search (New). These fields bill as Text Search Enterprise (phone and website need it):
 * 1,000 requests a month are free, and one search of 60 businesses is three requests.
 */
export const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'places.rating',
  'places.userRatingCount',
  'nextPageToken',
].join(',');

function googleFailure(status: number): DiscoveryError {
  if (status === 400) return new DiscoveryError('Google Places דחה את החיפוש. נסו לנסח את התחום או האזור אחרת.', 'rejected');
  if (status === 401 || status === 403) {
    return new DiscoveryError(
      'Google Places דחה את המפתח. ודאו ש-Places API (New) מופעל בפרויקט, שהחיוב פעיל ושהמפתח מורשה לו (GOOGLE_PLACES_API_KEY).',
      'auth',
    );
  }
  if (status === 429) return new DiscoveryError('נגמרה המכסה של Google Places לעכשיו. נסו שוב בעוד כמה דקות.', 'quota');
  return new DiscoveryError('Google Places לא זמין כרגע. נסו שוב בעוד רגע.', 'unavailable');
}

export interface GooglePlacesOptions {
  apiKey: string;
  /** Tests point this at a local stand-in */
  baseUrl?: string;
  languageCode: string;
  regionCode: string;
  countryCode: string;
  timeoutMs?: number;
}

export function createGooglePlaces(options: GooglePlacesOptions): DiscoveryProvider {
  const baseUrl = (options.baseUrl ?? 'https://places.googleapis.com').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;

  const toPlace = (place: GooglePlace): DiscoveredPlace | null => {
    if (!place.id || !place.displayName?.text || permanentlyClosed(place.businessStatus)) return null;
    const phone = place.nationalPhoneNumber?.trim() ?? '';
    return {
      placeId: place.id,
      name: place.displayName.text.trim(),
      phone,
      phoneIntl:
        internationalDigits(place.internationalPhoneNumber ?? '', options.countryCode) ?? internationalDigits(phone, options.countryCode) ?? '',
      website: place.websiteUri?.trim() ?? '',
      address: (place.shortFormattedAddress ?? place.formattedAddress ?? '').trim(),
      mapsUrl: place.googleMapsUri ?? '',
      category: place.primaryTypeDisplayName?.text?.trim() ?? '',
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      closed: place.businessStatus === 'CLOSED_TEMPORARILY',
      unclaimed: false,
    };
  };

  async function page(query: string, pageSize: number, pageToken: string | undefined, signal: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/places:searchText`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey, 'x-goog-fieldmask': GOOGLE_FIELD_MASK },
        body: JSON.stringify({
          textQuery: query,
          languageCode: options.languageCode,
          regionCode: options.regionCode,
          pageSize,
          ...(pageToken ? { pageToken } : {}),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      console.error('Google Places request failed:', error);
      throw new DiscoveryError('השרת לא הצליח להגיע ל-Google Places. נסו שוב בעוד רגע.', 'unavailable');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Google Places answered ${response.status}: ${detail.slice(0, 800)}`);
      throw googleFailure(response.status);
    }
    return (await response.json()) as { places?: GooglePlace[]; nextPageToken?: string };
  }

  return {
    name: 'google',
    async search(query, limit, signal) {
      const found: DiscoveredPlace[] = [];
      const seen = new Set<string>();
      let token: string | undefined;
      for (let pageNumber = 0; pageNumber < Math.ceil(limit / PAGE); pageNumber++) {
        let result: Awaited<ReturnType<typeof page>>;
        try {
          try {
            result = await page(query, PAGE, token, signal);
          } catch (error) {
            // A page token can take a moment to start working; one retry covers it.
            if (!token || !(error instanceof DiscoveryError) || error.kind !== 'rejected') throw error;
            await wait(2000, signal);
            result = await page(query, PAGE, token, signal);
          }
        } catch (error) {
          throw withPartial(error, found);
        }
        for (const raw of result.places ?? []) {
          const place = toPlace(raw);
          if (place && !seen.has(place.placeId)) {
            seen.add(place.placeId);
            found.push(place);
          }
        }
        token = result.nextPageToken;
        if (!token) break;
      }
      return found.slice(0, limit);
    },
  };
}

interface SerpLocalResult {
  title?: string;
  place_id?: string;
  data_id?: string;
  phone?: string;
  website?: string;
  address?: string;
  type?: string;
  rating?: number;
  reviews?: number;
  open_state?: string;
  unclaimed_listing?: boolean;
}

interface SerpResponse {
  search_metadata?: { status?: string };
  error?: string;
  local_results?: SerpLocalResult[];
  serpapi_pagination?: { next?: string };
}

const PERMANENTLY_CLOSED = /permanently closed|closed permanently|נסגר לצמיתות|סגור לצמיתות/i;
const TEMPORARILY_CLOSED = /temporarily closed|נסגר זמנית|סגור זמנית/i;

export interface SerpApiOptions {
  apiKey: string;
  baseUrl?: string;
  /** SerpApi's code for Hebrew is iw */
  hl: string;
  googleDomain: string;
  countryCode: string;
  timeoutMs?: number;
}

/** SerpApi's Google Maps engine: 250 searches a month on the free plan; a search of 60 businesses is three. */
export function createSerpApi(options: SerpApiOptions): DiscoveryProvider {
  const baseUrl = (options.baseUrl ?? 'https://serpapi.com').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 40_000;

  const toPlace = (item: SerpLocalResult): DiscoveredPlace | null => {
    const placeId = item.place_id ?? item.data_id;
    if (!placeId || !item.title || PERMANENTLY_CLOSED.test(item.open_state ?? '')) return null;
    const phone = localPhone(item.phone ?? '', options.countryCode);
    return {
      placeId,
      name: item.title.trim(),
      phone,
      phoneIntl: internationalDigits(phone, options.countryCode) ?? '',
      website: item.website?.trim() ?? '',
      address: item.address?.trim() ?? '',
      mapsUrl: item.place_id
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title)}&query_place_id=${encodeURIComponent(item.place_id)}`
        : '',
      category: item.type?.trim() ?? '',
      rating: typeof item.rating === 'number' ? item.rating : null,
      reviews: typeof item.reviews === 'number' ? item.reviews : null,
      closed: TEMPORARILY_CLOSED.test(item.open_state ?? ''),
      unclaimed: item.unclaimed_listing === true,
    };
  };

  return {
    name: 'serpapi',
    async search(query, limit, signal) {
      const found: DiscoveredPlace[] = [];
      const seen = new Set<string>();
      for (let start = 0; start < limit; start += PAGE) {
        const params = new URLSearchParams({
          engine: 'google_maps',
          type: 'search',
          q: query,
          hl: options.hl,
          google_domain: options.googleDomain,
          start: String(start),
          api_key: options.apiKey,
        });
        let response: Response;
        try {
          response = await fetch(`${baseUrl}/search.json?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
        } catch (error) {
          if (signal.aborted) throw error;
          console.error('SerpApi request failed:', error);
          throw new DiscoveryError('השרת לא הצליח להגיע ל-SerpApi. נסו שוב בעוד רגע.', 'unavailable', found);
        }
        const body = (await response.json().catch(() => ({}))) as SerpResponse;
        if (!response.ok || body.error) {
          const detail = String(body.error ?? '');
          // "Google hasn't returned any results for this query": no (more) businesses, not a failure
          if (/hasn't returned any results/i.test(detail)) break;
          console.error(`SerpApi answered ${response.status}: ${detail.slice(0, 500)}`);
          if (response.status === 401 || /invalid api key/i.test(detail)) {
            throw new DiscoveryError('SerpApi דחה את המפתח. בדקו את SERPAPI_KEY בשרת.', 'auth', found);
          }
          if (response.status === 429 || /run out of searches|limit/i.test(detail)) {
            throw new DiscoveryError('נגמרו החיפושים בחבילת SerpApi החודש.', 'quota', found);
          }
          if (response.status >= 500 || start > 0) {
            throw new DiscoveryError('SerpApi לא זמין כרגע. נסו שוב בעוד רגע.', 'unavailable', found);
          }
          throw new DiscoveryError('SerpApi לא קיבל את החיפוש. נסו לנסח את התחום או האזור אחרת.', 'rejected');
        }
        const items = body.local_results ?? [];
        for (const item of items) {
          const place = toPlace(item);
          if (place && !seen.has(place.placeId)) {
            seen.add(place.placeId);
            found.push(place);
          }
        }
        if (items.length < PAGE || !body.serpapi_pagination?.next) break;
      }
      return found.slice(0, limit);
    },
  };
}
