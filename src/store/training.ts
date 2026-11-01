import { create } from 'zustand';
import { repository } from '../data/repository';
import { count, joinList, NOUNS } from '../lib/hebrew';
import { readLanguage } from '../lib/language';
import { nicheKey, nicheOf } from '../lib/niche';
import { overlayCards } from '../lib/outbox';
import { allActive, review, warmUp } from '../lib/practice';
import { safeStorage } from '../lib/storage';
import type { CoachLanguage, Grade, NicheVariants, ObjectionCard, ObjectionVariant, TrainingDeck, TrainingNiche } from '../types';
import { handleOutbox, useSync } from './sync';
import { useTimeline } from './timeline';
import { toast } from './toasts';

export type SessionMode = 'warm-up' | 'deck' | 'card';

export interface PracticeSession {
  mode: SessionMode;
  /** Cards still to answer, in order. A missed card goes to the back once. */
  queue: string[];
  /** Answered so far, in order */
  answered: { cardId: string; grade: Grade }[];
  /** Missed once this session, so they come back only once */
  retried: string[];
  total: number;
  flipped: boolean;
}

/** A niche's tailored answers, as far as they've loaded */
export interface NicheState {
  status: 'loading' | 'ready' | 'error';
  data: NicheVariants | null;
  error: string | null;
}

