import { describe, expect, it } from 'vitest';
import { STARTER_CARDS } from '../../server/src/training/starter';
import { createStarterDeck, rewordCommon } from './starterDeck';

describe('the starter deck kept in this browser', () => {
  it('takes the current words for the common objections, keeping practice and your own answer', () => {
    const deck = createStarterDeck(Date.parse('2026-10-01T08:00:00Z'));
    const current = deck.cards.find((card) => card.key === 'too-expensive')!;
    const raised = deck.cards.find((card) => card.key === 'already-have-website')!;
    const saved = {
      ...deck,
      cards: deck.cards.map((card) =>
        card === current
          ? { ...card, response: 'ואפשר גם לפרוס את התשלום.', myResponse: 'My own answer', practice: { ...card.practice, box: 3 } }
          : card === raised
            ? { ...card, response: 'From your calls', leadCount: 2 }
            : card,
      ),
    };

    const reworded = rewordCommon(saved, Date.parse('2026-10-27T08:00:00Z'))!;
    const expensive = reworded.cards.find((card) => card.key === 'too-expensive')!;
    expect(expensive).toMatchObject({
      response: STARTER_CARDS.find((card) => card.key === 'too-expensive')!.response,
      myResponse: 'My own answer',
      practice: { box: 3 },
      updatedAt: '2026-10-27T08:00:00.000Z',
    });
    expect(reworded.cards.find((card) => card.key === 'already-have-website')).toMatchObject({ response: 'From your calls' });
    // Nothing left to change
    expect(rewordCommon(reworded)).toBeNull();
  });
});
