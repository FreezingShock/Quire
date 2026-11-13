/**
 * One sync pass between this device's store and the account's rows. It has no
 * network or DOM code of its own: `local` is the store, `remote` is the REST
 * client (or a test double), and `vault` is the open passcode lock.
 *
 * What goes up is one sealed row per entry. The row holds the whole entry as
 * JSON, encrypted with the lock's data key, and the entry's updatedAt as the
 * version. The server accepts a row only when its version is at least as new
 * as the one it holds (see the push_entries function in the migration).
 *
 * Each pass:
 *   1. Makes sure the account's lock record matches this device's key.
 *   2. Pulls rows changed since the cursor. A remote change wins over a local
 *      one only when it is newer, and the losing copy is kept as a version,
 *      so nothing is dropped silently.
 *   3. Pushes local entries that differ from the last synced version, and
 *      sends a tombstone for each entry that was purged here.
 *
 * `state` is { cursor, known } where known maps entry id to the updatedAt
 * last synced for it. Remote rows are only ever read through the vault.
 */

import { normalizeEntry } from '../model.js';
import { MAX_VERSIONS, makeVersion } from '../versions.js';
import { decodeSealed, encodeSealed, sameLock } from './codec.js';
import { isVaultEntryId } from '../vault-sync.js';

const CHECK_SCOPE = 'sync-check';
const CHECK_ID = 'quire';
const ENTRY_SCOPE = 'sync';
const BATCH = 200;

/** The account already has a lock this device does not hold. `remoteKey` is its record, so the caller can ask for that passcode. */
export class KeyMismatchError extends Error {
  constructor(remoteKey) {
    super('This account was set up with a different passcode.');
    this.name = 'KeyMismatchError';
    this.remoteKey = remoteKey;
  }
}

/** A value only the data key can open. Its presence on the server proves the device holds the account's key. */
export async function sealCheck(vault) {
  return encodeSealed(await vault.seal(CHECK_SCOPE, CHECK_ID, { ok: true }));
}

async function checkOpens(vault, check) {
  try {
    await vault.open(CHECK_SCOPE, CHECK_ID, decodeSealed(check));
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes the account's lock record match this device. Returns the remote lock
 * record when another device changed the passcode more recently, so the caller
 * can store it here. The data key is the same either way.
 */
async function keyStep({ remote, vault, lock }) {
  const remoteKey = await remote.getKey();
  if (!remoteKey) {
    await remote.putKey({ lock, check: await sealCheck(vault) });
    return null;
  }
  if (!(await checkOpens(vault, remoteKey.check))) throw new KeyMismatchError(remoteKey);
  if (sameLock(lock, remoteKey.lock)) return null;
  if ((lock.changedAt ?? '') > (remoteKey.lock.changedAt ?? '')) {
    await remote.putKey({ lock, check: remoteKey.check });
    return null;
  }
  return remoteKey.lock;
}

async function keepVersion(local, entry) {
  await local.saveVersion(makeVersion(entry, 'sync'), MAX_VERSIONS);
}

/**
 * Runs one pass. `lock` is the encoded lock record (see codec.js). Returns
 * { state, summary }. `summary.refused` counts pushes the server did not
 * accept, which the next pass picks up after pulling.
 */
export async function syncOnce({ local, remote, vault, lock, state = {}, now = () => new Date().toISOString() }) {
  const known = { ...(state.known ?? {}) };
  let cursor = state.cursor ?? 0;
  const summary = { pulled: 0, pushed: 0, removed: 0, conflicts: 0, refused: 0, lockAdopted: null };

  summary.lockAdopted = await keyStep({ remote, vault, lock });

  // Vault entries are plain files on this computer. They never leave it, in either direction.
  const byId = new Map((await local.listFull()).filter((entry) => !isVaultEntryId(entry.id)).map((entry) => [entry.id, entry]));

  for (const row of await remote.pullEntries(cursor)) {
    cursor = Math.max(cursor, row.revision);
    const id = row.entry_id;
    if (isVaultEntryId(id)) continue;
    const here = byId.get(id) ?? null;
    const localChanged = here ? known[id] !== here.updatedAt : false;

    if (row.deleted) {
      // An edit made here after the other device deleted the entry wins; the push below sends it back.
      if (here && localChanged) continue;
      if (here) {
        await local.remove(id);
        byId.delete(id);
        summary.removed += 1;
      }
      delete known[id];
      continue;
    }

    const incoming = normalizeEntry(await vault.open(ENTRY_SCOPE, id, decodeSealed(row.payload)));
    if (here && here.updatedAt === incoming.updatedAt) {
      known[id] = incoming.updatedAt;
      continue;
    }
    if (!here) {
      // Purged here after this version was synced. The tombstone below sends the purge up, so the copy is not brought back.
      if (known[id] === incoming.updatedAt) continue;
      await local.save(incoming);
      byId.set(id, incoming);
      known[id] = incoming.updatedAt;
      summary.pulled += 1;
      continue;
    }
    if (!localChanged || incoming.updatedAt > here.updatedAt) {
      if (localChanged) {
        await keepVersion(local, here);
        summary.conflicts += 1;
      }
      await local.save(incoming);
      byId.set(id, incoming);
      known[id] = incoming.updatedAt;
      summary.pulled += 1;
      continue;
    }
    // This device's edit is newer. It stays and goes up below; the other copy is kept as a version.
    await keepVersion(local, incoming);
    summary.conflicts += 1;
  }

  const outgoing = [];
  for (const id of Object.keys(known)) {
    if (!byId.has(id) && !isVaultEntryId(id)) outgoing.push({ entry_id: id, client_updated_at: known[id], deleted: true, payload: null });
  }
  for (const entry of byId.values()) {
    if (known[entry.id] === entry.updatedAt) continue;
    outgoing.push({
      entry_id: entry.id,
      client_updated_at: entry.updatedAt,
      deleted: false,
      payload: encodeSealed(await vault.seal(ENTRY_SCOPE, entry.id, entry)),
    });
  }

  for (let start = 0; start < outgoing.length; start += BATCH) {
    const batch = outgoing.slice(start, start + BATCH);
    const accepted = new Set((await remote.pushEntries(batch)).map((row) => row.entry_id));
    for (const sent of batch) {
      if (!accepted.has(sent.entry_id)) {
        summary.refused += 1;
      } else if (sent.deleted) {
        delete known[sent.entry_id];
        summary.removed += 1;
      } else {
        known[sent.entry_id] = sent.client_updated_at;
        summary.pushed += 1;
      }
    }
  }

  return { state: { cursor, known, syncedAt: now() }, summary };
}
