import { create } from 'zustand';
import { repository } from '../data/repository';
import type { Reminder } from '../lib/dashboard';
import { safeStorage } from '../lib/storage';
import type { LeadPulse } from '../types';

interface DashboardState {
  /** By lead id; null until loaded */
  pulses: ReadonlyMap<string, LeadPulse> | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Reminders put off, by id, until a time (ms). Remembered on this device. */
  snoozed: Readonly<Record<string, number>>;
  /** Loads the pulses. Quiet: keeps showing the ones it has meanwhile. */
  load: () => Promise<void>;
  /** Shows the pulses kept on this device (store/offline.ts) until the server answers */
  hydrate: (pulses: LeadPulse[]) => void;
  /** "לא עכשיו" until tomorrow; a renewal marked handled stays away until its date has passed */
  dismiss: (reminder: Pick<Reminder, 'id' | 'kind' | 'due'>) => void;
  reset: () => void;
}

const SNOOZE_KEY = 'omek-crm:snoozed:v1';
const DAY = 86_400_000;

function readSnoozed(now = Date.now()): Record<string, number> {
  try {
    const stored = JSON.parse(safeStorage.get(SNOOZE_KEY) ?? '{}') as Record<string, unknown>;
    // Expired ones are dropped as they're read
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > now));
  } catch {
    return {};
  }
}

const startOfTomorrow = (now = Date.now()) => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

export const useDashboard = create<DashboardState>()((set, get) => ({
  pulses: null,
  status: 'idle',
  error: null,
  snoozed: readSnoozed(),

  async load() {
    if (get().status === 'loading') return;
    set((state) => ({ status: state.pulses ? 'ready' : 'loading', error: null }));
    try {
      const { pulses } = await repository.dashboard();
      set({ pulses: new Map(pulses.map((pulse) => [pulse.leadId, pulse])), status: 'ready', error: null, snoozed: readSnoozed() });
    } catch (error) {
      set((state) => ({ status: state.pulses ? 'ready' : 'error', error: error instanceof Error ? error.message : 'שגיאה לא ידועה' }));
    }
  },

  hydrate(pulses) {
    if (!get().pulses) set({ pulses: new Map(pulses.map((pulse) => [pulse.leadId, pulse])), status: 'ready', error: null });
  },

  dismiss(reminder) {
    const until = reminder.kind === 'renewal' && reminder.due ? reminder.due + DAY : startOfTomorrow();
    const snoozed = { ...readSnoozed(), [reminder.id]: until };
    safeStorage.set(SNOOZE_KEY, JSON.stringify(snoozed));
    set({ snoozed });
  },

  reset() {
    set({ pulses: null, status: 'idle', error: null });
  },
}));
