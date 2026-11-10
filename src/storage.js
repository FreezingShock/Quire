/**
 * Local storage for entries. Both implementations share one async contract, so
 * a future account-backed store can replace them without touching the UI:
 *
 *   kind: 'indexeddb' | 'memory' | (future: 'remote')
 *   list()        -> Promise<Entry[]>   newest first
 *   get(id)       -> Promise<Entry|null>
 *   save(entry)   -> Promise<Entry>     upserts by id
 *   remove(id)    -> Promise<void>
 */

import { compareEntries, normalizeEntry } from './model.js';

const DB_NAME = 'quire';
const DB_VERSION = 1;
const STORE = 'entries';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createIndexedDBStore(db) {
  const run = async (mode, operation) => {
    const tx = db.transaction(STORE, mode);
    const result = await operation(tx.objectStore(STORE));
    await transactionDone(tx);
    return result;
  };

  return {
    kind: 'indexeddb',
    async list() {
      const rows = await run('readonly', (store) => requestToPromise(store.getAll()));
      return rows.map(normalizeEntry).sort(compareEntries);
    },
    async get(id) {
      const row = await run('readonly', (store) => requestToPromise(store.get(id)));
      return row ? normalizeEntry(row) : null;
    },
    async save(entry) {
      const normalized = normalizeEntry(entry);
      await run('readwrite', (store) => requestToPromise(store.put(normalized)));
      return normalized;
    },
    async remove(id) {
      await run('readwrite', (store) => requestToPromise(store.delete(id)));
    },
  };
}

function createMemoryStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async list() {
      return [...rows.values()].map((row) => structuredClone(row)).sort(compareEntries);
    },
    async get(id) {
      const row = rows.get(id);
      return row ? structuredClone(row) : null;
    },
    async save(entry) {
      const normalized = normalizeEntry(entry);
      rows.set(normalized.id, structuredClone(normalized));
      return normalized;
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

/** Opens IndexedDB, falling back to memory (with `kind: 'memory'`) if the browser blocks it. */
export async function createLocalStore() {
  try {
    return createIndexedDBStore(await openDatabase());
  } catch (error) {
    console.warn('Quire: IndexedDB unavailable, using memory storage.', error);
    return createMemoryStore();
  }
}
