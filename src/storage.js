/**
 * Local storage for entries, their pictures and sketches, and their version
 * history. Both implementations share one async contract, so a future
 * account-backed store can replace them without touching the UI:
 *
 *   kind: 'indexeddb' | 'memory' | (future: 'remote')
 *   list()                     -> Promise<Entry[]>    newest first, without pictures or sketches
 *   listFull()                 -> Promise<Entry[]>    every entry with its pictures and sketches (backups)
 *   get(id)                    -> Promise<Entry|null> with its pictures and sketches
 *   save(entry)                -> Promise<Entry>      upserts by id; writes the entry's media too
 *   remove(id)                 -> Promise<void>       also removes the entry's versions and media
 *   listVersions(entryId)      -> Promise<Version[]>  newest first
 *   latestVersion(entryId)     -> Promise<Version|null>
 *   listAllVersions()          -> Promise<Version[]>
 *   saveVersion(version, keep) -> Promise<void>       then drops all but the newest `keep` for that entry
 *   removeVersion(id)          -> Promise<void>
 *
 * Pictures and sketches live in their own `media` store, so the entries list
 * reads small rows and never touches image bytes. A picture is written once and
 * kept until its entry is deleted, so every version can still show it. A sketch
 * is rewritten on save, because its strokes change while you draw.
 */

import { compareEntries, normalizeEntry } from './model.js';

const DB_NAME = 'quire';
const DB_VERSION = 3;
const STORE = 'entries';
const VERSIONS = 'versions';
const MEDIA = 'media';
const BY_ENTRY_TIME = 'entryAt';
const BY_ENTRY = 'entryId';

/** Key range covering every version of one entry, ordered by savedAt. */
const entryRange = (entryId) => IDBKeyRange.bound([entryId, ''], [entryId, '￿']);
const byTimeAscending = (a, b) => a.savedAt.localeCompare(b.savedAt);

/** Primary key of one picture or sketch: its entry, its kind, and its id. */
export const mediaKey = (entryId, kind, id) => `${entryId}/${kind}/${id}`;

/** The entry row as it is stored: everything except pictures and sketches. */
export function rowOf(entry) {
  const { images: _images, sketches: _sketches, ...row } = normalizeEntry(entry);
  return row;
}

/** Store records for an entry's pictures and sketches. */
export function imageRecord(entryId, id, src) {
  return { key: mediaKey(entryId, 'image', id), entryId, kind: 'image', id, src };
}

export function sketchRecord(entryId, id, sketch) {
  return { key: mediaKey(entryId, 'sketch', id), entryId, kind: 'sketch', id, h: sketch.h, ops: sketch.ops };
}

/** Rebuilds a full entry from its row and its media records. Shared by both stores and by the upgrade. */
export function entryFromStorage(row, records = []) {
  const images = {};
  const sketches = {};
  for (const record of records) {
    if (record.kind === 'image') images[record.id] = record.src;
    else sketches[record.id] = { h: record.h, ops: record.ops };
  }
  return normalizeEntry({ ...row, images, sketches });
}

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

/** Runs `work(tx)` in one read-only transaction and resolves with what it returns. */
async function readTransaction(db, names, work) {
  const tx = db.transaction(names, 'readonly');
  const result = await work(tx);
  await transactionDone(tx);
  return result;
}

/**
 * Writes an entry's pictures and sketches inside an open transaction. Sketches
 * are always written, because their strokes change. A picture is written only
 * when it is not stored yet, since a picture never changes once added.
 */
function writeMedia(media, entry) {
  for (const [id, sketch] of Object.entries(entry.sketches ?? {})) {
    media.put(sketchRecord(entry.id, id, sketch));
  }
  const images = Object.entries(entry.images ?? {});
  if (!images.length) return;
  const stored = media.index(BY_ENTRY).getAllKeys(IDBKeyRange.only(entry.id));
  stored.onsuccess = () => {
    const have = new Set(stored.result);
    for (const [id, src] of images) {
      if (!have.has(mediaKey(entry.id, 'image', id))) media.put(imageRecord(entry.id, id, src));
    }
  };
}

/**
 * Upgrade to version 3: moves pictures and sketches out of the entry rows into
 * the media store. Runs inside the upgrade transaction, so it finishes or not at all.
 */
