import { internationalDigits } from '../lib/phone.js';

/**
 * Leads pasted or uploaded as JSON, checked before anything is saved. Every export names its fields its own way
 * (a Yellow Pages or Google Maps scrape, another CRM, a sheet saved as JSON), so each field is found by any of its
 * usual names:
 *
 *   [{ "name": "יוסי שיפוצים", "phone": "054-1234567", "niche": "קבלני שיפוצים", "notes": "ביקש לחזור אחרי החגים" }]
 *   [{ "title": "מספרת אליהו", "phone": "+972 50-909-4047", "categoryName": "מספרה", "street": "בית וגן 42", "city": "ירושלים" }]
 *
 * A key matches in any letter case, with or without spaces, _ - or . between its words: business_name,
 * BusinessName and "Business Name" are one field (ALIASES has every name). A key that isn't one of those names is
 * matched by what's in it (FUZZY): business_phone, Phone 2 and טלפון נוסף are phones, mainCategory and סוג העסק
 * niches, name_he and storeName business names, each read after every exact name. An item with no phone under any
 * key still gets one from a value written like a number (054-1234567, +972…). And the business name, the phone
 * and the niche can be told by hand which key to come from (JsonMapping), for a file that names them oddly.
 * What each field becomes:
 * - The business name: businessName, company, name, title or label, in that order. With a business or company name
 *   and also a plain name, the plain name is the contact person's.
 * - The phone: phone, telephone, mobile, phone_number, tel and the like; a list or an object of numbers too. The
 *   lead gets the first valid number, and any other number goes in its note.
 * - The niche, saved as the lead's campaign (what the app groups niches by): niche, category, cat or type, or the
 *   first of a list.
 * - Email, website and contact person go on the lead when they're valid, and in the note when they aren't.
 * - The rest goes in the lead's first timeline note, which starts with IMPORT_NOTE: the address (address or
 *   location, or street and city), source, rating, a link to the listing, description and notes.
 * Fields inside an object one level down are found too ({ "contact": { "phone": "…" } }).
 *
 * A lead is saved only with a phone number no lead has yet: a number already in the CRM, however it was written
 * there (054-1234567, 0541234567, +972 54-123-4567), is skipped, and so is a number that came earlier in the same
 * paste. Every skipped item is reported with the reason, and every field that wasn't read is named.
 *
 * Plain functions over parsed JSON, without Node or the database: the app reads pastes with them in the browser,
 * and plans the browser-only preview's imports with them (src/data/repository/local.ts).
 */

/** Most items one request may carry; the app sends bigger pastes in parts */
export const JSON_IMPORT_LIMIT = 1000;

/** The first line of every imported lead's first timeline note */
export const IMPORT_NOTE = 'יובא מקובץ JSON';

/** The usual names of each field, in English or Hebrew. Within a field the earlier name wins. */
const ALIASES = {
  name: [
    'businessName',
    'business',
    'companyName',
    'company',
    'organization',
    'שם העסק',
    'שם עסק',
    'עסק',
    'שם החברה',
    'חברה',
    'name',
    'שם',
    'title',
    'label',
    'displayName',
    'כותרת',
  ],
  contactName: ['contactName', 'contact', 'contactPerson', 'ownerName', 'owner', 'איש קשר', 'שם איש קשר'],
  phone: [
    'phone',
    'phoneNumber',
    'telephone',
    'tel',
    'mobile',
    'mobilePhone',
    'mobileNumber',
    'cell',
    'cellPhone',
    'phones',
    'phoneNumbers',
    'formattedPhoneNumber',
    'internationalPhoneNumber',
    'nationalPhoneNumber',
    'טלפון',
    'מספר טלפון',
    'נייד',
    'טלפון נייד',
    'פלאפון',
    'טל',
  ],
  niche: ['niche', 'categoryName', 'category', 'categories', 'cat', 'type', 'types', 'industry', 'נישה', 'תחום', 'קטגוריה', 'סוג', 'ענף'],
  source: ['source', 'leadSource', 'מקור'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'הערות', 'הערה'],
  address: ['address', 'fullAddress', 'formattedAddress', 'location', 'vicinity', 'כתובת', 'מיקום'],
  street: ['street', 'streetAddress', 'address1', 'רחוב'],
  city: ['city', 'town', 'locality', 'עיר', 'יישוב', 'ישוב'],
  description: ['description', 'about', 'details', 'תיאור', 'אודות'],
  email: ['email', 'emails', 'emailAddress', 'mail', 'אימייל', 'מייל', 'דוא"ל', 'דואר אלקטרוני'],
  website: ['website', 'websiteUrl', 'site', 'web', 'homepage', 'אתר', 'אתר אינטרנט'],
  link: ['url', 'link', 'listingUrl', 'mapsUrl', 'googleMapsUrl', 'profileUrl', 'קישור'],
  rating: ['rating', 'totalScore', 'stars', 'averageRating', 'דירוג'],
  reviews: ['reviewsCount', 'reviewCount', 'numberOfReviews', 'userRatingsTotal', 'reviews', 'ביקורות'],
} as const satisfies Record<string, readonly string[]>;

