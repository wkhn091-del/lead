import { internationalDigits, phoneKey } from '../lib/phone.js';
import { domainOf, notOwnSite } from '../lib/web.js';

/**
 * Whether a business is already in the CRM, or was there and was deleted. Two leads are one business when they
 * share a phone number, a Google Maps place, a website of their own or an email. Or when they have the same name in
 * the same city (or one has no city) and nothing tells them apart: two branches of a chain have different numbers,
 * places or sites, so they stay two leads.
 *
 * Shared by the server (JSON import, Prospector) and the app (adding a lead, a pasted list, the preview without a
 * server), so every way in judges the same way. No imports beyond pure helpers.
 */

/** What made two leads one business, strongest first */
export type IdentityKey = 'phone' | 'place' | 'site' | 'email' | 'name';

/** What's read of a lead, a deleted lead, or a business about to become one */
export interface IdentitySource {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  city?: string;
  mapsUrl?: string;
}

/** A lead in the CRM, or a deleted one (`deletedAt` set), as the registry knows it */
export interface KnownLead extends IdentitySource {
  id: string;
  /** When it was deleted: set only on a lead that's gone */
  deletedAt?: Date | string | null;
  /** When it was marked not relevant: it's still in the CRM */
  archivedAt?: Date | string | null;
}

interface Identity {
  phone: string | null;
  place: string | null;
  site: string | null;
  email: string | null;
  name: string;
  city: string;
}

const STRONG: readonly Exclude<IdentityKey, 'name'>[] = ['phone', 'place', 'site', 'email'];

/** "THE MODERN MAN - barberia" and "The Modern Man Barberia" read the same: letters and digits, lowercase */
export function nameKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[֑-ׇ]/g, '') // Hebrew vowel points and cantillation
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Two cities agree when either is unknown, or one is in the other ("תל אביב" and "תל אביב יפו") */
function sameCity(a: string, b: string): boolean {
  if (!a || !b || a === b) return true;
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
}

const MAPS_SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.page', 'g.co']);

/**
 * The Google Maps place a link points to: its place id (query_place_id=…, place_id=…, q=place_id:…), its cid, its
 * feature id (the "!1s0x…:0x…" in a /maps/place/ address), or a short link itself (maps.app.goo.gl/…). Null when
 * the link names no one place, as for a search by words.
 */
export function mapsPlaceOf(link: string | undefined): string | null {
  const text = (link ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const params = url.searchParams;
  const query = params.get('q') ?? params.get('query') ?? '';
  const placeId = params.get('query_place_id') ?? params.get('place_id') ?? params.get('placeid') ?? (/^place_id:(\S+)$/.exec(query)?.[1] || null);
  if (placeId?.trim()) return `place:${placeId.trim()}`;
  const cid = params.get('cid');
  if (cid && /^\d+$/.test(cid)) return `cid:${cid}`;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Keep it as written
  }
  const feature = params.get('ftid') ?? /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(decoded)?.[1] ?? null;
  if (feature && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(feature)) return `ftid:${feature.toLowerCase()}`;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');
  // A short link's code is case-sensitive, so it's kept as written
  if (MAPS_SHORT_HOSTS.has(host) && path.length > 1 && (host !== 'goo.gl' || path.startsWith('/maps/'))) return `link:${host}${path}`;
  return null;
}

// On these sites a business's page is the first part of the address (instagram.com/themodernman); two parts for
// the ones that say what kind of page first (linkedin.com/company/…, youtube.com/channel/…)
const PROFILE_HOSTS = new Set([
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  't.me',
  'linktr.ee',
  'linkin.bio',
  'beacons.ai',
  'taplink.cc',
  'bio.link',
  'lnk.bio',
  'linkedin.com',
  'youtube.com',
]);
const KIND_FIRST = new Set(['company', 'in', 'school', 'showcase', 'channel', 'c', 'user']);
// Not a business's page: a post, a share link, a search
const NOT_A_PAGE = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'share', 'sharer', 'sharer.php', 'watch', 'events', 'groups', 'posts', 'photos', 'videos', 'hashtag', 'tags', 'search', 'login', 'home.php']);

// Site builders that keep many people's sites under one name, by path: a web designer's Wix account can hold a
// site for each client (designer.wixsite.com/barber1, designer.wixsite.com/barber2)
const PATH_SITES: readonly [suffix: string, parts: number][] = [
  ['sites.google.com', 2],
  ['wixsite.com', 1],
  ['github.io', 1],
];

/** The path's parts, decoded and lowercase */
function pathParts(url: URL): string[] {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part).toLowerCase();
      } catch {
        return part.toLowerCase();
      }
    });
}

/**
 * The website a business has to itself: its domain ("arbel.co.il"), or its page on a shared site
 * ("instagram.com/themodernman", "facebook.com/profile.php?id=…", a directory listing's whole address). Null for a
 * link that isn't one business's (a WhatsApp link is the phone number, a Google Maps link the place).
 */
