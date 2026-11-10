import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import {
  countByKind,
  countByMood,
  countByNotebook,
  countByTag,
  countByWeather,
  countFlags,
  excerptOf,
  filterEntries,
  resolveNotebookName,
  highlightParts,
  parseQuery,
  snippetOf,
  sortEntries,
} from '../src/library.js';

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
  // The first heading is the title, which the card already shows, so the preview starts with the text.
  assert.equal(excerptOf(entry), 'Gulls over the pier.');
  const titled = createEntry({ title: 'Harbor', body: '# Harbor\n\nGulls over the pier.' });
  assert.equal(excerptOf(titled), 'Gulls over the pier.');
  // A heading that is not the title stays in the preview.
  const other = createEntry({ title: 'Trip', body: '## Day one\n\nGulls over the pier.' });
  assert.equal(excerptOf(other), 'Day one Gulls over the pier.');
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

test('filterEntries narrows by mood and weather, and search finds their labels', () => {
  const entries = [
    createEntry({ id: 'a', date: '2026-01-05', mood: 'good', weather: 'rain', body: 'Wet street.' }),
    createEntry({ id: 'b', date: '2026-01-06', mood: 'low', weather: null, body: 'Quiet day.' }),
    createEntry({ id: 'c', date: '2026-01-07', mood: null, weather: 'snow', body: 'Flakes.' }),
  ];
  assert.deepEqual(filterEntries(entries, { filter: { type: 'mood', value: 'low' } }).map((e) => e.id), ['b']);
  assert.deepEqual(filterEntries(entries, { filter: { type: 'weather', value: 'snow' } }).map((e) => e.id), ['c']);
  assert.deepEqual(filterEntries(entries, { query: 'rain' }).map((e) => e.id), ['a']);
  assert.deepEqual(filterEntries(entries, { query: 'good' }).map((e) => e.id), ['a']);
});

test('countByMood and countByWeather list only values in use, in option order', () => {
  const entries = [
    createEntry({ mood: 'rough', weather: 'storm' }),
    createEntry({ mood: 'great', weather: null }),
    createEntry({ mood: 'rough', weather: 'sunny' }),
    createEntry({ mood: null, weather: null }),
  ];
  assert.deepEqual(countByMood(entries).map(({ id, count }) => [id, count]), [['great', 1], ['rough', 2]]);
  assert.deepEqual(countByWeather(entries).map(({ id, label }) => [id, label]), [['sunny', 'Sunny'], ['storm', 'Storm']]);
});

test('parseQuery splits words and keeps quoted phrases whole', () => {
  assert.deepEqual(parseQuery('  Winter   WALK harbor '), ['winter', 'walk', 'harbor']);
  assert.deepEqual(parseQuery('"winter walk" harbor'), ['winter walk', 'harbor']);
  assert.deepEqual(parseQuery('gulls gulls GULLS'), ['gulls']);
  assert.deepEqual(parseQuery('   '), []);
  assert.equal(parseQuery('a b c d e f g h i j k').length, 8);
});

test('filterEntries needs every term, so a multi-word search narrows the list', () => {
  const entries = sample();
  assert.deepEqual(filterEntries(entries, { query: 'cold bright' }).map((e) => e.id), ['a']);
  assert.deepEqual(filterEntries(entries, { query: 'cold harbor' }).map((e) => e.id), []);
  assert.deepEqual(filterEntries(entries, { query: '"cold and bright"' }).map((e) => e.id), ['a']);
  assert.deepEqual(filterEntries(entries, { query: '"bright cold"' }).map((e) => e.id), []);
});

test('full-text search reads the rendered text, not Markdown markers', () => {
  const entries = sample();
  assert.deepEqual(filterEntries(entries, { query: 'harbor' }).map((e) => e.id), ['b']);
  assert.deepEqual(filterEntries(entries, { query: '# harbor' }).map((e) => e.id), []);
  assert.deepEqual(filterEntries(entries, { query: 'winter' }).map((e) => e.id).sort(), ['a', 'b']);
});

