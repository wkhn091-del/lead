import { describe, expect, it, vi } from 'vitest';
import type { Grade, ObjectionCard, TrainingDeck } from '../types';

// A deck of three due cards, and a server that can refuse an answer or be out of reach
const state = vi.hoisted(() => ({ reviews: [] as { cardId: string; grade: number; at?: string }[], refuseNext: false, offline: false }));

vi.mock('../data/repository', async () => {
  const { ApiError } = await import('../data/repository/http');
  const card = (id: string, box: number): ObjectionCard => ({
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
    practice: { box, dueAt: '2026-01-01T00:00:00.000Z', reviews: 0, lapses: 0, lastGrade: null, lastReviewedAt: null },
    retired: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const deck: TrainingDeck = { run: null, cards: [card('a', 1), card('b', 1), card('c', 2)] };
  return {
    repository: {
      kind: 'remote',
      trainingDeck: async () => structuredClone(deck),
      async reviewCard(cardId: string, grade: Grade, at?: string) {
        if (state.offline) throw new ApiError(0, 'אין חיבור לשרת.');
        state.reviews.push({ cardId, grade, at });
        if (state.refuseNext) {
          state.refuseNext = false;
          throw new ApiError(404, 'הכרטיסייה הזו כבר לא בחפיסה.');
        }
        const saved = structuredClone(deck.cards.find((item) => item.id === cardId)!);
        saved.practice = { ...saved.practice, box: 9, reviews: 1 };
        return saved;
      },
    },
  };
});

const { useTraining } = await import('../store/training');
const { useSync } = await import('../store/sync');

describe('a practice session', () => {
  it('brings a missed card back once at the end, and keeps the server’s schedule', async () => {
    await useTraining.getState().load();
    expect(useTraining.getState().start('warm-up')).toBe(true);
    const queue = () => useTraining.getState().session!.queue;
    expect(queue()).toEqual(['a', 'b', 'c']);

    useTraining.getState().flip();
    useTraining.getState().grade(1); // missed: comes back at the end
    expect(queue()).toEqual(['b', 'c', 'a']);
    expect(useTraining.getState().session!.flipped).toBe(false);

    useTraining.getState().grade(3);
    useTraining.getState().grade(4);
    useTraining.getState().grade(1); // missed again: not a third time
    expect(queue()).toEqual([]);
    expect(useTraining.getState().session!.answered.map((item) => item.grade)).toEqual([1, 3, 4, 1]);

    await vi.waitFor(() => expect(useTraining.getState().deck!.cards.find((item) => item.id === 'b')!.practice.box).toBe(9));
  });

  it('puts the card back as it was when the server refuses the answer', async () => {
    const before = useTraining.getState().deck!.cards.find((item) => item.id === 'c')!.practice;
    useTraining.getState().start('card', 'c');
    state.refuseNext = true;
    useTraining.getState().grade(4);
    await vi.waitFor(() => expect(useTraining.getState().deck!.cards.find((item) => item.id === 'c')!.practice).toEqual(before));
    expect(useSync.getState().dropped[0]).toMatchObject({ op: { kind: 'card-review', cardId: 'c' } });
  });

  it('keeps an answer given without a connection, and sends it with its time once the server answers', async () => {
    const card = () => useTraining.getState().deck!.cards.find((item) => item.id === 'a')!;
    const reviews = card().practice.reviews;
    state.offline = true;
    useTraining.getState().start('card', 'a');
    useTraining.getState().grade(3);
    await vi.waitFor(() => expect(useSync.getState().items[0]?.attempts).toBe(1));
    // Still counted on screen, and waiting to be sent
    expect(card().practice.reviews).toBe(reviews + 1);
    expect(useSync.getState()).toMatchObject({ offline: true });

    state.offline = false;
    await useSync.getState().flush();
    expect(useSync.getState().items).toEqual([]);
    expect(state.reviews.at(-1)).toMatchObject({ cardId: 'a', grade: 3, at: card().practice.lastReviewedAt ?? expect.any(String) });
  });

  it('has nothing to start when no card is due', () => {
    useTraining.setState({ deck: { run: null, cards: [] } });
    expect(useTraining.getState().start('warm-up')).toBe(false);
  });
});
