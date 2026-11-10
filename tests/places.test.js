import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACE_MAX, normalizeEntry, normalizePlace } from '../src/model.js';
import { countByPlace, filterEntries, resolvePlaceName } from '../src/library.js';
import { normalizeFilter } from '../src/savedsearches.js';

test('normalizePlace tidies spaces and drops blanks', () => {
  assert.equal(normalizePlace('  Lisbon  '), 'Lisbon');
  assert.equal(normalizePlace('Mom’s   kitchen'), 'Mom’s kitchen');
  assert.equal(normalizePlace('   '), null);
  assert.equal(normalizePlace(''), null);
  assert.equal(normalizePlace(42), null);
  assert.equal(normalizePlace(undefined), null);
});

test('normalizePlace caps the length', () => {
  const long = 'x'.repeat(PLACE_MAX + 20);
  assert.equal(normalizePlace(long).length, PLACE_MAX);
});

test('normalizeEntry keeps a place and reads older entries as null', () => {
  assert.equal(normalizeEntry({ place: ' Porto ' }).place, 'Porto');
  assert.equal(normalizeEntry({}).place, null);
});

test('countByPlace counts entries per place, sorted by name, and skips entries with none', () => {
  const entries = [
    { place: 'Porto' },
    { place: 'lisbon' },
    { place: 'Porto' },
    { place: null },
    {},
  ];
  assert.deepEqual(countByPlace(entries), [
    { name: 'lisbon', count: 1 },
    { name: 'Porto', count: 2 },
  ]);
});

test('resolvePlaceName reuses a known place ignoring case', () => {
  assert.equal(resolvePlaceName('  lisbon ', ['Lisbon', 'Porto']), 'Lisbon');
  assert.equal(resolvePlaceName('Madeira', ['Lisbon']), 'Madeira');
  assert.equal(resolvePlaceName('   ', ['Lisbon']), '');
});

test('filterEntries matches the place filter exactly', () => {
  const entries = [
    { title: 'A', place: 'Porto', tags: [], body: '' },
    { title: 'B', place: 'Lisbon', tags: [], body: '' },
    { title: 'C', place: null, tags: [], body: '' },
  ];
  const picked = filterEntries(entries, { filter: { type: 'place', value: 'Porto' } });
  assert.deepEqual(picked.map((entry) => entry.title), ['A']);
});

test('the text search finds entries by place', () => {
  const entries = [
    { title: 'Walk', place: 'Porto', tags: [], body: 'Rain all day.' },
    { title: 'Walk', place: 'Lisbon', tags: [], body: 'Rain all day.' },
  ];
  const found = filterEntries(entries, { query: 'porto' });
  assert.equal(found.length, 1);
  assert.equal(found[0].place, 'Porto');
});

test('saved searches keep a place filter with its name', () => {
  assert.deepEqual(normalizeFilter({ type: 'place', value: ' Porto ' }), { type: 'place', value: 'Porto' });
  // A place filter with no name falls back to all entries.
  assert.deepEqual(normalizeFilter({ type: 'place', value: '' }), { type: 'all', value: null });
});
