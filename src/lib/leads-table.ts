import type { Lead } from '../types';
import { boardColumn, cardLine, matchesSearch, touchedAt, type BoardColumn } from './board';
import { firstYearValue } from './deal';
import { formatPhone } from './phone';
import { ARCHIVED_META, PIPELINE, STATUS_META } from './stages';
import { isCall } from './workflow';

// The leads table (components/pipeline/LeadsTable.tsx): its filters, sort keys and the rows an export writes,
// kept apart from the component so they can be tested.

/** When the leads shown were added */
export type AddedFilter = 'all' | 'today' | 'week' | 'month';

export const ADDED_OPTIONS: readonly { value: AddedFilter; label: string }[] = [
  { value: 'all', label: 'כל התאריכים' },
  { value: 'today', label: 'נוספו היום' },
  { value: 'week', label: 'נוספו ב-7 ימים' },
  { value: 'month', label: 'נוספו ב-30 יום' },
];

export interface LeadFilter {
  query: string;
  /** Empty for every niche */
  campaign: string;
  /** Empty for every city */
  city: string;
  /** Empty: every status but "not relevant", which shows only when asked for */
  statuses: readonly BoardColumn[];
  added: AddedFilter;
}

/** Midnight, some days back: calendar days, so a change of clock (summer time) doesn't move it */
const midnight = (now: number, daysBack = 0) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack).getTime();
};

/** The first moment a lead may have been added at and still be shown: today, or the 7 or 30 days with today */
export function addedSince(added: AddedFilter, now = Date.now()): number | null {
  switch (added) {
    case 'all':
      return null;
    case 'today':
      return midnight(now);
    case 'week':
      return midnight(now, 6);
    case 'month':
      return midnight(now, 29);
  }
}

export function filterLeadsBy(leads: readonly Lead[], filter: LeadFilter, now = Date.now()): Lead[] {
  const since = addedSince(filter.added, now);
  const statuses = new Set(filter.statuses);
  return leads.filter((lead) => {
    const column = boardColumn(lead);
    if (statuses.size ? !statuses.has(column) : column === 'archived') return false;
    if (filter.campaign && lead.campaign !== filter.campaign) return false;
    if (filter.city && (lead.city ?? '') !== filter.city) return false;
    if (since !== null && Date.parse(lead.createdAt) < since) return false;
    return matchesSearch(lead, filter.query);
  });
}

/** Leads in each status, within the other filters: the counts on the status chips */
export function statusCounts(leads: readonly Lead[], filter: Omit<LeadFilter, 'statuses'>, now = Date.now()): Record<BoardColumn, number> {
  const counts = Object.fromEntries([...PIPELINE, 'archived'].map((column) => [column, 0])) as Record<BoardColumn, number>;
  for (const lead of filterLeadsBy(leads, { ...filter, statuses: [...PIPELINE, 'archived'] }, now)) counts[boardColumn(lead)] += 1;
  return counts;
}

/** Statuses in board order, so a table sorted by status reads like the board */
const STATUS_ORDER: Record<BoardColumn, number> = { new: 0, contacted: 1, whatsapp: 2, quote: 3, client: 4, archived: 5 };
export const statusRank = (lead: Lead) => STATUS_ORDER[boardColumn(lead)];
export const statusLabel = (lead: Lead) => {
  const column = boardColumn(lead);
  return column === 'archived' ? ARCHIVED_META.label : STATUS_META[column].label;
};

export const callCount = (lead: Lead) => lead.activity.filter(isCall).length;
/** When the lead was last contacted (its latest step), or null when it never was */
export const lastContactAt = (lead: Lead) => (lead.activity[0] ? Date.parse(lead.activity[0].at) : null);
/** What a closed deal brings in its first year: the build, twelve months of retainer and one renewal */
export const dealValue = (lead: Lead) => (lead.stage === 'closed' ? firstYearValue(lead.deal) : 0);

const hebrew = new Intl.Collator('he', { sensitivity: 'base', numeric: true });
export const compareText = (a: string, b: string) => hebrew.compare(a, b);

export type ExportValue = string | number | Date | null;

export interface ExportColumn {
  header: string;
  /** Characters, roughly, for the spreadsheet's column width */
  width: number;
  kind: 'text' | 'number' | 'money' | 'date' | 'datetime';
  value: (lead: Lead) => ExportValue;
}

/** What a spreadsheet of the leads holds, one row per lead, in the order shown */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { header: 'שם העסק', width: 34, kind: 'text', value: (lead) => lead.name },
  { header: 'איש קשר', width: 18, kind: 'text', value: (lead) => lead.contactName },
  { header: 'טלפון', width: 15, kind: 'text', value: (lead) => (lead.phone ? formatPhone(lead.phone) : '') },
  { header: 'אימייל', width: 26, kind: 'text', value: (lead) => lead.email },
  { header: 'אתר', width: 26, kind: 'text', value: (lead) => lead.website },
  { header: 'עיר', width: 14, kind: 'text', value: (lead) => lead.city ?? '' },
  { header: 'נישה', width: 16, kind: 'text', value: (lead) => lead.campaign },
  { header: 'סטטוס', width: 17, kind: 'text', value: statusLabel },
  { header: 'שיחות', width: 8, kind: 'number', value: callCount },
  { header: 'קשר אחרון', width: 17, kind: 'datetime', value: (lead) => (lead.activity[0] ? new Date(lead.activity[0].at) : null) },
  { header: 'מה היה אחרון', width: 30, kind: 'text', value: (lead) => cardLine(lead) },
  { header: 'נוסף', width: 12, kind: 'date', value: (lead) => new Date(lead.createdAt) },
  { header: 'דמי הקמה', width: 12, kind: 'money', value: (lead) => (lead.stage === 'closed' ? lead.deal.setupFee : null) },
  { header: 'ריטיינר חודשי', width: 13, kind: 'money', value: (lead) => (lead.stage === 'closed' ? lead.deal.monthlyRetainer : null) },
  { header: 'חידוש שנתי', width: 12, kind: 'money', value: (lead) => (lead.stage === 'closed' ? lead.deal.hostingYearly : null) },
  { header: 'מטבע', width: 7, kind: 'text', value: (lead) => (lead.stage === 'closed' ? lead.currency : '') },
  { header: 'איך לדבר איתם', width: 40, kind: 'text', value: (lead) => lead.approach },
  { header: 'גוגל מפות', width: 30, kind: 'text', value: (lead) => lead.mapsUrl ?? '' },
];

/** The leads sorted the way the table shows them: the most recently touched first, before any column sort */
export const byLatestTouch = (a: Lead, b: Lead) => touchedAt(b) - touchedAt(a);