test('highlightParts splits text around case-insensitive hits', () => {
  assert.deepEqual(highlightParts('Gulls over the GULLS', ['gulls']), [
    { text: 'Gulls', hit: true },
    { text: ' over the ', hit: false },
    { text: 'GULLS', hit: true },
  ]);
  assert.deepEqual(highlightParts('plain', []), [{ text: 'plain', hit: false }]);
  assert.deepEqual(highlightParts('a+b (c)', ['(c)']), [
    { text: 'a+b ', hit: false },
    { text: '(c)', hit: true },
  ]);
  assert.deepEqual(highlightParts('', ['x']), [{ text: '', hit: false }]);
});

test('snippetOf centers the snippet on the first hit with ellipses', () => {
  const body = 'Lorem ipsum dolor sit amet. '.repeat(10) + 'The harbor was quiet at dawn. ' + 'Dolor sit amet again. '.repeat(10);
  const entry = createEntry({ id: 's', title: 'Long', body });
  const snippet = snippetOf(entry, ['harbor'], 80);
  assert.ok(snippet.includes('harbor'));
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(snippet.length <= 90);
  // No term means the plain excerpt, so the list shows the start of the entry.
  assert.equal(snippetOf(entry, [], 40), excerptOf(entry, 40));
  assert.equal(snippetOf(createEntry({ id: 'n', body: 'Short' }), ['harbor']), 'Short');
});

test('sortEntries keeps pinned entries above the rest, in the chosen order', () => {
  const entries = [
    createEntry({ id: 'x', title: 'Zeta', date: '2026-04-01', body: '' }),
    createEntry({ id: 'y', title: 'Alpha', date: '2026-02-01', body: '', pinned: true }),
    createEntry({ id: 'z', title: 'Mid', date: '2026-03-01', body: '', pinned: true }),
  ];
  assert.deepEqual(sortEntries(entries, { key: 'date', dir: 'desc' }).map((e) => e.id), ['z', 'y', 'x']);
  assert.deepEqual(sortEntries(entries, { key: 'title', dir: 'asc' }).map((e) => e.id), ['y', 'z', 'x']);
});

test('filterEntries filters by pinned, favorite, and notebook', () => {
  const entries = [
    createEntry({ id: 'p', body: '', pinned: true, notebook: 'Travel' }),
    createEntry({ id: 'f', body: '', favorite: true }),
    createEntry({ id: 'n', body: '', notebook: 'Travel' }),
    createEntry({ id: 'o', body: '' }),
  ];
  assert.deepEqual(filterEntries(entries, { filter: { type: 'pinned', value: null } }).map((e) => e.id), ['p']);
  assert.deepEqual(filterEntries(entries, { filter: { type: 'favorite', value: null } }).map((e) => e.id), ['f']);
  assert.deepEqual(filterEntries(entries, { filter: { type: 'notebook', value: 'Travel' } }).map((e) => e.id), ['p', 'n']);
  assert.deepEqual(filterEntries(entries, { filter: { type: 'notebook', value: 'Work' } }).map((e) => e.id), []);
  // The notebook name is searchable too.
  assert.deepEqual(filterEntries(entries, { query: 'travel' }).map((e) => e.id), ['p', 'n']);
});

test('countByNotebook and countFlags count what is in use', () => {
  const entries = [
    createEntry({ id: 'a', body: '', notebook: 'Work', pinned: true }),
    createEntry({ id: 'b', body: '', notebook: 'Travel' }),
    createEntry({ id: 'c', body: '', notebook: 'Work' }),
    createEntry({ id: 'd', body: '', favorite: true }),
  ];
  assert.deepEqual(countByNotebook(entries), [
    { name: 'Travel', count: 1 },
    { name: 'Work', count: 2 },
  ]);
  assert.deepEqual(countFlags(entries), { pinned: 1, favorite: 1 });
});

test('resolveNotebookName reuses an existing notebook whose name differs only in case', () => {
  const notebooks = ['Work', 'Travel'];
  assert.equal(resolveNotebookName('work', notebooks), 'Work');
  assert.equal(resolveNotebookName('  TRAVEL  ', notebooks), 'Travel');
  assert.equal(resolveNotebookName('Poems', notebooks), 'Poems');
});

test('resolveNotebookName tidies whitespace and gives empty input as an empty name', () => {
  assert.equal(resolveNotebookName('  Day   job ', []), 'Day job');
  assert.equal(resolveNotebookName('   ', ['Work']), '');
  assert.equal(resolveNotebookName(undefined), '');
});
