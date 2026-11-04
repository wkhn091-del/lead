import { create } from 'zustand';
import { repository } from '../data/repository';
import { kept, type Snapshot } from '../lib/kept';
import { readQuickCopy, saveQuickCopy } from '../lib/quick-copy';
import type { LeadTimeline } from '../types';
import { useDashboard } from './dashboard';
import { useLeadStore } from './leads';
import { useTimeline } from './timeline';
import { useTraining } from './training';

/**
 * The leads always on this device (with a server; in local mode they already live in this browser):
 *
 * - The app keeps a copy of what it last loaded on this device (lib/kept.ts, in IndexedDB): the leads, today's
 *   calls, the dashboard, the practice deck, and the timelines opened lately. A smaller copy of the leads and
 *   today's calls is also kept in localStorage (lib/quick-copy.ts), because that one can be read at once.
 * - On opening, the small copy is on the screen from the first frame (showQuickCopy, from main.tsx), and the full
 *   one replaces it a moment later, so a phone with no signal, or a server still waking up, still opens on the
 *   leads; the app asks the server again until it answers (App.tsx). Changes made meanwhile wait in the outbox
 *   (store/sync.ts).
 * - The server's answers replace the copy as they come, and the copy is kept up to date from them.
 */

interface OfflineState {
  /** When the copy shown was kept (ms), while the app is showing it instead of fresh data */
  keptAt: number | null;
}

export const useOffline = create<OfflineState>()(() => ({ keptAt: null }));

const SAVE_DELAY_MS = 1200;

let started = false;

/**
 * Puts the small copy of the leads on the screen before the first render, so the app opens on the board at once.
 * Synchronous: call it before rendering (main.tsx).
 */
export function showQuickCopy(): void {
  if (repository.kind !== 'remote' || useLeadStore.getState().syncedAt) return;
  const copy = readQuickCopy();
  if (!copy?.leads.length) return;
  useOffline.setState({ keptAt: copy.savedAt });
  useLeadStore.getState().hydrate(copy.leads, copy.daily);
}

/** Shows the kept copy at once, while the server's answer is on its way. Call once, at start. */
export async function startFromKeptCopy(): Promise<void> {
  if (started || repository.kind !== 'remote') return;
  started = true;
  keepUpToDate();
  // Asks the browser to keep this site's storage even when the phone runs low on space (installed apps get it)
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Not offered here; the copy is kept as long as the browser allows
  }
  const snapshot = await kept.snapshot();
  // Nothing kept yet, or the server already answered: its leads are newer than the copy
  if (!snapshot?.leads || useLeadStore.getState().syncedAt) return;
  // The small copy may be on the screen already: the full one takes its place, unless it's older
  const shown = useOffline.getState().keptAt;
  if (shown === null || snapshot.savedAt >= shown) {
    useOffline.setState({ keptAt: snapshot.savedAt });
    useLeadStore.getState().hydrate(snapshot.leads, snapshot.daily);
  }
  useTimeline.getState().hydrate({}, snapshot.features);
  if (snapshot.pulses) useDashboard.getState().hydrate(snapshot.pulses);
  if (snapshot.deck) useTraining.getState().hydrate(snapshot.deck);
}

/** A lead's timeline as last kept, to show while the server's copy loads */
export async function keptTimeline(leadId: string): Promise<LeadTimeline | null> {
  if (repository.kind !== 'remote') return null;
  return (await kept.timeline(leadId)) ?? null;
}

/** Keeps the copy up to date with what the server sends, a moment after it changes */
function keepUpToDate() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    const { leads, daily, syncedAt, loadState } = useLeadStore.getState();
    // Only once this session has heard from the server, so a copy is never kept of nothing
    if (!syncedAt || loadState !== 'ready') return;
    const pulses = useDashboard.getState().pulses;
    const snapshot: Snapshot = {
      savedAt: syncedAt,
      leads,
      daily,
      features: useTimeline.getState().features,
      pulses: pulses ? [...pulses.values()] : null,
      deck: useTraining.getState().deck,
    };
    void kept.saveSnapshot(snapshot);
    saveQuickCopy({ savedAt: syncedAt, leads, daily });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  useLeadStore.subscribe((state, before) => {
    if (state.syncedAt && !before.syncedAt) useOffline.setState({ keptAt: null });
    if (state.leads !== before.leads || state.daily !== before.daily || state.syncedAt !== before.syncedAt) later();
  });
  useDashboard.subscribe((state, before) => state.pulses !== before.pulses && later());
  useTraining.subscribe((state, before) => state.deck !== before.deck && later());

  // Each timeline opened is kept as it loads and changes
  const savedTimelines = new Map<string, unknown>();
  useTimeline.subscribe((state, before) => {
    if (state.features !== before.features) later();
    if (state.profiles === before.profiles) return;
    for (const [leadId, profile] of Object.entries(state.profiles)) {
      if (profile.status !== 'ready' || savedTimelines.get(leadId) === profile || !useLeadStore.getState().syncedAt) continue;
      savedTimelines.set(leadId, profile);
      const { interactions, media, coaching } = profile;
      void kept.saveTimeline(leadId, { interactions, media, coaching });
    }
  });
}
