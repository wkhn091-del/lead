import { appConfig } from '../config';
import type { CoachingReport, Currency, DealHealth, DealTerms, Interaction, Lead, LeadPulse } from '../types';
import { firstYearValue, hasDealTerms } from './deal';
import { formatMoney } from './format';
import { count, NOUNS } from './hebrew';

/**
 * The dashboard's numbers, worked out from the leads and their pulses (the last touch and the gist of the
 * deal analysis, see LeadPulse): the money expected in the next 30 days, the open deals in order of what to
 * work on, and the reminders of what needs doing. Pure functions of their input and `now`, so they are tested
 * on their own (dashboard.test.ts).
 */

const DAY = 86_400_000;
/** How far ahead the forecast looks */
export const FORECAST_DAYS = 30;
/** A Zoom-stage deal with no contact for this long is cooling down */
export const STALE_ZOOM_DAYS = 5;
/** A cold call that was picked up but led nowhere, followed up after this long */
export const ANSWERED_FOLLOW_UP_DAYS = 7;
/** The odds of a deal nobody has read yet, before any Zoom meeting was decided */
const DEFAULT_ODDS = 0.25;
/**
 * Your close rate counts this many imaginary deals at DEFAULT_ODDS along with your real ones, so two or three
 * results can't swing it to 0% or 100%. With a few dozen decided deals it's practically your own rate.
 */
const PRIOR_DEALS = 4;
/** Below this many decided deals, the rate is called cautious on screen */
export const FEW_DECIDED = 10;

/** How likely a deal is to close, by the AI's read of it. A rough guide, labelled as an estimate on screen. */
export const HEALTH_ODDS: Record<DealHealth, number> = { won: 1, hot: 0.6, warm: 0.35, cold: 0.15, stalled: 0.1, lost: 0.03 };
const HEALTH_RANK: Record<DealHealth, number> = { won: 0, hot: 0, warm: 1, stalled: 3, cold: 4, lost: 5 };
/** Deals not analyzed yet sit between warm and stalled */
const UNKNOWN_RANK = 2;

const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
/** Calendar days from one moment to another, in this browser's time zone */
export const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);
const addDays = (time: number, days: number) => {
  const date = new Date(startOfDay(time));
  date.setDate(date.getDate() + days);
  return date.getTime();
};

/** A pulse from a timeline (newest first) and the latest report: the same thing the server sends */
export function pulseFrom(leadId: string, newestFirst: readonly Interaction[], report: CoachingReport | null): LeadPulse {
  const last = newestFirst[0];
  const zoom = newestFirst.find((entry) => entry.kind === 'zoom');
  const analysis = report?.analysis;
  return {
    leadId,
    lastEntry: last ? { at: last.at, kind: last.kind, outcome: last.outcome } : null,
    lastZoom: zoom ? { at: zoom.at, outcome: zoom.outcome } : null,
    coaching:
      report && analysis
        ? {
            at: report.createdAt,
            dealHealth: analysis.dealHealth,
            nextCall: { goal: analysis.nextCall.goal, timing: analysis.nextCall.timing, inDays: analysis.nextCall.inDays ?? null },
            firstStep: analysis.actionPlan?.[0]?.step ?? null,
            pricing: analysis.pricing
              ? {
                  setupFee: analysis.pricing.setupFee,
                  monthlyRetainer: analysis.pricing.monthlyRetainer,
                  hostingYearly: analysis.pricing.hostingYearly,
                  currency: analysis.pricing.currency,
                }
              : null,
            sample: report.provider === 'sample',
          }
        : null,
  };
}

/** Leads the dashboard looks at: in play, and past their first call or further along */
export const inPlay = (lead: Lead) => !lead.archivedAt && (lead.stage !== 'cold_call' || lead.activity.length > 0);

/** When the lead was last dealt with: its newest timeline entry or logged step */
export function lastTouch(lead: Lead, pulse: LeadPulse | undefined): number | null {
  const times = [pulse?.lastEntry?.at, lead.activity[0]?.at, lead.lastAttemptAt].filter((value): value is string => Boolean(value)).map(Date.parse);
  return times.length ? Math.max(...times) : null;
}

/** When the deal closed: the moment it reached the stage */
const closedAt = (lead: Lead) => Date.parse(lead.stageChangedAt);

