/**
 * Recording files for leads kept in this browser. They go to IndexedDB, which holds large files;
 * where it is blocked (some private windows and embedded previews) they stay in memory until the tab closes.
 */
export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  remove(ids: readonly string[]): Promise<void>;
}

const DB_NAME = 'omek-crm-recordings';
const STORE = 'files';

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
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
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void) {
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error('הדפדפן לא הצליח לשמור את הקובץ.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('לדפדפן נגמר המקום להקלטות.'));
  });
}

export function createBlobStore(): BlobStore {
  const memory = new Map<string, Blob>();
  let database: Promise<IDBDatabase | null> | undefined;
  const open = () => (database ??= openDatabase());

  return {
    async put(id, blob) {
      const db = await open();
      if (!db) {
        memory.set(id, blob);
        return;
      }
      await run(db, 'readwrite', (store) => store.put(blob, id));
    },
    async get(id) {
      if (memory.has(id)) return memory.get(id) ?? null;
      const db = await open();
      if (!db) return null;
      const blob = await run<Blob | undefined>(db, 'readonly', (store) => store.get(id) as IDBRequest<Blob | undefined>);
      return blob ?? null;
    },
    async remove(ids) {
      for (const id of ids) memory.delete(id);
      const db = await open();
      if (db && ids.length) await run(db, 'readwrite', (store) => ids.forEach((id) => store.delete(id)));
    },
  };
}
