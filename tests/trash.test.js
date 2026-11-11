import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry, normalizeEntry } from '../src/model.js';
import { createMemoryStore } from '../src/storage.js';
import { TRASH_DAYS, daysLeft, isExpired, purgeDate, removalNote, splitExpired } from '../src/trash.js';

const DAY = 24 * 60 * 60 * 1000;
const deletedDaysAgo = (days, now) => new Date(now - days * DAY).toISOString();

test('TRASH_DAYS is 30 days', () => {
  assert.equal(TRASH_DAYS, 30);
});

test('an entry outside the drawer has no purge date and never expires', () => {
  const live = normalizeEntry({ id: 'a' });
  assert.equal(live.deletedAt, null);
  assert.equal(purgeDate(live), null);
  assert.equal(isExpired(live, Date.now() + 365 * DAY), false);
  assert.equal(daysLeft(live), null);
  assert.equal(removalNote(live), '');
});

test('normalizeEntry keeps a valid deletion time and drops a broken one', () => {
  const when = '2026-11-01T12:00:00.000Z';
  assert.equal(normalizeEntry({ id: 'a', deletedAt: when }).deletedAt, when);
  assert.equal(normalizeEntry({ id: 'a', deletedAt: 'not a date' }).deletedAt, null);
  assert.equal(normalizeEntry({ id: 'a', deletedAt: 42 }).deletedAt, null);
});

test('a drawer entry is removed for good after exactly TRASH_DAYS', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const justInside = { deletedAt: deletedDaysAgo(TRASH_DAYS, now) };
  // Exactly at the boundary the entry is due. One millisecond earlier it is not.
  assert.equal(isExpired(justInside, now), true);
  assert.equal(isExpired({ deletedAt: new Date(now - TRASH_DAYS * DAY + 1).toISOString() }, now), false);
});

test('daysLeft rounds partial days up, and never goes below zero', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  assert.equal(daysLeft({ deletedAt: deletedDaysAgo(0, now) }, now), TRASH_DAYS);
  assert.equal(daysLeft({ deletedAt: deletedDaysAgo(28.5, now) }, now), 2);
  assert.equal(daysLeft({ deletedAt: deletedDaysAgo(40, now) }, now), 0);
});

test('removalNote reads naturally at each stage', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  assert.equal(removalNote({ deletedAt: deletedDaysAgo(0, now) }, now), 'Removed for good in 30 days');
  assert.equal(removalNote({ deletedAt: deletedDaysAgo(29, now) }, now), 'Removed for good in 1 day');
  assert.equal(removalNote({ deletedAt: deletedDaysAgo(31, now) }, now), 'Due for removal');
});

test('splitExpired separates entries past their days from the rest', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const old = { id: 'old', deletedAt: deletedDaysAgo(31, now) };
  const fresh = { id: 'fresh', deletedAt: deletedDaysAgo(3, now) };
  const { kept, expired } = splitExpired([old, fresh], now);
  assert.deepEqual(kept.map((e) => e.id), ['fresh']);
  assert.deepEqual(expired.map((e) => e.id), ['old']);
});

test('the store keeps drawer entries out of the list until they are restored', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  const keep = createEntry({ id: 'keep', title: 'Keep', body: 'stays' });
  const bin = createEntry({ id: 'bin', title: 'Bin', body: 'goes to the drawer' });
  await store.save(keep);
  await store.save(bin);

  await store.setTrashed('bin', '2026-11-09T09:00:00.000Z');
  assert.deepEqual((await store.list()).map((e) => e.id), ['keep']);
  const drawer = await store.listTrash();
  assert.deepEqual(drawer.map((e) => e.id), ['bin']);
  assert.equal(drawer[0].deletedAt, '2026-11-09T09:00:00.000Z');
  // The entry itself is still there: get() and the full backup both see it.
  assert.equal((await store.get('bin')).title, 'Bin');
  assert.deepEqual((await store.listFull()).map((e) => e.id).sort(), ['bin', 'keep']);

  await store.setTrashed('bin', null);
  assert.deepEqual((await store.list()).map((e) => e.id).sort(), ['bin', 'keep']);
  assert.deepEqual(await store.listTrash(), []);
});

test('moving to and from the drawer keeps the text, the pictures and the versions', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  await store.save(createEntry({ id: 'p', title: 'Photo', body: '![Photo](quire-image:i1)', images: { i1: image } }));
  await store.saveVersion({ id: 'v1', entryId: 'p', savedAt: '2026-11-10T08:00:00.000Z', reason: 'auto', content: { title: 'Photo' } }, 30);

  await store.setTrashed('p', '2026-11-10T10:00:00.000Z');
  const inDrawer = await store.get('p');
  assert.deepEqual(inDrawer.images, { i1: image });
  assert.equal(inDrawer.body, '![Photo](quire-image:i1)');
  assert.equal((await store.listVersions('p')).length, 1);

  await store.setTrashed('p', null);
  assert.deepEqual((await store.get('p')).images, { i1: image });
});

test('remove deletes for good, with its versions and pictures', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.save(createEntry({ id: 'gone', title: 'Gone', images: { i1: 'data:image/png;base64,iVBORw0KGgo=' } }));
  await store.saveVersion({ id: 'v1', entryId: 'gone', savedAt: '2026-11-10T08:00:00.000Z', reason: 'auto', content: {} }, 30);
  await store.setTrashed('gone', '2026-11-10T10:00:00.000Z');

  await store.remove('gone');
  assert.equal(await store.get('gone'), null);
  assert.deepEqual(await store.listTrash(), []);
  assert.deepEqual(await store.listAllVersions(), []);
});

test('setTrashed on an unknown id does nothing', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.setTrashed('missing', '2026-11-10T10:00:00.000Z');
  assert.deepEqual(await store.listTrash(), []);
});

test('drawer entries are sealed with the passcode lock, and only the lock opens them', async () => {
  const { createLock, unlockLock } = await import('../src/vault.js');
  const { record, vault } = await createLock('correct horse', { iterations: 1000 });
  const store = createMemoryStore();
  store.setCipher(vault);
  await store.save(createEntry({ id: 'secret', title: 'Private', body: 'the surprise party was on Tuesday' }));
  await store.save(createEntry({ id: 'open', title: 'Open', body: 'nothing to hide' }));
  await store.setTrashed('secret', '2026-11-10T10:00:00.000Z');

  // The drawer lists the sealed entry through the vault, and the live list leaves it out.
  assert.deepEqual((await store.listTrash()).map((e) => e.title), ['Private']);
  assert.deepEqual((await store.list()).map((e) => e.id), ['open']);

  // A reopened vault reads the same drawer. A store with the lock off cannot.
  const again = await unlockLock(record, 'correct horse');
  store.setCipher(again);
  assert.deepEqual((await store.listTrash()).map((e) => e.id), ['secret']);
  store.setCipher(null);
  await assert.rejects(store.listTrash());
});
