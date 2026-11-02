import { internationalDigits } from '../whatsapp/phone.js';

/**
 * Leads pasted as a JSON array, checked before anything is saved:
 *
 *   [{ "name": "יוסי שיפוצים", "phone": "054-1234567", "source": "קמפיין פייסבוק", "niche": "קבלני שיפוצים", "notes": "…" }]
 *
 * `niche` becomes the lead's campaign (what the app groups niches by), and `source` and `notes` its first timeline
 * note. A lead is saved only with a phone number no lead has yet: a number already in the CRM, however it was
 * written there (054-1234567, 0541234567, +972 54-123-4567), is skipped, and so is a number that came earlier in
 * the same paste. Every skipped item is reported with the reason.
 *
 * Plain functions over parsed JSON, without Node or the database: the app plans the browser-only preview's imports
 * with them too (src/data/repository/local.ts).
 */

/** Most items one request may carry; the app sends bigger pastes in parts */
export const JSON_IMPORT_LIMIT = 1000;

/** The fields read from each item, in English (any letter case) or Hebrew */
const ALIASES = {
  name: ['name', 'שם', 'שם העסק'],
  phone: ['phone', 'טלפון'],
  source: ['source', 'מקור'],
  niche: ['niche', 'נישה', 'תחום'],
  notes: ['notes', 'note', 'הערות', 'הערה'],
} as const;

export type JsonField = keyof typeof ALIASES;
export const JSON_FIELDS = Object.keys(ALIASES) as JsonField[];
const FIELD_OF = new Map<string, JsonField>(JSON_FIELDS.flatMap((field) => ALIASES[field].map((alias) => [alias, field] as const)));

/** The field a key is read as ("Phone" → phone), or null for a field that isn't read */
export function jsonField(key: string): JsonField | null {
  return FIELD_OF.get(key.trim().toLowerCase()) ?? null;
}

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
  /** As the app shows numbers: 054-123-4567 */
  phone: string;
  campaign: string;
  /** The first timeline note, from `source` and `notes`; empty when there are neither */
  note: string;
}

export interface JsonImportPlan {
  leads: JsonLeadDraft[];
  skipped: JsonSkip[];
  /** Fields the items had that aren't read, so nothing is left out without a word */
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
/** Israel's national numbers after 972: mobile and VoIP (9 digits), landlines (8), 1-800 and the like */
const ISRAELI_NATIONAL = /^(?:5\d{8}|7\d{8}|[2-489]\d{7}|1(?:599|700|800)\d{6})$/;

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

/** A value as text: numbers too (a phone typed without quotes), and a list of lines for the notes. Null otherwise. */
function text(value: unknown, lines = false): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (lines && Array.isArray(value)) {
    const parts = value.map((item) => text(item));
    return parts.every((part) => part !== null) ? parts.filter(Boolean).join('\n') : null;
  }
  return null;
}

const clip = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`);

/** What each item becomes, and what's skipped and why. `existing` is every lead in the CRM that has a phone. */
export function planJsonImport(items: readonly unknown[], existing: readonly ExistingLead[], countryCode: string): JsonImportPlan {
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

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      skip('invalid', 'זה לא ליד: כל פריט צריך להיות אובייקט, כמו { "name": "…", "phone": "…" }.');
      return;
    }
    const values: Partial<Record<JsonField, unknown>> = {};
    for (const [key, value] of Object.entries(item)) {
      const field = jsonField(key);
      if (!field) {
        if (key.trim() && ignored.size < 20) ignored.add(key.trim().slice(0, 40));
      } else if (!(field in values)) {
        values[field] = value;
      }
    }

    const read = Object.fromEntries(JSON_FIELDS.map((field) => [field, text(values[field], field === 'notes')])) as Record<JsonField, string | null>;
    const name = read.name ?? '';
    const phone = read.phone ?? '';
    const wrong = JSON_FIELDS.find((field) => read[field] === null);
    if (wrong) {
      skip('invalid', `השדה ${wrong} צריך להכיל טקסט.`, name, phone);
      return;
    }
    if (!name) {
      skip('invalid', 'חסר שם העסק (name).', '', phone);
      return;
    }
    if (!phone) {
      skip('no-phone', 'אין מספר טלפון (phone).', name);
      return;
    }
    const key = phoneKey(phone, countryCode);
    if (!key) {
      skip('no-phone', 'זה לא נראה כמו מספר טלפון.', name, phone);
      return;
    }
    const match = known.get(key);
    if (match) {
      skip('exists', `המספר כבר שמור בליד ״${clip(match.name, 60)}״.`, name, phone, { leadId: match.id });
      return;
    }
    const earlier = first.get(key);
    if (earlier !== undefined) {
      skip('repeated', 'המספר הזה כבר מופיע קודם ברשימה.', name, phone, { firstIndex: earlier });
      return;
    }
    first.set(key, index);
    const note = [read.source && `מקור: ${read.source}`, read.notes].filter(Boolean).join('\n');
    plan.leads.push({
      index,
      name: clip(name, NAME_LIMIT),
      phone: displayPhone(key),
      campaign: clip(read.niche ?? '', CAMPAIGN_LIMIT),
      note: clip(note, NOTE_LIMIT),
    });
  });

  plan.ignoredFields = [...ignored];
  return plan;
}
