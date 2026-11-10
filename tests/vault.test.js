import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Node 18 may not expose WebCrypto as a global. The browser always does.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { PASSCODE_MAX, PASSCODE_MIN, changeLock, createLock, createVault, passcodeProblem, unlockLock } = await import('../src/vault.js');
const { createMemoryStore, LockedError } = await import('../src/storage.js');
const { createEntry } = await import('../src/model.js');
const { makeVersion } = await import('../src/versions.js');

// Real runs use 600k rounds. Tests use a small count, and the record carries it, so unlocking reads it back.
const FAST = { iterations: 1000 };
const SECRET = 'Dear diary, the surprise party was on Tuesday';

const entryWithSecret = () =>
  createEntry({ id: 'e1', title: 'Private', body: SECRET, createdAt: '2026-11-10T10:00:00.000Z' });

test('passcodeProblem enforces the length limits and asks for something', () => {
  assert.equal(passcodeProblem(''), 'Enter a passcode.');
  assert.equal(passcodeProblem(undefined), 'Enter a passcode.');
  assert.match(passcodeProblem('x'.repeat(PASSCODE_MIN - 1)), /at least/);
  assert.equal(passcodeProblem('x'.repeat(PASSCODE_MIN)), null);
  assert.match(passcodeProblem('x'.repeat(PASSCODE_MAX + 1)), /at most/);
});

test('the right passcode opens the vault and a wrong one does not', async () => {
  const { record } = await createLock('correct horse', FAST);
  assert.equal(await unlockLock(record, 'wrong horse!'), null);
  assert.equal(await unlockLock(record, ''), null);
  assert.ok(await unlockLock(record, 'correct horse'));
});

test('sealed rows open with the same vault and never show their plaintext', async () => {
  const { record, vault } = await createLock('correct horse', FAST);
  const sealed = await vault.seal('entry', 'e1', entryWithSecret());
  const raw = JSON.stringify({ iv: Array.from(sealed.iv), ct: Array.from(sealed.ct) });
  assert.ok(!raw.includes('surprise party'));
  const again = await (await unlockLock(record, 'correct horse')).open('entry', 'e1', sealed);
  assert.equal(again.body, SECRET);
});

test('a sealed row fails to open under another id, so rows cannot be swapped', async () => {
  const { vault } = await createLock('correct horse', FAST);
  const sealed = await vault.seal('entry', 'e1', entryWithSecret());
  await assert.rejects(vault.open('entry', 'e2', sealed));
  await assert.rejects(vault.open('version', 'e1', sealed));
});

test('a vault from another lock cannot open the rows', async () => {
  const first = await createLock('correct horse', FAST);
  const second = await createLock('correct horse', FAST);
  const sealed = await first.vault.seal('entry', 'e1', entryWithSecret());
  await assert.rejects(second.vault.open('entry', 'e1', sealed));
});

test('changing the passcode keeps existing rows readable and drops the old passcode', async () => {
  const { record, vault } = await createLock('first passcode', FAST);
  const sealed = await vault.seal('entry', 'e1', entryWithSecret());
  const changed = await changeLock(vault, 'second passcode');
  assert.equal(await unlockLock(changed, 'first passcode'), null);
  const opened = await unlockLock(changed, 'second passcode');
  assert.equal((await opened.open('entry', 'e1', sealed)).body, SECRET);
  assert.ok(record.salt.length !== changed.salt.length || record.salt.some((byte, i) => byte !== changed.salt[i]));
});

test('a new vault from the record gives the same key the rows were sealed with', async () => {
  const { record, vault } = await createLock('correct horse', FAST);
  const sealed = await vault.seal('version', 'v1', { reason: 'auto', content: { body: SECRET } });
  const reopened = createVault((await unlockLock(record, 'correct horse')).dataKey);
  assert.deepEqual(await reopened.open('version', 'v1', sealed), { reason: 'auto', content: { body: SECRET } });
});

test('a locked store refuses reads and writes until a cipher is set', async () => {
  const store = createMemoryStore();
  await assert.rejects(store.list(), LockedError);
  await assert.rejects(store.save(entryWithSecret()), LockedError);
  // The record lives beside the rows, so it can be read while locked.
  assert.equal(await store.getMeta('lock'), null);
  store.setCipher(null);
  assert.deepEqual(await store.list(), []);
});

test('a sealed store round-trips entries and versions, and refuses other keys and a missing passcode', async () => {
  const { vault } = await createLock('correct horse', FAST);
  const store = createMemoryStore();
  store.setCipher(vault);
  const entry = entryWithSecret();
  await store.save(entry);
  await store.saveVersion(makeVersion(entry, 'manual', new Date('2026-11-10T11:00:00.000Z')), 30);

  assert.equal((await store.get('e1')).body, SECRET);
  assert.equal((await store.listAllVersions())[0].content.body, SECRET);
  assert.equal((await store.latestVersion('e1')).reason, 'manual');

  // Same rows, a different key: nothing opens.
  const { vault: stranger } = await createLock('correct horse', FAST);
  store.setCipher(stranger);
  await assert.rejects(store.get('e1'));

  // Rows are sealed, so with the lock off (no vault) they refuse to open rather than read as blank.
  store.setCipher(null);
  await assert.rejects(store.get('e1'), /passcode lock is off/);
});

test('reseal seals every row, picture and version, and opens them back to plain rows', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  const picture = 'data:image/png;base64,iVBORw0KGgo=';
  const entry = { ...entryWithSecret(), images: { p1: picture } };
  await store.save(entry);
  await store.saveVersion(makeVersion(entry, 'manual', new Date('2026-11-10T11:00:00.000Z')), 30);

  const { vault } = await createLock('correct horse', FAST);
  await store.reseal(vault);
  const sealed = await store.get('e1');
  assert.equal(sealed.body, SECRET);
  assert.equal(sealed.images.p1, picture);
  assert.equal((await store.listAllVersions())[0].content.body, SECRET);

  // Back to plain rows, read with the same vault, then with no cipher at all.
  store.setCipher(vault);
  await store.reseal(null);
  store.setCipher(null);
  assert.equal((await store.get('e1')).images.p1, picture);
  assert.equal((await store.latestVersion('e1')).reason, 'manual');
});

test('a failed reseal keeps the old cipher in place, so new writes are not stored in the clear', async () => {
  const store = createMemoryStore();
  const { vault } = await createLock('correct horse', FAST);
  store.setCipher(vault);
  await store.save(entryWithSecret());
  await assert.rejects(store.reseal('not a vault'));
  // Still sealing: a save after the failed reseal must not write plain content.
  await store.save({ ...entryWithSecret(), id: 'e2', body: 'second secret' });
  store.setCipher(null);
  await assert.rejects(store.get('e2'), /passcode lock is off/);
});
