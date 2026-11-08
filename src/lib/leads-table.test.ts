import { describe, expect, it } from 'vitest';
import type { ActionType, Lead } from '../types';
import { addedSince, byLatestTouch, callCount, dealValue, filterLeadsBy, lastContactAt, statusCounts, statusLabel, statusRank, type LeadFilter } from './leads-table';
import { applyAction } from './workflow';

const NOW = new Date('2026-11-04T10:00:00').getTime();
const DAY = 86_400_000;

function lead(overrides: Partial<Lead> & Pick<Lead, 'id' | 'name'>): Lead {
  return {
    contactName: '',
    phone: '',
    email: '',
    website: '',
    campaign: '',
    approach: '',
    method: 'call',
    stage: 'cold_call',
    stageChangedAt: '2026-11-01T08:00:00.000Z',
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
    currency: 'ILS',
    activity: [],
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

const step = (target: Lead, type: ActionType, at: number) => applyAction(target, { id: crypto.randomUUID(), type, from: target.stage }, new Date(at));

const fresh = lead({ id: 'fresh', name: 'מספרת אליהו', campaign: 'מספרות', city: 'ירושלים', phone: '050-909-4047', createdAt: new Date(NOW - 60_000).toISOString() });
const called = step(step(lead({ id: 'called', name: 'מוסך הגליל', campaign: 'מוסכים', createdAt: new Date(NOW - 3 * DAY).toISOString() }), 'no_answer', NOW - 2 * DAY), 'answered', NOW - DAY);
const messaged = step(lead({ id: 'messaged', name: 'פרחי השרון', campaign: 'מספרות', city: 'טבריה', createdAt: new Date(NOW - 10 * DAY).toISOString() }), 'whatsapp', NOW - 2 * 3_600_000);
const quote = lead({ id: 'quote', name: 'קפה נחת', stage: 'zoom', createdAt: new Date(NOW - 40 * DAY).toISOString() });
const client = lead({
  id: 'client',
  name: 'עו״ד כהן',
  stage: 'closed',
  deal: { setupFee: 4500, monthlyRetainer: 350, hostingYearly: 600 },
  createdAt: new Date(NOW - 50 * DAY).toISOString(),
});
const archived = lead({ id: 'archived', name: 'חנות סגורה', campaign: 'מספרות', archivedAt: new Date(NOW - DAY).toISOString() });
const leads = [fresh, called, messaged, quote, client, archived];

const all: LeadFilter = { query: '', campaign: '', city: '', statuses: [], added: 'all' };
const ids = (list: readonly Lead[]) => list.map((item) => item.id);

describe('filtering the leads table', () => {
  it('shows every status but "not relevant" until a status is chosen', () => {
    expect(ids(filterLeadsBy(leads, all, NOW))).toEqual(['fresh', 'called', 'messaged', 'quote', 'client']);
    expect(ids(filterLeadsBy(leads, { ...all, statuses: ['archived'] }, NOW))).toEqual(['archived']);
    expect(ids(filterLeadsBy(leads, { ...all, statuses: ['contacted', 'whatsapp'] }, NOW))).toEqual(['called', 'messaged']);
  });

  it('combines the search, the niche and when the lead was added', () => {
    expect(ids(filterLeadsBy(leads, { ...all, campaign: 'מספרות' }, NOW))).toEqual(['fresh', 'messaged']);
    expect(ids(filterLeadsBy(leads, { ...all, campaign: 'מספרות', statuses: ['new', 'archived'] }, NOW))).toEqual(['fresh', 'archived']);
    // A phone number however it was typed
    expect(ids(filterLeadsBy(leads, { ...all, query: '+972 50 909' }, NOW))).toEqual(['fresh']);
    expect(ids(filterLeadsBy(leads, { ...all, added: 'today' }, NOW))).toEqual(['fresh']);
    expect(ids(filterLeadsBy(leads, { ...all, added: 'week' }, NOW))).toEqual(['fresh', 'called']);
    expect(ids(filterLeadsBy(leads, { ...all, added: 'month' }, NOW))).toEqual(['fresh', 'called', 'messaged']);
    // By city, and the city is a word the search finds
    expect(ids(filterLeadsBy(leads, { ...all, city: 'טבריה' }, NOW))).toEqual(['messaged']);
    expect(ids(filterLeadsBy(leads, { ...all, query: 'ירושלים' }, NOW))).toEqual(['fresh']);
  });

  it('starts "today" at midnight, and the 7 and 30 days with today', () => {
    const midnight = new Date('2026-11-04T00:00:00').getTime();
    expect(addedSince('all', NOW)).toBeNull();
    expect(addedSince('today', NOW)).toBe(midnight);
    expect(addedSince('week', NOW)).toBe(new Date('2026-10-29T00:00:00').getTime());
    expect(addedSince('month', NOW)).toBe(new Date('2026-10-06T00:00:00').getTime());
  });

  it('counts each status within the other filters, for the chips', () => {
    expect(statusCounts(leads, { query: '', campaign: '', city: '', added: 'all' }, NOW)).toEqual({ new: 1, contacted: 1, whatsapp: 1, quote: 1, client: 1, archived: 1 });
    expect(statusCounts(leads, { query: '', campaign: 'מספרות', city: '', added: 'all' }, NOW)).toEqual({ new: 1, contacted: 0, whatsapp: 1, quote: 0, client: 0, archived: 1 });
  });
});

describe('the columns of the leads table', () => {
  it('sorts statuses the way the board reads, and names them', () => {
    expect([...leads].sort((a, b) => statusRank(a) - statusRank(b)).map(statusLabel)).toEqual([
      'חדש',
      'נוצר קשר (שיחה)',
      'נשלח וואטסאפ',
      'הצעת מחיר',
      'נסגר / לקוח',
      'לא רלוונטי',
    ]);
  });

  it('counts calls, not messages, and knows the latest contact', () => {
    expect(callCount(called)).toBe(2);
    expect(callCount(messaged)).toBe(0);
    expect(lastContactAt(called)).toBe(NOW - DAY);
    expect(lastContactAt(fresh)).toBeNull();
  });

  it("values a closed deal by its first year, and nothing else", () => {
    expect(dealValue(client)).toBe(4500 + 12 * 350 + 600);
    expect(dealValue({ ...quote, deal: client.deal })).toBe(0);
  });

  it('puts the most recently touched first', () => {
    expect(ids([...leads].sort(byLatestTouch)).slice(0, 3)).toEqual(['fresh', 'messaged', 'called']);
  });
});
