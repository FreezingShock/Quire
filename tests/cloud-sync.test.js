import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { createMemoryStore } from '../src/storage.js';
import { createLock, unlockLock } from '../src/vault.js';
import { decodeLock, encodeLock, encodeSealed } from '../src/cloud/codec.js';
import { KeyMismatchError, syncOnce } from '../src/cloud/sync-engine.js';

const ITER = 1000;
const clone = (value) => structuredClone(value);

/** A stand-in for the server: rows with revisions, last-writer-wins pushes, and a single lock record. */
function fakeServer() {
  let revision = 0;
  let key = null;
  const rows = new Map();
  const remote = {
    async getKey() {
      return key ? clone(key) : null;
    },
    async putKey(record) {
      key = clone(record);
    },
    async pullEntries(after) {
      const floor = Math.max(0, after - 100);
      return [...rows.values()].filter((row) => row.revision > floor).sort((a, b) => a.revision - b.revision).map(clone);
    },
    async pushEntries(batch) {
      const accepted = [];
      for (const sent of batch) {
        const current = rows.get(sent.entry_id);
        if (current && current.client_updated_at > sent.client_updated_at) continue;
        revision += 1;
        const row = { entry_id: sent.entry_id, revision, client_updated_at: sent.client_updated_at, deleted: sent.deleted, payload: sent.payload };
        rows.set(sent.entry_id, row);
        accepted.push({ entry_id: row.entry_id, revision, client_updated_at: row.client_updated_at, deleted: row.deleted });
      }
      return accepted;
    },
  };
  return { rows, remote, key: () => key };
}

async function newLock(passcode) {
  const { record, vault } = await createLock(passcode, { iterations: ITER });
  return { lock: { ...record, changedAt: '2026-11-01T09:00:00.000Z' }, vault };
}

/** A device: a memory store opened with the given vault, plus its own sync state. */
function device(vault, lock) {
  const store = createMemoryStore();
  store.setCipher(vault);
  return { store, vault, lock, state: {} };
}

async function sync(dev, server) {
  const result = await syncOnce({
    local: dev.store,
    remote: server.remote,
    vault: dev.vault,
    lock: encodeLock(dev.lock),
    state: dev.state,
    now: () => '2026-11-13T12:00:00.000Z',
  });
  dev.state = result.state;
  if (result.summary.lockAdopted) dev.lock = decodeLock(result.summary.lockAdopted);
  return result.summary;
}

const entry = (fields) => createEntry({ createdAt: '2026-11-01T08:00:00.000Z', ...fields });

test('the first sync uploads the lock record and every entry as ciphertext', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'Private title', body: 'secret body text', updatedAt: '2026-11-01T10:00:00.000Z' }));

  const summary = await sync(a, server);

  assert.equal(summary.pushed, 1);
  assert.ok(server.key(), 'the lock record is on the server');
  const wire = JSON.stringify([...server.rows.values()]) + JSON.stringify(server.key());
  assert.equal(wire.includes('Private title'), false);
  assert.equal(wire.includes('secret body text'), false);
  assert.equal(server.rows.get('e1').deleted, false);
});

test('a second device adopts the account passcode and reads the same entries', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'Shared', body: 'from device A', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);

  const remoteKey = await server.remote.getKey();
  const b = { store: createMemoryStore(), state: {} };
  const adopted = decodeLock(remoteKey.lock);
  const bVault = await unlockLock(adopted, 'correct horse');
  assert.ok(bVault, 'the account passcode opens the adopted lock');
  b.store.setCipher(bVault);
  b.vault = bVault;
  b.lock = adopted;

  const summary = await sync(b, server);

  assert.equal(summary.pulled, 1);
  const [pulled] = await b.store.listFull();
  assert.equal(pulled.title, 'Shared');
  assert.equal(pulled.body, 'from device A');
});

test('a device whose key differs from the account key is refused before anything moves', async () => {
  const server = fakeServer();
  const first = await newLock('correct horse');
  await sync(device(first.vault, first.lock), server);

  const other = await newLock('another passcode');
  const stranger = device(other.vault, other.lock);
  await stranger.store.save(entry({ id: 'x1', title: 'Mine', updatedAt: '2026-11-01T10:00:00.000Z' }));

  await assert.rejects(sync(stranger, server), (error) => error instanceof KeyMismatchError && Boolean(error.remoteKey.lock));
  assert.equal(server.rows.size, 0);
});

