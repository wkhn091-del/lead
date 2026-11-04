import type { DailyQueue, Lead } from '../types';
import { safeStorage } from './storage';

/**
 * A small copy of the leads in localStorage, which can be read before the first render: the app opens straight on
 * the board, without waiting for IndexedDB (lib/kept.ts, the full copy, a moment later) or for a server that's
 * waking up (Render's free plan sleeps). Each lead keeps only its latest steps, enough for where it stands on the
 * board; the full copy and the server's answer replace it as they come.
 *
 * localStorage also holds the outbox (store/sync.ts), which must always fit: the copy is kept small, is left out
 * when it would be too big, and gives its place up whenever the outbox needs it (forgetQuickCopy).
 */

const KEY = 'omek-crm:quick:v1';
/** Latest steps kept per lead: its status, its missed calls in a row, today's outcome and the Undo */
const STEPS_KEPT = 12;
/** Largest copy kept, in characters (localStorage holds about 5 million in all) */
const MAX_LENGTH = 1_200_000;

export interface QuickCopy {
  /** When the server sent these leads (ms) */
  savedAt: number;
  leads: Lead[];
  daily: DailyQueue | null;
}

export function readQuickCopy(): QuickCopy | null {
  try {
    const copy = JSON.parse(safeStorage.get(KEY) ?? 'null') as QuickCopy | null;
    return copy && typeof copy.savedAt === 'number' && Array.isArray(copy.leads) ? copy : null;
  } catch {
    return null;
  }
}

/** Keeps the copy; true when it fit */
export function saveQuickCopy(copy: QuickCopy): boolean {
  for (const steps of [STEPS_KEPT, 3]) {
    const text = JSON.stringify({ ...copy, leads: copy.leads.map((lead) => ({ ...lead, activity: lead.activity.slice(0, steps) })) });
    if (text.length <= MAX_LENGTH) {
      if (safeStorage.set(KEY, text)) return true;
      break;
    }
  }
  // Too big, or the storage is full: no copy rather than an old one
  forgetQuickCopy();
  return false;
}

export const forgetQuickCopy = () => safeStorage.remove(KEY);