/** The next domain and hosting renewal from today on: a year after closing, then every year */
export function nextRenewal(lead: Lead, now: number): number {
  const closed = new Date(closedAt(lead));
  for (let years = 1; ; years++) {
    const due = new Date(closed);
    due.setFullYear(closed.getFullYear() + years);
    if (due.getTime() >= startOfDay(now)) return due.getTime();
  }
}

const median = (values: readonly number[]) => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/** What your closed deals typically bring, per currency: the fallback value of a deal the AI hasn't priced */
function typicalDeal(leads: readonly Lead[]): Partial<Record<Currency, DealTerms>> {
  const typical: Partial<Record<Currency, DealTerms>> = {};
  for (const currency of ['ILS', 'USD'] as const) {
    const closed = leads.filter((lead) => lead.stage === 'closed' && !lead.archivedAt && lead.currency === currency && lead.deal.setupFee > 0);
    if (!closed.length) continue;
    const share = (field: keyof DealTerms) => closed.filter((lead) => lead.deal[field] > 0).length / closed.length;
    // A typical deal pays a retainer or hosting only if most of yours do
    typical[currency] = {
      setupFee: median(closed.map((lead) => lead.deal.setupFee)),
      monthlyRetainer: share('monthlyRetainer') >= 0.5 ? median(closed.map((lead) => lead.deal.monthlyRetainer)) : 0,
      hostingYearly: share('hostingYearly') >= 0.5 ? median(closed.map((lead) => lead.deal.hostingYearly)) : 0,
    };
  }
  return typical;
}

export interface DealEstimate extends DealTerms {
  currency: Currency;
  /** ai: the deal analysis priced it; typical: your typical closed deal */
  basis: 'ai' | 'typical';
}

/** Your odds of closing a deal after Zoom: closed deals out of those decided (closed, or marked not relevant at Zoom) */
export function closeOdds(leads: readonly Lead[]): { odds: number; basis: 'history' | 'default'; decided: number } {
  const won = leads.filter((lead) => lead.stage === 'closed' && !lead.archivedAt).length;
  const lost = leads.filter((lead) => lead.stage === 'zoom' && lead.archivedAt).length;
  const decided = won + lost;
  if (decided === 0) return { odds: DEFAULT_ODDS, basis: 'default', decided };
  return { odds: (won + PRIOR_DEALS * DEFAULT_ODDS) / (decided + PRIOR_DEALS), basis: 'history', decided };
}

export interface OpenDeal {
  lead: Lead;
  /** The AI's read of the deal, if it was analyzed */
  health: DealHealth | null;
  /** Chance it closes: by the AI's read, or else your close rate */
  odds: number;
  estimate: DealEstimate | null;
  lastTouch: number | null;
  /** Days since then */
  idleDays: number | null;
  /** The next step, from the deal analysis */
  nextStep: string | null;
  /** When the analysis said to make the next contact */
  followUpDue: number | null;
  /** Something was logged after the analysis, so it may be out of date */
  analysisStale: boolean;
}

/** The deal analysis's date for the next contact: the day it was made, plus the days it said */
export const followUpDue = (pulse: LeadPulse | undefined) =>
  pulse?.coaching && pulse.coaching.nextCall.inDays !== null ? addDays(Date.parse(pulse.coaching.at), pulse.coaching.nextCall.inDays) : null;

/** Deals at Zoom Meeting: the hottest first, then the most valuable, then the ones waiting longest */
export function openDeals(leads: readonly Lead[], pulses: ReadonlyMap<string, LeadPulse>, now: number): OpenDeal[] {
  const typical = typicalDeal(leads);
  const { odds: baseOdds } = closeOdds(leads);
  return leads
    .filter((lead) => !lead.archivedAt && lead.stage === 'zoom')
    .map((lead): OpenDeal => {
      const pulse = pulses.get(lead.id);
      const coaching = pulse?.coaching ?? null;
      const touched = lastTouch(lead, pulse);
      const pricing = coaching?.pricing;
      const fallback = typical[lead.currency];
      const estimate: DealEstimate | null =
        pricing && hasDealTerms(pricing)
          ? { ...pricing, basis: 'ai' }
          : fallback
            ? { ...fallback, currency: lead.currency, basis: 'typical' }
            : null;
      return {
        lead,
        health: coaching?.dealHealth ?? null,
        odds: coaching ? HEALTH_ODDS[coaching.dealHealth] : baseOdds,
        estimate,
        lastTouch: touched,
        idleDays: touched === null ? null : daysBetween(touched, now),
        nextStep: coaching ? coaching.firstStep || coaching.nextCall.goal || null : null,
        followUpDue: followUpDue(pulse),
        analysisStale: Boolean(coaching && touched !== null && touched > Date.parse(coaching.at)),
      };
    })
    .sort(
      (a, b) =>
        (a.health ? HEALTH_RANK[a.health] : UNKNOWN_RANK) - (b.health ? HEALTH_RANK[b.health] : UNKNOWN_RANK) ||
        (b.estimate ? firstYearValue(b.estimate) : 0) - (a.estimate ? firstYearValue(a.estimate) : 0) ||
        (b.idleDays ?? 0) - (a.idleDays ?? 0),
    );
}

