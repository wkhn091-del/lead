/** This browser's localStorage (a page's window's, or the global one where there is no window, as in tests) */
export const localStore = (): Storage => (typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage);

/** localStorage access that never throws (private windows, blocked storage, sandboxed frames). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStore().getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStore().setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStore().removeItem(key);
    } catch {
      // Storage is unavailable; nothing to remove.
    }
  },
};
