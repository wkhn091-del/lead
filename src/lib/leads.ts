import type { Currency, DealTerms, Lead, LeadPatch, Stage } from '../types';
import { firstYearValue } from './deal';
import { phoneDigits } from './phone';

export type MoneyTotals = Partial<Record<Currency, number>>;

/** One kind of income from closed deals */
export interface IncomeStream {
  /** Summed per currency */
  totals: MoneyTotals;
  /** How many closed deals pay it, per currency */
  deals: Partial<Record<Currency, number>>;
}

/** A stage, or archived leads ("לא רלוונטי"). "all" means every lead still in play. */
export type StageFilter = Stage | 'archived' | 'all';
export type SortKey = 'newest' | 'activity' | 'value' | 'name';

export interface FunnelMetrics {
  /** Leads at each stage, not counting archived ones */
  counts: Record<Stage, number>;
  archived: number;
  /** Leads still in play */
  active: number;
  /** What the closed deals bring in */
  income: {
    /** One-time setup fees */
    setup: IncomeStream;
    /** Monthly retainers: the monthly recurring revenue (MRR) */
    monthly: IncomeStream;
    /** Domain and hosting, renewed every year */
    yearly: IncomeStream;
  };
  /** Of cold calls with an outcome, the share that booked a Zoom. Null until there is one. */
  zoomRate: number | null;
  /** Of Zoom meetings with an outcome, the share that closed. Null until there is one. */
  closeRate: number | null;
}

export function funnelMetrics(leads: readonly Lead[]): FunnelMetrics {
  const counts: Record<Stage, number> = { cold_call: 0, zoom: 0, closed: 0 };
  const stream = (): IncomeStream => ({ totals: {}, deals: {} });
  const income = { setup: stream(), monthly: stream(), yearly: stream() };
  const add = ({ totals, deals }: IncomeStream, currency: Currency, amount: number) => {
    if (amount <= 0) return;
    totals[currency] = (totals[currency] ?? 0) + amount;
    deals[currency] = (deals[currency] ?? 0) + 1;
  };
  let archived = 0;
  let deadAtCold = 0;
  let deadAtZoom = 0;

  for (const lead of leads) {
    if (lead.archivedAt) {
      archived += 1;
      if (lead.stage === 'cold_call') deadAtCold += 1;
      if (lead.stage === 'zoom') deadAtZoom += 1;
      continue;
    }
    counts[lead.stage] += 1;
    if (lead.stage !== 'closed') continue;
    const { setupFee, monthlyRetainer, hostingYearly } = lead.deal;
    add(income.setup, lead.currency, setupFee);
    add(income.monthly, lead.currency, monthlyRetainer);
    add(income.yearly, lead.currency, hostingYearly);
  }

  // Leads that got past Cold Call, including ones that died later on.
  const reachedZoom = counts.zoom + counts.closed + deadAtZoom;
  return {
    counts,
    archived,
    active: counts.cold_call + counts.zoom + counts.closed,
    income,
    zoomRate: reachedZoom + deadAtCold > 0 ? reachedZoom / (reachedZoom + deadAtCold) : null,
    closeRate: counts.closed + deadAtZoom > 0 ? counts.closed / (counts.closed + deadAtZoom) : null,
  };
}

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'החדשים קודם' },
  { value: 'activity', label: 'פעילות אחרונה' },
  { value: 'value', label: 'שווי עסקה' },
  { value: 'name', label: 'שם (א–ת)' },
];

const comparators: Record<SortKey, (a: Lead, b: Lead) => number> = {
  newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  activity: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  // A deal's worth over its first year: the build, twelve months of retainer and one renewal
  value: (a, b) => firstYearValue(b.deal) - firstYearValue(a.deal),
  name: (a, b) => a.name.localeCompare(b.name, 'he', { sensitivity: 'base' }),
};

/** The lead with the edit applied: amounts merge into the deal it has, so one can change on its own. */
export function patchLead<T extends Pick<Lead, 'deal'>>(lead: T, patch: LeadPatch): T {
  const { deal, ...details } = patch;
  return { ...lead, ...details, ...(deal ? { deal: { ...lead.deal, ...deal } } : {}) };
}

/** What the lead had before the edit, for exactly the fields the edit changes */
export function patchRevert(lead: Lead, patch: LeadPatch): LeadPatch {
  const { deal, ...details } = patch;
  const revert: LeadPatch = Object.fromEntries(Object.keys(details).map((key) => [key, lead[key as keyof typeof details]]));
  if (deal) revert.deal = Object.fromEntries(Object.keys(deal).map((key) => [key, lead.deal[key as keyof DealTerms]]));
  return revert;
}

export interface LeadQuery {
  query: string;
  stage: StageFilter;
  /** Empty string for every campaign */
  campaign: string;
  sort: SortKey;
  /** Always included, so the lead being edited never vanishes mid-edit */
  pinnedId?: string | null;
}

export const matchesStage = (lead: Lead, stage: StageFilter) =>
  stage === 'archived' ? Boolean(lead.archivedAt) : !lead.archivedAt && (stage === 'all' || lead.stage === stage);

/** Search matches name, contact, email, website, campaign, approach notes and phone digits (3+). */
export function filterLeads(leads: readonly Lead[], { query, stage, campaign, sort, pinnedId }: LeadQuery): Lead[] {
  const q = query.trim().toLocaleLowerCase();
  const qDigits = q.replace(/\D/g, '');

  const matches = (lead: Lead) => {
    if (lead.id === pinnedId) return true;
    if (!matchesStage(lead, stage)) return false;
    if (campaign && lead.campaign !== campaign) return false;
    if (!q) return true;
    return (
      [lead.name, lead.contactName, lead.email, lead.website, lead.campaign, lead.approach].some((text) =>
        text.toLocaleLowerCase().includes(q),
      ) ||
      (qDigits.length >= 3 && phoneDigits(lead.phone).includes(qDigits))
    );
  };

  return leads.filter(matches).sort(comparators[sort]);
}

/** Campaign names with their lead counts, most leads first */
export function campaignCounts(leads: readonly Lead[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lead of leads) if (lead.campaign) counts.set(lead.campaign, (counts.get(lead.campaign) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'));
}