interface TrainingState {
  deck: TrainingDeck | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  generating: boolean;
  session: PracticeSession | null;
  /** The niche the answers are tailored to, or null for the general ones. Remembered on this device. */
  niche: string | null;
  /** Your leads' niches, and the ones already tailored */
  niches: TrainingNiche[] | null;
  /** Tailored answers, by niche key */
  tailored: Record<string, NicheState>;
  load: () => Promise<void>;
  /** Shows the deck kept on this device (store/offline.ts) until the server answers */
  hydrate: (deck: TrainingDeck) => void;
  /** Builds or refreshes the deck from past conversations with the AI coach */
  generate: (language: CoachLanguage) => Promise<boolean>;
  /** Starts practising: the warm-up (due cards), the whole deck, or one card. False when there's nothing to practise. */
  start: (mode: SessionMode, cardId?: string) => boolean;
  flip: () => void;
  /** Grades the card on top, shows the next one and saves in the background */
  grade: (grade: Grade) => void;
  stop: () => void;
  saveResponse: (cardId: string, myResponse: string) => Promise<boolean>;
  /** Answers tailored to this niche from now on (null: the general answers) */
  setNiche: (niche: string | null) => void;
  loadNiches: () => Promise<void>;
  /** Loads the chosen niche's tailored answers, and keeps checking while they're being written */
  loadVariants: (niche: string) => Promise<NicheState>;
  /** Has the AI coach rewrite the deck's answers for the chosen niche */
  tailor: (language: CoachLanguage) => Promise<boolean>;
  /**
   * Practice for calls to one niche, from a lead's profile or the day's warm-up: chooses the niche, starts the
   * warm-up (or the whole deck when nothing is due) and has the answers tailored if they aren't yet.
   */
  practiceNiche: (niche: string) => Promise<void>;
  reset: () => void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');

const NICHE_KEY = 'omek-crm:training-niche';
const readNiche = () => {
  const stored = safeStorage.get(NICHE_KEY);
  return stored && nicheOf(stored) ? nicheOf(stored) : null;
};

/** How often a niche being tailored is checked on: the server writes, this only asks how it's going */
const POLL_MS = 3000;
const pollers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tailoring needs the server and its AI coach */
export const canTailor = () => repository.kind === 'remote' && Boolean(useTimeline.getState().features?.coach);

export const useTraining = create<TrainingState>()((set, get) => {
  const replaceCard = (card: ObjectionCard) =>
    set((state) => (state.deck ? { deck: { ...state.deck, cards: state.deck.cards.map((item) => (item.id === card.id ? card : item)) } } : {}));
  const setNicheState = (key: string, next: NicheState) => set((state) => ({ tailored: { ...state.tailored, [key]: next } }));
  /** The deck as the server sent it, with answers and grades still on their way shown on top */
  const withPending = (deck: TrainingDeck): TrainingDeck => ({ ...deck, cards: overlayCards(deck.cards, useSync.getState().pendingOps()) });
  const cardWithPending = (card: ObjectionCard) => overlayCards([card], useSync.getState().pendingOps())[0] ?? card;

  // Grades and your own answers go through the outbox (store/sync.ts), so practice without a connection counts too
  handleOutbox('card-review', {
    send: (op) => repository.reviewCard(op.cardId, op.grade, op.at),
    saved: (_op, card) => {
      if (card) replaceCard(cardWithPending(card as ObjectionCard));
    },
    refused: (_op, _message, rollback) => (rollback ? rollback() : void get().load()),
  });
  handleOutbox('card-response', {
    send: (op) => repository.saveCardResponse(op.cardId, op.myResponse),
    saved: (_op, card) => {
      if (card) replaceCard(cardWithPending(card as ObjectionCard));
    },
    refused: (_op, _message, rollback) => (rollback ? rollback() : void get().load()),
  });

  /** Checks on a niche every few seconds until its answers are written, then says how it went */
  const watch = (niche: string) => {
    const key = nicheKey(niche);
    if (pollers.has(key)) return;
    const tick = async () => {
      pollers.delete(key);
      try {
        const data = await repository.nicheVariants(niche);
        setNicheState(key, { status: 'ready', data, error: null });
        if (data.tailoring) {
          pollers.set(key, setTimeout(() => void tick(), POLL_MS));
          return;
        }
        if (data.error) toast.error(`לא הצלחנו להתאים את התשובות ל${data.niche.label}.`, data.error);
        else if (data.variants.length) {
          toast.success(`התשובות מותאמות ל${data.niche.label}`, `${count(data.variants.length, NOUNS.card)} עם תשובה בשפה של ${data.niche.label}.`);
        }
        void get().loadNiches();
      } catch {
        // Offline for a moment: ask again
        pollers.set(key, setTimeout(() => void tick(), POLL_MS * 2));
      }
    };
    pollers.set(key, setTimeout(() => void tick(), POLL_MS));
  };

  return {
    deck: null,
    status: 'idle',
    error: null,
    generating: false,
    session: null,
    niche: readNiche(),
    niches: null,
    tailored: {},

    async load() {
      if (get().status === 'loading') return;
      set((state) => ({ status: state.deck ? 'ready' : 'loading', error: null }));
      try {
        set({ deck: withPending(await repository.trainingDeck()), status: 'ready', error: null });
      } catch (error) {
        set((state) => ({ status: state.deck ? 'ready' : 'error', error: messageOf(error) }));
      }
    },

    hydrate(deck) {
      if (!get().deck) set({ deck: withPending(deck), status: 'ready', error: null });
    },

    async generate(language) {
      if (get().generating) return false;
      set({ generating: true });
      try {
        const deck = await repository.generateDeck(language);
        set({ deck, status: 'ready', error: null });
        const active = deck.cards.filter((card) => !card.retired).length;
        const found = deck.run?.cards ?? 0;
        const read = deck.run
          ? joinList([count(deck.run.leadsAnalyzed, NOUNS.lead), ...(deck.run.conversations ? [count(deck.run.conversations, NOUNS.call)] : [])])
          : '';
        toast.show({
          message: found === 0 ? 'לא נמצאו התנגדויות בשיחות שלך' : found === 1 ? 'התנגדות אחת מהשיחות שלך' : `${found} התנגדויות מהשיחות שלך`,
          description: `${read ? `המאמן קרא ${read}. ` : ''}בחפיסה יש עכשיו ${count(active, NOUNS.objection)}.`,
        });
        return true;
      } catch (error) {
        toast.error('לא הצלחנו לבנות את החפיסה.', messageOf(error));
        return false;
      } finally {
        set({ generating: false });
      }
    },

    start(mode, cardId) {
      const cards = get().deck?.cards ?? [];
      const picked =
        mode === 'card' ? cards.filter((card) => card.id === cardId) : mode === 'warm-up' ? warmUp(cards) : allActive(cards);
      if (!picked.length) return false;
      set({ session: { mode, queue: picked.map((card) => card.id), answered: [], retried: [], total: picked.length, flipped: false } });
      return true;
    },

    flip() {
      set((state) => (state.session ? { session: { ...state.session, flipped: !state.session.flipped } } : {}));
    },

    grade(grade) {
      const { session, deck } = get();
      const cardId = session?.queue[0];
      const card = deck?.cards.find((item) => item.id === cardId);
      if (!session || !cardId || !card) return;

      // Missed cards come back at the end of the session, once
      const again = grade === 1 && !session.retried.includes(cardId);
      const queue = [...session.queue.slice(1), ...(again ? [cardId] : [])];
      set({
        session: {
          ...session,
          queue,
          answered: [...session.answered, { cardId, grade }],
          retried: again ? [...session.retried, cardId] : session.retried,
          flipped: false,
        },
      });

      // Shown at once; the server's schedule (in its time zone) replaces it when the answer is saved. The time goes
      // along, so an answer given offline counts when it was given, and once however many times it's sent.
      const at = new Date();
      replaceCard({ ...card, practice: review(card.practice, grade, at) });
      useSync.getState().enqueue({ kind: 'card-review', cardId, grade, at: at.toISOString() }, { rollback: () => replaceCard(card) });
    },

    stop() {
      set({ session: null });
    },

    async saveResponse(cardId, myResponse) {
      const card = get().deck?.cards.find((item) => item.id === cardId);
      if (!card) return false;
      replaceCard({ ...card, myResponse });
      useSync.getState().enqueue({ kind: 'card-response', cardId, myResponse }, { rollback: () => replaceCard(card) });
      return true;
    },

    setNiche(niche) {
      const value = niche && nicheOf(niche) ? nicheOf(niche) : null;
      if (value) safeStorage.set(NICHE_KEY, value);
      else safeStorage.remove(NICHE_KEY);
      set({ niche: value });
      if (value) void get().loadVariants(value);
    },

    async loadNiches() {
      try {
        const { niches, tailoring } = await repository.trainingNiches();
        set({ niches });
        // Tailoring started elsewhere (another tab, before a reload) is followed too
        for (const key of tailoring) {
          const known = niches.find((item) => item.key === key);
          if (known) watch(known.label);
        }
      } catch {
        // The list stays as it was; the picker still takes a niche typed in
      }
    },

    async loadVariants(niche) {
      const key = nicheKey(niche);
      const current = get().tailored[key];
      setNicheState(key, { status: current?.data ? 'ready' : 'loading', data: current?.data ?? null, error: null });
      try {
        const data = await repository.nicheVariants(niche);
        const next: NicheState = { status: 'ready', data, error: null };
        setNicheState(key, next);
        if (data.tailoring) watch(niche);
        return next;
      } catch (error) {
        const next: NicheState = { status: current?.data ? 'ready' : 'error', data: current?.data ?? null, error: messageOf(error) };
        setNicheState(key, next);
        return next;
      }
    },

    async tailor(language) {
      const niche = get().niche;
      if (!niche) return false;
      const key = nicheKey(niche);
      try {
        const data = await repository.tailorDeck(niche, language);
        setNicheState(key, { status: 'ready', data, error: null });
        if (data.tailoring) watch(niche);
        return true;
      } catch (error) {
        toast.error(`לא הצלחנו להתאים את התשובות ל${niche}.`, messageOf(error));
        return false;
      }
    },

    async practiceNiche(niche) {
      const label = nicheOf(niche);
      if (!label) {
        if (!get().start('warm-up')) get().start('deck');
        return;
      }
      get().setNiche(label);
      if (!get().start('warm-up')) get().start('deck');
      const state = await get().loadVariants(label);
      // No answers for this niche yet: have them written while practice starts with the general ones
      if (state.status === 'ready' && state.data && !state.data.variants.length && !state.data.tailoring && canTailor()) {
        void get().tailor(readLanguage());
      }
    },

    reset() {
      for (const timer of pollers.values()) clearTimeout(timer);
      pollers.clear();
      set({ deck: null, status: 'idle', error: null, generating: false, session: null, niches: null, tailored: {} });
    },
  };
});

/** The answer tailored to the chosen niche for this card, if there is one */
export function useVariant(card: Pick<ObjectionCard, 'key'>): ObjectionVariant | null {
  return useTraining((s) => (s.niche ? (s.tailored[nicheKey(s.niche)]?.data?.variants.find((variant) => variant.cardKey === card.key) ?? null) : null));
}