export interface Renewal {
  lead: Lead;
  due: number;
  amount: number;
}

export interface Forecast {
  /** The currency every amount here is in */
  currency: Currency;
  days: number;
  /** One month of every active retainer (MRR) */
  retainers: number;
  retainerClients: number;
  /** Domain and hosting renewals that fall in the window, soonest first */
  renewals: Renewal[];
  renewalTotal: number;
  /** Setup fees of open deals, each weighted by its chance of closing */
  pipeline: number;
  /** Open deals with an estimate, and without one */
  pipelineDeals: number;
  unpriced: number;
  /** All of the above */
  total: number;
  /** What open deals are worth over their first year, unweighted */
  pipelineValue: number;
  /** How deals without an AI read are weighted: your close rate, from this many decided deals */
  oddsBasis: 'history' | 'default';
  baseOdds: number;
  decided: number;
  /** Setup fees of deals closed since the 1st of this month, and how many of them have no amounts yet */
  closedThisMonth: { deals: number; setup: number; unpriced: number };
  /** The 30-day total of deals in other currencies, which isn't mixed into the one above */
  others: Partial<Record<Currency, number>>;
}

/** The money expected in the next 30 days: retainers, renewals that fall due, and open deals by their odds */
export function forecast(leads: readonly Lead[], deals: readonly OpenDeal[], now: number, currency: Currency = appConfig.baseCurrency): Forecast {
  const end = addDays(now, FORECAST_DAYS);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const others: Partial<Record<Currency, number>> = {};
  const addOther = (code: Currency, amount: number) => {
    if (amount > 0) others[code] = (others[code] ?? 0) + amount;
  };

  let retainers = 0;
  let retainerClients = 0;
  const renewals: Renewal[] = [];
  const closedThisMonth = { deals: 0, setup: 0, unpriced: 0 };
  for (const lead of leads) {
    if (lead.archivedAt || lead.stage !== 'closed') continue;
    const { monthlyRetainer, hostingYearly, setupFee } = lead.deal;
    const due = hostingYearly > 0 ? nextRenewal(lead, now) : null;
    const renewalDue = due !== null && due < end;
    if (lead.currency !== currency) {
      addOther(lead.currency, monthlyRetainer + (renewalDue ? hostingYearly : 0));
      continue;
    }
    if (monthlyRetainer > 0) {
      retainers += monthlyRetainer;
      retainerClients += 1;
    }
    if (renewalDue) renewals.push({ lead, due, amount: hostingYearly });
    if (closedAt(lead) >= monthStart && closedAt(lead) <= now) {
      closedThisMonth.deals += 1;
      closedThisMonth.setup += setupFee;
      if (!hasDealTerms(lead.deal)) closedThisMonth.unpriced += 1;
    }
  }
  renewals.sort((a, b) => a.due - b.due);

  let pipeline = 0;
  let pipelineDeals = 0;
  let pipelineValue = 0;
  let unpriced = 0;
  for (const deal of deals) {
    if (!deal.estimate) {
      unpriced += 1;
      continue;
    }
    if (deal.estimate.currency !== currency) {
      addOther(deal.estimate.currency, Math.round(deal.estimate.setupFee * deal.odds));
      continue;
    }
    pipeline += deal.estimate.setupFee * deal.odds;
    pipelineValue += firstYearValue(deal.estimate);
    pipelineDeals += 1;
  }
  pipeline = Math.round(pipeline);
  const renewalTotal = renewals.reduce((sum, item) => sum + item.amount, 0);
  const { odds, basis, decided } = closeOdds(leads);

  return {
    currency,
    days: FORECAST_DAYS,
    retainers,
    retainerClients,
    renewals,
    renewalTotal,
    pipeline,
    pipelineDeals,
    unpriced,
    total: retainers + renewalTotal + pipeline,
    pipelineValue,
    oddsBasis: basis,
    baseOdds: odds,
    decided,
    closedThisMonth,
    others,
  };
}

