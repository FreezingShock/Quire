/**
 * Local storage for entries and their version history. Both implementations
 * share one async contract, so a future account-backed store can replace them
 * without touching the UI:
 *
 *   kind: 'indexeddb' | 'memory' | (future: 'remote')
 *   list()                     -> Promise<Entry[]>    newest first
 *   get(id)                    -> Promise<Entry|null>
 *   save(entry)                -> Promise<Entry>      upserts by id
 *   remove(id)                 -> Promise<void>       also removes the entry's versions
 *   listVersions(entryId)      -> Promise<Version[]>  newest first
 *   latestVersion(entryId)     -> Promise<Version|null>
 *   listAllVersions()          -> Promise<Version[]>
 *   saveVersion(version, keep) -> Promise<void>       then drops all but the newest `keep` for that entry
 *   removeVersion(id)          -> Promise<void>
 */

import { compareEntries, normalizeEntry } from './model.js';

const DB_NAME = 'quire';
const DB_VERSION = 2;
const STORE = 'entries';
const VERSIONS = 'versions';
const BY_ENTRY_TIME = 'entryAt';

/** Key range covering every version of one entry, ordered by savedAt. */
const entryRange = (entryId) => IDBKeyRange.bound([entryId, ''], [entryId, '￿']);
const byTimeAscending = (a, b) => a.savedAt.localeCompare(b.savedAt);

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

/** Runs `work(tx)` in one read-write transaction over `names` and resolves when it commits. */
function writeTransaction(db, names, work) {
  const tx = db.transaction(names, 'readwrite');
  work(tx);
  return transactionDone(tx);
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
      if (!db.objectStoreNames.contains(VERSIONS)) {
        const versions = db.createObjectStore(VERSIONS, { keyPath: 'id' });
        versions.createIndex(BY_ENTRY_TIME, ['entryId', 'savedAt']);
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
      await writeTransaction(db, [STORE, VERSIONS], (tx) => {
        tx.objectStore(STORE).delete(id);
        const versions = tx.objectStore(VERSIONS);
        const keys = versions.index(BY_ENTRY_TIME).getAllKeys(entryRange(id));
        keys.onsuccess = () => keys.result.forEach((key) => versions.delete(key));
      });
    },
    async listVersions(entryId) {
      const tx = db.transaction(VERSIONS, 'readonly');
      const rows = await requestToPromise(tx.objectStore(VERSIONS).index(BY_ENTRY_TIME).getAll(entryRange(entryId)));
      return rows.reverse(); // the index yields oldest first
    },
    async latestVersion(entryId) {
      const tx = db.transaction(VERSIONS, 'readonly');
      const cursor = await requestToPromise(tx.objectStore(VERSIONS).index(BY_ENTRY_TIME).openCursor(entryRange(entryId), 'prev'));
      return cursor ? cursor.value : null;
    },
    async listAllVersions() {
      const tx = db.transaction(VERSIONS, 'readonly');
      return requestToPromise(tx.objectStore(VERSIONS).getAll());
    },
    async saveVersion(version, keep) {
      await writeTransaction(db, VERSIONS, (tx) => {
        const store = tx.objectStore(VERSIONS);
        store.put(version);
        // Queued after the put, so the count includes the new version.
        const keys = store.index(BY_ENTRY_TIME).getAllKeys(entryRange(version.entryId));
        keys.onsuccess = () => {
          const stale = keys.result.slice(0, Math.max(0, keys.result.length - keep));
          for (const key of stale) store.delete(key);
        };
      });
    },
    async removeVersion(id) {
      await writeTransaction(db, VERSIONS, (tx) => tx.objectStore(VERSIONS).delete(id));
    },
  };
}

function createMemoryStore() {
  const rows = new Map();
  const versions = new Map();
  const versionsOf = (entryId) =>
    [...versions.values()].filter((version) => version.entryId === entryId).sort(byTimeAscending);

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
      for (const version of versionsOf(id)) versions.delete(version.id);
    },
    async listVersions(entryId) {
      return versionsOf(entryId).reverse().map((version) => structuredClone(version));
    },
    async latestVersion(entryId) {
      const list = versionsOf(entryId);
      const last = list[list.length - 1];
      return last ? structuredClone(last) : null;
    },
    async listAllVersions() {
      return [...versions.values()].map((version) => structuredClone(version));
    },
    async saveVersion(version, keep) {
      versions.set(version.id, structuredClone(version));
      const list = versionsOf(version.entryId);
      for (const stale of list.slice(0, Math.max(0, list.length - keep))) versions.delete(stale.id);
    },
    async removeVersion(id) {
      versions.delete(id);
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
