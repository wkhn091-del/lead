import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import type { PoolCandidate, Stores } from '../stores/types.js';
import { dayKey, nextDay, startOfDay } from './time.js';

export interface DailyQueueView {
  /** The day in APP_TIMEZONE, like "2026-10-22" */
  date: string;
  startsAt: Date;
  endsAt: Date;
  /** Today's leads, in the order they were drawn */
  leadIds: string[];
  /** Leads still waiting in the pool for another day */
  poolSize: number;
  quota: number;
}

/**
 * Uncontacted leads: at Cold Call, never picked up, not marked not relevant, and not already tried today.
 * A lead that answered without booking a Zoom is followed up by hand, not drawn again at random.
 */
export function eligible(candidates: PoolCandidate[], startsAt: Date, exclude: ReadonlySet<string>): string[] {
  return candidates
    .filter((lead) => !lead.archivedAt && !lead.answered && !exclude.has(lead.id))
    .filter((lead) => !lead.lastAttemptAt || lead.lastAttemptAt < startsAt)
    .map((lead) => lead.id);
}

/** A uniformly random pick of `count` ids (partial Fisher-Yates with a cryptographic source). */
export function sample(ids: readonly string[], count: number): string[] {
  const pool = [...ids];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * Today's queue. The first request of the day draws `quota` random leads from the pool; later requests
 * return the same leads. If the pool was short when the day started, later imports top the queue up.
 */
export async function todaysQueue(stores: Stores, now: Date): Promise<DailyQueueView> {
  const { timeZone, dailyQuota: quota } = config;
  const date = dayKey(now, timeZone);
  const startsAt = startOfDay(date, timeZone);
  const endsAt = startOfDay(nextDay(date), timeZone);
  const view = (leadIds: string[], poolSize: number): DailyQueueView => ({ date, startsAt, endsAt, leadIds, poolSize, quota });

  // A few tries, in case another device draws or tops up the same day at the same moment.
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await stores.daily.find(date);
    const queued = existing?.leadIds ?? [];
    const pool = eligible(await stores.leads.poolCandidates(), startsAt, new Set(queued));
    const missing = quota - queued.length;
    if (existing && (missing <= 0 || pool.length === 0)) return view(queued, pool.length);

    const picked = sample(pool, missing);
    const leadIds = [...queued, ...picked];
    const saved = existing
      ? await stores.daily.extend(date, existing.version, leadIds)
      : await stores.daily.create(date, leadIds);
    if (saved) return view(leadIds, pool.length - picked.length);
  }
  throw new Error("Couldn't prepare today's queue.");
}