export type ReminderKind =
  | 'follow-up'
  | 'no-show'
  | 'stale-zoom'
  | 'answered'
  | 'no-amounts'
  | 'renewal'
  | 'upsell'
  | 'no-answer'
  | 'daily'
  | 'practice';

export type Urgency = 'now' | 'soon' | 'later';

export interface Reminder {
  /** Stable while the situation lasts, so a snoozed reminder comes back only when something changes */
  id: string;
  kind: ReminderKind;
  urgency: Urgency;
  /** The lead it's about, if any */
  lead: Lead | null;
  /** A few words on why: "מעקב שהמאמן קבע", "חידוש שנתי" */
  label: string;
  /** What to do, in a sentence */
  detail: string;
  /** When it's due; overdue when in the past */
  due: number | null;
}

export interface ReminderContext {
  /** Calls left in today's Daily 10 */
  dailyLeft: number;
  /** Objection cards due for practice */
  practiceDue: number;
}

/** "היום", "מחר", "בעוד 3 ימים", "באיחור של יומיים" */
export function dueLabel(due: number, now: number): string {
  const days = daysBetween(now, due);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days > 1) return `בעוד ${count(days, NOUNS.day)}`;
  return days === -1 ? 'באיחור של יום' : `באיחור של ${count(-days, NOUNS.day)}`;
}

const URGENCY_ORDER: Record<Urgency, number> = { now: 0, soon: 1, later: 2 };
const KIND_ORDER: ReminderKind[] = ['daily', 'no-amounts', 'follow-up', 'no-show', 'stale-zoom', 'answered', 'renewal', 'no-answer', 'upsell', 'practice'];
/** Of the reminders that are only nudges, at most this many each */
const NUDGE_LIMIT = 3;

/**
 * What needs doing, the most urgent first. Each lead gets its most important reminder only: a follow-up the
 * deal analysis set comes before the general rules, since it already knows what the next contact is for.
 */
