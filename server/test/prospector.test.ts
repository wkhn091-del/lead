import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { CoachProvider, CoachRequest } from '../src/coach/providers.js';
import { createLocalStorage } from '../src/media/storage.js';
import { createRenderer } from '../src/prospector/browser.js';
import { buildQuery, createGooglePlaces, createSerpApi, DiscoveryError, GOOGLE_FIELD_MASK, localPhone } from '../src/prospector/discovery.js';
import { createDiscovery, createSerpApiAccount } from '../src/prospector/fallback.js';
import { ProspectorEngine, type ProspectorSettings } from '../src/prospector/engine.js';
import { PHONE_USER_AGENT } from '../src/prospector/index.js';
import { decodeHtml, fetchPage, FetchFailure, guardedLookup, isPublicAddress, parseWebUrl } from '../src/prospector/net.js';
import { startFilteringProxy } from '../src/prospector/proxy.js';
import { finalScore, ruleScore, type SiteAssessment } from '../src/prospector/score.js';
import { extractSignals, parsePage } from '../src/prospector/signals.js';
import { cleanWebsite, domainOf, notAWebsite, responseVerdict } from '../src/prospector/site.js';
import { emptyAnalysis, type DiscoveredPlace, type DiscoveryProvider, type ProspectProviderName, type ProspectRecord, type ProspectSearchRecord } from '../src/prospector/types.js';
import { createMemoryStores } from '../src/stores/memory.js';
import type { Stores } from '../src/stores/types.js';
import { TEST_EMAIL, TEST_PASSWORD } from './credentials.js';
import {
  CHALLENGE_PAGE,
  closedPort,
  MODERN_SITE,
  OLD_SITE,
  OVERFLOWING_PAGE,
  PARKED_PAGE,
  startSite,
  windows1255,
  WIX_SITE,
  type TestSite,
} from './prospector-sites.js';

const fetchSettings = {
  allowPrivateNetwork: true,
  maxBytes: 1_500_000,
  maxRedirects: 6,
  userAgent: PHONE_USER_AGENT,
  acceptLanguage: 'he-IL,he;q=0.9',
};

/** A tiny HTTP server that answers with `handle` and remembers each request */
async function stub(handle: (req: http.IncomingMessage, body: string) => { status?: number; json: unknown }) {
  const requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const answer = handle(req, body);
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(answer.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const googlePlace = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `place-${n}`,
  displayName: { text: `עסק ${n}`, languageCode: 'he' },
  shortFormattedAddress: `רחוב ${n}, תל אביב`,
  nationalPhoneNumber: `03-555-01${String(n).padStart(2, '0')}`,
  internationalPhoneNumber: `+972 3-555-01${String(n).padStart(2, '0')}`,
  websiteUri: `https://biz${n}.co.il/?utm_source=gmb`,
  googleMapsUri: `https://maps.google.com/?cid=${n}`,
  businessStatus: 'OPERATIONAL',
  primaryTypeDisplayName: { text: 'חדר כושר' },
  rating: 4.5,
  userRatingCount: 100 + n,
  ...extra,
});

describe('finding businesses', () => {
  it('builds the query in natural Hebrew, and in English for Latin input', () => {
    expect(buildQuery('חדרי כושר', 'תל אביב')).toBe('חדרי כושר בתל אביב');
    expect(buildQuery(' מסעדות ', ' באר  שבע ')).toBe('מסעדות באר שבע');
    expect(buildQuery('gyms', 'Haifa')).toBe('gyms in Haifa');
    expect(localPhone('+972 3-555-0101', '972')).toBe('03-555-0101');
    expect(localPhone('+1 212-555-0100', '972')).toBe('+1 212-555-0100');
  });

  it('pages through Google Places with the Enterprise fields, drops closed businesses and maps each one', async () => {
    const google = await stub((_req, body) => {
      const { pageToken } = JSON.parse(body) as { pageToken?: string };
      if (!pageToken) {
        return {
          json: {
            places: [
              ...Array.from({ length: 18 }, (_, i) => googlePlace(i + 1)),
              googlePlace(19, { businessStatus: 'CLOSED_PERMANENTLY' }),
              googlePlace(20, { businessStatus: 'CLOSED_TEMPORARILY', websiteUri: undefined }),
            ],
            nextPageToken: 'page-2',
          },
        };
      }
      return { json: { places: Array.from({ length: 20 }, (_, i) => googlePlace(i + 21)), nextPageToken: 'page-3' } };
    });
    try {
      const provider = createGooglePlaces({ apiKey: 'test-key', baseUrl: google.url, languageCode: 'he', regionCode: 'IL', countryCode: '972' });
      const places = await provider.search('חדרי כושר בתל אביב', 40, new AbortController().signal);
      expect(google.requests).toHaveLength(2);
      const [first, second] = google.requests;
      expect(first.method).toBe('POST');
      expect(first.url).toBe('/v1/places:searchText');
      expect(first.headers['x-goog-api-key']).toBe('test-key');
      expect(first.headers['x-goog-fieldmask']).toBe(GOOGLE_FIELD_MASK);
      expect(GOOGLE_FIELD_MASK).toContain('places.websiteUri');
      expect(GOOGLE_FIELD_MASK).toContain('nextPageToken');
      expect(JSON.parse(first.body)).toEqual({ textQuery: 'חדרי כושר בתל אביב', languageCode: 'he', regionCode: 'IL', pageSize: 20 });
      expect(JSON.parse(second.body).pageToken).toBe('page-2');

      expect(places).toHaveLength(39);
      expect(places.find((place) => place.placeId === 'place-19')).toBeUndefined();
      expect(places.find((place) => place.placeId === 'place-20')).toMatchObject({ closed: true, website: '' });
      expect(places[0]).toEqual({
        placeId: 'place-1',
        name: 'עסק 1',
        phone: '03-555-0101',
        phoneIntl: '97235550101',
        website: 'https://biz1.co.il/?utm_source=gmb',
        address: 'רחוב 1, תל אביב',
        mapsUrl: 'https://maps.google.com/?cid=1',
        category: 'חדר כושר',
        rating: 4.5,
        reviews: 101,
        closed: false,
        unclaimed: false,
      });
    } finally {
      await google.close();
    }
  });

  it('turns a rejected Google key into a message about what to fix', async () => {
    const google = await stub(() => ({ status: 403, json: { error: { code: 403, status: 'PERMISSION_DENIED' } } }));
    try {
      const provider = createGooglePlaces({ apiKey: 'bad', baseUrl: google.url, languageCode: 'he', regionCode: 'IL', countryCode: '972' });
      const failure = await provider.search('x', 20, new AbortController().signal).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DiscoveryError);
      expect((failure as Error).message).toContain('Places API (New)');
    } finally {
      await google.close();
    }
  });

  it('pages through SerpApi in Hebrew and keeps whether the listing was claimed', async () => {
    const serp = await stub((req) => {
      const params = new URL(req.url ?? '', 'http://x').searchParams;
      const start = Number(params.get('start'));
      const count = start === 0 ? 20 : 3;
      return {
        json: {
          search_metadata: { status: 'Success' },
          local_results: Array.from({ length: count }, (_, i) => ({
            title: `עסק ${start + i + 1}`,
            place_id: `ChIJ${start + i}`,
            phone: '+972 4-600-0000',
            website: i === 0 ? 'https://www.facebook.com/biz' : undefined,
            address: 'טבריה',
            type: 'מוסך',
            rating: 4.1,
            reviews: 12,
            unclaimed_listing: i === 1 ? true : undefined,
          })),
          serpapi_pagination: { next: 'https://serpapi.com/search.json?start=20' },
        },
      };
    });
    try {
      const provider = createSerpApi({ apiKey: 'serp-key', baseUrl: serp.url, hl: 'iw', googleDomain: 'google.co.il', countryCode: '972' });
      const places = await provider.search('מוסכים בטבריה', 60, new AbortController().signal);
      expect(serp.requests.map((entry) => new URL(entry.url, 'http://x').searchParams.get('start'))).toEqual(['0', '20']);
      const params = new URL(serp.requests[0].url, 'http://x').searchParams;
      expect(Object.fromEntries(params)).toMatchObject({ engine: 'google_maps', type: 'search', q: 'מוסכים בטבריה', hl: 'iw', api_key: 'serp-key' });
      expect(places).toHaveLength(23);
      expect(places[0]).toMatchObject({ phone: '04-600-0000', phoneIntl: '97246000000', website: 'https://www.facebook.com/biz', unclaimed: false });
      expect(places[1].unclaimed).toBe(true);
      expect(places[0].mapsUrl).toContain('query_place_id=ChIJ0');
    } finally {
      await serp.close();
    }
  });
});

