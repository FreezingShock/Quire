import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { entryFromVaultFile, hasMedia, normalizeVaultIndex, planVaultSync, recordFor, vaultEntryId, vaultMarkdown } from '../src/vault-sync.js';
import { normalizeFolderList } from '../src/folders.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const disk = (entries) => new Map(entries);
const file = (modified, size) => ({ modified, size });
const record = (entry, modified, size) => recordFor({ entryId: entry.id, modified, size, entryUpdatedAt: entry.updatedAt });

test('a vault file keeps the same entry id every time it is read', () => {
  assert.equal(vaultEntryId('f1', 'Trip.md'), vaultEntryId('f1', 'Trip.md'));
  assert.notEqual(vaultEntryId('f1', 'Trip.md'), vaultEntryId('f2', 'Trip.md'));
  assert.notEqual(vaultEntryId('f1', 'Trip.md'), vaultEntryId('f1', 'Trip2.md'));
});

test('a file with no record is imported as new', () => {
  const plan = planVaultSync({ disk: disk([['a.md', file(1, 10)]]) });
  assert.deepEqual(plan, [{ type: 'import', name: 'a.md', why: 'new' }]);
});

test('an untouched file and entry make no change', () => {
  const entry = createEntry({ id: 'v1', title: 'A', body: 'Hello', updatedAt: '2026-11-01T10:00:00.000Z' });
  const index = { 'a.md': record(entry, 5, 20) };
  const plan = planVaultSync({ disk: disk([['a.md', file(5, 20)]]), index, entries: new Map([[entry.id, entry]]) });
  assert.deepEqual(plan, []);
});

test('a file changed on disk is read into its entry', () => {
  const entry = createEntry({ id: 'v1', title: 'A', body: 'Hello', updatedAt: '2026-11-01T10:00:00.000Z' });
  const index = { 'a.md': record(entry, 5, 20) };
  const plan = planVaultSync({ disk: disk([['a.md', file(9, 25)]]), index, entries: new Map([[entry.id, entry]]) });
  assert.deepEqual(plan, [{ type: 'import', name: 'a.md', why: 'changed' }]);
});

test('an entry changed in Quire is written back to its file', () => {
  const entry = createEntry({ id: 'v1', title: 'A', body: 'Hello', updatedAt: '2026-11-02T10:00:00.000Z' });
  const index = { 'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '2026-11-01T10:00:00.000Z' } };
  const plan = planVaultSync({ disk: disk([['a.md', file(5, 20)]]), index, entries: new Map([[entry.id, entry]]) });
  assert.deepEqual(plan, [{ type: 'export', name: 'a.md' }]);
});

test('a change on both sides is a conflict for the person to decide', () => {
  const entry = createEntry({ id: 'v1', title: 'A', body: 'Hello', updatedAt: '2026-11-02T10:00:00.000Z' });
  const index = { 'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '2026-11-01T10:00:00.000Z' } };
  const plan = planVaultSync({ disk: disk([['a.md', file(9, 25)]]), index, entries: new Map([[entry.id, entry]]) });
  assert.deepEqual(plan, [{ type: 'conflict', name: 'a.md' }]);
});

test('an entry with pictures is never written back, and is reported as skipped', () => {
  const entry = createEntry({ id: 'v1', title: 'A', body: 'Hi', images: { p1: PNG }, updatedAt: '2026-11-02T10:00:00.000Z' });
  const index = { 'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '2026-11-01T10:00:00.000Z' } };
  const plan = planVaultSync({ disk: disk([['a.md', file(5, 20)]]), index, entries: new Map([[entry.id, entry]]) });
  assert.deepEqual(plan, [{ type: 'skip', name: 'a.md', why: 'media' }]);
  assert.equal(hasMedia(entry), true);
  assert.equal(hasMedia(createEntry({ id: 'x', body: 'plain text' })), false);
});

test('a file whose entry is gone or in the drawer is retired, and never imported again', () => {
  const index = { 'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '' } };
  assert.deepEqual(planVaultSync({ disk: disk([['a.md', file(5, 20)]]), index, entries: new Map() }), [{ type: 'retire', name: 'a.md' }]);
  const retired = { 'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '', removed: true } };
  assert.deepEqual(planVaultSync({ disk: disk([['a.md', file(9, 99)]]), index: retired, entries: new Map() }), []);
});

test('a file deleted from disk drops its record, and the entry stays in Quire', () => {
  const index = { 'gone.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '' } };
  assert.deepEqual(planVaultSync({ disk: disk([]), index, entries: new Map() }), [{ type: 'forget', name: 'gone.md' }]);
});

test('a Quire entry written to a file reads back as the same entry', () => {
  const entry = createEntry({
    id: 'v1',
    title: 'Beach day',
    date: '2026-11-03',
    tags: ['sun', 'sea'],
    body: 'We walked the long pier.\n\nThe water was cold.',
    updatedAt: '2026-11-03T18:00:00.000Z',
  });
  const back = entryFromVaultFile('f1', 'beach.md', vaultMarkdown(entry), '2026-11-13');
  assert.equal(back.id, vaultEntryId('f1', 'beach.md'));
  assert.equal(back.title, 'Beach day');
  assert.equal(back.date, '2026-11-03');
  assert.deepEqual(back.tags, ['sun', 'sea']);
  assert.equal(back.body, 'We walked the long pier.\n\nThe water was cold.');
});

test('normalizeVaultIndex keeps well-formed records and drops the rest', () => {
  const index = normalizeVaultIndex({
    'a.md': { entryId: 'v1', diskModified: 5, diskSize: 20, entryUpdatedAt: '2026-11-01T10:00:00.000Z' },
    'b.md': { entryId: '', diskModified: 1 },
    'c.md': null,
    'd.md': { entryId: 'v4', removed: true },
  });
  assert.deepEqual(Object.keys(index), ['a.md', 'd.md']);
  assert.equal(index['d.md'].removed, true);
  assert.deepEqual(normalizeVaultIndex(['not', 'an', 'object']), {});
});

test('a vault folder keeps its sync records and a plain folder keeps none', () => {
  const [vault] = normalizeFolderList([{ id: 'f1', name: 'Notes', vault: true, files: { 'a.md': { entryId: 'v1', diskModified: 1, diskSize: 2, entryUpdatedAt: '' } } }]);
  assert.equal(vault.vault, true);
  assert.equal(vault.files['a.md'].entryId, 'v1');
  const [plain] = normalizeFolderList([{ id: 'f2', name: 'Pictures', files: { 'a.md': { entryId: 'v1' } } }]);
  assert.equal('files' in plain, false);
  assert.equal('vault' in plain, false);
});
