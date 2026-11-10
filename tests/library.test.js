import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { countByKind, countByTag, excerptOf, filterEntries, sortEntries } from '../src/library.js';

const sample = () => [
  createEntry({ id: 'a', title: 'Winter walk', date: '2026-01-05', kind: 'journal', tags: ['winter'], body: 'Cold and bright.', updatedAt: '2026-01-05T10:00:00.000Z' }),
  createEntry({ id: 'b', title: 'Harbor', date: '2026-03-02', kind: 'poem', tags: ['travel', 'winter'], body: '# Harbor\n\nGulls over the pier.', updatedAt: '2026-03-02T09:00:00.000Z' }),
  createEntry({ id: 'c', title: '', date: '2026-02-10', kind: 'journal', tags: [], body: 'A long day of ' + 'words '.repeat(40), updatedAt: '2026-02-11T08:00:00.000Z' }),
];

test('filterEntries narrows by kind and tag', () => {
  const entries = sample();
  assert.deepEqual(filterEntries(entries, { filter: { type: 'kind', value: 'poem' } }).map((e) => e.id), ['b']);
  assert.deepEqual(filterEntries(entries, { filter: { type: 'tag', value: 'winter' } }).map((e) => e.id).sort(), ['a', 'b']);
  assert.equal(filterEntries(entries, { filter: { type: 'all', value: null } }).length, 3);
});

test('filterEntries searches title, body, tags, and kind ignoring case', () => {
  const entries = sample();
  assert.deepEqual(filterEntries(entries, { query: 'GULLS' }).map((e) => e.id), ['b']);
  assert.deepEqual(filterEntries(entries, { query: '  travel ' }).map((e) => e.id), ['b']);
  assert.deepEqual(filterEntries(entries, { query: 'blog' }).map((e) => e.id), []);
  assert.deepEqual(filterEntries(entries, { query: 'poem' }).map((e) => e.id), ['b']);
});

test('sortEntries orders by each column and keeps newest-first on ties', () => {
  const entries = sample();
  assert.deepEqual(sortEntries(entries, { key: 'date', dir: 'desc' }).map((e) => e.id), ['b', 'c', 'a']);
  assert.deepEqual(sortEntries(entries, { key: 'date', dir: 'asc' }).map((e) => e.id), ['a', 'c', 'b']);
  // Titles: "Harbor", "Untitled" (no title and no heading), "Winter walk".
  assert.deepEqual(sortEntries(entries, { key: 'title', dir: 'asc' }).map((e) => e.id), ['b', 'c', 'a']);
  assert.deepEqual(sortEntries(entries, { key: 'words', dir: 'desc' }).map((e) => e.id)[0], 'c');
  assert.deepEqual(sortEntries(entries, { key: 'updatedAt', dir: 'desc' }).map((e) => e.id)[0], 'b');
});

test('sortEntries does not mutate its input', () => {
  const entries = sample();
  const before = entries.map((e) => e.id).join();
  sortEntries(entries, { key: 'title', dir: 'asc' });
  assert.equal(entries.map((e) => e.id).join(), before);
});

test('excerptOf strips Markdown and cuts long text at a word', () => {
  const entry = createEntry({ body: '# Harbor\n\n**Gulls** over the pier.' });
  assert.equal(excerptOf(entry), 'Harbor Gulls over the pier.');
  const long = createEntry({ body: 'word '.repeat(100) });
  const short = excerptOf(long, 50);
  assert.ok(short.endsWith('…'));
  assert.ok(short.length <= 51);
  assert.ok(!/\s…$/.test(short));
});

test('countByKind includes empty kinds and countByTag sorts tags', () => {
  const entries = sample();
  assert.deepEqual(countByKind(entries), { journal: 2, poem: 1, blog: 0, note: 0 });
  assert.deepEqual(countByTag(entries), [
    { tag: 'travel', count: 1 },
    { tag: 'winter', count: 2 },
  ]);
});
