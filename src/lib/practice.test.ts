import { describe, expect, it, vi } from 'vitest';
import type { ObjectionCard, PracticeState } from '../types';
import { comesBack, dueCards, nextStep, review, warmUp } from './practice';

const NOW = new Date(2026, 9, 22, 10, 30); // 22 Oct, 10:30 local
const fresh: PracticeState = { box: 1, dueAt: NOW.toISOString(), reviews: 0, lapses: 0, lastGrade: null, lastReviewedAt: null };

function card(id: string, practice: Partial<PracticeState>, extra: Partial<ObjectionCard> = {}): ObjectionCard {
  return {
    id,
    key: id,
    category: 'price',
    objection: id,
    insight: '',
    response: '',
    alternatives: [],
    followUp: '',
    leadCount: 1,
    mentions: 1,
    sources: [],
    myResponse: '',
    practice: { ...fresh, ...practice },
    retired: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...extra,
  };
}

describe('practice schedule', () => {
  it('moves a card up a box when answered well, and back to box 1 when missed', () => {
    expect(nextStep({ box: 1 }, 3)).toEqual({ box: 2, days: 1 });
    expect(nextStep({ box: 2 }, 4)).toEqual({ box: 4, days: 7 });
    expect(nextStep({ box: 5 }, 4)).toEqual({ box: 5, days: 14 });
    expect(nextStep({ box: 4 }, 2)).toEqual({ box: 4, days: 3 });
    expect(nextStep({ box: 4 }, 1)).toEqual({ box: 1, days: 0 });
  });

  it('brings cards back at the start of a day, and missed ones right away', () => {
    const good = review(fresh, 3, NOW);
    expect(new Date(good.dueAt)).toEqual(new Date(2026, 9, 23));
    expect(good).toMatchObject({ box: 2, reviews: 1, lapses: 0, lastGrade: 3 });
    const missed = review(good, 1, NOW);
    expect(missed).toMatchObject({ box: 1, dueAt: NOW.toISOString(), reviews: 2, lapses: 1 });
  });

  it('says when a card comes back', () => {
    expect([0, 1, 3, 7, 14].map(comesBack)).toEqual(['היום', 'מחר', 'בעוד 3 ימים', 'בעוד שבוע', 'בעוד שבועיים']);
  });

  it('warms up with the shakiest due cards first, five at most, never retired ones', () => {
    vi.setSystemTime(NOW);
    const yesterday = new Date(2026, 9, 21).toISOString();
    const tomorrow = new Date(2026, 9, 23).toISOString();
    const cards = [
      card('box3', { box: 3, dueAt: yesterday }),
      card('box1-common', { box: 1, dueAt: yesterday }, { leadCount: 4 }),
      card('box1', { box: 1, dueAt: yesterday }),
      card('later', { box: 2, dueAt: tomorrow }),
      card('retired', { box: 1, dueAt: yesterday }, { retired: true }),
      ...['a', 'b', 'c'].map((id) => card(id, { box: 2, dueAt: yesterday })),
    ];
    expect(dueCards(cards).map((item) => item.id)).toEqual(['box1-common', 'box1', 'a', 'b', 'c', 'box3']);
    expect(warmUp(cards).map((item) => item.id)).toEqual(['box1-common', 'box1', 'a', 'b', 'c']);
    vi.useRealTimers();
  });
});
