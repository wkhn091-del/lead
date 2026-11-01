import { describe, expect, it } from 'vitest';
import { createSampleLeads } from '../data/sampleLeads';
import type { Lead } from '../types';
import { eligibleForDraw, localDay, sample } from './daily';
import { funnelMetrics, filterLeads } from './leads';
import { applyAction, callsThisMonth, outcomeBetween, undoAction, WorkflowError } from './workflow';

const NOW = new Date('2026-10-22T09:00:00');
const leads = createSampleLeads(NOW.getTime());
const fresh = (): Lead => ({ ...leads.find((lead) => lead.name === 'סטקיית הגולן')! });
const step = (lead: Lead, type: 'advance' | 'no_answer' | 'archive', id: string = crypto.randomUUID(), at = NOW) =>
  applyAction(lead, { id, type, from: lead.stage }, at);

describe('the funnel', () => {
  it('moves one stage at a time, and a repeated action changes nothing', () => {
    const zoom = step(fresh(), 'advance', 'a1');
    expect(zoom.stage).toBe('zoom');
    expect(applyAction(zoom, { id: 'a1', type: 'advance', from: 'cold_call' }, NOW)).toBe(zoom);
    expect(() => applyAction(zoom, { id: 'a2', type: 'advance', from: 'cold_call' }, NOW)).toThrow(WorkflowError);
    const closed = step(zoom, 'advance');
    expect(closed.stage).toBe('closed');
    expect(() => step(closed, 'advance')).toThrow(/כבר סגורה/);
    expect(() => step(closed, 'archive')).toThrow(WorkflowError);
  });

  it('logs unanswered calls, archives for good, and undoes only the latest step in time', () => {
    const tried = step(fresh(), 'no_answer', 'n1');
    expect(tried).toMatchObject({ stage: 'cold_call', attemptCount: 1, lastAttemptAt: NOW.toISOString() });
    const dead = step(tried, 'archive', 'x1');
    expect(() => step(dead, 'advance')).toThrow(/כלא רלוונטי/);

    expect(() => undoAction(dead, 'n1', NOW)).toThrow(WorkflowError); // not the latest
    const restored = undoAction(dead, 'x1', new Date(NOW.getTime() + 5 * 60_000));
    expect(restored.archivedAt).toBeNull();
    expect(() => undoAction(dead, 'x1', new Date(NOW.getTime() + 11 * 60_000))).toThrow(/10 דקות/);

    const closed = step(step(fresh(), 'advance'), 'advance', 'c1');
    const deal = { setupFee: 9000, monthlyRetainer: 450, hostingYearly: 800 };
    // The amounts belong to the closed deal, so reopening it clears them
    expect(undoAction({ ...closed, deal }, 'c1', NOW)).toMatchObject({ stage: 'zoom', deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 } });
  });
});

describe('the daily draw', () => {
  it("takes only uncontacted leads that weren't tried today", () => {
    const { startsAt } = localDay(NOW);
    const ids = new Set(eligibleForDraw(leads, startsAt, new Set()));
    const cold = leads.filter((lead) => lead.stage === 'cold_call' && !lead.archivedAt);
    expect(ids.size).toBe(cold.length);
    expect(leads.filter((lead) => ids.has(lead.id)).every((lead) => lead.stage === 'cold_call' && !lead.archivedAt)).toBe(true);

    const triedNow = step(fresh(), 'no_answer');
    expect(eligibleForDraw([triedNow], startsAt, new Set())).toEqual([]);
    expect(sample([...ids], 10)).toHaveLength(10);
  });

  it("reads each queued lead's outcome for the day", () => {
    const { startsAt, endsAt } = localDay(NOW);
    const advanced = step(fresh(), 'advance');
    expect(outcomeBetween(advanced, startsAt.toISOString(), endsAt.toISOString())?.type).toBe('advanced');
    expect(outcomeBetween(fresh(), startsAt.toISOString(), endsAt.toISOString())).toBeNull();
  });
});

describe('pipeline numbers', () => {
  it('counts stages, revenue and conversion from the sample data', () => {
    const m = funnelMetrics(leads);
    expect(m.counts).toEqual({ cold_call: 13, zoom: 3, closed: 2 });
    expect(m.archived).toBe(2);
    // Setup fees of both closed deals, one retainer, and both renew domain and hosting
    expect(m.income).toEqual({
      setup: { totals: { ILS: 25_000 }, deals: { ILS: 2 } },
      monthly: { totals: { ILS: 600 }, deals: { ILS: 1 } },
      yearly: { totals: { ILS: 1_650 }, deals: { ILS: 2 } },
    });
    expect(m.zoomRate).toBeCloseTo(5 / 7); // 3 in Zoom + 2 closed, against 2 ruled out at Cold Call
    expect(m.closeRate).toBe(1);
  });

  it('filters by stage and campaign, and counts calls in the month', () => {
    const dentists = filterLeads(leads, { query: '', stage: 'all', campaign: 'רופאי שיניים', sort: 'newest' });
    expect(dentists).toHaveLength(5); // six dentists, one marked not relevant
    expect(filterLeads(leads, { query: '', stage: 'archived', campaign: '', sort: 'newest' })).toHaveLength(2);
    expect(filterLeads(leads, { query: 'hadar-realty', stage: 'all', campaign: '', sort: 'newest' })).toHaveLength(1);
    expect(callsThisMonth([step(fresh(), 'no_answer')], NOW)).toBe(1);
  });
});
