import { jsonField } from '../../../server/src/leads/json-import';

/**
 * Leads pasted as JSON, read in the browser before they're sent: whether it's JSON at all and where it breaks, how
 * many leads it holds, and which fields won't be read. The server checks each lead and the phone numbers
 * (server/src/leads/json-import.ts).
 */

export const JSON_EXAMPLE = `[
  {
    "name": "יוסי שיפוצים",
    "phone": "054-1234567",
    "source": "קמפיין פייסבוק",
    "niche": "קבלני שיפוצים",
    "notes": "ביקש לחזור אליו אחרי החגים"
  },
  {
    "name": "מוסך הגליל",
    "phone": "0529876543",
    "source": "חיפוש גוגל",
    "niche": "מוסכים"
  }
]`;

export type JsonPaste =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  /** `fixed`: typographic quotes or a comma before ] or } were corrected so it reads */
  | { kind: 'ok'; items: unknown[]; fixed: boolean };

/** Quotes a phone or a notes app turns into “ ”, and a comma left before ] or }: the usual reasons pasted JSON won't read */
const lenient = (text: string) => text.replace(/[“”„‟]/g, '"').replace(/,(\s*[\]}])/g, '$1');

export function parseJsonLeads(text: string): JsonPaste {
  if (!text.trim()) return { kind: 'empty' };
  let value: unknown;
  let fixed = false;
  // The text as it is in the box, so a line number in a message is the line the box shows
  try {
    value = JSON.parse(text);
  } catch (error) {
    const corrected = lenient(text);
    try {
      if (corrected === text) throw error;
      value = JSON.parse(corrected);
      fixed = true;
    } catch {
      return { kind: 'error', message: jsonProblem(text, error) };
    }
  }
  const items = Array.isArray(value) ? value : typeof value === 'object' && value !== null ? [value] : null;
  if (!items) return { kind: 'error', message: 'צריך מערך של לידים, כמו [ { "name": "…", "phone": "…" } ].' };
  if (items.length === 0) return { kind: 'error', message: 'המערך ריק: אין בו לידים.' };
  return { kind: 'ok', items, fixed };
}

/** Where the JSON breaks, in words */
function jsonProblem(text: string, error: unknown): string {
  // JSON numbers can't start with 0, so 054… without quotes is the most common mistake in a list of leads
  if (/"(?:phone|טלפון)"\s*:\s*0\d/i.test(text)) return 'מספר טלפון שמתחיל ב-0 צריך מירכאות, כמו "phone": "054-1234567".';
  const message = error instanceof Error ? error.message : '';
  // Chrome and Node say "position 57 (line 4 column 5)", Firefox "line 4 column 5"
  const position = Number(/position (\d+)/i.exec(message)?.[1]);
  if (/end of (JSON )?(input|data)|unterminated/i.test(message) || position >= text.trimEnd().length) {
    return 'ה-JSON נקטע באמצע: חסרה סגירה, ] או }.';
  }
  const at = /line (\d+) column (\d+)/i.exec(message);
  let place: [number, number] | null = at ? [Number(at[1]), Number(at[2])] : null;
  if (!place && Number.isFinite(position)) {
    const before = text.slice(0, position).split('\n');
    place = [before.length, before[before.length - 1].length + 1];
  }
  if (place) return `ה-JSON לא תקין בשורה ${place[0]}, תו ${place[1]}. כדאי לבדוק שם פסיקים ומירכאות.`;
  return 'זה לא JSON תקין. כדאי לבדוק פסיקים, מירכאות וסוגריים.';
}

/** Fields the items have that won't be read (only name, phone, source, niche and notes are) */
export function unreadFields(items: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) if (key.trim() && !jsonField(key)) found.add(key.trim());
  }
  return [...found];
}

const encoder = new TextEncoder();

/** Parts small enough for one request: at most `maxItems` leads and `maxBytes` of JSON (the server takes 2 MB) */
export function jsonBatches<T>(items: readonly T[], maxItems = 500, maxBytes = 1_500_000): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let bytes = 2;
  for (const item of items) {
    const size = encoder.encode(JSON.stringify(item) ?? 'null').length + 1;
    if (batch.length && (batch.length >= maxItems || bytes + size > maxBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(item);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
