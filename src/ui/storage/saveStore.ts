/**
 * Where save text is kept in the browser.
 *
 * Uses IndexedDB. If the browser refuses (some private modes do), it
 * falls back to memory so the game still runs; saves are then lost when
 * the tab closes, and the UI says so.
 */
export interface SaveStore {
  /** False when saves will not survive closing the tab. */
  readonly persistent: boolean;
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB_NAME = 'project-null';
const STORE = 'saves';

export function createMemoryStore(): SaveStore {
  const data = new Map<string, string>();
  return {
    persistent: false,
    read: async (key) => data.get(key) ?? null,
    write: async (key, text) => void data.set(key, text),
    remove: async (key) => void data.delete(key),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Save storage is blocked by another tab.'));
  });
}

export async function openSaveStore(): Promise<SaveStore> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return createMemoryStore();
  }

  const run = <T,>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

  return {
    persistent: true,
    read: async (key) => {
      const value = await run('readonly', (store) => store.get(key));
      return typeof value === 'string' ? value : null;
    },
    write: async (key, text) => void (await run('readwrite', (store) => store.put(text, key))),
    remove: async (key) => void (await run('readwrite', (store) => store.delete(key))),
  };
}
