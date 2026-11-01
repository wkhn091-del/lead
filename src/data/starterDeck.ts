import { sameWording, STARTER_CARDS, wordingOf } from '../../server/src/training/starter';
import type { ObjectionCard, TrainingDeck } from '../types';

/**
 * The starter deck when the app runs without the server: the objections a web studio hears most on cold calls,
 * all due now. They are the same cards the server starts every new deck with (server/src/training/starter.ts);
 * there, the AI coach then adds the objections your own prospects raise.
 */
export function createStarterDeck(now = Date.now()): TrainingDeck {
  const at = new Date(now).toISOString();
  const cards = STARTER_CARDS.map(
    (card): ObjectionCard => ({
      id: `starter-${card.key}`,
      key: card.key,
      category: card.category,
      objection: card.objection,
      insight: card.insight,
      response: card.response,
      alternatives: [...card.alternatives],
      followUp: card.followUp,
      leadCount: 0,
      mentions: 0,
      sources: [],
      myResponse: '',
      practice: { box: 1, dueAt: at, reviews: 0, lapses: 0, lastGrade: null, lastReviewedAt: null },
      retired: false,
      createdAt: at,
      updatedAt: at,
    }),
  );
  return {
    run: { id: 'starter', provider: 'starter', model: 'starter', language: 'he', leadsAnalyzed: 0, entriesAnalyzed: 0, conversations: 0, cards: cards.length, createdAt: at },
    cards,
  };
}

/**
 * A deck saved in this browser, with the common objections in their current words (an update may have reworded
 * them, like TrainingStore.rewordCommon on the server): every card no lead raised, keeping its practice and your
 * own answer. Null when there was nothing to change.
 */
export function rewordCommon(deck: TrainingDeck, now = Date.now()): TrainingDeck | null {
  const byKey = new Map(STARTER_CARDS.map((card) => [card.key, card]));
  let changed = false;
  const cards = deck.cards.map((card) => {
    const starter = byKey.get(card.key);
    if (!starter || card.leadCount > 0 || sameWording(card, starter)) return card;
    changed = true;
    return { ...card, ...wordingOf(starter), updatedAt: new Date(now).toISOString() };
  });
  return changed ? { ...deck, cards } : null;
}

/** A card no lead of yours has raised yet: one of the common objections */
export const isCommonObjection = (card: Pick<ObjectionCard, 'leadCount'>) => card.leadCount === 0;