function moveMediaOutOfRows(tx) {
  const rows = tx.objectStore(STORE);
  const media = tx.objectStore(MEDIA);
  const cursorRequest = rows.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const { images, sketches, ...row } = cursor.value;
    if (images || sketches) {
      for (const [id, src] of Object.entries(images ?? {})) {
        media.put(imageRecord(row.id, id, src));
      }
      for (const [id, sketch] of Object.entries(sketches ?? {})) {
        if (sketch && typeof sketch === 'object') media.put(sketchRecord(row.id, id, sketch));
      }
      cursor.update(row);
    }
    cursor.continue();
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(VERSIONS)) {
        const versions = db.createObjectStore(VERSIONS, { keyPath: 'id' });
        versions.createIndex(BY_ENTRY_TIME, ['entryId', 'savedAt']);
      }
      if (!db.objectStoreNames.contains(MEDIA)) {
        const media = db.createObjectStore(MEDIA, { keyPath: 'key' });
        media.createIndex(BY_ENTRY, 'entryId');
      }
      if (event.oldVersion > 0 && event.oldVersion < 3) moveMediaOutOfRows(request.transaction);
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

  /** The media records of one entry. */
  const mediaOf = (tx, entryId) => requestToPromise(tx.objectStore(MEDIA).index(BY_ENTRY).getAll(IDBKeyRange.only(entryId)));

  return {
    kind: 'indexeddb',
    async list() {
      const rows = await run('readonly', (store) => requestToPromise(store.getAll()));
      return rows.map((row) => normalizeEntry(row)).sort(compareEntries);
    },
    async listFull() {
      return readTransaction(db, [STORE, MEDIA], async (tx) => {
        const rows = await requestToPromise(tx.objectStore(STORE).getAll());
        const records = await requestToPromise(tx.objectStore(MEDIA).getAll());
        const byEntry = new Map();
        for (const record of records) {
          if (!byEntry.has(record.entryId)) byEntry.set(record.entryId, []);
          byEntry.get(record.entryId).push(record);
        }
        return rows.map((row) => entryFromStorage(row, byEntry.get(row.id))).sort(compareEntries);
      });
    },
    async get(id) {
      return readTransaction(db, [STORE, MEDIA], async (tx) => {
        const row = await requestToPromise(tx.objectStore(STORE).get(id));
        if (!row) return null;
        return entryFromStorage(row, await mediaOf(tx, id));
      });
    },
    async save(entry) {
      const normalized = normalizeEntry(entry);
      await writeTransaction(db, [STORE, MEDIA], (tx) => {
        tx.objectStore(STORE).put(rowOf(normalized));
        writeMedia(tx.objectStore(MEDIA), normalized);
      });
      return normalized;
    },
    async remove(id) {
      await writeTransaction(db, [STORE, VERSIONS, MEDIA], (tx) => {
        tx.objectStore(STORE).delete(id);
        const versions = tx.objectStore(VERSIONS);
        const keys = versions.index(BY_ENTRY_TIME).getAllKeys(entryRange(id));
        keys.onsuccess = () => keys.result.forEach((key) => versions.delete(key));
        const media = tx.objectStore(MEDIA);
        const mediaKeys = media.index(BY_ENTRY).getAllKeys(IDBKeyRange.only(id));
        mediaKeys.onsuccess = () => mediaKeys.result.forEach((key) => media.delete(key));
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
  const media = new Map();
  const versions = new Map();
  const versionsOf = (entryId) =>
    [...versions.values()].filter((version) => version.entryId === entryId).sort(byTimeAscending);
  const mediaOf = (entryId) =>
    [...media.values()].filter((record) => record.entryId === entryId).map((record) => structuredClone(record));

  return {
    kind: 'memory',
    async list() {
      return [...rows.values()].map((row) => normalizeEntry(structuredClone(row))).sort(compareEntries);
    },
    async listFull() {
      return [...rows.values()]
        .map((row) => entryFromStorage(structuredClone(row), mediaOf(row.id)))
        .sort(compareEntries);
    },
    async get(id) {
      const row = rows.get(id);
      return row ? entryFromStorage(structuredClone(row), mediaOf(id)) : null;
    },
    async save(entry) {
      const normalized = normalizeEntry(entry);
      rows.set(normalized.id, structuredClone(rowOf(normalized)));
      for (const [id, sketch] of Object.entries(normalized.sketches)) {
        const record = sketchRecord(normalized.id, id, sketch);
        media.set(record.key, structuredClone(record));
      }
      for (const [id, src] of Object.entries(normalized.images)) {
        const key = mediaKey(normalized.id, 'image', id);
        if (!media.has(key)) media.set(key, imageRecord(normalized.id, id, src));
      }
      return normalized;
    },
    async remove(id) {
      rows.delete(id);
      for (const record of mediaOf(id)) media.delete(record.key);
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
