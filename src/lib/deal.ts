import type { Currency, DealTerms, Lead } from '../types';
import { formatMoney } from './format';
import { joinList } from './hebrew';

// A web studio's three kinds of income from a closed deal: the build, the monthly retainer, and the yearly
// domain and hosting renewal.

export const NO_DEAL: Readonly<DealTerms> = Object.freeze({ setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 });

export const DEAL_FIELDS = ['setupFee', 'monthlyRetainer', 'hostingYearly'] as const;
export type DealField = (typeof DEAL_FIELDS)[number];

export const DEAL_META: Record<DealField, { label: string; hint: string; per: string | null }> = {
  setupFee: { label: 'דמי הקמה', hint: 'תשלום חד-פעמי על בניית האתר', per: null },
  monthlyRetainer: { label: 'ריטיינר חודשי', hint: 'תחזוקה וניהול שוטפים', per: 'לחודש' },
  hostingYearly: { label: 'דומיין ואחסון', hint: 'חידוש שנתי', per: 'לשנה' },
};

export const hasDealTerms = (deal: DealTerms) => deal.setupFee > 0 || deal.monthlyRetainer > 0 || deal.hostingYearly > 0;

/** Income that comes back every year: twelve months of retainer and the renewal */
export const recurringYearly = (deal: DealTerms) => deal.monthlyRetainer * 12 + deal.hostingYearly;

/** What the deal brings in over its first year: the build, twelve months of retainer and one renewal */
export const firstYearValue = (deal: DealTerms) => deal.setupFee + recurringYearly(deal);

/** Leads saved before deal terms had one amount, `value`: a closed deal's becomes its setup fee */
export function dealFromStored(stored: { deal?: DealTerms; value?: number; stage?: string }): DealTerms {
  if (stored.deal) return { ...NO_DEAL, ...stored.deal };
  return { ...NO_DEAL, setupFee: stored.stage === 'closed' ? (stored.value ?? 0) : 0 };
}

/** Closed a moment ago and nothing filled in yet: the deal section takes focus to ask for the amounts. */
export const justClosed = (lead: Pick<Lead, 'stage' | 'stageChangedAt' | 'deal'>, now = Date.now()) =>
  lead.stage === 'closed' && !hasDealTerms(lead.deal) && now - Date.parse(lead.stageChangedAt) < 2 * 60_000;

/** The deal's amounts with their cadence: "13,500 ₪", "600 ₪ לחודש", "900 ₪ לשנה". Empty amounts are left out. */
export function dealAmounts(deal: DealTerms, currency: Currency): string[] {
  return DEAL_FIELDS.filter((field) => deal[field] > 0).map((field) => {
    const per = DEAL_META[field].per;
    return per ? `${formatMoney(deal[field], currency)} ${per}` : formatMoney(deal[field], currency);
  });
}

/** "13,500 ₪, 600 ₪ לחודש ו-900 ₪ לשנה", or null before any amount is in */
export function dealPhrase(deal: DealTerms, currency: Currency): string | null {
  const amounts = dealAmounts(deal, currency);
  return amounts.length ? joinList(amounts) : null;
}
