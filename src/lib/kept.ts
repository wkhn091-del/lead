import type { DailyQueue, Features, Lead, LeadPulse, LeadTimeline, TrainingDeck } from '../types';
import { idb } from './idb';

/**
 * The copy of the server's data kept on this device (IndexedDB), so the app opens at once, even with no signal or
 * while the server is waking up, and shows what it showed last time. The server's answer replaces it as soon as
 * it comes. Kept only when the leads live on a server; deleted on signing out.
 */

const SNAPSHOT = 'snapshot:v1';
const TIMELINE = 'timeline:v1:';
const TIMELINE_ORDER = 'timelines:v1';
/** Timelines kept: the ones opened most recently */
export const TIMELINES_KEPT = 40;

export interface Snapshot {
  /** Who it belongs to */
  email: string | null;
  /** When it was kept (ms) */
  savedAt: number;
  leads: Lead[];
  daily: DailyQueue | null;
  features: Features | null;
  pulses: LeadPulse[] | null;
  deck: TrainingDeck | null;
}

export interface KeptTimeline extends LeadTimeline {
  savedAt: number;
}

export const kept = {
  snapshot: () => idb.get<Snapshot>(SNAPSHOT),
  saveSnapshot: (snapshot: Snapshot) => idb.set(SNAPSHOT, snapshot),

  timeline: (leadId: string) => idb.get<KeptTimeline>(TIMELINE + leadId),
  /** Keeps a lead's timeline, and lets go of the ones opened longest ago */
  async saveTimeline(leadId: string, timeline: LeadTimeline) {
    await idb.set(TIMELINE + leadId, { ...timeline, savedAt: Date.now() } satisfies KeptTimeline);
    const order = [leadId, ...((await idb.get<string[]>(TIMELINE_ORDER)) ?? []).filter((id) => id !== leadId)];
    await idb.set(TIMELINE_ORDER, order.slice(0, TIMELINES_KEPT));
    for (const id of order.slice(TIMELINES_KEPT)) await idb.remove(TIMELINE + id);
  },

  /** Everything kept, for signing out */
  clear: () => idb.clear(),
};
