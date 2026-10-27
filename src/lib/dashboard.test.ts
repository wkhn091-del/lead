import { describe, expect, it } from 'vitest';
import type { Activity, CoachingReport, Interaction, Lead, LeadPulse } from '../types';
import { closeOdds, dueLabel, forecast, nextRenewal, openDeals, pulseFrom, reminders, type Reminder } from './dashboard';
import { NO_DEAL } from './deal';
import { nicheCounts, nicheKey, nicheOf } from './niche';

// Local times, so calendar days don't depend on where the tests run
const NOW = Date.parse('2026-10-22T10:00:00');
const day = (offset: number, hour = 10) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

let next = 0;
function lead(overrides: Partial<Lead> = {}): Lead {
  next += 1;
  return {
    id: `lead-${next}`,
    name: `Business ${next}`,
    contactName: '',
    phone: '',
    email: '',
    website: '',
    campaign: '',
    approach: '',
    method: 'call',
    stage: 'cold_call',
    stageChangedAt: day(-60),
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { ...NO_DEAL },
    currency: 'ILS',
    activity: [],
    createdAt: day(-60),
    updatedAt: day(-60),
    ...overrides,
  };
}
const step = (type: Activity['type'], at: string, from: Lead['stage'] = 'cold_call', to: Lead['stage'] | null = null): Activity => ({
  id: `step-${at}-${type}`,
  type,
  at,
  from,
  to,
  before: { stageChangedAt: at, lastAttemptAt: null, attemptCount: 0 },
});
const closed = (deal: Lead['deal'], closedOn: string, extra: Partial<Lead> = {}) =>
  lead({ stage: 'closed', stageChangedAt: closedOn, deal, activity: [step('advanced', closedOn, 'zoom', 'closed')], ...extra });
const zoom = (touched: string, extra: Partial<Lead> = {}) => lead({ stage: 'zoom', stageChangedAt: touched, activity: [step('advanced', touched, 'cold_call', 'zoom')], ...extra });
const coaching = (at: string, overrides: Partial<NonNullable<LeadPulse['coaching']>> = {}): NonNullable<LeadPulse['coaching']> => ({
  at,
  dealHealth: 'warm',
  nextCall: { goal: 'Book the closing call', timing: 'Tomorrow', inDays: 1 },
  firstStep: 'Send the proposal',
  pricing: null,
  sample: false,
  ...overrides,
});
const pulse = (target: Lead, extra: Partial<LeadPulse> = {}): [string, LeadPulse] => [target.id, { leadId: target.id, lastEntry: null, lastZoom: null, coaching: null, ...extra }];
const kinds = (list: Reminder[]) => list.map((item) => [item.kind, item.lead?.name ?? null, item.urgency]);

