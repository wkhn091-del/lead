import type { Lead } from '../types';
import { formatRelative } from './format';
import { count, NOUNS } from './hebrew';
import { normalize } from './palette';
import { phoneDigits, toInternational } from './phone';
import { PIPELINE, pipelineStatus, type PipelineStatus } from './stages';

// The leads board (components/pipeline/PipelineBoard.tsx): its columns, search and the line under each card,
// kept apart from the components so they can be tested.

/** A column of the board: a status, or the leads marked not relevant, shown apart */
export type BoardColumn = PipelineStatus | 'archived';
export const BOARD_COLUMNS: readonly BoardColumn[] = [...PIPELINE, 'archived'];

export const boardColumn = (lead: Lead): BoardColumn => (lead.archivedAt ? 'archived' : pipelineStatus(lead));

/** When the lead was last dealt with: its latest step, or when it was added */
export const touchedAt = (lead: Pick<Lead, 'activity' | 'createdAt'>) =>
  Math.max(Date.parse(lead.activity[0]?.at ?? lead.createdAt), Date.parse(lead.createdAt));

const PHONE_LIKE = /^\+?[\d\s()-]{3,}$/;

/** Whether these digits are in the lead's phone, in its local or its international form */
function phoneHas(lead: Lead, digits: string): boolean {
  if (!digits) return false;
  const international = toInternational(lead.phone) ?? '';
  return phoneDigits(lead.phone).includes(digits) || international.includes(digits) || (digits.startsWith('0') && international.includes(digits.slice(1)));
}

/**
 * Whether a lead matches every word of a search: in the business, contact, niche or email, or digits in its phone
 * however they were typed (054…, +972 54…, 054 123 4567)
 */
export function matchesSearch(lead: Lead, query: string): boolean {
  // A number typed in groups is one phone number, not words to find apart
  if (PHONE_LIKE.test(query.trim()) && phoneHas(lead, phoneDigits(query))) return true;
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const text = normalize([lead.name, lead.contactName, lead.campaign, lead.email].join(' '));
  return words.every((word) => text.includes(word) || (PHONE_LIKE.test(word) && phoneHas(lead, phoneDigits(word))));
}

export interface BoardFilter {
  query: string;
  /** Empty for every niche */
  campaign: string;
}

/** The leads of each column, the most recently touched first; optionally only those a search and niche match */
export function boardColumns(leads: readonly Lead[], { query, campaign }: BoardFilter = { query: '', campaign: '' }): Record<BoardColumn, Lead[]> {
  const columns = Object.fromEntries(BOARD_COLUMNS.map((column) => [column, [] as Lead[]])) as Record<BoardColumn, Lead[]>;
  for (const lead of leads) {
    if (campaign && lead.campaign !== campaign) continue;
    if (!matchesSearch(lead, query)) continue;
    columns[boardColumn(lead)].push(lead);
  }
  for (const column of BOARD_COLUMNS) columns[column].sort((a, b) => touchedAt(b) - touchedAt(a));
  return columns;
}

/** Calls nobody picked up since the lead last answered or got a message */
function missedInARow(lead: Lead): number {
  let missed = 0;
  for (const step of lead.activity) {
    if (step.type === 'no_answer') missed += 1;
    else if (step.type === 'answered' || step.type === 'whatsapp' || step.type === 'advanced') break;
  }
  return missed;
}

/**
 * What the card says under the lead: its latest contact and when. "נוסף היום", "אין מענה 3 פעמים · האחרונה
 * אתמול", "נשלח וואטסאפ לפני שעתיים", "דיברנו לפני 4 ימים", "בהצעת מחיר מאתמול", "לא רלוונטי".
 */
export function cardLine(lead: Lead, now = Date.now()): string {
  // "לפני שעתיים", "אתמול", and a date with a ב-: "ב-12 באוק׳"
  const when = (iso: string) => {
    const relative = formatRelative(iso, now);
    return /^\d/.test(relative) ? `ב-${relative}` : relative;
  };
  if (lead.archivedAt) return `סומן כלא רלוונטי ${when(lead.archivedAt)}`;
  const latest = lead.activity[0];
  if (lead.stage === 'closed') return `נסגר ${when(lead.stageChangedAt)}`;
  if (!latest) return `נוסף ${when(lead.createdAt)}`;
  switch (latest.type) {
    case 'whatsapp':
      return `נשלח וואטסאפ ${when(latest.at)}`;
    case 'no_answer': {
      const missed = missedInARow(lead);
      return missed > 1 ? `אין מענה ${count(missed, NOUNS.time)} · האחרונה ${when(latest.at)}` : `אין מענה · ${when(latest.at)}`;
    }
    case 'answered':
      return `דיברנו ${when(latest.at)}`;
    case 'advanced':
      return `עבר להצעת מחיר ${when(latest.at)}`;
    case 'archived':
      return `סומן כלא רלוונטי ${when(latest.at)}`;
  }
}
