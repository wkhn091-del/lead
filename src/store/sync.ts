import { create } from 'zustand';
import { setReachabilityHandler } from '../data/repository/http';
import { copyText } from '../lib/clipboard';
import { createId } from '../lib/id';
import { retryDelay, verdictFor, writtenText, type DroppedItem, type OutboxItem, type OutboxKind, type OutboxOp } from '../lib/outbox';
import { localStore, safeStorage } from '../lib/storage';
import { toast } from './toasts';

/**
 * Sends the outbox (src/lib/outbox.ts): every change to leads, timelines and practice cards is kept on this device
 * first, then sent to the server one at a time, in the order it was made. When the server can't be reached (no
 * signal, or Render still waking up) the change waits and is sent again a little later, when the connection comes
 * back, or when the app is opened again: nothing written is lost on the way. A change the server refuses (the lead
 * was deleted meanwhile) is taken back on screen, with a way to copy what was written.
 *
 * Each change is stored under its own key, so two open tabs never overwrite each other's changes.
 */

const PREFIX = 'omek-crm:outbox:v1:';
const DROPPED_KEY = 'omek-crm:outbox-dropped:v1';
const DROPPED_LIMIT = 20;

/** What each kind of change does. Registered by the store that owns the data (leads, timeline, training). */
export interface OutboxHandler<O extends OutboxOp = OutboxOp> {
  send: (op: O) => Promise<unknown>;
  /** The server took it: its answer, or null when it had happened already */
  saved?: (op: O, result: unknown) => void;
  /**
   * The server refused it: take it back on screen. `rollback` is the undo made when it was written, when that was
   * in this session; after a reload the handler loads the server's copy instead.
   */
  refused?: (op: O, message: string, rollback: (() => void) | undefined) => void;
}

const handlers: { [K in OutboxKind]?: OutboxHandler<Extract<OutboxOp, { kind: K }>> } = {};

export function handleOutbox<K extends OutboxKind>(kind: K, handler: OutboxHandler<Extract<OutboxOp, { kind: K }>>) {
  (handlers as Record<string, unknown>)[kind] = handler;
}

/** Callers waiting for a change to be saved, and how to take it back; this session only */
const waiters = new Map<string, { resolve: (saved: boolean) => void; rollback?: () => void }>();
const settle = (id: string, saved: boolean) => {
  waiters.get(id)?.resolve(saved);
  waiters.delete(id);
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'שגיאה לא ידועה');

let sequence = 0;
/** Sorts in the order changes were made, across tabs too */
const keyFor = (item: OutboxItem) => `${PREFIX}${item.createdAt}:${item.id}`;

function readQueue(): OutboxItem[] {
  const items: OutboxItem[] = [];
  try {
    const storage = localStore();
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys.sort()) {
      const item = JSON.parse(storage.getItem(key) ?? 'null') as OutboxItem | null;
      if (item?.op?.kind) items.push(item);
    }
  } catch {
    // Storage unavailable (a private window): changes are kept in memory only
  }
  return items;
}