export type JsonField = keyof typeof ALIASES;
export const JSON_FIELDS = Object.keys(ALIASES) as JsonField[];

/** A key as keys are compared: lowercase, without spaces, _ - . or quotes (so דוא"ל is דואל) */
const keyOf = (key: string) => key.normalize('NFKC').toLowerCase().replace(/[\s_\-.'"׳״]/g, '');

const FIELD_OF = new Map<string, { field: JsonField; rank: number }>();
for (const field of JSON_FIELDS) {
  (ALIASES[field] as readonly string[]).forEach((alias, rank) => {
    if (!FIELD_OF.has(keyOf(alias))) FIELD_OF.set(keyOf(alias), { field, rank });
  });
}
/** The names that say "the business" outright; next to one of them, a plain name is a person's */
const BUSINESS_NAMES = new Set(ALIASES.name.slice(0, ALIASES.name.indexOf('name')).map(keyOf));
const PERSON_NAMES = new Set(['name', 'שם'].map(keyOf));

/**
 * Keys beyond ALIASES, by what's in them (the key compared, keyOf): tried in this order, so a key with "phone" in it
 * is a phone before it's anything else (contactPhone), and one with "category" a niche before a name
 * (businessCategory). `not` keeps out keys that only look the part: an image's URL, a job title, a place's id.
 */
const FUZZY: readonly { field: JsonField; pattern: RegExp; not?: RegExp }[] = [
  { field: 'phone', pattern: /phone|mobile|טלפון|נייד|פלאפון|whatsapp|וואטסאפ|ווטסאפ|^(?:tel|cell)\d*$/, not: /fax|פקס|type|kind|label|verified|status|count/ },
  { field: 'email', pattern: /email|אימייל|מייל|דואל/, not: /verified|status|count|opt/ },
  { field: 'website', pattern: /website|webpage|homepage|domain|^site|site$|אתר/ },
  { field: 'link', pattern: /url|link|href|קישור/, not: /image|img|logo|photo|picture|thumbnail|icon|avatar|video|search|תמונה|לוגו/ },
  { field: 'niche', pattern: /categor|niche|industry|sector|segment|profession|specialt|^type|type$|נישה|תחום|קטגוריה|ענף|מקצוע|סוג/, not: /image|img|photo|id$/ },
  { field: 'address', pattern: /address|location|כתובת|מיקום/ },
  { field: 'street', pattern: /^street|רחוב/ },
  { field: 'city', pattern: /^(?:city|town)|(?:city|town)(?:name|he|en)?$|עיר|יישוב|ישוב/, not: /capacity|velocity|electricity|ethnicity|publicity|municipality/ },
  { field: 'rating', pattern: /rating|stars|דירוג/ },
  { field: 'reviews', pattern: /review|ביקורות/ },
  { field: 'description', pattern: /description|about|summary|תיאור|אודות/ },
  { field: 'notes', pattern: /note|comment|remark|הערה|הערות/ },
  { field: 'source', pattern: /source|מקור/ },
  { field: 'contactName', pattern: /contact|owner|manager|person|fullname|firstname|אישקשר|בעלים|בעל|מנהל/ },
  {
    field: 'name',
    pattern: /business|company|biz|store|shop|brand|listing|place|^name|name$|title|שםהעסק|שםעסק|^שם|עסק|חברה/,
    not: /firstname|lastname|middlename|surname|username|nickname|filename|jobtitle|pagetitle|metatitle|seotitle|status|hour|time|date|count|tag|price|id$/,
  },
];
const FUZZY_RANK = 500;

/** The field a key not in ALIASES is read as, by what's in it, or null */
function fuzzyField(key: string): { field: JsonField; rank: number } | null {
  const compared = keyOf(key);
  if (!compared) return null;
  const index = FUZZY.findIndex(({ pattern, not }) => pattern.test(compared) && !not?.test(compared));
  return index === -1 ? null : { field: FUZZY[index].field, rank: FUZZY_RANK + index };
}

/** The field a key is read as ("Phone Number" → phone, "title" → name, "business_phone" → phone), or null */
export function jsonField(key: string): JsonField | null {
  return (FIELD_OF.get(keyOf(key)) ?? fuzzyField(key))?.field ?? null;
}

/** The fields an import can be told where to find, when the automatic match picks the wrong key or none */
export const MAPPABLE_FIELDS = ['name', 'phone', 'niche'] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];
/** A key chosen by hand for a field: "title", or "contact.phone" one level down. It's read first, for that field only. */
export type JsonMapping = Partial<Record<MappableField, string>>;

export type JsonSkipReason = 'invalid' | 'no-phone' | 'exists' | 'repeated';

export interface JsonSkip {
  /** The item's place in the array that was sent, from 0 */
  index: number;
  name: string;
  phone: string;
  reason: JsonSkipReason;
  /** Why, in Hebrew, as the app shows it */
  message: string;
  /** The lead that already has this number ('exists') */
  leadId?: string;
  /** The item this number first came in ('repeated'), from 0 */
  firstIndex?: number;
}

/** A lead to create. The caller gives it an id and times. */
export interface JsonLeadDraft {
  index: number;
  name: string;
  contactName: string;
  /** As the app shows numbers: 054-123-4567 */
  phone: string;
  email: string;
  website: string;
  campaign: string;
  /** The lead's first timeline note: IMPORT_NOTE, then what was read that has no field of its own */
  note: string;
}

export interface JsonImportPlan {
  leads: JsonLeadDraft[];
  skipped: JsonSkip[];
  /** Fields the items had that weren't read, so nothing is left out without a word */
  ignoredFields: string[];
}

/** What's needed of a lead already in the CRM */
export interface ExistingLead {
  id: string;
  name: string;
  phone: string;
}

// The limits of any new lead (leads.schemas.ts), so a long value is shortened instead of failing the item
const NAME_LIMIT = 120;
const CAMPAIGN_LIMIT = 60;
const NOTE_LIMIT = 5000;
const EMAIL_LIMIT = 254;
const WEBSITE_LIMIT = 500;
/** Israel's national numbers after 972: mobile and VoIP (9 digits), landlines (8), 1-800 and the like */
const ISRAELI_NATIONAL = /^(?:5\d{8}|7\d{8}|[2-489]\d{7}|1(?:599|700|800)\d{6})$/;
/** A domain or an http(s) address: the rule every lead's website is held to (leads.schemas.ts, src/lib/website.ts) */
export const WEBSITE = /^(https?:\/\/)?[^\s/?#:@]+\.[^\s/?#:@]{2,}(:\d{1,5})?([/?#]\S*)?$/i;
/** The email format the server takes (zod's z.email()), so an email can't cost a lead */
const EMAIL = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/**
 * A number as international digits, the same way whoever wrote it: 054-1234567, 0541234567, +972 54-123-4567
 * and "+972 054…" (the local 0 kept after the country code) are all 972541234567. Null when it can't be a number.
 */
export function phoneKey(phone: string, countryCode: string): string | null {
  let digits = internationalDigits(phone, countryCode);
  if (!digits) return null;
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  // An Israeli number has a known length, so a number cut short isn't saved as if it were one
  if (digits.startsWith('972') && !ISRAELI_NATIONAL.test(digits.slice(3))) return null;
  return digits;
}

/** 054-123-4567 for a mobile, 03-123-4567 for a landline, 1-800-123-456; other countries as +digits */
export function displayPhone(key: string): string {
  if (key.startsWith('972')) {
    const national = key.slice(3);
    if (/^[57]\d{8}$/.test(national)) return `0${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
    if (/^[2-489]\d{7}$/.test(national)) return `0${national.slice(0, 1)}-${national.slice(1, 4)}-${national.slice(4)}`;
    if (/^1\d{9}$/.test(national)) return `${national.slice(0, 1)}-${national.slice(1, 4)}-${national.slice(4, 7)}-${national.slice(7)}`;
  }
  return `+${key}`;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nothing to read: no value, empty text, false, or a list or object of those */
function isBlank(value: unknown, depth = 0): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (depth > 3) return false;
  if (Array.isArray(value)) return value.every((item) => isBlank(item, depth + 1));
  if (isObject(value)) return Object.values(value).every((item) => isBlank(item, depth + 1));
  return false;
}

/** A plain value as text: a string, or a number (a phone typed without quotes). Null for anything else. */
function plain(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'bigint') return String(value);
  return null;
}

/** What an object calls itself: { "name": "מספרות", "id": 7 } is "מספרות" */
const SELF_NAMES = ['name', 'title', 'label', 'value', 'text'];

/** The text of a value: itself, the first text in a list, or an object's name for itself */
function firstText(value: unknown, depth = 0): string {
  const text = plain(value);
  if (text !== null) return text;
  if (depth >= 2) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item, depth + 1);
      if (found) return found;
    }
  } else if (isObject(value)) {
    for (const key of SELF_NAMES) {
      const found = firstText(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

/** Every piece of text in a value, in order, a string split at `separators` ("03-1234567, 054-1234567") */
function texts(value: unknown, separators: RegExp, depth = 0): string[] {
  const text = plain(value);
  if (text !== null) return text.split(separators).map((part) => part.trim()).filter(Boolean);
  if (depth >= 2) return [];
  if (Array.isArray(value)) return value.flatMap((item) => texts(item, separators, depth + 1));
  if (isObject(value)) return Object.values(value).flatMap((item) => texts(item, separators, depth + 1));
  return [];
}

/** Lines of free text: a string, or a list of strings or of objects holding their text ({ "body": "…" }) */
function lines(value: unknown, depth = 0): string {
  const text = plain(value);
  if (text !== null) return text;
  if (depth >= 2) return '';
  if (Array.isArray(value)) return value.map((item) => lines(item, depth + 1)).filter(Boolean).join('\n');
  if (isObject(value)) {
    for (const key of ['text', 'body', 'note', 'content', 'comment', 'value', 'description']) {
      const found = lines(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

const unique = <T>(values: readonly T[]) => [...new Set(values)];

const WHOLE_ADDRESS = ['formatted', 'formattedaddress', 'full', 'fulladdress', 'text', 'value', 'label'];
const STREET_KEYS = ['street', 'streetaddress', 'address', 'address1', 'line1', 'רחוב'];
const NUMBER_KEYS = ['number', 'housenumber', 'streetnumber', 'מספר', 'מספרבית'];
const PLACE_KEYS = ['address2', 'line2', 'neighborhood', 'neighbourhood', 'שכונה', 'city', 'town', 'locality', 'עיר', 'יישוב', 'ישוב', 'zip', 'zipcode', 'postalcode', 'postcode', 'מיקוד'];

/** An address as one line: a string, the lines of a list, or the parts of an object ({ "street": …, "city": … }) */
function addressText(value: unknown, depth = 0): string {
  const text = plain(value);
  if (text !== null) return text;
  if (depth >= 2) return '';
  if (Array.isArray(value)) return unique(value.map((item) => addressText(item, depth + 1)).filter(Boolean)).join(', ');
  if (!isObject(value)) return '';
  const parts = new Map(Object.entries(value).map(([key, part]) => [keyOf(key), plain(part) ?? ''] as const));
  const pick = (keys: readonly string[]) => keys.map((key) => parts.get(key) ?? '').filter(Boolean);
  const whole = pick(WHOLE_ADDRESS)[0];
  if (whole) return whole;
  const street = pick(STREET_KEYS)[0] ?? '';
  const number = pick(NUMBER_KEYS)[0] ?? '';
  const line = street && number && !street.includes(number) ? `${street} ${number}` : street;
  return unique([line, ...pick(PLACE_KEYS)].filter(Boolean)).join(', ');
}

/** A count or a score, from a number or a numeric string */
function numberText(value: unknown): string {
  const text = plain(value);
  return text && Number.isFinite(Number(text.replace(',', '.'))) ? text.replace(',', '.') : '';
}

const PHONE_SEPARATORS = /[,;|\n]|\s\/\s|\s+(?:או|or)\s+/i;

/** Addresses in a value: "a@b.co.il, c@d.co.il" or "a@b.co.il c@d.co.il" is two, "not a site" is one */
const addresses = (value: unknown, valid: (text: string) => boolean) =>
  texts(value, /[,;\n]+/).flatMap((part) => {
    const words = part.split(/\s+/);
    return words.length > 1 && words.every(valid) ? words : [part];
  });

/** Where a listing link leads, by its address */
const LINK_LABELS: [RegExp, string][] = [
  [/^https?:\/\/(?:[\w-]+\.)*google\.[a-z.]+\/maps|^https?:\/\/maps\.(?:google\.[a-z.]+|app\.goo\.gl)\//i, 'גוגל מפות'],
  [/^https?:\/\/(?:www\.)?d\.co\.il\//i, 'דפי זהב'],
  [/^https?:\/\/(?:www\.)?b144\.co\.il\//i, 'B144'],
  [/^https?:\/\/(?:www\.)?easy\.co\.il\//i, 'איזי'],
];
const linkLine = (link: string) => `${LINK_LABELS.find(([pattern]) => pattern.test(link))?.[1] ?? 'קישור'}: ${link}`;

/** How each field's value is read. Empty (text or list) when there's nothing usable in it. */
const READERS: Record<JsonField, (value: unknown) => string | string[]> = {
  name: firstText,
  contactName: firstText,
  phone: (value) => texts(value, PHONE_SEPARATORS),
  niche: firstText,
  source: firstText,
  notes: lines,
  address: addressText,
  street: firstText,
  city: firstText,
  description: lines,
  email: (value) => addresses(value, (text) => text.includes('@')).map((email) => email.replace(/^mailto:/i, '')),
  website: (value) => addresses(value, (text) => WEBSITE.test(text)),
  link: (value) => texts(value, /\s+/).filter((link) => /^https?:\/\/\S+$/i.test(link)),
  rating: numberText,
  reviews: numberText,
};

const readable = (field: JsonField, value: unknown) => READERS[field](value).length > 0;

/** One value that may be a field: where it was, and how good a name for the field its key is */
interface Candidate {
  /** As the item has it, "contact.phone" one level down */
  key: string;
  /** The key compared (keyOf) */
  alias: string;
  value: unknown;
  /** Lower is better; anything one level down comes after every top-level key */
  rank: number;
}

/** Fields that hold words, so a bare number under a key that only looks like theirs (a place's id) isn't one */
const WORDY = new Set<JsonField>(['name', 'contactName', 'niche', 'city', 'street', 'source']);
const numeric = (value: unknown) => typeof value === 'number' || (typeof value === 'string' && /^[\d\s.,:/+-]+$/.test(value.trim()));

/** Keys whose numbers aren't ones to call, even written like a phone */
const NOT_A_PHONE = /fax|פקס|zip|postal|מיקוד|^id|id$|date|time|תאריך|שעה/;

/** A value written like a phone number: 054-1234567, 03 123 4567, +972 54…, 00972… */
function writtenLikePhone(value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[+0]/.test(text) || !/^[+\d\s().\-\u200e\u200f\u2066-\u2069]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, '').length;
  return digits >= 9 && digits <= 15;
}

/**
 * The field a value is read as: the one it was chosen for by hand (`path`, as the item has it: "title",
 * "contact.phone"), the one its key names (`name`), or a guess from what's in the key, taken only when the value
 * reads as that field. Rank -1 for a key chosen by hand, so it's read before any other.
 */
function matchOf(path: string, name: string, value: unknown, chosen: ReadonlyMap<string, JsonField>): { field: JsonField; rank: number } | null {
  const forced = chosen.get(path);
  if (forced) return { field: forced, rank: -1 };
  const exact = FIELD_OF.get(keyOf(name));
  if (exact) return exact;
  const guess = fuzzyField(name);
  if (!guess || !readable(guess.field, value) || (WORDY.has(guess.field) && numeric(value))) return null;
  return guess;
}

/** An item's values by field, best first, and the keys that weren't read */
function candidatesOf(item: JsonObject, mapping: JsonMapping = {}): { fields: Partial<Record<JsonField, Candidate[]>>; unread: string[] } {
  const fields: Partial<Record<JsonField, Candidate[]>> = {};
  const unread: string[] = [];
  const add = (field: JsonField, candidate: Candidate) => (fields[field] ??= []).push(candidate);
  const chosen = new Map<string, JsonField>();
  for (const field of MAPPABLE_FIELDS) {
    const key = mapping[field]?.trim();
    if (key) chosen.set(key, field);
  }

  for (const [rawKey, value] of Object.entries(item)) {
    const key = rawKey.trim();
    if (!key || isBlank(value)) continue;
    const match = matchOf(key, key, value, chosen);
    if (match) add(match.field, { key, alias: keyOf(key), value, rank: match.rank });
    // One level down too: { "contact": { "name": …, "phone": … } }, { "company": { "name": …, "phone": … } }. A name
    // in there is the business's only inside a business or an unnamed object: in "category" or "owner" it's theirs.
    let inside = false;
    if (isObject(value) && match?.rank !== -1) {
      for (const [rawInner, inner] of Object.entries(value)) {
        const innerKey = rawInner.trim();
        if (!innerKey || isBlank(inner)) continue;
        const path = `${key}.${innerKey}`;
        const innerMatch = matchOf(path, innerKey, inner, chosen);
        if (!innerMatch || !readable(innerMatch.field, inner)) continue;
        const byHand = innerMatch.rank === -1;
        if (!byHand && innerMatch.field === 'name' && match && match.field !== 'name') continue;
        add(innerMatch.field, { key: path, alias: keyOf(innerKey), value: inner, rank: byHand ? -1 : 1000 + innerMatch.rank });
        inside = true;
      }
    }
    if (!inside && (!match || !readable(match.field, value))) unread.push(key);
  }
  // No key names a phone (a column called "מס׳" or "field3"): a value written like a number is one
  if (!fields.phone) {
    for (const [rawKey, value] of Object.entries(item)) {
      const key = rawKey.trim();
      if (!unread.includes(key) || NOT_A_PHONE.test(keyOf(key)) || !writtenLikePhone(value)) continue;
      add('phone', { key, alias: keyOf(key), value, rank: 900 });
      unread.splice(unread.indexOf(key), 1);
    }
  }
  for (const list of Object.values(fields)) list.sort((a, b) => a.rank - b.rank);
  return { fields, unread };
}

/**
 * Where the items keep each field, and the keys that won't be read: what the app shows before an import. Each field
 * lists every key it was found under, the one read first.
 */
export function jsonFieldsOf(items: readonly unknown[], mapping: JsonMapping = {}): { fields: Partial<Record<JsonField, string[]>>; unread: string[] } {
  const fields: Partial<Record<JsonField, string[]>> = {};
  const unread = new Set<string>();
  for (const item of items) {
    if (!isObject(item)) continue;
    const found = candidatesOf(item, mapping);
    for (const key of found.unread) unread.add(key);
    for (const field of JSON_FIELDS) {
      for (const candidate of found.fields[field] ?? []) {
        const keys = (fields[field] ??= []);
        if (!keys.includes(candidate.key)) keys.push(candidate.key);
      }
    }
  }
  return { fields, unread: [...unread] };
}

export interface JsonKey {
  /** As the items have it, "contact.phone" one level down */
  key: string;
  /** Items with a value under it */
  count: number;
  /** The first value under it, shortened */
  example: string;
}

/**
 * Every key the items have something under, at the top and one level down, the most common first, each with an
 * example: what a field can be told to come from (JsonMapping). Reads the first 2,000 items; that says enough.
 */
export function jsonKeysOf(items: readonly unknown[], limit = 80): JsonKey[] {
  const keys = new Map<string, JsonKey & { order: number }>();
  const see = (key: string, value: unknown) => {
    const text = firstText(value);
    if (!text) return;
    const known = keys.get(key);
    if (known) known.count += 1;
    else keys.set(key, { key, count: 1, example: clip(text.replace(/\s+/g, ' '), 40), order: keys.size });
  };
  for (const item of items.slice(0, 2000)) {
    if (!isObject(item)) continue;
    for (const [rawKey, value] of Object.entries(item)) {
      const key = rawKey.trim();
      if (!key) continue;
      see(key, value);
      if (isObject(value)) for (const [inner, innerValue] of Object.entries(value)) if (inner.trim()) see(`${key}.${inner.trim()}`, innerValue);
    }
  }
  return [...keys.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, limit)
    .map(({ key, count, example }) => ({ key, count, example }));
}

/** The first of a field's values that reads, best name first */
function best(candidates: readonly Candidate[] | undefined, read: (value: unknown) => string): { text: string; from: Candidate } | null {
  for (const candidate of candidates ?? []) {
    const text = read(candidate.value);
    if (text) return { text, from: candidate };
  }
  return null;
}

/** Every value a field's candidates hold, without repeats */
const all = (field: JsonField, candidates: readonly Candidate[] | undefined) =>
  unique((candidates ?? []).flatMap((candidate) => [READERS[field](candidate.value)].flat()).filter(Boolean));

/** "דירוג: 4.8 (157 ביקורות)" */
function ratingLine(rating: string, reviews: string): string {
  const stars = Math.round(Number(rating) * 10) / 10;
  const count = Number(reviews);
  const counted = reviews && Number.isInteger(count) && count > 0 ? (count === 1 ? 'ביקורת אחת' : `${count} ביקורות`) : '';
  if (rating && stars > 0) return `דירוג: ${stars}${counted ? ` (${counted})` : ''}`;
  return counted ? `ביקורות: ${count}` : '';
}

const clip = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`);

/**
 * The same lead with its contact person, email and website in its note instead of on it: for when the server
 * refuses one of them, so the lead is saved anyway.
 */
export function withDetailsInNote(draft: JsonLeadDraft): JsonLeadDraft {
  const parts = [
    draft.note,
    draft.contactName && `איש קשר: ${draft.contactName}`,
    draft.email && `אימייל: ${draft.email}`,
    draft.website && `אתר: ${draft.website}`,
  ];
  return { ...draft, contactName: '', email: '', website: '', note: clip(parts.filter(Boolean).join('\n'), NOTE_LIMIT) };
}

/** Lists an export wraps its leads in: { "data": [ … ] }, { "results": [ … ] } */
const WRAPPERS = new Set(['leads', 'data', 'results', 'items', 'businesses', 'records', 'rows', 'places', 'listings', 'entries', 'contacts', 'לידים', 'עסקים'].map(keyOf));

/** Whether an object is a lead itself rather than something holding a list of them */
const looksLikeLead = (value: JsonObject) => Object.keys(value).some((key) => ['name', 'phone'].includes(jsonField(key) ?? ''));

/**
 * The leads in parsed JSON: the array itself, or the list an export wraps them in ({ "data": [ … ] },
 * { "response": { "results": [ … ] } }). GeoJSON features give their properties. Null when there's no list, as
 * for a single lead.
 */
export function leadList(value: unknown, depth = 0): unknown[] | null {
  const items = (list: unknown[]) =>
    list.map((item) => (isObject(item) && item.type === 'Feature' && isObject(item.properties) ? item.properties : item));
  if (Array.isArray(value)) return items(value);
  if (!isObject(value) || depth > 3 || looksLikeLead(value)) return null;
  const lists = Object.entries(value).filter(([, inner]) => Array.isArray(inner) && inner.some(isObject));
  const wrapped = lists.find(([key]) => WRAPPERS.has(keyOf(key))) ?? (lists.length === 1 ? lists[0] : undefined);
  if (wrapped) return items(wrapped[1] as unknown[]);
  for (const inner of Object.values(value)) {
    const found = isObject(inner) ? leadList(inner, depth + 1) : null;
    if (found) return found;
  }
  return null;
}

/**
 * What each item becomes, and what's skipped and why. `existing` is every lead in the CRM that has a phone;
 * `mapping`, the keys chosen by hand for the business name, the phone and the niche.
 */
export function planJsonImport(items: readonly unknown[], existing: readonly ExistingLead[], countryCode: string, mapping: JsonMapping = {}): JsonImportPlan {
  const known = new Map<string, ExistingLead>();
  for (const lead of existing) {
    const key = phoneKey(lead.phone, countryCode);
    if (key && !known.has(key)) known.set(key, lead);
  }
  const first = new Map<string, number>();
  const ignored = new Set<string>();
  const plan: JsonImportPlan = { leads: [], skipped: [], ignoredFields: [] };

  items.forEach((item, index) => {
    const skip = (reason: JsonSkipReason, message: string, name = '', phone = '', extra: Pick<JsonSkip, 'leadId' | 'firstIndex'> = {}) =>
      plan.skipped.push({ index, name: clip(name, NAME_LIMIT), phone: clip(phone, 40), reason, message, ...extra });

    if (!isObject(item)) {
      skip('invalid', 'זה לא ליד: כל פריט צריך להיות אובייקט, כמו { "name": "…", "phone": "…" }.');
      return;
    }
    const { fields, unread } = candidatesOf(item, mapping);
    for (const key of unread) if (ignored.size < 20) ignored.add(key.slice(0, 40));

    const numbers = all('phone', fields.phone);
    const keys = numbers.map((number) => phoneKey(number, countryCode));
    const at = keys.findIndex(Boolean);
    const shownPhone = numbers[Math.max(at, 0)] ?? '';

    const named = best(fields.name, firstText);
    if (!named) {
      const unreadable = fields.name?.find((candidate) => !isBlank(candidate.value));
      skip('invalid', unreadable ? `השדה ${unreadable.key} צריך להכיל טקסט.` : 'חסר שם העסק (name, title או company).', '', shownPhone);
      return;
    }
    const name = named.text;
    if (!numbers.length) {
      skip('no-phone', 'אין מספר טלפון (phone, mobile או tel).', name);
      return;
    }
    const key = keys[at];
    if (!key) {
      skip('no-phone', 'זה לא נראה כמו מספר טלפון.', name, shownPhone);
      return;
    }
    const match = known.get(key);
    if (match) {
      skip('exists', `המספר כבר שמור בליד ״${clip(match.name, 60)}״.`, name, shownPhone, { leadId: match.id });
      return;
    }
    const earlier = first.get(key);
    if (earlier !== undefined) {
      skip('repeated', 'המספר הזה כבר מופיע קודם ברשימה.', name, shownPhone, { firstIndex: earlier });
      return;
    }
    first.set(key, index);

    // Next to a business or company name, a plain "name" is the person to ask for
    let contactName = best(fields.contactName, firstText)?.text ?? '';
    if (!contactName && BUSINESS_NAMES.has(named.from.alias)) {
      const person = fields.name?.find((candidate) => PERSON_NAMES.has(candidate.alias) && candidate.rank < 1000);
      const personName = person ? firstText(person.value) : '';
      if (personName && personName !== name) contactName = personName;
    }

    const emails = all('email', fields.email);
    const email = emails.find((value) => value.length <= EMAIL_LIMIT && EMAIL.test(value)) ?? '';
    const websites = all('website', fields.website);
    const website = websites.find((value) => value.length <= WEBSITE_LIMIT && WEBSITE.test(value)) ?? '';
    const otherPhones = unique(keys.filter((other): other is string => Boolean(other) && other !== key).map(displayPhone));
    const otherEmails = emails.filter((value) => value !== email);
    const otherSites = websites.filter((value) => value !== website);

    const street = best(fields.street, firstText)?.text ?? '';
    const city = best(fields.city, firstText)?.text ?? '';
    let place = best(fields.address, addressText)?.text || street;
    if (city && !place.includes(city)) place = place ? `${place}, ${city}` : city;

    const note = [
      IMPORT_NOTE,
      ...all('source', fields.source).map((source) => `מקור: ${source}`),
      place && `כתובת: ${place}`,
      otherPhones.length > 0 && `${otherPhones.length === 1 ? 'טלפון נוסף' : 'טלפונים נוספים'}: ${otherPhones.join(', ')}`,
      otherEmails.length > 0 && `${email ? 'אימייל נוסף' : 'אימייל'}: ${otherEmails.join(', ')}`,
      otherSites.length > 0 && `${website ? 'אתר נוסף' : 'אתר'}: ${otherSites.join(', ')}`,
      ratingLine(best(fields.rating, numberText)?.text ?? '', best(fields.reviews, numberText)?.text ?? ''),
      ...all('link', fields.link).map(linkLine),
      ...all('description', fields.description),
      ...all('notes', fields.notes),
    ];

    plan.leads.push({
      index,
      name: clip(name, NAME_LIMIT),
      contactName: clip(contactName, NAME_LIMIT),
      phone: displayPhone(key),
      email,
      website,
      campaign: clip(best(fields.niche, firstText)?.text ?? '', CAMPAIGN_LIMIT),
      note: clip(note.filter(Boolean).join('\n'), NOTE_LIMIT),
    });
  });

  plan.ignoredFields = [...ignored];
  return plan;
}