describe('searching with a backup provider', () => {
  const found = (from: number, count: number, prefix = 'ChIJ') =>
    Array.from({ length: count }, (_, i) => place(from + i, `עסק ${from + i}`, '', { placeId: `${prefix}${from + i}` }));
  /** A provider that answers from a script, one step per search, and counts its searches */
  const scripted = (name: ProspectProviderName, steps: (DiscoveredPlace[] | DiscoveryError)[]) => {
    const calls: number[] = [];
    const provider: DiscoveryProvider & { calls: number[] } = {
      name,
      calls,
      async search(_query, limit) {
        calls.push(limit);
        const step = steps.shift() ?? [];
        if (step instanceof DiscoveryError) throw step;
        return step.slice(0, limit);
      },
    };
    return provider;
  };
  const signal = new AbortController().signal;
  const outOfSearches = (partial: DiscoveredPlace[] = []) => new DiscoveryError('נגמרו החיפושים בחבילת SerpApi החודש.', 'quota', partial);

  it('lets Google Places finish a search SerpApi ran out of searches for, then skips SerpApi for a while', async () => {
    let now = new Date('2026-10-27T10:00:00Z');
    const serp = scripted('serpapi', [outOfSearches(found(0, 20)), found(100, 20)]);
    // Google reads the same listings: its first page is the one SerpApi already found
    const google = scripted('google', [found(0, 40), found(200, 20)]);
    const discovery = createDiscovery([serp, google], { clock: () => now });
    expect([discovery.primary, discovery.backup]).toEqual(['serpapi', 'google']);

    const first = await discovery.search('מסעדות בטבריה', 40, signal);
    expect(first.places.map((item) => item.placeId)).toEqual(found(0, 40).map((item) => item.placeId));
    expect(first).toMatchObject({ provider: 'serpapi', fallbackFrom: 'serpapi', notice: 'נגמרו החיפושים בחבילת SerpApi החודש. את שאר העסקים מצא Google Places.' });

    // SerpApi rests after running out: the next search goes straight to Google
    const second = await discovery.search('מוסכים בטבריה', 20, signal);
    expect(serp.calls).toHaveLength(1);
    expect(second).toMatchObject({ provider: 'google', fallbackFrom: 'serpapi', notice: 'נגמרו החיפושים בחבילת SerpApi החודש. החיפוש עבר ל-Google Places.' });
    expect((await discovery.status()).map((item) => [item.name, item.role, item.state])).toEqual([
      ['serpapi', 'primary', 'exhausted'],
      ['google', 'backup', 'ready'],
    ]);

    // A quarter of an hour later it's tried again
    now = new Date('2026-10-27T10:16:00Z');
    const third = await discovery.search('קפה בטבריה', 20, signal);
    expect(third).toMatchObject({ provider: 'serpapi', fallbackFrom: null, notice: null });
    expect(third.places[0].placeId).toBe('ChIJ100');
  });

  it("asks SerpApi's Account API before searching, and skips a month with no searches left", async () => {
    let left = 0;
    const account = await stub((req) => {
      const params = new URL(req.url ?? '', 'http://x').searchParams;
      if (params.get('api_key') !== 'serp-key') return { status: 401, json: { error: 'Invalid API key.' } };
      return { json: { searches_per_month: 250, plan_searches_left: left, total_searches_left: left, plan_renewal_date: '2026-11-03' } };
    });
    try {
      let now = new Date('2026-10-27T10:00:00Z');
      const allowance = createSerpApiAccount({ apiKey: 'serp-key', baseUrl: account.url, clock: () => now });
      const serp = scripted('serpapi', [found(0, 20)]);
      const google = scripted('google', [found(50, 20)]);
      const discovery = createDiscovery([serp, google], { allowance, clock: () => now });

      const skipped = await discovery.search('מסעדות בטבריה', 20, signal);
      expect(serp.calls).toEqual([]);
      expect(skipped.provider).toBe('google');
      expect(skipped.notice).toBe('נגמרו החיפושים בחבילת SerpApi החודש (הם מתחדשים ב-3 בנוב׳). החיפוש עבר ל-Google Places.');
      expect(account.requests[0].url).toBe('/account.json?api_key=serp-key');
      expect(await discovery.status()).toMatchObject([
        { name: 'serpapi', state: 'exhausted', searchesLeft: 0, searchesPerMonth: 250 },
        { name: 'google', state: 'ready', searchesLeft: null },
      ]);

      // The plan renewed: SerpApi is back, and the count is read again (at most once a minute)
      left = 250;
      now = new Date('2026-10-27T10:02:00Z');
      const back = await discovery.search('מוסכים בטבריה', 20, signal);
      expect(back.provider).toBe('serpapi');
      expect(serp.calls).toEqual([20]);
      expect((await discovery.status())[0]).toMatchObject({ state: 'ready', searchesLeft: 250 });

      // A key the Account API refuses says nothing about the searches: SerpApi is simply tried
      const wrongKey = createDiscovery([scripted('serpapi', [found(0, 3)])], { allowance: createSerpApiAccount({ apiKey: 'other', baseUrl: account.url }) });
      expect((await wrongKey.search('x', 20, signal)).places).toHaveLength(3);
    } finally {
      await account.close();
    }
  });

  it('says how to keep searching when SerpApi runs out with no backup, and keeps what it found', async () => {
    const alone = createDiscovery([scripted('serpapi', [outOfSearches(), outOfSearches(found(0, 20))])], { clock: () => new Date(0) });
    const failure = await alone.search('מסעדות', 40, signal).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DiscoveryError);
    expect((failure as DiscoveryError).message).toContain('GOOGLE_PLACES_API_KEY');
    expect((failure as DiscoveryError).kind).toBe('quota');

    const partway = createDiscovery([scripted('serpapi', [outOfSearches(found(0, 20))])]);
    expect(await partway.search('מסעדות', 40, signal)).toMatchObject({
      provider: 'serpapi',
      fallbackFrom: null,
      notice: 'נגמרו החיפושים בחבילת SerpApi החודש. לכן נמצאו רק 20 עסקים.',
    });
  });

  it('tries the backup when the first finds nothing, and explains when both fail', async () => {
    const empty = createDiscovery([scripted('serpapi', [[]]), scripted('google', [found(0, 5)])]);
    expect(await empty.search('צפרות בחולה', 20, signal)).toMatchObject({ provider: 'google', notice: 'SerpApi לא מצא עסקים לחיפוש הזה. החיפוש עבר ל-Google Places.' });

    const none = createDiscovery([scripted('serpapi', [[]]), scripted('google', [[]])]);
    expect(await none.search('x', 20, signal)).toEqual({ places: [], provider: 'serpapi', fallbackFrom: null, notice: null });

    const both = createDiscovery([
      scripted('serpapi', [new DiscoveryError('SerpApi דחה את המפתח. בדקו את SERPAPI_KEY בשרת.', 'auth')]),
      scripted('google', [new DiscoveryError('Google Places לא זמין כרגע. נסו שוב בעוד רגע.', 'unavailable')]),
    ]);
    const failure = (await both.search('x', 20, signal).catch((error: unknown) => error)) as DiscoveryError;
    expect(failure.message).toBe('SerpApi דחה את המפתח. בדקו את SERPAPI_KEY בשרת. גם Google Places נכשל: Google Places לא זמין כרגע. נסו שוב בעוד רגע.');
    expect(failure.kind).toBe('auth');
  });

  it('turns SerpApi running out mid-search into a failure that carries what was found', async () => {
    const serp = await stub((req) => {
      const start = Number(new URL(req.url ?? '', 'http://x').searchParams.get('start'));
      if (start > 0) return { status: 429, json: { error: 'Your account has run out of searches.' } };
      return {
        json: {
          local_results: Array.from({ length: 20 }, (_, i) => ({ title: `עסק ${i}`, place_id: `ChIJ${i}`, phone: '04-600-0000' })),
          serpapi_pagination: { next: 'https://serpapi.com/search.json?start=20' },
        },
      };
    });
    try {
      const provider = createSerpApi({ apiKey: 'serp-key', baseUrl: serp.url, hl: 'iw', googleDomain: 'google.co.il', countryCode: '972' });
      const failure = (await provider.search('מסעדות', 40, signal).catch((error: unknown) => error)) as DiscoveryError;
      expect(failure).toBeInstanceOf(DiscoveryError);
      expect([failure.kind, failure.partial.length, failure.message]).toEqual(['quota', 20, 'נגמרו החיפושים בחבילת SerpApi החודש.']);
    } finally {
      await serp.close();
    }
  });
});

