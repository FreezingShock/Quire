/**
 * Local storage for entries, their pictures and sketches, and their version
 * history. Both implementations share one async contract, so a future
 * account-backed store can replace them without touching the UI:
 *
 *   kind: 'indexeddb' | 'memory' | (future: 'remote')
 *   list()                     -> Promise<Entry[]>    newest first, without pictures or sketches; desk drawer entries are left out
 *   listTrash()                -> Promise<Entry[]>    the desk drawer: entries with a deletedAt time, newest deletion first
 *   setTrashed(id, deletedAt)  -> Promise<void>       puts an entry in the desk drawer (an ISO time), or takes it out (null). Pictures, sketches and versions stay put
 *   listFull()                 -> Promise<Entry[]>    every entry, drawer included, with its pictures and sketches (backups)
 *   get(id)                    -> Promise<Entry|null> any entry, drawer included, with its pictures and sketches
 *   save(entry)                -> Promise<Entry>      upserts by id; writes the entry's media too
 *   remove(id)                 -> Promise<void>       removes for good: also the entry's versions and media
 *   listVersions(entryId)      -> Promise<Version[]>  newest first
 *   latestVersion(entryId)     -> Promise<Version|null>
 *   listAllVersions()          -> Promise<Version[]>
 *   saveVersion(version, keep) -> Promise<void>       then drops all but the newest `keep` for that entry
 *   removeVersion(id)          -> Promise<void>
 *   setCipher(vault | null)    -> void                null stores plain rows; a vault (see vault.js) seals them
 *   reseal(vault | null)       -> Promise<void>       rewrites every row, picture and version under that cipher, in one transaction
 *   getMeta / setMeta / removeMeta(key)  -> small records kept beside the rows (the passcode lock lives here)
 *   getNote / setNote(text)    -> the sticky note's text, sealed with the rows when the lock is on
 *   getHabits / setHabits(state) -> the habit tracker's list and checks, sealed the same way
 *   getSavedSearches / setSavedSearches(list) -> the sidebar's saved searches, sealed the same way
 *   clear()                    -> Promise<void>       erases every row and record
 *
 * Pictures and sketches live in their own `media` store, so the entries list
 * reads small rows and never touches image bytes. A picture is written once and
 * kept until its entry is deleted, so every version can still show it. A sketch
 * is rewritten on save, because its strokes change while you draw.
 *
 * Until setCipher is called, the store is locked: reading or writing throws
 * LockedError. The app sets the cipher once it knows whether a passcode is
 * needed, so nothing is written in the clear by accident.
 */

import { compareEntries, normalizeEntry } from './model.js';

const DB_NAME = 'quire';
const DB_VERSION = 4;
const STORE = 'entries';
const VERSIONS = 'versions';
const MEDIA = 'media';
const META = 'meta';
const BY_ENTRY_TIME = 'entryAt';
const BY_ENTRY = 'entryId';

const LOCKED = Symbol('locked');

/** The sticky note's record in the meta store. Its text is sealed like entries when the lock is on. */
const NOTE_META = 'sticky-note';
/** The habit tracker's record in the meta store. Sealed like the note when the lock is on. */
const HABITS_META = 'habits';
/** The saved searches in the sidebar. They can hold words from the entries, so they are sealed like the rest. */
const SAVED_SEARCHES_META = 'saved-searches';
// Set once the voice notes older versions copied have moved into the entries. See migrateVersionClips.
const VOICE_CLIPS_META = 'voice-clips-moved';

/** Live entries are the ones not in the desk drawer. */
const isLive = (entry) => !entry.deletedAt;
const isTrashed = (entry) => Boolean(entry.deletedAt);
const newestDeletionFirst = (a, b) => b.deletedAt.localeCompare(a.deletedAt);

export class LockedError extends Error {
  constructor() {
    super('Quire is locked. Enter your passcode to open your entries.');
    this.name = 'LockedError';
  }
}

/** Key range covering every version of one entry, ordered by savedAt. */
const entryRange = (entryId) => IDBKeyRange.bound([entryId, ''], [entryId, '￿']);
const byTimeAscending = (a, b) => a.savedAt.localeCompare(b.savedAt);