describe('the dashboard', () => {
  it('finds the next domain renewal a year after closing, then every year', () => {
    const deal = closed({ setupFee: 9_000, monthlyRetainer: 0, hostingYearly: 800 }, '2025-11-01T12:00:00');
    expect(new Date(nextRenewal(deal, NOW)).getFullYear()).toBe(2026);
    expect(new Date(nextRenewal(deal, NOW)).getMonth()).toBe(10);
    const older = closed({ setupFee: 9_000, monthlyRetainer: 0, hostingYearly: 800 }, '2024-10-01T12:00:00');
    expect(new Date(nextRenewal(older, NOW)).toISOString().slice(0, 7)).toBe('2027-10');
    expect([dueLabel(Date.parse(day(0)), NOW), dueLabel(Date.parse(day(1)), NOW), dueLabel(Date.parse(day(3)), NOW), dueLabel(Date.parse(day(-1)), NOW), dueLabel(Date.parse(day(-2)), NOW)]).toEqual([
      'היום',
      'מחר',
      'בעוד 3 ימים',
      'באיחור של יום',
      'באיחור של יומיים',
    ]);
  });

  it('expects retainers, renewals due within 30 days, and open deals by their odds', () => {
    const retainer = closed({ setupFee: 12_000, monthlyRetainer: 600, hostingYearly: 900 }, day(-350)); // renews in 15 days
    const later = closed({ setupFee: 14_000, monthlyRetainer: 0, hostingYearly: 700 }, day(-100)); // renews in 265 days
    const fresh = closed({ setupFee: 10_000, monthlyRetainer: 400, hostingYearly: 0 }, day(-3)); // closed this month
    const dollars = closed({ setupFee: 3_000, monthlyRetainer: 200, hostingYearly: 0 }, day(-90), { currency: 'USD' });
    const priced = zoom(day(-2));
    const typical = zoom(day(-4));
    const leads = [retainer, later, fresh, dollars, priced, typical];
    const pulses = new Map([
      pulse(priced, { coaching: coaching(day(-1), { dealHealth: 'hot', pricing: { setupFee: 20_000, monthlyRetainer: 500, hostingYearly: 800, currency: 'ILS' } }) }),
    ]);

    const deals = openDeals(leads, pulses, NOW);
    expect(deals.map((deal) => [deal.lead.id, deal.health, deal.odds, deal.estimate?.basis, deal.estimate?.setupFee])).toEqual([
      [priced.id, 'hot', 0.6, 'ai', 20_000],
      // Not analyzed: your typical deal (the median setup fee), at your close rate: 4 of 4, taken cautiously
      [typical.id, null, 0.625, 'typical', 12_000],
    ]);
    expect(closeOdds(leads)).toEqual({ odds: 0.625, basis: 'history', decided: 4 });
    expect(closeOdds([priced, typical])).toEqual({ odds: 0.25, basis: 'default', decided: 0 });

    const result = forecast(leads, deals, NOW, 'ILS');
    expect(result).toMatchObject({
      currency: 'ILS',
      retainers: 1_000,
      retainerClients: 2,
      renewalTotal: 900,
      pipeline: 20_000 * 0.6 + 12_000 * 0.625,
      pipelineDeals: 2,
      unpriced: 0,
      total: 1_000 + 900 + 19_500,
      closedThisMonth: { deals: 1, setup: 10_000, unpriced: 0 },
      others: { USD: 200 },
    });
    expect(result.renewals.map((item) => item.lead.id)).toEqual([retainer.id]);
    // The typical deal: the median setup fee, plus the retainer and hosting most of your deals pay (medians)
    expect(result.pipelineValue).toBe(20_000 + 500 * 12 + 800 + (12_000 + 500 * 12 + 800));
  });

  it('counts the deals closed this month that have no amounts yet', () => {
    const priced = closed({ setupFee: 10_000, monthlyRetainer: 0, hostingYearly: 0 }, day(-2));
    const missing = closed({ ...NO_DEAL }, day(-1));
    const lastMonth = closed({ ...NO_DEAL }, day(-40));
    expect(forecast([priced, missing, lastMonth], [], NOW, 'ILS').closedThisMonth).toEqual({ deals: 2, setup: 10_000, unpriced: 1 });
  });

  it('weighs open deals by your close rate, cautiously while there are few', () => {
    const won = (n: number) => Array.from({ length: n }, () => closed({ setupFee: 10_000, monthlyRetainer: 0, hostingYearly: 0 }, day(-40)));
    const lost = (n: number) => Array.from({ length: n }, () => lead({ stage: 'zoom', archivedAt: day(-30) }));
    // Two of four: 3/8, not 50%
    expect(closeOdds([...won(2), ...lost(2)])).toEqual({ odds: 0.375, basis: 'history', decided: 4 });
    // Forty decided: close to the real 50%
    expect(closeOdds([...won(20), ...lost(20)]).odds).toBeCloseTo(21 / 44);
  });

  it('puts the hottest deals first, then the most valuable', () => {
    const stalled = zoom(day(-1));
    const unknown = zoom(day(-1));
    const warm = zoom(day(-1));
    const hot = zoom(day(-1));
    const pulses = new Map([
      pulse(stalled, { coaching: coaching(day(-1), { dealHealth: 'stalled' }) }),
      pulse(warm, { coaching: coaching(day(-1), { dealHealth: 'warm' }) }),
      pulse(hot, { coaching: coaching(day(-1), { dealHealth: 'hot' }) }),
    ]);
    expect(openDeals([stalled, unknown, warm, hot], pulses, NOW).map((deal) => deal.lead.id)).toEqual([hot.id, warm.id, unknown.id, stalled.id]);
  });

  it('reminds of what needs doing, each lead once, the most urgent first', () => {
    // The deal analysis set the next contact for today, and nothing was logged since
    const planned = zoom(day(-3));
    // The analysis says to call in ten days: nothing to nag about yet, even after a quiet week
    const patient = zoom(day(-8));
    // Logged after the analysis: back to the general rules, and a week without contact
    const cooling = zoom(day(-7));
    const noShow = zoom(day(-2));
    const talked = lead({ activity: [step('answered', day(-9))], lastAttemptAt: day(-9) });
    const silent = lead({ attemptCount: 5, activity: [step('no_answer', day(-2))], lastAttemptAt: day(-2) });
    const noAmounts = closed({ ...NO_DEAL }, day(-1));
    const renewing = closed({ setupFee: 9_000, monthlyRetainer: 300, hostingYearly: 800 }, day(-355));
    const upsell = closed({ setupFee: 9_000, monthlyRetainer: 0, hostingYearly: 0 }, day(-45));
    const archived = zoom(day(-30), { archivedAt: day(-20) });
    const leads = [planned, patient, cooling, noShow, talked, silent, noAmounts, renewing, upsell, archived];
    const pulses = new Map([
      pulse(planned, { lastEntry: { at: day(-3), kind: 'zoom', outcome: 'held' }, coaching: coaching(day(-1), { nextCall: { goal: 'Get the signature', timing: 'Today', inDays: 1 } }) }),
      pulse(patient, { lastEntry: { at: day(-8), kind: 'zoom', outcome: 'held' }, coaching: coaching(day(-2), { nextCall: { goal: 'Check in', timing: 'In ten days', inDays: 10 } }) }),
      pulse(cooling, { lastEntry: { at: day(-7), kind: 'note', outcome: null }, coaching: coaching(day(-9)) }),
      pulse(noShow, { lastEntry: { at: day(-2), kind: 'zoom', outcome: 'no_show' }, lastZoom: { at: day(-2), outcome: 'no_show' } }),
    ]);

    const list = reminders(leads, pulses, { dailyLeft: 6, practiceDue: 3 }, NOW);
    // Within each urgency, what has a date first
    expect(kinds(list)).toEqual([
      ['follow-up', planned.name, 'now'],
      ['daily', null, 'now'],
      ['no-amounts', noAmounts.name, 'now'],
      ['no-show', noShow.name, 'now'],
      ['stale-zoom', cooling.name, 'now'],
      ['renewal', renewing.name, 'soon'],
      ['answered', talked.name, 'soon'],
      ['no-answer', silent.name, 'later'],
      ['upsell', upsell.name, 'later'],
      ['practice', null, 'later'],
    ]);
    expect(list.find((item) => item.kind === 'follow-up')).toMatchObject({ detail: 'Get the signature', label: 'מעקב שהמאמן קבע' });
    expect(list.find((item) => item.kind === 'daily')?.detail).toBe('נשארו 6 שיחות מהעשירייה של היום.');
    expect(list.find((item) => item.kind === 'answered')?.detail).toContain('דיברתם לפני 9 ימים');
    // The same situation keeps its id, so a snoozed reminder stays snoozed
    expect(reminders(leads, pulses, { dailyLeft: 6, practiceDue: 3 }, NOW + 60_000).map((item) => item.id)).toEqual(list.map((item) => item.id));
  });

  it('builds a pulse from a loaded timeline and report, like the server does', () => {
    const target = zoom(day(-1));
    const entries = [
      { id: 'b', leadId: target.id, kind: 'note', outcome: null, body: 'Sent the proposal', step: null, stage: 'zoom', stageTo: null, at: day(-1), updatedAt: day(-1) },
      { id: 'a', leadId: target.id, kind: 'zoom', outcome: 'held', body: '', step: 'answered', stage: 'zoom', stageTo: null, at: day(-3), updatedAt: day(-3) },
    ] satisfies Interaction[];
    const report = {
      id: 'r',
      leadId: target.id,
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      interactionCount: 2,
      createdAt: day(0, 9),
      analysis: {
        summary: '',
        dealHealth: 'hot',
        actionPlan: [{ step: 'Call about the proposal', when: 'today', why: '' }],
        pricing: { setupFee: 15_000, monthlyRetainer: 450, hostingYearly: 0, walkAwaySetupFee: 12_000, scope: [], rationale: '', howToPresent: '', currency: 'ILS' },
        wentWell: [],
        wentWrong: [],
        mistakes: [],
        objections: [],
        openQuestions: [],
        tips: [],
        nextCall: { goal: 'Close', timing: 'Today', inDays: 0, script: [], fallbackMessage: '' },
      },
    } satisfies CoachingReport;
    expect(pulseFrom(target.id, entries, report)).toEqual({
      leadId: target.id,
      lastEntry: { at: day(-1), kind: 'note', outcome: null },
      lastZoom: { at: day(-3), outcome: 'held' },
      coaching: {
        at: day(0, 9),
        dealHealth: 'hot',
        nextCall: { goal: 'Close', timing: 'Today', inDays: 0 },
        firstStep: 'Call about the proposal',
        pricing: { setupFee: 15_000, monthlyRetainer: 450, hostingYearly: 0, currency: 'ILS' },
        sample: false,
      },
    });
    // A report from before the plan and the price
    const { actionPlan: _plan, pricing: _pricing, ...older } = report.analysis;
    expect(pulseFrom(target.id, [], { ...report, analysis: { ...older, nextCall: { ...older.nextCall, inDays: undefined } } }).coaching).toMatchObject({
      firstStep: null,
      pricing: null,
      nextCall: { inDays: null },
    });
  });
});

describe('niches', () => {
  it('groups leads by their campaign without the area', () => {
    expect(nicheOf('מסעדות · תל אביב')).toBe('מסעדות');
    expect(nicheKey('Law Firms · Haifa')).toBe('law firms');
    expect(nicheKey('עורכי דין נדל״ן')).toBe(nicheKey('עורכי דין נדל"ן'));
    expect(nicheCounts([{ campaign: 'מסעדות · חיפה' }, { campaign: 'מסעדות' }, { campaign: 'רופאי שיניים' }, { campaign: '' }])).toEqual([
      { niche: 'מסעדות', key: 'מסעדות', count: 2 },
      { niche: 'רופאי שיניים', key: 'רופאי שיניים', count: 1 },
    ]);
  });
});
