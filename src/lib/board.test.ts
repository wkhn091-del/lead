import { describe, expect, it } from 'vitest';
import type { ActionType, Lead } from '../types';
import { boardColumn, boardColumns, cardLine, matchesSearch } from './board';
import { eligibleForDraw, localDay } from './daily';
import { leadBadge, pipelineStatus } from './stages';
import { describeTimeline } from './timeline';
import { applyAction, callsThisMonth, entryAfterUndo, isCall, timelineEntryFor, undoAction, WorkflowError } from './workflow';

const NOW = new Date('2026-11-04T10:00:00');

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

const step = (target: Lead, type: ActionType, at = NOW, id: string = crypto.randomUUID()) => applyAction(target, { id, type, from: target.stage }, at);

describe('the WhatsApp step', () => {
  it("counts as today's contact, not as a call attempt, and can be undone", () => {
    const fresh = lead({ id: 'a', name: 'מספרת אליהו', phone: '050-909-4047' });
    const sent = step(fresh, 'whatsapp', NOW, 'w1');
    expect(sent).toMatchObject({ stage: 'cold_call', attemptCount: 0, lastAttemptAt: NOW.toISOString() });
    expect(sent.activity[0]).toMatchObject({ id: 'w1', type: 'whatsapp', from: 'cold_call', to: null });
    expect(isCall(sent.activity[0])).toBe(false);
    expect(callsThisMonth([sent], NOW)).toBe(0);
    // Messaged today, so not drawn again today; still in the pool for another day, since nobody answered
    expect(eligibleForDraw([sent], localDay(NOW).startsAt, new Set())).toEqual([]);
    expect(eligibleForDraw([sent], localDay(new Date('2026-11-05T10:00:00')).startsAt, new Set())).toEqual(['a']);
    expect(undoAction(sent, 'w1', new Date(NOW.getTime() + 60_000))).toMatchObject({ lastAttemptAt: null, activity: [] });
  });

  it('is refused on a closed deal and on a lead marked not relevant', () => {
    expect(() => step(lead({ id: 'c', name: 'סגור', stage: 'closed' }), 'whatsapp')).toThrow(/כבר סגורה/);
    expect(() => step(lead({ id: 'x', name: 'לא רלוונטי', archivedAt: '2026-11-02T08:00:00.000Z' }), 'whatsapp')).toThrow(WorkflowError);
  });

  it('becomes a WhatsApp entry on the timeline, which stays one when the step is undone', () => {
    const sent = step(lead({ id: 'a', name: 'א' }), 'whatsapp', NOW, 'w1');
    const entry = timelineEntryFor(sent.activity[0], 'a', ' שלחתי דוגמאות ');
    expect(entry).toMatchObject({ id: 'w1', kind: 'whatsapp', outcome: null, step: 'whatsapp', stageTo: null, body: 'שלחתי דוגמאות' });
    expect(describeTimeline([entry]).map((item) => item.title)).toEqual(['נשלח וואטסאפ']);
    expect(entryAfterUndo(entry, false)).toMatchObject({ kind: 'whatsapp', step: null, body: 'שלחתי דוגמאות' });
  });
});

describe('the board', () => {
  it('puts a lead where its stage and its latest contact say', () => {
    const fresh = lead({ id: 'a', name: 'א' });
    expect(pipelineStatus(fresh)).toBe('new');
    const missed = step(fresh, 'no_answer');
    expect(pipelineStatus(missed)).toBe('contacted');
    const messaged = step(missed, 'whatsapp');
    expect(pipelineStatus(messaged)).toBe('whatsapp');
    // Called again after the message: back with the calls
    expect(pipelineStatus(step(messaged, 'answered'))).toBe('contacted');
    const quote = step(messaged, 'advance');
    expect(pipelineStatus(quote)).toBe('quote');
    // At the quote, contact doesn't move it
    expect(pipelineStatus(step(quote, 'whatsapp'))).toBe('quote');
    expect(pipelineStatus(step(quote, 'advance'))).toBe('client');
    expect(leadBadge(messaged).label).toBe('נשלח וואטסאפ');
    expect(boardColumn(step(missed, 'archive'))).toBe('archived');
  });

  it('groups by column, newest contact first, within the search and the niche', () => {
    const leads = [
      lead({ id: 'old', name: 'מספרה ותיקה', campaign: 'מספרות', createdAt: '2026-10-01T08:00:00.000Z' }),
      lead({ id: 'new', name: 'נגריית הכרמל', campaign: 'נגריות', phone: '+972 54-123-4567', createdAt: '2026-11-03T08:00:00.000Z' }),
      step(lead({ id: 'called', name: 'מספרת אליהו', campaign: 'מספרות' }), 'answered', new Date('2026-11-04T09:00:00')),
      step(lead({ id: 'messaged', name: 'מספרת קובי', campaign: 'מספרות' }), 'whatsapp', new Date('2026-11-04T09:30:00')),
      lead({ id: 'gone', name: 'עסק שנסגר', archivedAt: '2026-11-02T08:00:00.000Z' }),
    ];
    const all = boardColumns(leads, { query: '', campaign: '' });
    expect(all.new.map((item) => item.id)).toEqual(['new', 'old']);
    expect(all.contacted.map((item) => item.id)).toEqual(['called']);
    expect(all.whatsapp.map((item) => item.id)).toEqual(['messaged']);
    expect(all.archived.map((item) => item.id)).toEqual(['gone']);
    expect(boardColumns(leads, { query: '', campaign: 'מספרות' }).new.map((item) => item.id)).toEqual(['old']);
    expect(boardColumns(leads, { query: 'מספרת', campaign: '' }).contacted.map((item) => item.id)).toEqual(['called']);
  });

  it('finds a lead by its phone however the number is typed', () => {
    const target = lead({ id: 'n', name: 'נגריית הכרמל', phone: '+972 54-123-4567' });
    for (const query of ['054-1234567', '0541234567', '054 123 4567', '+972 54 123', '4567', 'נגריי', 'הכרמל נגריית']) {
      expect(matchesSearch(target, query), query).toBe(true);
    }
    expect(matchesSearch(target, '052')).toBe(false);
    expect(matchesSearch(target, '054 999')).toBe(false);
  });

  it('says what happened last, and when', () => {
    const now = NOW.getTime();
    const added = lead({ id: 'a', name: 'א', createdAt: new Date(now - 2 * 60 * 60_000).toISOString() });
    // The time itself is the browser's relative format ("לפני שעתיים"), the same as everywhere in the app
    expect(cardLine(added, now)).toMatch(/^נוסף לפני /);
    const twice = step(step(added, 'no_answer', new Date(now - 26 * 60 * 60_000)), 'no_answer', new Date(now - 60_000));
    expect(cardLine(twice, now)).toMatch(/^אין מענה פעמיים · האחרונה לפני /);
    expect(cardLine(step(twice, 'whatsapp', new Date(now - 30_000)), now)).toBe('נשלח וואטסאפ עכשיו');
    expect(cardLine(step(added, 'answered', new Date(now - 30_000)), now)).toBe('דיברנו עכשיו');
    expect(cardLine({ ...added, archivedAt: new Date(now - 30_000).toISOString() }, now)).toBe('סומן כלא רלוונטי עכשיו');
  });
});
