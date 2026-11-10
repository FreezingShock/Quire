import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareEntries,
  displayTitle,
  fileStem,
  isBlankEntry,
  isISODate,
  NOTEBOOK_MAX,
  normalizeEntry,
  parseTags,
  slugify,
} from '../src/model.js';
import { createZip, crc32 } from '../src/zip.js';

test('slugify makes file-safe names', () => {
  assert.equal(slugify('Monday, November 9!'), 'monday-november-9');
  assert.equal(slugify('Café Déjà Vu'), 'cafe-deja-vu');
  assert.equal(slugify('!!!'), 'entry');
});

test('fileStem combines date and title', () => {
  assert.equal(fileStem({ date: '2026-11-09', title: 'Late light', body: '' }), '2026-11-09-late-light');
});

test('parseTags trims, collapses spaces and removes duplicates', () => {
  assert.deepEqual(parseTags(' a, b ,a,, c d '), ['a', 'b', 'c d']);
  assert.deepEqual(parseTags(undefined), []);
});

test('isISODate rejects impossible dates', () => {
  assert.equal(isISODate('2026-11-09'), true);
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('11/09/2026'), false);
});

test('normalizeEntry repairs bad fields instead of throwing', () => {
  const entry = normalizeEntry({ id: 'x', kind: 'diary', date: 'nope', pageColor: 'red', tags: [' a ', 'a'], ink: { ops: 'bad' } });
  assert.equal(entry.kind, 'journal');
  assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(entry.pageColor, '#fffdf8');
  assert.deepEqual(entry.tags, ['a']);
  assert.deepEqual(entry.ink.ops, []);
});

test('displayTitle falls back to the first heading, then Untitled', () => {
  assert.equal(displayTitle({ title: '', body: '# From heading\ntext' }), 'From heading');
  assert.equal(displayTitle({ title: 'Given', body: '# Other' }), 'Given');
  assert.equal(displayTitle({ title: '', body: '' }), 'Untitled');
});

test('isBlankEntry only treats empty entries as blank', () => {
  assert.equal(isBlankEntry({ title: ' ', body: '', ink: { ops: [] } }), true);
  // A cleared drawing has no visible ink, so the entry is blank again.
  assert.equal(isBlankEntry({ title: '', body: '', ink: { ops: [{ t: 'clear' }] } }), true);
  assert.equal(isBlankEntry({ title: '', body: '', ink: { ops: [{ t: 'stroke', p: [[1, 1]] }, { t: 'clear' }] } }), true);
  assert.equal(isBlankEntry({ title: '', body: '', ink: { ops: [{ t: 'clear' }, { t: 'stroke', p: [[1, 1]] }] } }), false);
});

test('compareEntries puts the newest day first', () => {
  const rows = [
    { date: '2026-11-07', updatedAt: '2026-11-07T10:00:00Z' },
    { date: '2026-11-09', updatedAt: '2026-11-09T08:00:00Z' },
    { date: '2026-11-09', updatedAt: '2026-11-09T09:00:00Z' },
  ];
  rows.sort(compareEntries);
  assert.deepEqual(rows.map((r) => r.updatedAt), [
    '2026-11-09T09:00:00Z',
    '2026-11-09T08:00:00Z',
    '2026-11-07T10:00:00Z',
  ]);
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('createZip writes local headers and a central directory with the right entry count', () => {
  const enc = new TextEncoder();
  const zip = createZip([
    { name: 'a.md', data: enc.encode('# hi') },
    { name: 'b.png', data: new Uint8Array([1, 2, 3]) },
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
});

test('normalizeEntry keeps only known mood and weather ids, defaulting to null', () => {
  assert.equal(normalizeEntry({ mood: 'good', weather: 'rain' }).mood, 'good');
  assert.equal(normalizeEntry({ mood: 'good', weather: 'rain' }).weather, 'rain');
  const bad = normalizeEntry({ mood: 'ecstatic', weather: 42 });
  assert.equal(bad.mood, null);
  assert.equal(bad.weather, null);
  // Entries saved before these fields existed still load.
  const old = normalizeEntry({ id: 'x', body: 'old' });
  assert.equal(old.mood, null);
  assert.equal(old.weather, null);
});

test('normalizeEntry keeps notebook, pinned, and favorite, and defaults them for older entries', () => {
  const older = normalizeEntry({ id: 'old', body: 'x' });
  assert.equal(older.notebook, null);
  assert.equal(older.pinned, false);
  assert.equal(older.favorite, false);

  const set = normalizeEntry({ id: 'new', notebook: '  Road   trip ', pinned: true, favorite: true });
  assert.equal(set.notebook, 'Road trip');
  assert.equal(set.pinned, true);
  assert.equal(set.favorite, true);

  assert.equal(normalizeEntry({ notebook: '   ' }).notebook, null);
  assert.equal(normalizeEntry({ notebook: 42 }).notebook, null);
  assert.equal(normalizeEntry({ notebook: 'n'.repeat(80) }).notebook.length, NOTEBOOK_MAX);
  assert.equal(normalizeEntry({ pinned: 'yes', favorite: 1 }).pinned, false);
});