function readDropped(): DroppedItem[] {
  try {
    const stored = JSON.parse(safeStorage.get(DROPPED_KEY) ?? '[]') as DroppedItem[];
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

const REFUSED: Record<OutboxKind, string> = {
  'create-lead': 'הליד לא נשמר.',
  'update-lead': 'השינוי לא נשמר.',
  act: 'הצעד לא נשמר.',
  undo: 'הביטול לא נשמר.',
  'remove-lead': 'המחיקה לא בוצעה.',
  'remove-leads': 'המחיקה לא בוצעה.',
  'add-entry': 'הרשומה לא נשמרה.',
  'edit-entry': 'העריכה לא נשמרה.',
  'remove-entry': 'המחיקה לא בוצעה.',
  'card-review': 'הדירוג לא נשמר.',
  'card-response': 'התשובה שלך לא נשמרה.',
};

/** Offers what was written back, so a refused change never takes text with it */
export function copyWritten(op: OutboxOp) {
  const text = writtenText(op);
  if (text) void copyText(text, { copied: 'הטקסט הועתק', failed: 'לא הצלחנו להעתיק' });
}

interface SyncState {
  /** Changes waiting to be sent, oldest first */
  items: OutboxItem[];
  /** Changes the server refused, newest first */
  dropped: DroppedItem[];
  /** The change being sent right now */
  sending: string | null;
  /** The server can't be reached: no connection, or it didn't answer */
  offline: boolean;
  /** Failed tries in a row */
  failures: number;
  /** When the next try is due, while waiting after a failure */
  retryAt: number | null;
  /** Signed out: changes wait until signing in again */
  held: boolean;
  /** Keeps a change and sends it. `saved` settles with whether the server took it. */
  enqueue: (op: OutboxOp, options?: { rollback?: () => void }) => { id: string; saved: Promise<boolean> };
  /** Takes back the latest waiting change that matches, if it hasn't started sending. Returns it, or null. */
  cancel: (match: (op: OutboxOp) => boolean) => OutboxOp | null;
  /** The changes still waiting, oldest first, to show on top of what the server sends */
  pendingOps: () => OutboxOp[];
  /** Sends what's waiting, now */
  flush: () => Promise<void>;
  setHeld: (held: boolean) => void;
  setOffline: (offline: boolean) => void;
  dismissDropped: (id?: string) => void;
}

let busy = false;
let running: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;

export const useSync = create<SyncState>()((set, get) => {
  const store = (item: OutboxItem) => {
    safeStorage.set(keyFor(item), JSON.stringify(item));
  };
  const forget = (item: OutboxItem) => {
    safeStorage.remove(keyFor(item));
    set((state) => ({ items: state.items.filter((other) => other.id !== item.id) }));
  };
  const remember = (dropped: DroppedItem[]) => {
    safeStorage.set(DROPPED_KEY, JSON.stringify(dropped));
    set({ dropped });
  };

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void get().flush(), delay);
  }

  /** Sends what's waiting, oldest first, until it's all sent or the server can't take more for now */
  async function sendAll() {
    try {
      for (;;) {
        const { held, items } = get();
        const item = items[0];
        if (held || !item) return;
        const handler = handlers[item.op.kind] as OutboxHandler | undefined;
        if (!handler) {
          // Made by another version of the app, which knew a kind this one doesn't; it can't be sent from here
          forget(item);
          continue;
        }
        set({ sending: item.id });
        try {
          let result: unknown;
          try {
            result = await handler.send(item.op);
          } finally {
            set({ sending: null });
          }
          forget(item);
          set({ offline: false, failures: 0, retryAt: null });
          handler.saved?.(item.op, result);
          settle(item.id, true);
        } catch (error) {
          const message = messageOf(error);
          const verdict = verdictFor(item.op, error);
          if (verdict === 'retry') {
            const failures = get().failures + 1;
            const updated = { ...item, attempts: item.attempts + 1, error: message };
            // Unless it was taken back while it was on its way (an undone step)
            if (get().items.some((other) => other.id === item.id)) store(updated);
            const delay = retryDelay(failures);
            set((state) => ({
              items: state.items.map((other) => (other.id === item.id ? updated : other)),
              offline: true,
              failures,
              retryAt: Date.now() + delay,
            }));
            schedule(delay);
            return;
          }
          if (verdict === 'signed-out') {
            set({ held: true });
            return;
          }
          forget(item);
          if (verdict === 'done') {
            handler.saved?.(item.op, null);
            settle(item.id, true);
            continue;
          }
          handler.refused?.(item.op, message, waiters.get(item.id)?.rollback);
          settle(item.id, false);
          remember([{ id: item.id, op: item.op, reason: message, at: new Date().toISOString() }, ...get().dropped].slice(0, DROPPED_LIMIT));
          toast.show({
            tone: 'error',
            duration: 12_000,
            message: REFUSED[item.op.kind],
            description: message,
            ...(writtenText(item.op) ? { action: { label: 'העתקת מה שכתבת', onClick: () => copyWritten(item.op) } } : {}),
          });
        }
      }
    } finally {
      // Cleared in the same step the sending stops in, so a change made a moment before is never left for a
      // flush that already returned
      busy = false;
    }
  }

  return {
    items: readQueue(),
    dropped: readDropped(),
    sending: null,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    failures: 0,
    retryAt: null,
    held: false,

    enqueue(op, options = {}) {
      // Milliseconds plus a counter, so changes made in the same millisecond keep their order
      const createdAt = `${new Date().toISOString()}#${String(sequence++).padStart(6, '0')}`;
      const item: OutboxItem = { id: createId(), op, createdAt, attempts: 0, error: null };
      store(item);
      set((state) => ({ items: [...state.items, item] }));
      const saved = new Promise<boolean>((resolve) => waiters.set(item.id, { resolve, rollback: options.rollback }));
      // While waiting out a failure, the next try is already set; otherwise send now
      const { retryAt } = get();
      if (!retryAt || retryAt <= Date.now()) void get().flush();
      return { id: item.id, saved };
    },

    cancel(match) {
      const { items, sending } = get();
      const item = [...items].reverse().find((other) => other.id !== sending && match(other.op));
      if (!item) return null;
      forget(item);
      settle(item.id, false);
      return item.op;
    },

    pendingOps: () => get().items.map((item) => item.op),

    flush() {
      // Already sending: it takes whatever is waiting, including changes made meanwhile
      if (busy) return running;
      busy = true;
      clearTimeout(timer);
      set({ retryAt: null });
      running = sendAll();
      return running;
    },

    setHeld(held) {
      set({ held });
      if (!held) void get().flush();
    },

    setOffline(offline) {
      if (get().offline === offline) return;
      set({ offline });
      // The server answers again: what's waiting goes now, not when the wait after the last failure is over
      if (!offline && get().items.length) void get().flush();
    },

    dismissDropped(id) {
      remember(id ? get().dropped.filter((item) => item.id !== id) : []);
    },
  };
});

// Every answer from the server (or the lack of one) says whether it can be reached
setReachabilityHandler((reachable) => useSync.getState().setOffline(!reachable));

if (typeof window !== 'undefined') {
  // The connection is back, or the app is in front again: try now instead of waiting out the delay
  window.addEventListener('online', () => void useSync.getState().flush());
  window.addEventListener('offline', () => useSync.getState().setOffline(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && useSync.getState().items.length) void useSync.getState().flush();
  });
  // Another tab wrote or sent changes: take its list, so changes a closed tab left behind are sent from here
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith(PREFIX)) useSync.setState({ items: readQueue() });
  });
}
