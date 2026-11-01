import type { Lead } from '../types';
import { wasAnswered } from './workflow';

// The daily draw for leads kept in this browser. With a server, server/src/daily/queue.ts does this.

export interface LocalDay {
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/** Today in this browser's time zone */
export function localDay(now = new Date()): LocalDay {
  const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const date = [startsAt.getFullYear(), startsAt.getMonth() + 1, startsAt.getDate()]
    .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0'))
    .join('-');
  return { date, startsAt, endsAt };
}

/**
 * Uncontacted leads: at Cold Call, never picked up, not marked not relevant, not already tried today
 * and not already queued. A lead that answered without booking a Zoom is followed up by hand.
 */
export function eligibleForDraw(leads: readonly Lead[], startsAt: Date, exclude: ReadonlySet<string>): string[] {
  return leads
    .filter((lead) => lead.stage === 'cold_call' && !lead.archivedAt && !wasAnswered(lead) && !exclude.has(lead.id))
    .filter((lead) => !lead.lastAttemptAt || Date.parse(lead.lastAttemptAt) < startsAt.getTime())
    .map((lead) => lead.id);
}

function randomBelow(limit: number): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0] % limit;
  }
  return Math.floor(Math.random() * limit);
}

/** A uniformly random pick of `count` ids. */
export function sample(ids: readonly string[], count: number): string[] {
  const pool = [...ids];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + randomBelow(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}