export function siteOf(website: string | undefined): string | null {
  const text = (website ?? '').trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!notOwnSite(text)) {
    const domain = domainOf(text);
    if (!domain) return null;
    const shared = PATH_SITES.find(([suffix]) => domain === suffix || domain.endsWith(`.${suffix}`));
    const parts = shared ? pathParts(url).slice(0, shared[1]) : [];
    return parts.length ? `${domain}/${parts.join('/')}` : domain;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|web|mobile|business)\./, '');
  if (host === 'wa.me' || host.endsWith('whatsapp.com') || mapsPlaceOf(url.href) || MAPS_SHORT_HOSTS.has(host) || /(^|\.)google\.[a-z.]+$/.test(host)) return null;
  const segments = pathParts(url);
  if (host === 'facebook.com' && segments[0] === 'profile.php') {
    const id = url.searchParams.get('id');
    return id && /^\d+$/.test(id) ? `facebook.com/profile.php?id=${id}` : null;
  }
  if (host === 'facebook.com' && segments[0] === 'pages') {
    const id = segments.find((segment) => /^\d{5,}$/.test(segment));
    return id ? `facebook.com/pages/${id}` : null;
  }
  if (!segments.length || NOT_A_PAGE.has(segments[0])) return null;
  const take = PROFILE_HOSTS.has(host) ? (KIND_FIRST.has(segments[0]) ? 2 : 1) : segments.length;
  if (segments.length < take) return null;
  return `${host}/${segments.slice(0, take).join('/')}`;
}

/** An email address as one: lowercase, without spaces. Null when it isn't one. */
function emailOf(email: string | undefined): string | null {
  const text = (email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

/** A number however it was written, as international digits; a number the stricter key refuses still matches itself */
function phoneOf(phone: string | undefined, countryCode: string): string | null {
  const text = (phone ?? '').trim();
  if (!text) return null;
  return phoneKey(text, countryCode) ?? internationalDigits(text, countryCode);
}

function identityOf(source: IdentitySource, countryCode: string): Identity {
  return {
    phone: phoneOf(source.phone, countryCode),
    place: mapsPlaceOf(source.mapsUrl) ?? mapsPlaceOf(source.website),
    site: siteOf(source.website),
    email: emailOf(source.email),
    name: nameKey(source.name ?? ''),
    city: nameKey(source.city ?? ''),
  };
}

/** Same name, same city or an unknown one, and nothing that tells them apart */
function sameByName(a: Identity, b: Identity): boolean {
  if (!a.name || a.name !== b.name || !sameCity(a.city, b.city)) return false;
  return !STRONG.some((key) => a[key] && b[key] && a[key] !== b[key]);
}

export interface IdentityMatch<T> {
  lead: T;
  /** What they share */
  by: IdentityKey;
}

/** Leads by what identifies them, to find the one a business already is */
export class IdentityIndex<T extends IdentitySource> {
  private readonly keyed = new Map<string, T>();
  private readonly named = new Map<string, { lead: T; identity: Identity }[]>();

  constructor(private readonly countryCode: string) {}

  /** Adds a lead, or what's new on it (after it was filled in). The first lead with a number keeps it. */
  add(lead: T): void {
    const identity = identityOf(lead, this.countryCode);
    for (const key of STRONG) {
      const value = identity[key];
      if (value && !this.keyed.has(`${key}:${value}`)) this.keyed.set(`${key}:${value}`, lead);
    }
    if (!identity.name) return;
    const list = this.named.get(identity.name) ?? [];
    const at = list.findIndex((entry) => entry.lead === lead);
    if (at >= 0) list[at] = { lead, identity };
    else list.push({ lead, identity });
    this.named.set(identity.name, list);
  }

  find(source: IdentitySource): IdentityMatch<T> | null {
    const identity = identityOf(source, this.countryCode);
    for (const key of STRONG) {
      const value = identity[key];
      const lead = value ? this.keyed.get(`${key}:${value}`) : undefined;
      if (lead) return { lead, by: key };
    }
    for (const entry of this.named.get(identity.name) ?? []) {
      if (sameByName(identity, entry.identity)) return { lead: entry.lead, by: 'name' };
    }
    return null;
  }
}

export interface Duplicate<T> extends IdentityMatch<T> {
  /** It was in the CRM and was deleted, rather than being there now */
  deleted: boolean;
}

/**
 * The leads in the CRM and the deleted ones. A business that's both (deleted, then added again) is the lead that's
 * there now.
 */
export class LeadRegistry<T extends KnownLead> {
  private readonly live: IdentityIndex<T>;
  private readonly gone: IdentityIndex<T>;

  constructor(leads: Iterable<T>, countryCode: string) {
    this.live = new IdentityIndex(countryCode);
    this.gone = new IdentityIndex(countryCode);
    for (const lead of leads) this.add(lead);
  }

  add(lead: T): void {
    (lead.deletedAt ? this.gone : this.live).add(lead);
  }

  find(source: IdentitySource): Duplicate<T> | null {
    const live = this.live.find(source);
    if (live) return { ...live, deleted: false };
    const gone = this.gone.find(source);
    return gone ? { ...gone, deleted: true } : null;
  }
}

/** What they share, as the app says it: "אותו מספר טלפון" */
export const SHARED: Record<IdentityKey, string> = {
  phone: 'אותו מספר טלפון',
  place: 'אותו מקום בגוגל מפות',
  site: 'אותו אתר',
  email: 'אותו אימייל',
  name: 'אותו שם',
};

/** "אותו שם ועיר" when both have the city, otherwise what SHARED says */
export function sharedText(by: IdentityKey, source: IdentitySource, lead: IdentitySource): string {
  return by === 'name' && nameKey(source.city ?? '') && nameKey(lead.city ?? '') ? 'אותו שם ועיר' : SHARED[by];
}

/** "7.11.2026": when a lead was deleted, in the CRM's time zone */
export function deletedDate(at: Date | string, timeZone = 'Asia/Jerusalem'): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(date);
  }
}