/** Primary key of one picture or sketch: its entry, its kind, and its id. */
export const mediaKey = (entryId, kind, id) => `${entryId}/${kind}/${id}`;

/** The entry row as it is stored: everything except pictures and sketches. */
export function rowOf(entry) {
  const row = { ...normalizeEntry(entry) };
  delete row.images;
  delete row.audio;
  delete row.sketches;
  return row;
}

/** Store records for an entry's pictures, voice notes and sketches. */
export function imageRecord(entryId, id, src) {
  return { key: mediaKey(entryId, 'image', id), entryId, kind: 'image', id, src };
}

export function audioRecord(entryId, id, src) {
  return { key: mediaKey(entryId, 'audio', id), entryId, kind: 'audio', id, src };
}

export function sketchRecord(entryId, id, sketch) {
  return { key: mediaKey(entryId, 'sketch', id), entryId, kind: 'sketch', id, h: sketch.h, ops: sketch.ops };
}

/** Rebuilds a full entry from its row and its media records. Shared by both stores and by the upgrade. */
export function entryFromStorage(row, records = []) {
  const images = {};
  const audio = {};
  const sketches = {};
  for (const record of records) {
    if (record.kind === 'image') images[record.id] = record.src;
    else if (record.kind === 'audio') audio[record.id] = record.src;
    else sketches[record.id] = { h: record.h, ops: record.ops };
  }
  return normalizeEntry({ ...row, images, audio, sketches });
}

/**
 * Turns rows, media records and versions into the stored shape, and back. With
 * no cipher they are stored as they are. With a cipher, the content moves into
 * `sealed`, and the fields the store indexes or keys on (ids, entry ids, version
 * times) stay readable. Each stored row carries its own shape, so an open can
 * read a row written before the lock was turned on.
 */
function createCodec() {
  let cipher = LOCKED;
  const active = () => {
    if (cipher === LOCKED) throw new LockedError();
    return cipher;
  };
  const openSealed = async (scope, id, sealed) => {
    const vault = active();
    if (!vault) throw new Error('An encrypted entry was found, but the passcode lock is off. Turn the lock back on to open it.');
    return vault.open(scope, id, sealed);
  };
  return {
    set(next) {
      cipher = next;
    },
    /** Throws LockedError until a cipher (or null for plain rows) has been set. */
    ready() {
      active();
    },
    current: () => cipher,
    async encodeRow(row) {
      const vault = active();
      return vault ? { id: row.id, sealed: await vault.seal('entry', row.id, row) } : row;
    },
    async decodeRow(stored) {
      return stored.sealed ? openSealed('entry', stored.id, stored.sealed) : stored;
    },
    async encodeMedia(record) {
      const vault = active();
      return vault ? { key: record.key, entryId: record.entryId, sealed: await vault.seal('media', record.key, record) } : record;
    },
    async decodeMedia(stored) {
      return stored.sealed ? openSealed('media', stored.key, stored.sealed) : stored;
    },
    async encodeVersion(version) {
      const vault = active();
      if (!vault) return version;
      const { id, entryId, savedAt, reason, content } = version;
      return { id, entryId, savedAt, sealed: await vault.seal('version', id, { reason, content }) };
    },
    async decodeVersion(stored) {
      if (!stored.sealed) return stored;
      const { reason, content } = await openSealed('version', stored.id, stored.sealed);
      return { id: stored.id, entryId: stored.entryId, savedAt: stored.savedAt, reason, content };
    },
    async encodeNote(text) {
      const vault = active();
      return vault ? { sealed: await vault.seal('note', NOTE_META, { text }) } : { text };
    },
    /** The note's text. Empty when nothing is saved. */
    async decodeNote(stored) {
      if (!stored) return '';
      if (!stored.sealed) return stored.text ?? '';
      const { text } = await openSealed('note', NOTE_META, stored.sealed);
      return text ?? '';
    },
    async encodeHabits(state) {
      const vault = active();
      return vault ? { sealed: await vault.seal('habits', HABITS_META, { state }) } : { state };
    },
    /** The habit state, or null when none is saved. */
    async decodeHabits(stored) {
      if (!stored) return null;
      if (!stored.sealed) return stored.state ?? null;
      const { state } = await openSealed('habits', HABITS_META, stored.sealed);
      return state ?? null;
    },
    async encodeSavedSearches(list) {
      const vault = active();
      return vault ? { sealed: await vault.seal('saved-searches', SAVED_SEARCHES_META, { list }) } : { list };
    },
    /** The saved searches list, or null when none is saved. */
    async decodeSavedSearches(stored) {
      if (!stored) return null;
      if (!stored.sealed) return stored.list ?? null;
      const { list } = await openSealed('saved-searches', SAVED_SEARCHES_META, stored.sealed);
      return list ?? null;
    },
  };
}

