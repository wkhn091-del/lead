import type { ActionType, DailyQueue, Lead } from '../types';
import { phoneDigits, toInternational, whatsAppHref } from './phone';
import { canUndo, isOpen, outcomeBetween } from './workflow';

// The command palette's search and actions, kept apart from the component so they can be tested.

/** Lowercase, without Hebrew vowel points or accents, so "שָׁלוֹם" finds "שלום" and "Café" finds "cafe". */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LeadHit {
  lead: Lead;
  score: number;
}

/** How well one search word matches a text: 3 at the start, 2 at the start of a word, 1 inside, 0 not at all */
function wordScore(text: string, word: string): number {
  const at = text.indexOf(word);
  if (at < 0) return 0;
  if (at === 0) return 3;
  return /[\s\-'"(.,/&]/.test(text[at - 1]) ? 2 : 1;
}

/**
 * Leads matching every word of the query, best first. A word can match the business, the contact, the
 * campaign, the email or the website; digits also match the phone however it was typed (054…, +972 54…).
 * `boost` lifts leads that matter right now, like today's calls.
 */
export function searchLeads(leads: readonly Lead[], query: string, boost: ReadonlySet<string> = new Set(), limit = 8): LeadHit[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits: LeadHit[] = [];
  for (const lead of leads) {
    const name = normalize(lead.name);
    const fields = [name, normalize(lead.contactName), normalize(lead.campaign), normalize(lead.email), normalize(lead.website)];
    const local = phoneDigits(lead.phone);
    const international = toInternational(lead.phone) ?? '';
    let score = 0;
    let matched = true;
    for (const word of words) {
      const digits = /^\+?[\d\s()-]{3,}$/.test(word) ? phoneDigits(word) : '';
      const phoneHit = digits && (local.includes(digits) || international.includes(digits) || (digits.startsWith('0') && international.includes(digits.slice(1))));
      // The business name counts double: it's what people search for
      const best = Math.max(wordScore(name, word) * 2, ...fields.slice(1).map((field) => wordScore(field, word)), phoneHit ? 4 : 0);
      if (best === 0) {
        matched = false;
        break;
      }
      score += best;
    }
    if (!matched) continue;
    if (name === words.join(' ')) score += 10;
    if (boost.has(lead.id)) score += 3;
    if (!isOpen(lead)) score -= 2;
    hits.push({ lead, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.lead.name.localeCompare(b.lead.name, 'he')).slice(0, limit);
}

export interface QueueStatus {
  lead: Lead;
  /** Position in today's call order, from 1 */
  position: number;
  done: boolean;
}

/** Today's calls in order, with whether each one is done */
export function todaysCalls(daily: DailyQueue | null, leads: readonly Lead[]): QueueStatus[] {
  if (!daily) return [];
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  return daily.leadIds.flatMap((id, index) => {
    const lead = byId.get(id);
    return lead ? [{ lead, position: index + 1, done: outcomeBetween(lead, daily.startsAt, daily.endsAt) !== null }] : [];
  });
}

export type LeadCommand = ActionType | 'undo' | 'open' | 'note' | 'coach' | 'copy-phone';

export interface LeadCommandItem {
  command: LeadCommand;
  label: string;
  /** Shown after the label, quieter */
  hint?: string;
  /** The physical key (KeyboardEvent.code), so it works on a Hebrew layout too */
  code: string;
  /** What to show on the key */
  key: string;
  group: 'log' | 'lead';
}

/** What can be done to a lead from the palette right now, with a one-key shortcut each */
export function leadCommands(lead: Lead, options: { now?: number } = {}): LeadCommandItem[] {
  const now = options.now ?? Date.now();
  const items: LeadCommandItem[] = [];
  if (isOpen(lead)) {
    // Each is logged as a phone call (CommandPalette.tsx); a Zoom meeting is logged from the profile
    const quote = lead.stage === 'zoom';
    items.push(
      { command: 'no_answer', label: 'אין מענה', hint: quote ? 'לא ענה לשיחה' : 'נשאר במאגר', code: 'KeyN', key: 'N', group: 'log' },
      { command: 'answered', label: quote ? 'דיברנו, עוד לא נסגר' : 'ענה, עוד בלי הצעה', code: 'KeyA', key: 'A', group: 'log' },
      { command: 'advance', label: quote ? 'העסקה נסגרה' : 'הצעת מחיר', hint: quote ? 'מעבר לנסגר / לקוח' : 'מעבר להצעת מחיר', code: 'KeyZ', key: 'Z', group: 'log' },
      { command: 'archive', label: 'לא רלוונטי', hint: 'יוצא מהרשימה', code: 'KeyX', key: 'X', group: 'log' },
    );
    if (whatsAppHref(lead.phone)) {
      items.push({ command: 'whatsapp', label: 'שליחת וואטסאפ', hint: 'פותח את וואטסאפ עם ההודעה המוכנה', code: 'KeyS', key: 'S', group: 'log' });
    }
  }
  const latest = lead.activity[0];
  if (latest && canUndo(lead, latest.id, now)) {
    const names = {
      advanced: 'המעבר לשלב הבא',
      no_answer: '"אין מענה"',
      answered: '"ענה"',
      archived: '"לא רלוונטי"',
      whatsapp: '"נשלח וואטסאפ"',
    } as const;
    items.push({ command: 'undo', label: `ביטול ${names[latest.type]}`, hint: 'הצעד האחרון, עד 10 דקות', code: 'KeyU', key: 'U', group: 'log' });
  }
  items.push(
    { command: 'open', label: 'פתיחת הפרופיל', code: 'KeyO', key: 'O', group: 'lead' },
    { command: 'note', label: 'כתיבת הערה', code: 'KeyW', key: 'W', group: 'lead' },
    { command: 'coach', label: 'הכנה עם מאמן ה-AI', code: 'KeyP', key: 'P', group: 'lead' },
  );
  if (lead.phone.trim()) items.push({ command: 'copy-phone', label: 'העתקת מספר הטלפון', hint: lead.phone, code: 'KeyC', key: 'C', group: 'lead' });
  return items;
}
