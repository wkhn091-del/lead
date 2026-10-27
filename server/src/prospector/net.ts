import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';

/**
 * Reading a business's homepage, safely. The addresses come from Google listings, so they're treated as
 * untrusted: only http(s) on the standard ports, and every connection is checked at connect time so a site
 * (or its DNS) can't point the server at itself, the local network or a cloud metadata address. Only GET is
 * ever sent: the Prospector reads pages and never submits anything.
 */

/** A public internet address: not loopback, private, link-local, carrier-grade NAT, multicast or reserved */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

const errorWithCode = (message: string, code: string) => Object.assign(new Error(message), { code });

/**
 * dns.lookup that refuses names pointing anywhere private. Passed to every connection (here and in the
 * browser's proxy), so the address that's checked is the address that's used.
 */
export function guardedLookup(allowPrivateNetwork: boolean, resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { family: options.family, hints: options.hints, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '');
      if (!addresses.length) return callback(errorWithCode(`No address for ${hostname}`, 'ENOTFOUND'), '');
      if (!allowPrivateNetwork && addresses.some((entry) => !isPublicAddress(entry.address))) {
        return callback(errorWithCode(`${hostname} points to a private address`, 'EBLOCKED'), '');
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export type FetchFailureKind =
  | 'bad-url'
  | 'blocked-address'
  | 'dns'
  | 'dns-temporary'
  | 'refused'
  | 'timeout'
  | 'tls'
  | 'tls-chain'
  | 'reset'
  | 'redirects'
  | 'aborted'
  | 'other';

export class FetchFailure extends Error {
  readonly kind: FetchFailureKind;
  readonly code: string | undefined;
  constructor(kind: FetchFailureKind, message: string, code?: string) {
    super(message);
    this.name = 'FetchFailure';
    this.kind = kind;
    this.code = code;
  }
}

export interface FetchOptions {
  /** Development and tests only: lets the check reach localhost and private addresses */
  allowPrivateNetwork: boolean;
  /** For the whole request, redirects included */
  timeoutMs: number;
  /** Bytes of page kept, after decompression; the rest isn't downloaded */
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
  acceptLanguage: string;
  /** Reads a page whose certificate chain is incomplete (browsers fill the gap; Node doesn't) */
  skipCertificateCheck?: boolean;
  /** A redirect to an address this matches isn't followed: the page ends there (a Facebook page, say) */
  stopAt?: (url: URL) => boolean;
  signal?: AbortSignal;
}

export interface FetchedPage {
  /** The address asked for, and where it ended up */
  url: string;
  finalUrl: string;
  status: number;
  headers: IncomingHttpHeaders;
  contentType: string;
  body: Buffer;
  /** The page was longer than maxBytes */
  truncated: boolean;
  /** Until the last response's headers arrived, and until its body was read */
  ttfbMs: number;
  totalMs: number;
  redirects: string[];
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * A website address as given on a listing ("www.biz.co.il", "http://biz.co.il/he?utm_source=gmb"), checked and
 * normalized. Throws FetchFailure('bad-url' or 'blocked-address').
 */
export function parseWebUrl(input: string, allowPrivateNetwork: boolean): URL {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `http://${text}`);
  } catch {
    throw new FetchFailure('bad-url', `Not a web address: ${text.slice(0, 200)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchFailure('bad-url', `Only http and https addresses are checked (${url.protocol})`);
  if (url.username || url.password) throw new FetchFailure('bad-url', 'Addresses with a user name or password are not checked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new FetchFailure('bad-url', 'The address has no host');
  if (isIP(host)) {
    if (!allowPrivateNetwork && !isPublicAddress(host)) throw new FetchFailure('blocked-address', `${host} is a private address`);
  } else if (!host.includes('.') && !allowPrivateNetwork) {
    throw new FetchFailure('bad-url', `${host} is not a public host name`);
  }
  if (url.port && url.port !== DEFAULT_PORTS[url.protocol] && !allowPrivateNetwork) {
    throw new FetchFailure('bad-url', `Only the standard web ports are checked (${url.port})`);
  }
  url.hash = '';
  return url;
}

const TLS_CHAIN = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT']);
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'EPROTO',
  'HOSTNAME_MISMATCH',
]);

/** A connection error, sorted into what it means for the site */
export function classifyNetworkError(error: unknown): FetchFailure {
  if (error instanceof FetchFailure) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'EBLOCKED') return new FetchFailure('blocked-address', message, code);
  if (code === 'ENOTFOUND' || code === 'ENODATA') return new FetchFailure('dns', message, code);
  if (code === 'EAI_AGAIN' || code === 'ESERVFAIL') return new FetchFailure('dns-temporary', message, code);
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return new FetchFailure('refused', message, code);
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ETIMEOUT') return new FetchFailure('timeout', message, code);
  if (TLS_CHAIN.has(code)) return new FetchFailure('tls-chain', message, code);
  if (TLS_CODES.has(code) || code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_') || /certificate|ssl|tls/i.test(message)) {
    return new FetchFailure('tls', message, code);
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang up/i.test(message)) return new FetchFailure('reset', message, code);
  if (code === 'ABORT_ERR' || (error instanceof Error && error.name === 'AbortError')) return new FetchFailure('aborted', message, code);
  return new FetchFailure('other', message, code);
}

const isRedirect = (status: number) => status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

/** Bodies worth reading: pages, and the short error pages that say why a site is down */
const isTextual = (contentType: string) => !contentType || /html|xml|text\/plain/i.test(contentType);

function decompressed(response: IncomingMessage) {
  const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

interface Hop {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  ttfbMs: number;
}

function requestOnce(url: URL, options: FetchOptions, deadline: number, started: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return reject(new FetchFailure('timeout', 'The page took too long to load'));
    if (options.signal?.aborted) return reject(new FetchFailure('aborted', 'Stopped'));

    const client = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (error: FetchFailure | null, hop?: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(hop!);
    };

    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(options.allowPrivateNetwork),
        rejectUnauthorized: !options.skipCertificateCheck,
        agent: false,
        headers: {
          'user-agent': options.userAgent,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': options.acceptLanguage,
          'accept-encoding': 'gzip, deflate, br',
          'cache-control': 'no-cache',
        },
      },
      (response) => {
        const ttfbMs = performance.now() - started;
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers['content-type'] ?? '');
        if (isRedirect(status) || !isTextual(contentType)) {
          response.resume();
          request.destroy();
          return finish(null, { status, headers: response.headers, body: Buffer.alloc(0), truncated: false, ttfbMs });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const stream = decompressed(response);
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const room = options.maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size += room;
            truncated = true;
            // Enough of the page: stop downloading the rest.
            request.destroy();
            finish(null, { status, headers: response.headers, body: Buffer.concat(chunks), truncated, ttfbMs });
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', () => finish(null, { status, headers: response.headers, body: Buffer.concat(chunks), truncated, ttfbMs }));
        stream.on('error', (error) => {
          // A broken compressed stream after some of the page arrived: keep what came.
          if (size > 0) finish(null, { status, headers: response.headers, body: Buffer.concat(chunks), truncated: true, ttfbMs });
          else finish(classifyNetworkError(error));
        });
      },
    );

    const onAbort = () => {
      request.destroy();
      finish(new FetchFailure('aborted', 'Stopped'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      request.destroy();
      finish(new FetchFailure('timeout', 'The page took too long to load'));
    }, remaining);
    request.on('error', (error) => finish(classifyNetworkError(error)));
    request.end();
  });
}

/** GETs a page, following up to `maxRedirects` redirects (each one checked like the first address). */
export async function fetchPage(input: string, options: FetchOptions): Promise<FetchedPage> {
  const started = performance.now();
  const deadline = started + options.timeoutMs;
  let url = parseWebUrl(input, options.allowPrivateNetwork);
  const redirects: string[] = [];
  for (;;) {
    const hop = await requestOnce(url, options, deadline, started);
    const location = hop.headers.location;
    if (isRedirect(hop.status) && location) {
      if (redirects.length >= options.maxRedirects) throw new FetchFailure('redirects', 'The site redirects in a loop');
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new FetchFailure('other', `The site redirects to an invalid address: ${location.slice(0, 200)}`);
      }
      if (options.stopAt?.(next)) {
        redirects.push(next.toString());
        return {
          url: input,
          finalUrl: next.toString(),
          status: hop.status,
          headers: hop.headers,
          contentType: '',
          body: Buffer.alloc(0),
          truncated: false,
          ttfbMs: Math.round(hop.ttfbMs),
          totalMs: Math.round(performance.now() - started),
          redirects,
        };
      }
      url = parseWebUrl(next.toString(), options.allowPrivateNetwork);
      redirects.push(url.toString());
      continue;
    }
    return {
      url: input,
      finalUrl: url.toString(),
      status: hop.status,
      headers: hop.headers,
      contentType: String(hop.headers['content-type'] ?? ''),
      body: hop.body,
      truncated: hop.truncated,
      ttfbMs: Math.round(hop.ttfbMs),
      totalMs: Math.round(performance.now() - started),
      redirects,
    };
  }
}

/**
 * The page as text, in the encoding it declares: the BOM, then the Content-Type header, then <meta charset>.
 * Old Hebrew sites often use windows-1255 or iso-8859-8.
 */
export function decodeHtml(body: Buffer, contentType: string): { html: string; charset: string } {
  let label: string | undefined;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) label = 'utf-8';
  label ??= /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1];
  if (!label) {
    const head = body.subarray(0, 4096).toString('latin1');
    label = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(head)?.[1];
  }
  const charset = (label ?? 'utf-8').toLowerCase();
  try {
    return { html: new TextDecoder(charset).decode(body), charset };
  } catch {
    return { html: new TextDecoder('utf-8').decode(body), charset: 'utf-8' };
  }
}
