import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import {
  MAX_VERSIONS,
  VERSION_INTERVAL_MS,
  contentOf,
  makeVersion,
  normalizeVersion,
  sameContent,
  shouldKeepVersion,
} from '../src/versions.js';
import { parseBackup } from '../src/export.js';
import { createLocalStore } from '../src/storage.js';

const written = (overrides = {}) =>
  createEntry({ id: 'e1', title: 'Late light', body: 'The porch was quiet.', createdAt: '2026-11-10T10:00:00.000Z', ...overrides });

test('contentOf copies the content fields and ignores ids, times and sheet height', () => {
  const entry = { ...written(), ink: { ops: [{ t: 'stroke' }], h: 1200 } };
  const content = contentOf(entry);
  assert.deepEqual(Object.keys(content), ['title', 'date', 'kind', 'tags', 'body', 'pageColor', 'ink']);
  assert.deepEqual(content.ink, { ops: [{ t: 'stroke' }] });
});

test('sameContent ignores timestamps and sheet height but sees text and ink changes', () => {
  const entry = written();
  const content = contentOf(entry);
  assert.equal(sameContent({ ...entry, updatedAt: '2030-01-01T00:00:00.000Z' }, content), true);
  assert.equal(sameContent({ ...entry, body: 'Changed.' }, content), false);
  assert.equal(sameContent({ ...entry, ink: { ops: [{ t: 'stroke' }], h: 0 } }, content), false);
});

test('a blank entry never gets a version', () => {
  const blank = written({ title: '', body: '' });
  assert.equal(shouldKeepVersion({ entry: blank, reason: 'leave', now: Date.now() }), false);
});

test('an unchanged entry gets no new version, whatever the reason', () => {
  const entry = written();
  const latest = makeVersion(entry, 'manual');
  for (const reason of ['auto', 'manual', 'leave', 'restore']) {
    assert.equal(shouldKeepVersion({ entry, latest, reason, now: Date.now() + VERSION_INTERVAL_MS * 4 }), false, reason);
  }
});

test('automatic versions wait the interval after the latest version', () => {
  const entry = written({ body: 'Edited.' });
  const latest = makeVersion(written(), 'auto', new Date('2026-11-10T11:00:00.000Z'));
  const justBefore = Date.parse('2026-11-10T11:00:00.000Z') + VERSION_INTERVAL_MS - 1;
  const atInterval = Date.parse('2026-11-10T11:00:00.000Z') + VERSION_INTERVAL_MS;
  assert.equal(shouldKeepVersion({ entry, latest, reason: 'auto', now: justBefore }), false);
  assert.equal(shouldKeepVersion({ entry, latest, reason: 'auto', now: atInterval }), true);
});

test('the first automatic version waits from when the entry was created', () => {
  const entry = written({ body: 'Edited.', createdAt: '2026-11-10T10:00:00.000Z' });
  const created = Date.parse('2026-11-10T10:00:00.000Z');
  assert.equal(shouldKeepVersion({ entry, latest: null, reason: 'auto', now: created + 1000 }), false);
  assert.equal(shouldKeepVersion({ entry, latest: null, reason: 'auto', now: created + VERSION_INTERVAL_MS }), true);
});

test('leaving, saving by hand, and restoring keep a version whenever content changed', () => {
  const entry = written({ body: 'Edited.' });
  const latest = makeVersion(written(), 'auto', new Date());
  for (const reason of ['leave', 'manual', 'restore']) {
    assert.equal(shouldKeepVersion({ entry, latest, reason, now: Date.now() }), true, reason);
  }
});

test('normalizeVersion cleans a backup record and rejects one without an entry', () => {
  const version = normalizeVersion({
    id: 'v1',
    entryId: 'e1',
    savedAt: '2026-11-10T12:00:00.000Z',
    reason: 'bogus',
    content: { title: 'Kept', body: 'Text', kind: 'poem', tags: ['a', 'a'], ink: { ops: [] } },
  });
  assert.equal(version.reason, 'auto');
  assert.equal(version.content.kind, 'poem');
  assert.deepEqual(version.content.tags, ['a']);
  assert.equal(normalizeVersion({ content: {} }), null);
  assert.equal(normalizeVersion({ entryId: 'e1', content: 'nope' }), null);
});

test('backups carry versions, and older backups without them still parse', () => {
  const entry = written();
  const version = makeVersion(entry, 'manual', new Date('2026-11-10T12:00:00.000Z'));
  const withVersions = JSON.stringify({ app: 'quire', format: 1, entries: [entry], versions: [version] });
  const parsed = parseBackup(withVersions);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.versions.length, 1);
  assert.equal(parsed.versions[0].entryId, 'e1');

  const legacy = parseBackup(JSON.stringify({ app: 'quire', format: 1, entries: [entry] }));
  assert.deepEqual(legacy.versions, []);
});

test('memory store keeps the newest versions per entry and removes them with the entry', async () => {
  const store = await createLocalStore(); // no IndexedDB under node, so this is the memory store
  assert.equal(store.kind, 'memory');
  store.setCipher(null); // plain rows; the store starts locked until the app decides
  const entry = written();
  await store.save(entry);
  const base = Date.parse('2026-11-10T10:00:00.000Z');
  for (let i = 0; i < MAX_VERSIONS + 3; i += 1) {
    const savedAt = new Date(base + i * 1000);
    await store.saveVersion(makeVersion({ ...entry, body: `Draft ${i}` }, 'auto', savedAt), MAX_VERSIONS);
  }
  const versions = await store.listVersions('e1');
  assert.equal(versions.length, MAX_VERSIONS);
  assert.equal(versions[0].content.body, `Draft ${MAX_VERSIONS + 2}`); // newest first
  assert.equal((await store.latestVersion('e1')).content.body, `Draft ${MAX_VERSIONS + 2}`);

  await store.removeVersion(versions[0].id);
  assert.equal((await store.listVersions('e1')).length, MAX_VERSIONS - 1);

  await store.remove('e1');
  assert.deepEqual(await store.listVersions('e1'), []);
  assert.deepEqual(await store.listAllVersions(), []);
});

test('a version copies sketch strokes, so restoring it brings them back', () => {
  const entry = { ...createEntry({ body: 'Hi' }), sketches: { s1: { h: 320, ops: [{ t: 'stroke', id: 'a' }] } } };
  const content = contentOf(entry);
  assert.deepEqual(content.sketches, { s1: { h: 320, ops: [{ t: 'stroke', id: 'a' }] } });
  entry.sketches.s1.ops.push({ t: 'stroke', id: 'b' });
  assert.deepEqual(content.sketches.s1.ops, [{ t: 'stroke', id: 'a' }], 'the copy does not change when the sketch does');
});

test('a version without sketches leaves them out, so older versions still match', () => {
  const content = contentOf(createEntry({ body: 'Hi' }));
  assert.equal('sketches' in content, false);
});

test('a version with a changed sketch is not the same content', () => {
  const entry = { ...createEntry({ body: 'Hi' }), sketches: { s1: { h: 320, ops: [] } } };
  const latest = makeVersion(entry, 'manual');
  assert.equal(sameContent(entry, latest.content), true);
  entry.sketches.s1.ops = [{ t: 'stroke', id: 'new' }];
  assert.equal(sameContent(entry, latest.content), false);
});