test('edits and purges move from one device to the other', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  const b = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'v1', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await a.store.save(entry({ id: 'e2', title: 'to purge', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);
  await sync(b, server);
  assert.equal((await b.store.listFull()).length, 2);

  await a.store.save(entry({ id: 'e1', title: 'v2', updatedAt: '2026-11-02T10:00:00.000Z' }));
  await a.store.remove('e2');
  await sync(a, server);
  await sync(b, server);

  const remaining = await b.store.listFull();
  assert.deepEqual(remaining.map((item) => [item.id, item.title]), [['e1', 'v2']]);
});

test('a trashed entry syncs as trashed, not purged', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  const b = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'keep', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);
  await sync(b, server);

  await a.store.save(entry({ id: 'e1', title: 'keep', deletedAt: '2026-11-02T09:00:00.000Z', updatedAt: '2026-11-02T09:00:00.000Z' }));
  await sync(a, server);
  await sync(b, server);

  const [copy] = await b.store.listFull();
  assert.equal(copy.id, 'e1');
  assert.equal(copy.deletedAt, '2026-11-02T09:00:00.000Z');
});

test('when both devices edit before syncing, the newer edit wins and the other copy is kept as a version', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  const b = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'base', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);
  await sync(b, server);

  await a.store.save(entry({ id: 'e1', title: 'edited on A', updatedAt: '2026-11-02T10:00:00.000Z' }));
  await b.store.save(entry({ id: 'e1', title: 'edited on B later', updatedAt: '2026-11-03T10:00:00.000Z' }));
  await sync(b, server);
  const summary = await sync(a, server);

  assert.equal(summary.conflicts, 1);
  const [onA] = await a.store.listFull();
  assert.equal(onA.title, 'edited on B later');
  const versions = await a.store.listVersions('e1');
  assert.ok(versions.some((version) => version.reason === 'sync' && version.content.title === 'edited on A'));
});

test('an older local edit loses to a newer remote edit and is kept as a version', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  const b = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'base', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);
  await sync(b, server);

  await b.store.save(entry({ id: 'e1', title: 'newer remote', updatedAt: '2026-11-04T10:00:00.000Z' }));
  await sync(b, server);
  await a.store.save(entry({ id: 'e1', title: 'older local', updatedAt: '2026-11-02T10:00:00.000Z' }));
  const summary = await sync(a, server);

  assert.equal(summary.conflicts, 1);
  const [onA] = await a.store.listFull();
  assert.equal(onA.title, 'newer remote');
  const versions = await a.store.listVersions('e1');
  assert.ok(versions.some((version) => version.content.title === 'older local'));
});

test('a passcode change on one device reaches the account record', async () => {
  const server = fakeServer();
  const first = await newLock('correct horse');
  const a = device(first.vault, first.lock);
  await sync(a, server);

  const { record } = await (async () => {
    const { changeLock } = await import('../src/vault.js');
    return { record: await changeLock(first.vault, 'a new passcode') };
  })();
  a.lock = { ...record, changedAt: '2026-11-05T10:00:00.000Z' };
  await sync(a, server);

  const remoteKey = await server.remote.getKey();
  assert.equal(encodeLock(a.lock).wrappedKey, remoteKey.lock.wrappedKey);
  assert.ok(await unlockLock(decodeLock(remoteKey.lock), 'a new passcode'));
});

test('a refused push leaves the entry unsynced so the next pass pulls the newer copy', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  await a.store.save(entry({ id: 'e1', title: 'base', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await sync(a, server);
  server.rows.get('e1').client_updated_at = '2026-11-09T10:00:00.000Z';

  await a.store.save(entry({ id: 'e1', title: 'stale', updatedAt: '2026-11-03T10:00:00.000Z' }));
  const summary = await sync(a, server);

  assert.equal(summary.refused, 1);
  assert.notEqual(a.state.known.e1, '2026-11-03T10:00:00.000Z');
});

test('vault entries never leave the computer, in either direction', async () => {
  const server = fakeServer();
  const { lock, vault } = await newLock('correct horse');
  const a = device(vault, lock);
  const b = device(vault, lock);
  await a.store.save(entry({ id: 'vault-f1-abc123', title: 'From a folder', updatedAt: '2026-11-01T10:00:00.000Z' }));
  await a.store.save(entry({ id: 'e9', title: 'Ordinary', updatedAt: '2026-11-01T10:00:00.000Z' }));

  const summary = await sync(a, server);
  assert.equal(summary.pushed, 1);
  assert.equal(server.rows.has('vault-f1-abc123'), false);

  // A row with a vault id, however it got there, is ignored on pull.
  const sealed = encodeSealed(await vault.seal('sync', 'vault-f1-zzz', entry({ id: 'vault-f1-zzz', title: 'Injected' })));
  server.rows.set('vault-f1-zzz', { entry_id: 'vault-f1-zzz', revision: 99, client_updated_at: '2026-11-01T10:00:00.000Z', deleted: false, payload: sealed });
  await sync(b, server);
  const ids = (await b.store.listFull()).map((item) => item.id);
  assert.deepEqual(ids, ['e9']);
});
