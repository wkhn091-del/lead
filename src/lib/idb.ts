/**
 * A small key-value store in IndexedDB, for copies too large for localStorage (the whole lead list). Every call
 * resolves even when IndexedDB is missing or refuses (a private window, an embedded preview): reads come back
 * undefined and writes do nothing, and the app works online as before.
 */

const DB_NAME = 'omek-crm';
const STORE = 'kv';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = action(transaction.objectStore(STORE));
          transaction.oncomplete = () => resolve(request.result);
          transaction.onerror = () => resolve(undefined);
          transaction.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const idb = {
  get: <T>(key: string) => run<T>('readonly', (store) => store.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) => run('readwrite', (store) => store.put(value, key)).then(() => undefined),
  remove: (key: string) => run('readwrite', (store) => store.delete(key)).then(() => undefined),
  keys: () => run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()).then((keys) => (keys ?? []).map(String)),
  clear: () => run('readwrite', (store) => store.clear()).then(() => undefined),
};
