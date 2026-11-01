import { describe, expect, it } from 'vitest';
import { eligible, sample } from '../src/daily/queue.js';
import { dayKey, nextDay, startOfDay } from '../src/daily/time.js';

describe('days in a time zone', () => {
  const zone = 'Asia/Jerusalem';

  it('turns over at local midnight, not UTC midnight', () => {
    expect(dayKey(new Date('2026-10-21T20:59:00Z'), zone)).toBe('2026-10-21');
    expect(dayKey(new Date('2026-10-21T21:00:00Z'), zone)).toBe('2026-10-22');
  });

  it('follows daylight saving time (Israel goes back an hour on 25 October 2026)', () => {
    expect(startOfDay('2026-10-25', zone).toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(startOfDay('2026-10-26', zone).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
});

describe('the daily draw', () => {
  it('leaves out archived and answered leads, leads tried today and leads already queued', () => {
    const startsAt = new Date('2026-10-21T21:00:00Z');
    const ids = eligible(
      [
        { id: 'fresh', archivedAt: null, lastAttemptAt: null, answered: false },
        { id: 'tried-yesterday', archivedAt: null, lastAttemptAt: new Date('2026-10-21T15:00:00Z'), answered: false },
        { id: 'tried-today', archivedAt: null, lastAttemptAt: new Date('2026-10-22T06:00:00Z'), answered: false },
        { id: 'talked-last-week', archivedAt: null, lastAttemptAt: new Date('2026-10-14T09:00:00Z'), answered: true },
        { id: 'dead', archivedAt: new Date('2026-10-20T10:00:00Z'), lastAttemptAt: null, answered: false },
        { id: 'queued', archivedAt: null, lastAttemptAt: null, answered: false },
      ],
      startsAt,
      new Set(['queued']),
    );
    expect(ids).toEqual(['fresh', 'tried-yesterday']);
  });

  it('picks distinct leads and every lead can be picked', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `lead-${i}`);
    const seen = new Set<string>();
    for (let run = 0; run < 200; run++) {
      const picked = sample(ids, 10);
      expect(new Set(picked).size).toBe(10);
      picked.forEach((id) => seen.add(id));
    }
    expect(seen.size).toBe(30);
    expect(sample(ids.slice(0, 3), 10)).toHaveLength(3);
  });
});