describe('reading websites safely', () => {
  it('only treats public internet addresses as reachable', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) expect(isPublicAddress(address), address).toBe(true);
  });

  it('refuses addresses that are not ordinary public web pages', () => {
    const kind = (url: string) => {
      try {
        parseWebUrl(url, false);
        return 'ok';
      } catch (error) {
        return (error as FetchFailure).kind;
      }
    };
    expect(kind('javascript:alert(1)')).toBe('bad-url');
    expect(kind('file:///etc/passwd')).toBe('bad-url');
    expect(kind('http://user:secret@biz.co.il/')).toBe('bad-url');
    expect(kind('http://biz.co.il:8080/')).toBe('bad-url');
    expect(kind('http://localhost/')).toBe('bad-url');
    expect(kind('http://127.0.0.1/')).toBe('blocked-address');
    expect(kind('http://[::1]/')).toBe('blocked-address');
    expect(kind('http://169.254.169.254/latest/meta-data/')).toBe('blocked-address');
    expect(kind('biz.co.il')).toBe('ok');
    expect(parseWebUrl('biz.co.il/#top', false).toString()).toBe('http://biz.co.il/');
  });

  it('checks the address every connection actually uses, so DNS can’t swap in a private one', async () => {
    const resolver = (answer: { address: string; family: number }[]) =>
      ((_host: string, _options: unknown, callback: (error: Error | null, addresses: unknown) => void) => callback(null, answer)) as never;
    const lookup = (answer: { address: string; family: number }[], all: boolean) =>
      new Promise<{ error: (Error & { code?: string }) | null; address: unknown }>((resolve) =>
        guardedLookup(false, resolver(answer))('evil.example', { all }, (error, address) => resolve({ error, address })),
      );
    expect((await lookup([{ address: '10.0.0.5', family: 4 }], false)).error?.code).toBe('EBLOCKED');
    expect((await lookup([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], true)).error?.code).toBe('EBLOCKED');
    expect(await lookup([{ address: '93.184.216.34', family: 4 }], false)).toEqual({ error: null, address: '93.184.216.34' });
  });

  it('follows redirects, unpacks gzip, stops at the size limit and only ever sends GET', async () => {
    const big = `<html><body>${'א'.repeat(5000)}</body></html>`;
    const site = await startSite({
      '/': { status: 301, headers: { location: '/home' } },
      '/home': { headers: { 'content-encoding': 'gzip' }, body: gzipSync(Buffer.from(big)) },
    });
    try {
      const page = await fetchPage(site.url, { ...fetchSettings, timeoutMs: 5000, maxBytes: 1000 });
      expect(page.status).toBe(200);
      expect(page.finalUrl).toBe(`${site.url}home`);
      expect(page.redirects).toEqual([`${site.url}home`]);
      expect(page.truncated).toBe(true);
      expect(page.body.length).toBe(1000);
      expect(site.hits.every((hit) => hit.startsWith('GET '))).toBe(true);
    } finally {
      await site.close();
    }
  });

  it('stops at a redirect to Facebook instead of following it', async () => {
    const site = await startSite({ '/': { status: 302, headers: { location: 'https://www.facebook.com/galilflowers' } } });
    try {
      const page = await fetchPage(site.url, { ...fetchSettings, timeoutMs: 5000, stopAt: (url) => notAWebsite(url.toString()) !== null });
      expect(page.status).toBe(302);
      expect(page.finalUrl).toBe('https://www.facebook.com/galilflowers');
      expect(responseVerdict(page, '', '')).toEqual({ state: 'social', reason: 'האתר הרשום בגוגל הוא רק עמוד פייסבוק (האתר מפנה לשם)' });
    } finally {
      await site.close();
    }
  });

  it('reads old Hebrew sites saved as windows-1255', () => {
    const { html, charset } = decodeHtml(windows1255(OLD_SITE), 'text/html');
    expect(charset).toBe('windows-1255');
    expect(html).toContain('מוסך הגליל');
  });

  it('the browser’s proxy refuses private addresses, other ports and anything but GET', async () => {
    const proxy = await startFilteringProxy(false);
    const send = (raw: string) =>
      new Promise<string>((resolve) => {
        const socket = net.connect(proxy.port, '127.0.0.1', () => socket.write(raw));
        let data = '';
        socket.on('data', (chunk) => (data += chunk));
        socket.on('close', () => resolve(data));
        socket.on('error', () => resolve(data));
        setTimeout(() => socket.destroy(), 1500);
      });
    try {
      expect(await send('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      expect(await send('CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]:443\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      expect(await send('CONNECT biz.co.il:22 HTTP/1.1\r\nHost: biz.co.il:22\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      expect(await send('GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      expect(await send('POST http://biz.co.il/contact HTTP/1.1\r\nHost: biz.co.il\r\nContent-Length: 0\r\n\r\n')).toMatch(/^HTTP\/1\.1 405/);
    } finally {
      await proxy.close();
    }
  });
});

describe('judging a site', () => {
  const now = new Date();
  const signalsOf = (html: string, finalUrl = 'https://biz.example/', charset = 'utf-8') =>
    extractSignals({ html, finalUrl, status: 200, charset, responseMs: 300, loadMs: 600, bytes: html.length, now }, parsePage(html));

  it('knows which listing links are not a website of their own', () => {
    expect(notAWebsite('https://www.facebook.com/galil')?.state).toBe('social');
    expect(notAWebsite('instagram.com/galil')?.state).toBe('social');
    expect(notAWebsite('https://linktr.ee/galil')?.state).toBe('social');
    expect(notAWebsite('https://wa.me/972500000000')?.state).toBe('social');
    expect(notAWebsite('https://www.b144.co.il/b144_sip/abc')?.state).toBe('social');
    expect(notAWebsite('https://galil.business.site/')?.state).toBe('broken');
    expect(notAWebsite('https://galil.co.il/')).toBeNull();
    expect(cleanWebsite('http://galil.co.il/?utm_source=gmb&utm_medium=organic')).toBe('http://galil.co.il');
    expect(cleanWebsite('https://galil.co.il/he/?page=2&fbclid=x')).toBe('https://galil.co.il/he/?page=2');
    expect(domainOf('https://WWW.Galil.co.il/he')).toBe('galil.co.il');
  });

  it('tells dead, parked, placeholder and bot-protected sites apart', () => {
    const page = (status: number, headers: Record<string, string> = {}) => ({
      url: 'https://biz.example/',
      finalUrl: 'https://biz.example/',
      status,
      headers,
      contentType: 'text/html',
      body: Buffer.alloc(0),
      truncated: false,
      ttfbMs: 100,
      totalMs: 200,
      redirects: [],
    });
    const verdict = (status: number, html: string, headers: Record<string, string> = {}) =>
      responseVerdict(page(status, headers), html, parsePage(html).text)?.state ?? 'ok';
    expect(verdict(200, PARKED_PAGE)).toBe('broken');
    expect(verdict(403, CHALLENGE_PAGE, { 'cf-mitigated': 'challenge' })).toBe('blocked');
    expect(verdict(404, '<html><body>Not found</body></html>')).toBe('broken');
    expect(verdict(500, '<html><body>error</body></html>')).toBe('broken');
    expect(verdict(200, '<html><head><title>Welcome to nginx!</title></head><body>nginx</body></html>')).toBe('broken');
    expect(verdict(200, '<html><body><h1>האתר בבנייה</h1><p>נחזור בקרוב</p></body></html>')).toBe('broken');
    expect(verdict(200, MODERN_SITE)).toBe('ok');
  });

  it('reads an old site’s age from its HTML and scores it 4', () => {
    const { html, charset } = decodeHtml(windows1255(OLD_SITE), 'text/html');
    const signals = signalsOf(html, 'http://garage.example/', charset);
    expect(signals.viewport).toBe(false);
    expect(signals.https).toBe(false);
    expect(signals.copyrightYear).toBe(2012);
    expect(signals.legacy).toEqual(expect.arrayContaining(['table layout', '<font> tags', 'legacy encoding (windows-1255)', 'jQuery 1.8.3', 'WordPress 3.9.2']));
    expect(signals.tech).toEqual(expect.arrayContaining(['WordPress 3.9.2', 'jQuery 1.8.3']));
    const rule = ruleScore(signals, now);
    expect(rule.score).toBe(4);
    expect(rule.reasons[0]).toContain('לא מותאם לטלפונים');
  });

  it('recognizes a modern site with every basic in place and scores it 1', () => {
    const signals = signalsOf(MODERN_SITE);
    expect(signals).toMatchObject({
      viewport: true,
      modern: true,
      clickToCall: true,
      whatsappButton: true,
      contactForm: true,
      accessibilityStatement: true,
      privacyPolicy: true,
      structuredData: true,
      openGraph: true,
      favicon: true,
      modernImages: true,
      h1: true,
      legacy: [],
    });
    expect(signals.tech).toContain('Next.js');
    expect(ruleScore(signals, now).score).toBe(1);
  });

  it('gives a do-it-yourself site without the basics a 3', () => {
    const signals = signalsOf(WIX_SITE);
    expect(signals.tech).toContain('Wix');
    expect(signals.modern).toBe(false);
    expect(signals.accessibilityStatement).toBe(false);
    expect(ruleScore(signals, now).score).toBe(3);
  });

  it('keeps a site that isn’t made for phones at 4 or above, whatever the AI says', () => {
    const { html, charset } = decodeHtml(windows1255(OLD_SITE), 'text/html');
    const assessment: SiteAssessment = { score: 2, verdict: 'x', reasons: ['x'], pitch: 'x', confidence: 'high' };
    expect(finalScore(assessment, signalsOf(html, 'http://garage.example/', charset))).toBe(4);
    expect(finalScore(assessment, signalsOf(MODERN_SITE))).toBe(2);
  });
});

/** A search provider that returns fixed businesses, for engine and API tests */
function fixedProvider(places: DiscoveredPlace[], gate?: Promise<void>): DiscoveryProvider {
  return {
    name: 'google',
    async search(_query, limit, signal) {
      if (gate) {
        await Promise.race([gate, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
      }
      return places.slice(0, limit);
    },
  };
}

const place = (n: number, name: string, website: string, extra: Partial<DiscoveredPlace> = {}): DiscoveredPlace => ({
  placeId: `p-${n}`,
  name,
  phone: `04-600-00${String(n).padStart(2, '0')}`,
  phoneIntl: `9724600 00${String(n).padStart(2, '0')}`.replace(/\s/g, ''),
  website,
  address: 'טבריה',
  mapsUrl: `https://maps.google.com/?cid=${n}`,
  category: 'עסק',
  rating: 4.2,
  reviews: 40,
  closed: false,
  unclaimed: false,
  ...extra,
});

/** A stand-in AI: scores by the business named in the prompt, and remembers what it was sent */
function fakeScorer(): CoachProvider & { requests: CoachRequest[] } {
  const requests: CoachRequest[] = [];
  return {
    name: 'anthropic',
    model: 'test-model',
    requests,
    async complete(request) {
      requests.push(request);
      const score = request.prompt.includes('Business: מוסך הגליל') ? 3 : request.prompt.includes('Business: סטודיו כוח') ? 1 : 3;
      return {
        score,
        verdict: score === 1 ? 'אתר עדכני ומהיר' : 'אתר שעובד אבל מיושן',
        reasons: ['אין כפתור חיוג בטלפון', 'זכויות היוצרים נעצרו ב-2012'],
        pitch: 'ראיתי שהאתר שלכם לא נפתח טוב בטלפון. אשמח להראות לכם רעיון לדף בית חדש.',
        confidence: 'medium',
      };
    },
  };
}

const settings = (overrides: Partial<ProspectorSettings> = {}): ProspectorSettings => ({
  businessContext: 'סטודיו לבניית אתרים',
  countryCode: '972',
  reuseDays: 14,
  retentionDays: 30,
  fetch: fetchSettings,
  concurrency: { fetch: 4, render: 1, ai: 2 },
  ...overrides,
});

async function waitForSearch(stores: Stores, id: string, statuses = ['done', 'failed', 'cancelled'], timeoutMs = 20_000): Promise<ProspectSearchRecord> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const search = await stores.prospector.getSearch(id);
    if (search && statuses.includes(search.status)) return search;
    if (Date.now() > until) throw new Error(`Search still ${search?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('a search, end to end', () => {
  const sites: TestSite[] = [];
  let mediaDir = '';
  let places: DiscoveredPlace[] = [];
  let siteFor: Record<string, TestSite> = {};

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'omek-prospector-'));
    const serve = async (key: string, routes: Parameters<typeof startSite>[0]) => {
      const site = await startSite(routes);
      sites.push(site);
      siteFor[key] = site;
      return site.url;
    };
    const old = await serve('old', { '/': { headers: { 'content-type': 'text/html' }, body: windows1255(OLD_SITE) } });
    const modern = await serve('modern', { '/': { body: MODERN_SITE } });
    const wix = await serve('wix', { '/': { body: WIX_SITE } });
    const parked = await serve('parked', { '/': { body: PARKED_PAGE } });
    const challenge = await serve('challenge', { '/': { status: 403, headers: { 'cf-mitigated': 'challenge' }, body: CHALLENGE_PAGE } });
    const toFacebook = await serve('toFacebook', { '/': { status: 302, headers: { location: 'https://www.facebook.com/galilflowers' } } });
    const chain = await serve('chain', { '/': { body: WIX_SITE.replace('הגינה של רותם', 'רשת גינון') } });
    const dead = `http://127.0.0.1:${await closedPort()}/`;
    places = [
      place(1, 'בית קפה בלי אתר', ''),
      place(2, 'פרחי הגליל', 'https://www.facebook.com/galilflowers'),
      place(3, 'מוסך הגליל', old),
      place(4, 'סטודיו כוח', modern),
      place(5, 'הגינה של רותם', wix),
      place(6, 'מוסך ישן', dead),
      place(7, 'דומיין חונה', parked),
      place(8, 'אתר חסום', challenge),
      place(9, 'פרחים מפנה', toFacebook),
      place(10, 'רשת גינון סניף א', chain),
      place(11, 'רשת גינון סניף ב', chain),
      place(12, 'ליד שכבר קיים', '', { phone: '04-600-0012', phoneIntl: '97246000012' }),
    ];
  });

  afterAll(async () => {
    await Promise.all(sites.map((site) => site.close()));
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('checks every website and scores it, calling the AI only for working sites', async () => {
    const stores = createMemoryStores();
    await stores.leads.create({
      id: 'existing-lead',
      name: 'ליד שכבר קיים',
      contactName: '',
      phone: '+972 4-600-0012',
      email: '',
      website: '',
      campaign: '',
      approach: '',
      method: 'call',
      currency: 'ILS',
      notes: [],
    });
    const scorer = fakeScorer();
    const engine = new ProspectorEngine({
      stores,
      storage: createLocalStorage(mediaDir),
      discovery: createDiscovery([fixedProvider(places)]),
      coach: scorer,
      renderer: null,
      settings: settings(),
      clock: () => new Date(),
    });
    const search = await engine.start({ niche: 'עסקים', location: 'טבריה', limit: 20, language: 'he' });
    expect(search.query).toBe('עסקים בטבריה');
    const finished = await waitForSearch(stores, search.id);
    expect(finished).toMatchObject({ status: 'done', found: 12 });

    const prospects = await stores.prospector.listProspects(search.id);
    const by = (name: string) => prospects.find((prospect) => prospect.name === name)!;
    const summary = (prospect: ProspectRecord) => [prospect.analysis.siteState, prospect.analysis.score, prospect.analysis.scoredBy];

    expect(summary(by('בית קפה בלי אתר'))).toEqual(['none', 5, 'rules']);
    expect(summary(by('פרחי הגליל'))).toEqual(['social', 5, 'rules']);
    expect(summary(by('פרחים מפנה'))).toEqual(['social', 5, 'rules']);
    expect(summary(by('מוסך ישן'))).toEqual(['broken', 5, 'rules']);
    expect(by('מוסך ישן').analysis.reasons[0]).toBe('השרת של האתר לא עונה');
    expect(summary(by('דומיין חונה'))).toEqual(['broken', 5, 'rules']);
    expect(summary(by('אתר חסום'))).toEqual(['blocked', null, null]);
    // The AI said 3, but a site that isn't made for phones stays at 4
    expect(summary(by('מוסך הגליל'))).toEqual(['ok', 4, 'ai']);
    expect(by('מוסך הגליל').analysis).toMatchObject({ ruleScore: 4, pitch: expect.stringContaining('בטלפון'), confidence: 'medium' });
    expect(by('מוסך הגליל').analysis.signals?.viewport).toBe(false);
    expect(summary(by('סטודיו כוח'))).toEqual(['ok', 1, 'ai']);
    expect(summary(by('הגינה של רותם'))).toEqual(['ok', 3, 'ai']);
    for (const prospect of prospects) expect(prospect.analysis.status).toBe('done');

    // Two branches with one website: checked once, shared
    const [branchA, branchB] = [by('רשת גינון סניף א'), by('רשת גינון סניף ב')];
    expect(branchB.analysis.reusedFrom).toBe(branchA.id);
    expect(branchB.analysis.score).toBe(branchA.analysis.score);
    expect(siteFor.chain.hits).toEqual(['GET /']);

    expect(by('ליד שכבר קיים').existingLeadId).toBe('existing-lead');
    expect(by('מוסך הגליל').website).toBe(siteFor.old.url.replace(/\/$/, ''));

    // The AI saw the working sites only, and no phone numbers, not even the ones on the sites' pages
    expect(scorer.requests).toHaveLength(4);
    for (const sent of scorer.requests) {
      expect(sent.prompt).not.toMatch(/04-?600|9724600|0500000000|972500000000/);
      expect(sent.images).toBeUndefined();
      expect(sent.system).toContain('Hebrew');
    }
    // Reading only: every site got nothing but GET
    for (const site of sites) expect(site.hits.every((hit) => hit.startsWith('GET ')), site.url).toBe(true);
  });

  it('scores by the rules when the AI is off, and reuses a recent check of the same site', async () => {
    const stores = createMemoryStores();
    const engine = new ProspectorEngine({
      stores,
      storage: createLocalStorage(mediaDir),
      discovery: createDiscovery([fixedProvider([places[2], places[3]])]),
      coach: null,
      renderer: null,
      settings: settings(),
      clock: () => new Date(),
    });
    const first = await engine.start({ niche: 'מוסכים', location: 'טבריה', limit: 20, language: 'he' });
    await waitForSearch(stores, first.id);
    const [old, modern] = await stores.prospector.listProspects(first.id);
    // The test sites are plain http: without HTTPS even the modern site loses its 1
    expect([old.analysis.score, old.analysis.scoredBy, modern.analysis.score]).toEqual([4, 'rules', 3]);
    expect(modern.analysis.reasons).toContain('האתר בלי HTTPS, והדפדפן מסמן אותו "לא מאובטח"');
    expect(old.analysis.pitch).toContain('עברתי על האתר שלכם');

    const hitsBefore = siteFor.old.hits.length;
    const second = await engine.start({ niche: 'מוסכים', location: 'הגליל', limit: 20, language: 'he' });
    await waitForSearch(stores, second.id);
    const [again] = await stores.prospector.listProspects(second.id);
    expect(again.analysis.reusedFrom).toBe(old.id);
    expect(siteFor.old.hits.length).toBe(hitsBefore);
  });

  it('stops a search, and marks what wasn’t checked as skipped', async () => {
    const stores = createMemoryStores();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const engine = new ProspectorEngine({
      stores,
      storage: createLocalStorage(mediaDir),
      discovery: createDiscovery([fixedProvider(places, gate)]),
      coach: null,
      renderer: null,
      settings: settings(),
      clock: () => new Date(),
    });
    const search = await engine.start({ niche: 'עסקים', location: 'טבריה', limit: 20, language: 'he' });
    const cancelled = await engine.cancel(search.id);
    release();
    expect(cancelled?.status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await stores.prospector.getSearch(search.id))?.status).toBe('cancelled');
    expect(await stores.prospector.listProspects(search.id)).toEqual([]);
  });

  it('picks up a search the server was in the middle of after a restart', async () => {
    const stores = createMemoryStores();
    const slow = await startSite({
      '/': () => {
        return { body: MODERN_SITE };
      },
    });
    sites.push(slow);
    const storage = createLocalStorage(mediaDir);
    // A search saved as the server last left it: found, but not checked yet
    const search = await stores.prospector.createSearch({
      id: randomUUID(),
      niche: 'סטודיו',
      location: 'טבריה',
      query: 'סטודיו בטבריה',
      provider: 'google',
      fallbackFrom: null,
      notice: null,
      limit: 20,
      language: 'he',
      status: 'analyzing',
      error: null,
      found: 1,
      finishedAt: null,
    });
    await stores.prospector.addProspects([
      {
        ...place(1, 'סטודיו כוח', slow.url),
        id: randomUUID(),
        searchId: search.id,
        position: 0,
        domain: domainOf(slow.url),
        existingLeadId: null,
        importedLeadId: null,
        importedAt: null,
        analysis: { ...emptyAnalysis(), status: 'checking' },
      },
    ]);
    const engine = new ProspectorEngine({ stores, storage, discovery: createDiscovery([fixedProvider([])]), coach: null, renderer: null, settings: settings(), clock: () => new Date() });
    await engine.resume();
    const finished = await waitForSearch(stores, search.id);
    expect(finished.status).toBe('done');
    const [prospect] = await stores.prospector.listProspects(search.id);
    // Scored by the rules (no AI here), over plain http
    expect(prospect.analysis).toMatchObject({ status: 'done', score: 3, scoredBy: 'rules' });
    await engine.stop();
  });

  it('deletes searches older than the retention period', async () => {
    const stores = createMemoryStores();
    let now = new Date('2026-10-01T10:00:00Z');
    const engine = new ProspectorEngine({ stores, storage: createLocalStorage(mediaDir), discovery: createDiscovery([fixedProvider([places[0]])]), coach: null, renderer: null, settings: settings(), clock: () => now });
    const search = await engine.start({ niche: 'קפה', location: 'טבריה', limit: 20, language: 'he' });
    await waitForSearch(stores, search.id);
    now = new Date('2026-10-20T10:00:00Z');
    await engine.cleanup();
    expect(await stores.prospector.getSearch(search.id)).not.toBeNull();
    // The memory store stamps createdAt with the real time; move the cut-off past it
    now = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await engine.cleanup();
    expect(await stores.prospector.getSearch(search.id)).toBeNull();
  });
});

describe('a search that another provider finished', () => {
  it('records who found the businesses and why the first choice did not', async () => {
    const stores = createMemoryStores();
    const mediaDir = await mkdtemp(join(tmpdir(), 'omek-fallback-'));
    try {
      const outOfSearches: DiscoveryProvider = {
        name: 'serpapi',
        async search() {
          throw new DiscoveryError('נגמרו החיפושים בחבילת SerpApi החודש.', 'quota');
        },
      };
      const engine = new ProspectorEngine({
        stores,
        storage: createLocalStorage(mediaDir),
        discovery: createDiscovery([outOfSearches, fixedProvider([place(1, 'בית קפה', '')])]),
        coach: null,
        renderer: null,
        settings: settings(),
        clock: () => new Date(),
      });
      const search = await engine.start({ niche: 'קפה', location: 'טבריה', limit: 20, language: 'he' });
      expect(search).toMatchObject({ provider: 'serpapi', fallbackFrom: null, notice: null });
      const done = await waitForSearch(stores, search.id);
      expect(done).toMatchObject({
        status: 'done',
        found: 1,
        provider: 'google',
        fallbackFrom: 'serpapi',
        notice: 'נגמרו החיפושים בחבילת SerpApi החודש. החיפוש עבר ל-Google Places.',
      });
      expect([engine.providerName, engine.backupName]).toEqual(['serpapi', 'google']);

      // Both out: the search fails with both reasons
      const broken = new ProspectorEngine({
        stores,
        storage: createLocalStorage(mediaDir),
        discovery: createDiscovery([outOfSearches]),
        coach: null,
        renderer: null,
        settings: settings(),
        clock: () => new Date(),
      });
      const failed = await waitForSearch(stores, (await broken.start({ niche: 'קפה', location: 'טבריה', limit: 20, language: 'he' })).id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toContain('GOOGLE_PLACES_API_KEY');
    } finally {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});

describe('Prospector API', () => {
  let site: TestSite;
  let oldSite: TestSite;
  let mediaDir = '';
  const stores = createMemoryStores();
  let engine: ProspectorEngine;
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'omek-prospector-api-'));
    site = await startSite({ '/': { body: MODERN_SITE } });
    oldSite = await startSite({ '/': { headers: { 'content-type': 'text/html' }, body: windows1255(OLD_SITE) } });
    const storage = createLocalStorage(mediaDir);
    engine = new ProspectorEngine({
      stores,
      storage,
      discovery: createDiscovery([fixedProvider([
        place(1, 'מוסך הגליל', oldSite.url),
        place(2, 'סטודיו כוח', site.url),
        place(3, 'מוסך הגליל סניף 2', '', { phone: '04-600-0001', phoneIntl: '97246000001' }),
        place(4, 'בית קפה', ''),
      ])]),
      coach: fakeScorer(),
      renderer: null,
      settings: settings(),
      clock: () => new Date(),
    });
    app = createApp({ stores, storage, coach: null, prospector: engine });
    agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
  });

  afterAll(async () => {
    await site.close();
    await oldSite.close();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('runs a search, imports the chosen businesses into the Daily 10 pool and skips duplicates', async () => {
    expect((await agent.get('/api/features').expect(200)).body.prospector).toEqual({ enabled: true, provider: 'google', backup: null, browser: false, ai: true });
    await agent.post('/api/prospector/searches').send({ niche: 'מוסכים', location: 'טבריה', limit: 30 }).expect(400);
    await agent.post('/api/prospector/searches').send({ niche: 'מ', location: 'טבריה' }).expect(400);

    const started = (await agent.post('/api/prospector/searches').send({ niche: 'מוסכים', location: 'טבריה', limit: 20 }).expect(202)).body;
    expect(started).toMatchObject({ niche: 'מוסכים', location: 'טבריה', limit: 20, status: 'discovering', total: 0 });
    await waitForSearch(stores, started.id);

    const { body } = await agent.get(`/api/prospector/searches/${started.id}`).expect(200);
    expect(body.search).toMatchObject({ status: 'done', total: 4, checked: 4, scores: { '1': 1, '4': 1, '5': 2 } });
    const [old, modern, branch, cafe] = body.prospects;
    expect(old.analysis).toMatchObject({ score: 4, hasScreenshot: false });
    expect(old.analysis.signals.text).toBeUndefined();
    expect(old.analysis.screenshotKey).toBeUndefined();

    const list = (await agent.get('/api/prospector').expect(200)).body;
    expect(list).toMatchObject({ enabled: true, provider: 'google', backup: null, ai: true, browser: false, retentionDays: 30 });
    expect(list.providers).toEqual([{ name: 'google', role: 'primary', state: 'ready', searchesLeft: null, searchesPerMonth: null, renews: null, note: null }]);
    expect(list.searches[0]).toMatchObject({ provider: 'google', fallbackFrom: null, notice: null });
    expect(list.searches.map((search: { id: string }) => search.id)).toEqual([started.id]);

    // The second branch shares the garage's number: one import, one lead
    const imported = (await agent.post('/api/prospector/import').send({ ids: [old.id, modern.id, branch.id] }).expect(201)).body;
    expect(imported.created).toHaveLength(2);
    expect(imported.skipped).toEqual([{ id: branch.id, reason: 'exists', leadId: imported.created.find((lead: { name: string }) => lead.name === 'מוסך הגליל').id }]);
    const garage = imported.created.find((lead: { name: string }) => lead.name === 'מוסך הגליל');
    expect(garage).toMatchObject({
      stage: 'cold_call',
      method: 'call',
      phone: '04-600-0001',
      campaign: 'מוסכים · טבריה',
      website: oldSite.url.replace(/\/$/, ''),
      attemptCount: 0,
    });
    expect(garage.approach).toMatch(/^ציון צורך 4\/5: /);
    const timeline = (await agent.get(`/api/leads/${garage.id}/timeline`).expect(200)).body;
    expect(timeline.interactions).toHaveLength(1);
    expect(timeline.interactions[0]).toMatchObject({ kind: 'note' });
    expect(timeline.interactions[0].body).toContain('נמצא במאתר הלידים: מוסכים · טבריה');
    expect(timeline.interactions[0].body).toContain('ציון צורך: 4/5 (מיושן מאוד)');

    // Into today's queue, since the pool was short
    const daily = (await agent.get('/api/daily').expect(200)).body;
    expect(daily.leadIds).toEqual(expect.arrayContaining(imported.created.map((lead: { id: string }) => lead.id)));

    const again = (await agent.post('/api/prospector/import').send({ ids: [old.id, cafe.id] }).expect(201)).body;
    expect(again.created.map((lead: { name: string }) => lead.name)).toEqual(['בית קפה']);
    expect(again.skipped).toEqual([{ id: old.id, reason: 'imported', leadId: garage.id }]);
    const after = (await agent.get(`/api/prospector/searches/${started.id}`).expect(200)).body;
    expect(after.search.imported).toBe(3);

    // Deleting the search keeps the leads
    await agent.delete(`/api/prospector/searches/${started.id}`).expect(204);
    await agent.get(`/api/prospector/searches/${started.id}`).expect(404);
    expect((await agent.get('/api/leads').expect(200)).body.map((lead: { id: string }) => lead.id)).toContain(garage.id);
  });

  it('checks one site again on request', async () => {
    const started = (await agent.post('/api/prospector/searches').send({ niche: 'סטודיו', location: 'טבריה', limit: 20 }).expect(202)).body;
    await waitForSearch(stores, started.id);
    const { prospects } = (await agent.get(`/api/prospector/searches/${started.id}`).expect(200)).body;
    const hits = site.hits.length;
    const modern = prospects.find((prospect: { name: string }) => prospect.name === 'סטודיו כוח');
    await agent.post(`/api/prospector/prospects/${modern.id}/recheck`).expect(202);
    for (let i = 0; i < 100 && (await stores.prospector.getProspect(modern.id))?.analysis.status !== 'done'; i++) await new Promise((r) => setTimeout(r, 30));
    expect((await stores.prospector.getProspect(modern.id))?.analysis.score).toBe(1);
    expect(site.hits.length).toBe(hits + 1);
    await agent.get(`/api/prospector/prospects/${modern.id}/screenshot`).expect(404);
  });

  it('explains itself when no search provider is set up', async () => {
    const off = createApp({ stores, storage: createLocalStorage(mediaDir), coach: null });
    const offAgent = request.agent(off);
    await offAgent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
    const status = (await offAgent.get('/api/prospector').expect(200)).body;
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('GOOGLE_PLACES_API_KEY');
    await offAgent.post('/api/prospector/searches').send({ niche: 'מוסכים', location: 'טבריה' }).expect(503);
    await request(off).get('/api/prospector').expect(401);
  });
});

const CHROME = [process.env.PROSPECTOR_TEST_CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(
  (path): path is string => Boolean(path && existsSync(path)),
);

describe.skipIf(!CHROME)('the headless browser', () => {
  it('opens a page as a phone would, screenshots it, and blocks anything but GET', async () => {
    const beaconPage = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>בדיקה</title></head><body>
      <h1>שלום</h1><p>${'טקסט '.repeat(80)}</p>
      <script>fetch('/beacon', { method: 'POST', body: 'x' }).catch(() => {}); navigator.sendBeacon('/beacon', 'y');
      document.forms; </script></body></html>`;
    const site = await startSite({ '/': { body: beaconPage }, '/wide': { body: OVERFLOWING_PAGE }, '/old': { headers: { 'content-type': 'text/html' }, body: windows1255(OLD_SITE) } });
    const renderer = createRenderer({ executablePath: CHROME!, allowPrivateNetwork: true, userAgent: PHONE_USER_AGENT, idleMs: 1000 });
    try {
      const page = await renderer.render(site.url, new AbortController().signal);
      expect(page.screenshot?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(page.mobileOverflow).toBe(false);
      expect(page.text).toContain('שלום');
      expect(page.html).toContain('<h1>שלום</h1>');
      expect((await renderer.render(`${site.url}wide`, new AbortController().signal)).mobileOverflow).toBe(true);
      // No viewport: the phone shows the desktop page shrunk
      expect((await renderer.render(`${site.url}old`, new AbortController().signal)).mobileOverflow).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(site.hits.filter((hit) => !hit.startsWith('GET '))).toEqual([]);
      expect(site.hits).toContain('GET /');
    } finally {
      await renderer.close();
      await site.close();
    }
  }, 60_000);

  it('sends the AI a phone screenshot and serves it to the app', async () => {
    const site = await startSite({ '/': { body: MODERN_SITE } });
    const mediaDir = await mkdtemp(join(tmpdir(), 'omek-prospector-shot-'));
    const stores = createMemoryStores();
    const storage = createLocalStorage(mediaDir);
    const scorer = fakeScorer();
    const engine = new ProspectorEngine({
      stores,
      storage,
      discovery: createDiscovery([fixedProvider([place(4, 'סטודיו כוח', site.url)])]),
      coach: scorer,
      renderer: createRenderer({ executablePath: CHROME!, allowPrivateNetwork: true, userAgent: PHONE_USER_AGENT, idleMs: 1000 }),
      settings: settings(),
      clock: () => new Date(),
    });
    try {
      const search = await engine.start({ niche: 'סטודיו', location: 'טבריה', limit: 20, language: 'he' });
      await waitForSearch(stores, search.id, undefined, 45_000);
      const [prospect] = await stores.prospector.listProspects(search.id);
      expect(prospect.analysis).toMatchObject({ status: 'done', score: 1, scoredBy: 'ai', screenshotKey: `prospector/${search.id}/${prospect.id}.jpg` });
      expect(prospect.analysis.signals).toMatchObject({ rendered: true, mobileOverflow: false });
      expect(scorer.requests[0].images?.[0].mediaType).toBe('image/jpeg');
      expect(Buffer.from(scorer.requests[0].images![0].data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(scorer.requests[0].prompt).toContain('Attached: a screenshot');

      const app = createApp({ stores, storage, coach: null, prospector: engine });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD }).expect(200);
      const shot = await agent.get(`/api/prospector/prospects/${prospect.id}/screenshot`).expect(200);
      expect(shot.headers['content-type']).toBe('image/jpeg');
      expect((await agent.get(`/api/prospector/searches/${search.id}`).expect(200)).body.prospects[0].analysis.hasScreenshot).toBe(true);

      // Deleting the search deletes its screenshots
      await agent.delete(`/api/prospector/searches/${search.id}`).expect(204);
      expect(existsSync(join(mediaDir, 'prospector', search.id, `${prospect.id}.jpg`))).toBe(false);
    } finally {
      await engine.stop();
      await site.close();
      await rm(mediaDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('can’t be pointed at this server or the local network', async () => {
    const site = await startSite({ '/': { body: '<html><body>internal</body></html>' } });
    const renderer = createRenderer({ executablePath: CHROME!, allowPrivateNetwork: false, userAgent: PHONE_USER_AGENT, idleMs: 1000 });
    try {
      const result = await renderer.render(site.url, new AbortController().signal).catch((error: unknown) => error);
      expect(site.hits).toEqual([]);
      if (!(result instanceof Error)) expect((result as { text: string }).text).not.toContain('internal');
    } finally {
      await renderer.close();
      await site.close();
    }
  }, 60_000);
});
