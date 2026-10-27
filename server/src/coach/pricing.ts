import type { LeadRecord } from '../stores/types.js';
import { nicheKey, nicheOf } from '../training/niche.js';

/**
 * The seller's own prices, from the deals they already closed: what the coach's price recommendation is
 * anchored on. Only amounts and the niche name leave the server, never which business paid them.
 */

export interface Spread {
  median: number;
  low: number;
  high: number;
}

export interface PriceHistory {
  currency: LeadRecord['currency'];
  /** Closed deals in this currency with any amount recorded */
  priced: number;
  /** Of those, the ones with a setup fee, and what they paid */
  setups: number;
  setupFee: Spread | null;
  /** The ones that pay a monthly retainer */
  retainers: number;
  monthlyRetainer: Spread | null;
  /** The ones that pay for domain and hosting */
  hosting: number;
  hostingYearly: Spread | null;
  /** Deals in the lead's own niche, when it has one */
  niche: { name: string; deals: number; setupFee: Spread | null } | null;
}

export function spread(values: readonly number[]): Spread | null {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  return { median, low: sorted[0], high: sorted[sorted.length - 1] };
}

/** The closed deals other than this lead, in its currency */
export function priceHistory(leads: readonly LeadRecord[], lead: Pick<LeadRecord, 'id' | 'currency' | 'campaign'>): PriceHistory {
  const priced = leads.filter(
    (other) =>
      other.id !== lead.id &&
      other.stage === 'closed' &&
      !other.archivedAt &&
      other.currency === lead.currency &&
      (other.deal.setupFee > 0 || other.deal.monthlyRetainer > 0 || other.deal.hostingYearly > 0),
  );
  const niche = nicheOf(lead.campaign);
  const sameNiche = niche ? priced.filter((other) => other.deal.setupFee > 0 && nicheKey(other.campaign) === nicheKey(niche)) : [];
  const fees = (field: keyof LeadRecord['deal']) => priced.map((other) => other.deal[field]).filter((value) => value > 0);
  return {
    currency: lead.currency,
    priced: priced.length,
    setups: fees('setupFee').length,
    setupFee: spread(fees('setupFee')),
    retainers: fees('monthlyRetainer').length,
    monthlyRetainer: spread(fees('monthlyRetainer')),
    hosting: fees('hostingYearly').length,
    hostingYearly: spread(fees('hostingYearly')),
    niche: niche ? { name: niche, deals: sameNiche.length, setupFee: spread(sameNiche.map((other) => other.deal.setupFee)) } : null,
  };
}

const amount = (value: number) => value.toLocaleString('en-US');
const range = ({ median, low, high }: Spread) => (low === high ? amount(median) : `median ${amount(median)}, from ${amount(low)} to ${amount(high)}`);

/** The history as lines for the prompt */
export function describePriceHistory(history: PriceHistory): string[] {
  if (history.priced === 0) return ['No closed deals with amounts yet.'];
  const { priced } = history;
  const lines = [
    history.setupFee ? `Setup fee: ${history.setups} of ${priced} closed deals (${range(history.setupFee)})` : `Setup fee: none recorded in ${priced} closed deals`,
    history.monthlyRetainer
      ? `Monthly retainer: ${history.retainers} of ${priced} closed deals (${range(history.monthlyRetainer)} a month)`
      : `Monthly retainer: none of ${priced} closed deals`,
    history.hostingYearly
      ? `Domain and hosting: ${history.hosting} of ${priced} closed deals (${range(history.hostingYearly)} a year)`
      : `Domain and hosting: none of ${priced} closed deals`,
  ];
  if (history.niche) {
    lines.push(
      history.niche.setupFee
        ? `Same niche ("${history.niche.name}"): ${history.niche.deals} closed, setup fee ${range(history.niche.setupFee)}`
        : `Same niche ("${history.niche.name}"): no closed deals yet`,
    );
  }
  return lines;
}
