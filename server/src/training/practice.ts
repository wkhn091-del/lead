import { dayKey, startOfDay } from '../daily/time.js';
import type { PracticeState } from '../stores/types.js';

/**
 * Spaced repetition for the objection cards, Leitner style. A card you answer well moves up a box and comes
 * back later; a card you miss drops to box 1 and comes back in the next session. Days are counted in the
 * app's time zone, so a card due "tomorrow" is in tomorrow morning's warm-up, whatever time you practised.
 */

export const GRADES = [1, 2, 3, 4] as const;
export type Grade = (typeof GRADES)[number];

/** Days until a card in each box comes back: box 1 every session, box 5 after two weeks */
export const BOX_DAYS = [0, 1, 3, 7, 14] as const;
export const TOP_BOX = BOX_DAYS.length;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** The card's state after one answer: 1 missed, 2 hard, 3 good, 4 easy */
export function review(practice: PracticeState, grade: Grade, now: Date, timeZone: string): PracticeState {
  const current = Math.min(Math.max(practice.box, 1), TOP_BOX);
  const box = grade === 1 ? 1 : grade === 2 ? current : Math.min(TOP_BOX, current + (grade === 4 ? 2 : 1));
  const days = grade === 1 ? 0 : grade === 2 ? Math.max(1, Math.floor(BOX_DAYS[box - 1] / 2)) : BOX_DAYS[box - 1];
  return {
    box,
    // Missed cards are due again right away; the rest at the start of the day they come back
    dueAt: days === 0 ? now : startOfDay(addDays(dayKey(now, timeZone), days), timeZone),
    reviews: practice.reviews + 1,
    lapses: practice.lapses + (grade === 1 ? 1 : 0),
    lastGrade: grade,
    lastReviewedAt: now,
  };
}
