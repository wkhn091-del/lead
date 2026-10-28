import type { Grade, ObjectionCard, PracticeState } from '../types';

// Spaced repetition for objection cards, Leitner style. The same rules as server/src/training/practice.ts;
// with a server, it schedules (in APP_TIMEZONE) and this only previews and orders.

/** Days until a card in each box comes back: box 1 every session, box 5 after two weeks */
export const BOX_DAYS = [0, 1, 3, 7, 14] as const;
export const TOP_BOX = BOX_DAYS.length;
/** Cards in a warm-up before the day's calls */
export const WARM_UP_SIZE = 5;

export const GRADES: { grade: Grade; label: string; key: string; tone: string }[] = [
  { grade: 1, label: 'לא ידעתי', key: '1', tone: 'var(--st-lost)' },
  { grade: 2, label: 'קשה', key: '2', tone: 'var(--st-no-answer)' },
  { grade: 3, label: 'טוב', key: '3', tone: 'var(--st-cold)' },
  { grade: 4, label: 'קל', key: '4', tone: 'var(--st-won)' },
];

const startOfLocalDay = (date: Date, plusDays = 0) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + plusDays);

/** Box and days until the card comes back after this answer */
export function nextStep(practice: Pick<PracticeState, 'box'>, grade: Grade): { box: number; days: number } {
  const current = Math.min(Math.max(practice.box, 1), TOP_BOX);
  const box = grade === 1 ? 1 : grade === 2 ? current : Math.min(TOP_BOX, current + (grade === 4 ? 2 : 1));
  const days = grade === 1 ? 0 : grade === 2 ? Math.max(1, Math.floor(BOX_DAYS[box - 1] / 2)) : BOX_DAYS[box - 1];
  return { box, days };
}

/** The card's practice after one answer, counted in this browser's days */
export function review(practice: PracticeState, grade: Grade, now = new Date()): PracticeState {
  const { box, days } = nextStep(practice, grade);
  return {
    box,
    dueAt: (days === 0 ? now : startOfLocalDay(now, days)).toISOString(),
    reviews: practice.reviews + 1,
    lapses: practice.lapses + (grade === 1 ? 1 : 0),
    lastGrade: grade,
    lastReviewedAt: now.toISOString(),
  };
}

/** "היום", "מחר", "בעוד 3 ימים", "בעוד שבועיים": when a grade would bring the card back */
export function comesBack(days: number): string {
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'בעוד יומיים';
  if (days % 7 === 0) return days === 7 ? 'בעוד שבוע' : days === 14 ? 'בעוד שבועיים' : `בעוד ${days / 7} שבועות`;
  return `בעוד ${days} ימים`;
}

export const isDue = (card: ObjectionCard, now = Date.now()) => !card.retired && Date.parse(card.practice.dueAt) <= now;

/** Cards to practise now: the shakiest first, then the most common */
export function dueCards(cards: readonly ObjectionCard[], now = Date.now()): ObjectionCard[] {
  return cards
    .filter((card) => isDue(card, now))
    .sort((a, b) => a.practice.box - b.practice.box || b.leadCount - a.leadCount || Date.parse(a.practice.dueAt) - Date.parse(b.practice.dueAt));
}

/** The warm-up before the Daily 10: up to five due cards */
export const warmUp = (cards: readonly ObjectionCard[], now = Date.now()) => dueCards(cards, now).slice(0, WARM_UP_SIZE);

/** Every active card, for practising the whole deck */
export const allActive = (cards: readonly ObjectionCard[]) =>
  cards.filter((card) => !card.retired).sort((a, b) => a.practice.box - b.practice.box || b.leadCount - a.leadCount);

export const CATEGORY_LABEL: Record<ObjectionCard['category'], string> = {
  price: 'מחיר',
  timing: 'תזמון',
  trust: 'אמון',
  need: 'אין צורך',
  authority: 'לא מקבל ההחלטות',
  competition: 'מתחרים',
  diy: 'יעשו לבד',
  other: 'אחר',
};
