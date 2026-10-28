import { create } from 'zustand';
import { repository } from '../data/repository';
import { kept, type Snapshot } from '../lib/kept';
import type { LeadTimeline } from '../types';
import { useAuth } from './auth';
import { useDashboard } from './dashboard';
import { useLeadStore } from './leads';
import { useTimeline } from './timeline';
import { useTraining } from './training';

/**
 * The leads always on this device (with a server; in local mode they already live in this browser):
 *
 * - The app keeps a copy of what it last loaded on this device (lib/kept.ts): the leads, today's calls, the
 *   dashboard, the practice deck, and the timelines opened lately.
 * - On opening, that copy shows at once, so a phone with no signal, or a server still waking up, still opens on
 *   the leads. If the session can't be checked yet, the app opens on the copy and checks again when the
 *   connection is back. If the session ended by itself, it still opens on the copy and asks to sign in again.
 *   Changes made meanwhile wait in the outbox (store/sync.ts).
 * - The server's answers replace the copy as they come, and the copy is kept up to date from them. Only signing
 *   out on purpose deletes it.
 */

interface OfflineState {
  /** When the copy shown was kept (ms), while the app is showing it instead of fresh data */
  keptAt: number | null;
}

export const useOffline = create<OfflineState>()(() => ({ keptAt: null }));

const SAVE_DELAY_MS = 1200;
const RECHECK_MS = 30_000;

let started = false;

/** Shows the kept copy at once, and opens the app on it if the session can't be confirmed yet. Call once, at start. */
export async function startFromKeptCopy(): Promise<void> {
  if (started || repository.kind !== 'remote') return;
  started = true;
  keepUpToDate();
  watchSession();
  // Asks the browser to keep this site's storage even when the phone runs low on space (installed apps get it)
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Not offered here; the copy is kept as long as the browser allows
  }
  const snapshot = await kept.snapshot();
  if (!snapshot?.leads) return;
  // The session ended by itself (the copy is deleted only by signing out on purpose): open on the copy anyway,
  // and ask to sign in again to send what's written. Otherwise, open on it while the session is checked.
  if (useAuth.getState().status === 'signed-out') useAuth.getState().keepOnDevice(snapshot.email);
  else useAuth.getState().resumeOffline(snapshot.email);
  if (useAuth.getState().status !== 'signed-in') return;
  useOffline.setState({ keptAt: snapshot.savedAt });
  useLeadStore.getState().hydrate(snapshot.leads, snapshot.daily);
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
    const auth = useAuth.getState();
    // Only once this session has heard from the server, so a copy is never kept of nothing
    if (!syncedAt || loadState !== 'ready' || auth.status !== 'signed-in') return;
    const pulses = useDashboard.getState().pulses;
    const snapshot: Snapshot = {
      email: auth.email,
      savedAt: syncedAt,
      leads,
      daily,
      features: useTimeline.getState().features,
      pulses: pulses ? [...pulses.values()] : null,
      deck: useTraining.getState().deck,
    };
    void kept.saveSnapshot(snapshot);
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

/** In on the kept copy: checks the session again when the connection comes back, and every half minute */
function watchSession() {
  const recheck = () => {
    if (useAuth.getState().offline) void useAuth.getState().check();
  };
  window.addEventListener('online', recheck);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheck());
  setInterval(recheck, RECHECK_MS);
}
