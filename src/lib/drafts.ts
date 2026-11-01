import { useCallback, useEffect, useRef, useState } from 'react';
import { localStore, safeStorage } from './storage';

/**
 * Drafts of what's being typed, kept on this device as it's typed, so nothing is lost when the page reloads: a
 * phone call that sent the browser to the background, a closed tab, a crash. Each draft is restored where it was
 * written and forgotten once it's saved (or after a month).
 */

const PREFIX = 'omek-crm:draft:v1:';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Stored<T> {
  value: T;
  savedAt: number;
}

export const drafts = {
  read<T>(key: string): T | null {
    try {
      const stored = JSON.parse(safeStorage.get(PREFIX + key) ?? 'null') as Stored<T> | null;
      if (!stored || typeof stored.savedAt !== 'number') return null;
      if (Date.now() - stored.savedAt > MAX_AGE_MS) {
        safeStorage.remove(PREFIX + key);
        return null;
      }
      return stored.value;
    } catch {
      return null;
    }
  },
  write<T>(key: string, value: T) {
    safeStorage.set(PREFIX + key, JSON.stringify({ value, savedAt: Date.now() } satisfies Stored<T>));
  },
  clear(key: string) {
    safeStorage.remove(PREFIX + key);
  },
  /** Forgets drafts older than a month, so the device doesn't collect them */
  prune() {
    try {
      const storage = localStore();
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) drafts.read(key.slice(PREFIX.length));
    } catch {
      // Storage unavailable: nothing kept to forget
    }
  },
};

/**
 * State that is also kept as a draft under `key` (null: not kept). Starts from the kept draft when there is one.
 * `isEmpty` decides when there's nothing worth keeping, so an untouched form leaves no draft behind.
 * Returns the value, a setter, a way to forget the draft (after saving), and whether it started from a draft.
 */
export function useDraft<T>(
  key: string | null,
  initial: T | (() => T),
  isEmpty: (value: T) => boolean,
): [T, (next: T | ((current: T) => T)) => void, () => void, boolean] {
  const [restored] = useState(() => (key ? drafts.read<T>(key) : null));
  const [value, setValue] = useState<T>(() => restored ?? (typeof initial === 'function' ? (initial as () => T)() : initial));
  const keyRef = useRef(key);
  keyRef.current = key;
  const emptyRef = useRef(isEmpty);
  emptyRef.current = isEmpty;

  const set = useCallback((next: T | ((current: T) => T)) => {
    setValue((current) => {
      const updated = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
      const draftKey = keyRef.current;
      if (draftKey) {
        if (emptyRef.current(updated)) drafts.clear(draftKey);
        else drafts.write(draftKey, updated);
      }
      return updated;
    });
  }, []);

  const forget = useCallback(() => {
    if (keyRef.current) drafts.clear(keyRef.current);
  }, []);

  // A different draft (another lead's): start from that one
  const firstKey = useRef(key);
  useEffect(() => {
    if (key === firstKey.current) return;
    firstKey.current = key;
    const kept = key ? drafts.read<T>(key) : null;
    setValue(kept ?? (typeof initial === 'function' ? (initial as () => T)() : initial));
    // `initial` is read only when the key changes
  }, [key]);

  return [value, set, forget, restored !== null && !isEmpty(restored)];
}