/**
 * Entries from stored rows and media records. Both are decoded first, so the
 * same code serves the IndexedDB store and the memory store.
 */
async function assembleEntries(codec, rows, records) {
  const decodedRows = await Promise.all(rows.map((row) => codec.decodeRow(row)));
  const decodedRecords = await Promise.all(records.map((record) => codec.decodeMedia(record)));
  const byEntry = new Map();
  for (const record of decodedRecords) {
    if (!byEntry.has(record.entryId)) byEntry.set(record.entryId, []);
    byEntry.get(record.entryId).push(record);
  }
  return decodedRows.map((row) => entryFromStorage(row, byEntry.get(row.id))).sort(compareEntries);
}

/**
 * The media records to write for an entry. Sketches are always written, because
 * their strokes change. A picture is written only when it is not stored yet, so
 * `storedKeys` holds the keys already on disk.
 */
async function encodeMediaFor(codec, entry, storedKeys) {
  const out = [];
  for (const [id, sketch] of Object.entries(entry.sketches ?? {})) {
    out.push(await codec.encodeMedia(sketchRecord(entry.id, id, sketch)));
  }
  for (const [id, src] of Object.entries(entry.images ?? {})) {
    if (!storedKeys.has(mediaKey(entry.id, 'image', id))) out.push(await codec.encodeMedia(imageRecord(entry.id, id, src)));
  }
  // A voice note is written once, like a picture. Its bytes never change after it is recorded.
  for (const [id, src] of Object.entries(entry.audio ?? {})) {
    if (!storedKeys.has(mediaKey(entry.id, 'audio', id))) out.push(await codec.encodeMedia(audioRecord(entry.id, id, src)));
  }
  return out;
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
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
      if (event.oldVersion > 0 && event.oldVersion < 3) moveMediaOutOfRows(request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createIndexedDBStore(db) {
  const codec = createCodec();

  return {
    kind: 'indexeddb',
    setCipher: (vault) => codec.set(vault),
    async reseal(next) {
      codec.ready();
      const previous = codec.current();
      try {
        const { rows, records, versions, note, habits, savedSearches } = await readTransaction(db, [STORE, MEDIA, VERSIONS, META], async (tx) => ({
          rows: await requestToPromise(tx.objectStore(STORE).getAll()),
          records: await requestToPromise(tx.objectStore(MEDIA).getAll()),
          versions: await requestToPromise(tx.objectStore(VERSIONS).getAll()),
          note: await requestToPromise(tx.objectStore(META).get(NOTE_META)),
          habits: await requestToPromise(tx.objectStore(META).get(HABITS_META)),
          savedSearches: await requestToPromise(tx.objectStore(META).get(SAVED_SEARCHES_META)),
        }));
        const plainRows = await Promise.all(rows.map((row) => codec.decodeRow(row)));
        const plainRecords = await Promise.all(records.map((record) => codec.decodeMedia(record)));
        const plainVersions = await Promise.all(versions.map((version) => codec.decodeVersion(version)));
        const plainNote = note ? await codec.decodeNote(note) : null;
        const plainHabits = habits ? await codec.decodeHabits(habits) : null;
        const plainSavedSearches = savedSearches ? await codec.decodeSavedSearches(savedSearches) : null;
        codec.set(next);
        const sealedRows = await Promise.all(plainRows.map((row) => codec.encodeRow(row)));
        const sealedRecords = await Promise.all(plainRecords.map((record) => codec.encodeMedia(record)));
        const sealedVersions = await Promise.all(plainVersions.map((version) => codec.encodeVersion(version)));
        const sealedNote = plainNote === null ? null : await codec.encodeNote(plainNote);
        const sealedHabits = plainHabits === null ? null : await codec.encodeHabits(plainHabits);
        const sealedSavedSearches = plainSavedSearches === null ? null : await codec.encodeSavedSearches(plainSavedSearches);
        // One transaction: either every row moves to the new cipher or none does.
        await writeTransaction(db, [STORE, MEDIA, VERSIONS, META], (tx) => {
          for (const row of sealedRows) tx.objectStore(STORE).put(row);
          for (const record of sealedRecords) tx.objectStore(MEDIA).put(record);
          for (const version of sealedVersions) tx.objectStore(VERSIONS).put(version);
          if (sealedNote) tx.objectStore(META).put(sealedNote, NOTE_META);
          if (sealedHabits) tx.objectStore(META).put(sealedHabits, HABITS_META);
          if (sealedSavedSearches) tx.objectStore(META).put(sealedSavedSearches, SAVED_SEARCHES_META);
        });
      } catch (error) {
        codec.set(previous); // rows still hold the old cipher, so keep writing with it
        throw error;
      }
    },
    async list() {
      codec.ready();
      const rows = await readTransaction(db, STORE, (tx) => requestToPromise(tx.objectStore(STORE).getAll()));
      const decoded = await Promise.all(rows.map((row) => codec.decodeRow(row)));
      return decoded.map((row) => normalizeEntry(row)).filter(isLive).sort(compareEntries);
    },
    async listTrash() {
      codec.ready();
      const rows = await readTransaction(db, STORE, (tx) => requestToPromise(tx.objectStore(STORE).getAll()));
      const decoded = await Promise.all(rows.map((row) => codec.decodeRow(row)));
      return decoded.map((row) => normalizeEntry(row)).filter(isTrashed).sort(newestDeletionFirst);
    },
    async setTrashed(id, deletedAt) {
      codec.ready();
      const row = await readTransaction(db, STORE, (tx) => requestToPromise(tx.objectStore(STORE).get(id)));
      if (!row) return;
      const plain = await codec.decodeRow(row);
      const sealed = await codec.encodeRow({ ...plain, deletedAt });
      await writeTransaction(db, STORE, (tx) => tx.objectStore(STORE).put(sealed));
    },
    async listFull() {
      codec.ready();
      const { rows, records } = await readTransaction(db, [STORE, MEDIA], async (tx) => ({
        rows: await requestToPromise(tx.objectStore(STORE).getAll()),
        records: await requestToPromise(tx.objectStore(MEDIA).getAll()),
      }));
      return assembleEntries(codec, rows, records);
    },
    async get(id) {
      codec.ready();
      const found = await readTransaction(db, [STORE, MEDIA], async (tx) => {
        const row = await requestToPromise(tx.objectStore(STORE).get(id));
        if (!row) return null;
        const records = await requestToPromise(tx.objectStore(MEDIA).index(BY_ENTRY).getAll(IDBKeyRange.only(id)));
        return { row, records };
      });
      if (!found) return null;
      const [entry] = await assembleEntries(codec, [found.row], found.records);
      return entry;
    },
    async save(entry) {
      codec.ready();
      const normalized = normalizeEntry(entry);
      const row = await codec.encodeRow(rowOf(normalized));
      const storedKeys = new Set(
        await readTransaction(db, MEDIA, (tx) => requestToPromise(tx.objectStore(MEDIA).index(BY_ENTRY).getAllKeys(IDBKeyRange.only(normalized.id)))),
      );
      const records = await encodeMediaFor(codec, normalized, storedKeys);
      await writeTransaction(db, [STORE, MEDIA], (tx) => {
        tx.objectStore(STORE).put(row);
        const media = tx.objectStore(MEDIA);
        for (const record of records) media.put(record);
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
      codec.ready();
      const tx = db.transaction(VERSIONS, 'readonly');
      const rows = await requestToPromise(tx.objectStore(VERSIONS).index(BY_ENTRY_TIME).getAll(entryRange(entryId)));
      return Promise.all(rows.reverse().map((row) => codec.decodeVersion(row))); // the index yields oldest first
    },
    async latestVersion(entryId) {
      codec.ready();
      const tx = db.transaction(VERSIONS, 'readonly');
      const cursor = await requestToPromise(tx.objectStore(VERSIONS).index(BY_ENTRY_TIME).openCursor(entryRange(entryId), 'prev'));
      return cursor ? codec.decodeVersion(cursor.value) : null;
    },
    async listAllVersions() {
      codec.ready();
      const tx = db.transaction(VERSIONS, 'readonly');
      const rows = await requestToPromise(tx.objectStore(VERSIONS).getAll());
      return Promise.all(rows.map((row) => codec.decodeVersion(row)));
    },
    async saveVersion(version, keep) {
      codec.ready();
      const row = await codec.encodeVersion(version);
      await writeTransaction(db, VERSIONS, (tx) => {
        const store = tx.objectStore(VERSIONS);
        store.put(row);
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
    /**
     * One-time move of voice notes out of version snapshots. Older versions kept
     * their own copy of each clip. A clip now lives in the media store, and a
     * version refers to it by id, the way a picture does. A clip the entry does
     * not hold yet is written first, so nothing is lost. Each step can run again:
     * a clip already stored is skipped, and the flag is set last. Returns how many
     * clips were moved.
     */
    async migrateVersionClips() {
      codec.ready();
      const flag = await readTransaction(db, META, (tx) => requestToPromise(tx.objectStore(META).get(VOICE_CLIPS_META)));
      if (flag) return 0;
      const rows = await readTransaction(db, VERSIONS, (tx) => requestToPromise(tx.objectStore(VERSIONS).getAll()));
      let moved = 0;
      for (const row of rows) {
        const version = await codec.decodeVersion(row);
        const { audio, ...content } = version.content ?? {};
        if (!audio) continue;
        for (const [id, src] of Object.entries(audio)) {
          const key = mediaKey(version.entryId, 'audio', id);
          const held = await readTransaction(db, MEDIA, (tx) => requestToPromise(tx.objectStore(MEDIA).get(key)));
          if (!held) {
            const record = await codec.encodeMedia(audioRecord(version.entryId, id, src));
            await writeTransaction(db, MEDIA, (tx) => tx.objectStore(MEDIA).put(record));
            moved += 1;
          }
        }
        const stripped = await codec.encodeVersion({ ...version, content });
        await writeTransaction(db, VERSIONS, (tx) => tx.objectStore(VERSIONS).put(stripped));
      }
      await writeTransaction(db, META, (tx) => tx.objectStore(META).put(true, VOICE_CLIPS_META));
      return moved;
    },
    async getMeta(key) {
      return (await readTransaction(db, META, (tx) => requestToPromise(tx.objectStore(META).get(key)))) ?? null;
    },
    async setMeta(key, value) {
      await writeTransaction(db, META, (tx) => tx.objectStore(META).put(value, key));
    },
    async removeMeta(key) {
      await writeTransaction(db, META, (tx) => tx.objectStore(META).delete(key));
    },
    async getNote() {
      const stored = await readTransaction(db, META, (tx) => requestToPromise(tx.objectStore(META).get(NOTE_META)));
      return codec.decodeNote(stored);
    },
    async setNote(text) {
      const sealed = await codec.encodeNote(text);
      await writeTransaction(db, META, (tx) => tx.objectStore(META).put(sealed, NOTE_META));
    },
    async getHabits() {
      const stored = await readTransaction(db, META, (tx) => requestToPromise(tx.objectStore(META).get(HABITS_META)));
      return codec.decodeHabits(stored);
    },
    async setHabits(state) {
      const sealed = await codec.encodeHabits(state);
      await writeTransaction(db, META, (tx) => tx.objectStore(META).put(sealed, HABITS_META));
    },
    async getSavedSearches() {
      const stored = await readTransaction(db, META, (tx) => requestToPromise(tx.objectStore(META).get(SAVED_SEARCHES_META)));
      return codec.decodeSavedSearches(stored);
    },
    async setSavedSearches(list) {
      const sealed = await codec.encodeSavedSearches(list);
      await writeTransaction(db, META, (tx) => tx.objectStore(META).put(sealed, SAVED_SEARCHES_META));
    },
    async clear() {
      await writeTransaction(db, [STORE, VERSIONS, MEDIA, META], (tx) => {
        for (const name of [STORE, VERSIONS, MEDIA, META]) tx.objectStore(name).clear();
      });
    },
  };
}

/** The in-memory fallback. Rows go through the same codec, so it seals the same way. */
export function createMemoryStore() {
  const codec = createCodec();
  const rows = new Map();
  const media = new Map();
  const versions = new Map();
  const metas = new Map();
  const versionsOf = (entryId) =>
    [...versions.values()].filter((version) => version.entryId === entryId).sort(byTimeAscending);
  const mediaOf = (entryId) => [...media.values()].filter((record) => record.entryId === entryId);
  const clone = (value) => structuredClone(value);

  return {
    kind: 'memory',
    setCipher: (vault) => codec.set(vault),
    async reseal(next) {
      codec.ready();
      const previous = codec.current();
      try {
        const plainRows = await Promise.all([...rows.values()].map((row) => codec.decodeRow(clone(row))));
        const plainRecords = await Promise.all([...media.values()].map((record) => codec.decodeMedia(clone(record))));
        const plainVersions = await Promise.all([...versions.values()].map((version) => codec.decodeVersion(clone(version))));
        const plainNote = metas.has(NOTE_META) ? await codec.decodeNote(clone(metas.get(NOTE_META))) : null;
        const plainHabits = metas.has(HABITS_META) ? await codec.decodeHabits(clone(metas.get(HABITS_META))) : null;
        const plainSavedSearches = metas.has(SAVED_SEARCHES_META) ? await codec.decodeSavedSearches(clone(metas.get(SAVED_SEARCHES_META))) : null;
        codec.set(next);
        const sealedRows = await Promise.all(plainRows.map((row) => codec.encodeRow(row)));
        const sealedRecords = await Promise.all(plainRecords.map((record) => codec.encodeMedia(record)));
        const sealedVersions = await Promise.all(plainVersions.map((version) => codec.encodeVersion(version)));
        const sealedNote = plainNote === null ? null : await codec.encodeNote(plainNote);
        const sealedHabits = plainHabits === null ? null : await codec.encodeHabits(plainHabits);
        const sealedSavedSearches = plainSavedSearches === null ? null : await codec.encodeSavedSearches(plainSavedSearches);
        rows.clear();
        media.clear();
        versions.clear();
        for (const row of sealedRows) rows.set(row.id, clone(row));
        for (const record of sealedRecords) media.set(record.key, clone(record));
        for (const version of sealedVersions) versions.set(version.id, clone(version));
        if (sealedNote) metas.set(NOTE_META, clone(sealedNote));
        if (sealedHabits) metas.set(HABITS_META, clone(sealedHabits));
        if (sealedSavedSearches) metas.set(SAVED_SEARCHES_META, clone(sealedSavedSearches));
      } catch (error) {
        codec.set(previous);
        throw error;
      }
    },
    async list() {
      codec.ready();
      // The list reads rows only, so pictures and sketches are never touched here.
      const entries = await assembleEntries(codec, [...rows.values()].map(clone), []);
      return entries.filter(isLive);
    },
    async listTrash() {
      codec.ready();
      const entries = await assembleEntries(codec, [...rows.values()].map(clone), []);
      return entries.filter(isTrashed).sort(newestDeletionFirst);
    },
    async setTrashed(id, deletedAt) {
      codec.ready();
      const row = rows.get(id);
      if (!row) return;
      const plain = await codec.decodeRow(clone(row));
      rows.set(id, clone(await codec.encodeRow({ ...plain, deletedAt })));
    },
    async listFull() {
      codec.ready();
      return assembleEntries(codec, [...rows.values()].map(clone), [...media.values()].map(clone));
    },
    async get(id) {
      codec.ready();
      const row = rows.get(id);
      if (!row) return null;
      const [entry] = await assembleEntries(codec, [clone(row)], mediaOf(id).map(clone));
      return entry;
    },
    async save(entry) {
      codec.ready();
      const normalized = normalizeEntry(entry);
      rows.set(normalized.id, clone(await codec.encodeRow(rowOf(normalized))));
      const stored = new Set(mediaOf(normalized.id).map((record) => record.key));
      for (const record of await encodeMediaFor(codec, normalized, stored)) media.set(record.key, clone(record));
      return normalized;
    },
    async remove(id) {
      rows.delete(id);
      for (const record of mediaOf(id)) media.delete(record.key);
      for (const version of versionsOf(id)) versions.delete(version.id);
    },
    async listVersions(entryId) {
      codec.ready();
      const list = versionsOf(entryId).reverse();
      return Promise.all(list.map((row) => codec.decodeVersion(clone(row))));
    },
    async latestVersion(entryId) {
      codec.ready();
      const list = versionsOf(entryId);
      const last = list[list.length - 1];
      return last ? codec.decodeVersion(clone(last)) : null;
    },
    async listAllVersions() {
      codec.ready();
      return Promise.all([...versions.values()].map((row) => codec.decodeVersion(clone(row))));
    },
    async saveVersion(version, keep) {
      codec.ready();
      versions.set(version.id, clone(await codec.encodeVersion(version)));
      const list = versionsOf(version.entryId);
      for (const stale of list.slice(0, Math.max(0, list.length - keep))) versions.delete(stale.id);
    },
    async removeVersion(id) {
      versions.delete(id);
    },
    /** Same move as the IndexedDB store. See there for what it does. */
    async migrateVersionClips() {
      codec.ready();
      if (metas.has(VOICE_CLIPS_META)) return 0;
      let moved = 0;
      for (const [versionId, row] of [...versions.entries()]) {
        const version = await codec.decodeVersion(clone(row));
        const { audio, ...content } = version.content ?? {};
        if (!audio) continue;
        for (const [id, src] of Object.entries(audio)) {
          const key = mediaKey(version.entryId, 'audio', id);
          if (!media.has(key)) {
            media.set(key, clone(await codec.encodeMedia(audioRecord(version.entryId, id, src))));
            moved += 1;
          }
        }
        versions.set(versionId, clone(await codec.encodeVersion({ ...version, content })));
      }
      metas.set(VOICE_CLIPS_META, true);
      return moved;
    },
    async getMeta(key) {
      return metas.has(key) ? clone(metas.get(key)) : null;
    },
    async setMeta(key, value) {
      metas.set(key, clone(value));
    },
    async removeMeta(key) {
      metas.delete(key);
    },
    async getNote() {
      return codec.decodeNote(metas.get(NOTE_META) ?? null);
    },
    async setNote(text) {
      metas.set(NOTE_META, await codec.encodeNote(text));
    },
    async getHabits() {
      return codec.decodeHabits(metas.get(HABITS_META) ?? null);
    },
    async setHabits(state) {
      metas.set(HABITS_META, await codec.encodeHabits(state));
    },
    async getSavedSearches() {
      return codec.decodeSavedSearches(metas.get(SAVED_SEARCHES_META) ?? null);
    },
    async setSavedSearches(list) {
      metas.set(SAVED_SEARCHES_META, await codec.encodeSavedSearches(list));
    },
    async clear() {
      rows.clear();
      media.clear();
      versions.clear();
      metas.clear();
    },
  };
}

/** Opens IndexedDB, falling back to memory (with `kind: 'memory'`) if the browser blocks it. The store starts locked. */
export async function createLocalStore() {
  try {
    return createIndexedDBStore(await openDatabase());
  } catch (error) {
    console.warn('Quire: IndexedDB unavailable, using memory storage.', error);
    return createMemoryStore();
  }
}