export function reminders(leads: readonly Lead[], pulses: ReadonlyMap<string, LeadPulse>, context: ReminderContext, now: number): Reminder[] {
  const found: Reminder[] = [];
  const today = startOfDay(now);
  const nudges: Partial<Record<ReminderKind, number>> = {};
  const nudge = (kind: ReminderKind) => (nudges[kind] = (nudges[kind] ?? 0) + 1) <= NUDGE_LIMIT;

  for (const lead of leads) {
    if (lead.archivedAt) continue;
    const pulse = pulses.get(lead.id);
    const touched = lastTouch(lead, pulse);
    const idle = touched === null ? null : daysBetween(touched, now);
    const coaching = pulse?.coaching ?? null;
    const add = (reminder: Omit<Reminder, 'lead'>) => found.push({ ...reminder, lead });

    if (lead.stage === 'closed') {
      if (!hasDealTerms(lead.deal)) {
        add({ id: `no-amounts:${lead.id}`, kind: 'no-amounts', urgency: 'now', label: 'חסרים סכומים', detail: 'העסקה נסגרה בלי סכומים, אז היא לא נכנסת להכנסות. כדאי לרשום אותם.', due: null });
        continue;
      }
      if (lead.deal.hostingYearly > 0) {
        const due = nextRenewal(lead, now);
        const days = daysBetween(now, due);
        if (days <= FORECAST_DAYS) {
          add({
            id: `renewal:${lead.id}:${new Date(due).getFullYear()}`,
            kind: 'renewal',
            urgency: days <= 7 ? 'now' : 'soon',
            label: 'חידוש שנתי',
            detail: `חידוש דומיין ואחסון ${dueLabel(due, now)}: ${formatMoney(lead.deal.hostingYearly, lead.currency)}.`,
            due,
          });
          continue;
        }
      }
      if (lead.deal.monthlyRetainer === 0 && daysBetween(closedAt(lead), now) >= 30 && nudge('upsell')) {
        add({ id: `upsell:${lead.id}`, kind: 'upsell', urgency: 'later', label: 'הזדמנות לריטיינר', detail: 'אין ריטיינר. זה זמן טוב להציע תחזוקה וניהול חודשיים.', due: null });
      }
      continue;
    }

    // While nothing was logged after the deal analysis, its plan is the one to follow: it already knows about
    // a no-show or a quiet week, and says when to make contact. The reminder comes up three days before.
    const due = followUpDue(pulse);
    if (coaching && due !== null && (touched === null || touched <= Date.parse(coaching.at))) {
      const days = daysBetween(now, due);
      if (days <= 3) {
        add({
          id: `follow-up:${lead.id}:${coaching.at}`,
          kind: 'follow-up',
          urgency: days <= 0 ? 'now' : 'soon',
          label: 'מעקב שהמאמן קבע',
          detail: coaching.nextCall.goal || coaching.firstStep || 'ליצור קשר, לפי ניתוח העסקה.',
          due,
        });
      }
      continue;
    }

    const lastZoom = pulse?.lastZoom;
    if (lead.stage === 'zoom' && lastZoom?.outcome === 'no_show' && (touched === null || touched <= Date.parse(lastZoom.at))) {
      add({ id: `no-show:${lead.id}:${lastZoom.at}`, kind: 'no-show', urgency: 'now', label: 'לא הגיע לזום', detail: 'לקבוע מועד חדש, ולאשר איתו יום לפני.', due: null });
      continue;
    }

    if (lead.stage === 'zoom' && idle !== null && idle >= STALE_ZOOM_DAYS) {
      add({
        id: `stale-zoom:${lead.id}:${touched}`,
        kind: 'stale-zoom',
        urgency: idle >= 7 ? 'now' : 'soon',
        label: 'עסקה מתקררת',
        detail: `${count(idle, NOUNS.day)} בלי מגע בשלב פגישת זום. כדאי לחזור אליו לפני שהעניין יורד.`,
        due: null,
      });
      continue;
    }

    if (lead.stage === 'cold_call') {
      const answered = lead.activity.some((step) => step.type === 'answered');
      if (answered && idle !== null && idle >= ANSWERED_FOLLOW_UP_DAYS) {
        // Picked up once, so the daily draw no longer brings it back: only a reminder will
        add({
          id: `answered:${lead.id}:${touched}`,
          kind: 'answered',
          urgency: 'soon',
          label: 'שיחה שלא נסגרה',
          detail: `דיברתם לפני ${count(idle, NOUNS.day)} ולא נקבע זום. הוא כבר לא עולה בהגרלה היומית, אז כדאי לחזור אליו.`,
          due: null,
        });
        continue;
      }
      if (!answered && lead.attemptCount >= 4 && idle !== null && idle >= 1 && nudge('no-answer')) {
        add({
          id: `no-answer:${lead.id}:${lead.attemptCount}`,
          kind: 'no-answer',
          urgency: 'later',
          label: 'לא עונה',
          detail: `${lead.attemptCount} ניסיונות בלי מענה. לנסות בשעה אחרת, לכתוב לו בעצמך, או לסמן כלא רלוונטי.`,
          due: null,
        });
      }
    }
  }

  if (context.dailyLeft > 0) {
    found.push({
      id: `daily:${new Date(today).toDateString()}`,
      kind: 'daily',
      urgency: 'now',
      lead: null,
      label: 'העשירייה היומית',
      detail: context.dailyLeft === 1 ? 'נשארה שיחה אחת מהעשירייה של היום.' : `נשארו ${context.dailyLeft} שיחות מהעשירייה של היום.`,
      due: null,
    });
  }
  if (context.practiceDue > 0) {
    found.push({
      id: `practice:${new Date(today).toDateString()}`,
      kind: 'practice',
      urgency: 'later',
      lead: null,
      label: 'אימון התנגדויות',
      detail: `${count(context.practiceDue, NOUNS.objection)} לתרגול. כמה דקות לפני השיחות.`,
      due: null,
    });
  }

  return found.sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      (a.due ?? Infinity) - (b.due ?? Infinity) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
}
