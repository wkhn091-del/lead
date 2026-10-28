import { describe, expect, it } from 'vitest';
import type { Activity, DailyQueue, Lead } from '../types';
import { leadCommands, normalize, searchLeads, todaysCalls } from './palette';

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
    stageChangedAt: '2026-10-01T08:00:00.000Z',
    archivedAt: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
    currency: 'ILS',
    activity: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

const leads = [
  lead({ id: 'hadar', name: 'Hadar Real Estate', contactName: 'Daniel Hadar', phone: '052-000-0158', campaign: 'Real estate' }),
  lead({ id: 'bakery', name: 'מאפיית הגליל', contactName: 'אמיר', phone: '+972 54 000 0124', campaign: 'Food producers' }),
  lead({ id: 'dental', name: 'Galil Dental Studio', contactName: 'Dr. Avi Peretz', phone: '054-000-0119', campaign: 'Dentists' }),
  lead({ id: 'lost', name: 'Galil Old Shop', archivedAt: '2026-10-10T08:00:00.000Z' }),
];
const names = (query: string, boost?: Set<string>) => searchLeads(leads, query, boost).map((hit) => hit.lead.id);

describe('palette search', () => {
  it('ignores case, accents and Hebrew vowel points', () => {
    expect(normalize('  Café  שָׁלוֹם ')).toBe('cafe שלום');
  });

  it('finds leads by business, contact, campaign and every word typed', () => {
    expect(names('hadar')).toEqual(['hadar']);
    expect(names('daniel')).toEqual(['hadar']);
    expect(names('dentists')).toEqual(['dental']);
    expect(names('galil dent')).toEqual(['dental']);
    expect(names('אמיר')).toEqual(['bakery']);
    expect(names('מָאפִיית')).toEqual(['bakery']);
    expect(names('nobody')).toEqual([]);
  });

  it('matches phone digits however the number was typed', () => {
    expect(names('0158')).toEqual(['hadar']);
    expect(names('052-000')).toEqual(['hadar']);
    // Typed local, stored international (and the other way round)
    expect(names('0540000124')).toEqual(['bakery']);
    expect(names('972520000158')).toEqual(['hadar']);
  });

  it('puts open leads and today’s calls first', () => {
    expect(names('galil')).toEqual(['dental', 'lost']);
    expect(names('galil', new Set(['lost']))[0]).toBe('lost');
  });
});

describe('palette lead actions', () => {
  const codes = (target: Lead, whatsapp = false, now?: number) => leadCommands(target, { whatsapp, now }).map((item) => item.code);

  it('offers the four call outcomes with one key each, then the lead’s own actions', () => {
    const items = leadCommands(leads[0], { whatsapp: false });
    expect(items.slice(0, 4).map((item) => [item.key, item.label])).toEqual([
      ['N', 'אין מענה'],
      ['A', 'ענה, בלי זום עדיין'],
      ['Z', 'נקבע זום'],
      ['X', 'לא רלוונטי'],
    ]);
    expect(codes(leads[0])).toEqual(['KeyN', 'KeyA', 'KeyZ', 'KeyX', 'KeyO', 'KeyW', 'KeyP', 'KeyC']);
    // Every key is different, so one press can't mean two things
    expect(new Set(codes(leads[0], true)).size).toBe(codes(leads[0], true).length);
  });

  it('speaks the Zoom stage’s language', () => {
    const atZoom = leadCommands({ ...leads[0], stage: 'zoom' }, { whatsapp: false });
    expect(atZoom.slice(0, 3).map((item) => item.label)).toEqual(['לא הגיע', 'דיברנו, עוד לא נסגר', 'העסקה נסגרה']);
  });

  it('logs nothing on closed or archived leads, and offers Undo only inside its window', () => {
    expect(codes({ ...leads[0], stage: 'closed' })).toEqual(['KeyO', 'KeyW', 'KeyP', 'KeyC']);
    expect(codes(leads[3])).toEqual(['KeyO', 'KeyW', 'KeyP']);
    const step: Activity = {
      id: 'step-1',
      type: 'no_answer',
      at: '2026-10-22T08:00:00.000Z',
      from: 'cold_call',
      to: null,
      before: { stageChangedAt: '2026-10-01T08:00:00.000Z', lastAttemptAt: null, attemptCount: 0 },
    };
    const called = { ...leads[0], activity: [step] };
    expect(codes(called, false, Date.parse('2026-10-22T08:05:00.000Z'))).toContain('KeyU');
    expect(codes(called, false, Date.parse('2026-10-22T08:15:00.000Z'))).not.toContain('KeyU');
    expect(leadCommands(called, { whatsapp: true, now: Date.parse('2026-10-22T08:05:00.000Z') }).find((item) => item.code === 'KeyU')?.label).toBe('ביטול "אין מענה"');
  });

  it('offers to pull WhatsApp history only when WhatsApp is linked and the lead has a number', () => {
    expect(codes(leads[0], true)).toContain('KeyH');
    expect(codes(leads[3], true)).not.toContain('KeyH');
  });
});

describe('today’s calls', () => {
  it('keeps the drawn order and marks the ones done today', () => {
    const daily: DailyQueue = {
      date: '2026-10-22',
      startsAt: '2026-10-21T21:00:00.000Z',
      endsAt: '2026-10-22T21:00:00.000Z',
      leadIds: ['dental', 'gone', 'hadar'],
      poolSize: 0,
      quota: 3,
    };
    const step: Activity = {
      id: 's',
      type: 'no_answer',
      at: '2026-10-22T07:00:00.000Z',
      from: 'cold_call',
      to: null,
      before: { stageChangedAt: '2026-10-01T08:00:00.000Z', lastAttemptAt: null, attemptCount: 0 },
    };
    const withStep = leads.map((item) => (item.id === 'dental' ? { ...item, activity: [step] } : item));
    expect(todaysCalls(daily, withStep).map((item) => [item.lead.id, item.position, item.done])).toEqual([
      ['dental', 1, true],
      ['hadar', 3, false],
    ]);
  });
});
