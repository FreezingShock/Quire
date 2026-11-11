import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVED_SEARCH_MAX,
  addSavedSearch,
  normalizeFilter,
  normalizeSavedSearches,
  removeSavedSearch,
  savedSearchProblem,
} from '../src/savedsearches.js';

test('normalizeFilter keeps known filters and drops values the type does not use', () => {
  assert.deepEqual(normalizeFilter({ type: 'tag', value: ' travel ' }), { type: 'tag', value: 'travel' });
  assert.deepEqual(normalizeFilter({ type: 'tag', value: '' }), { type: 'all', value: null });
  assert.deepEqual(normalizeFilter({ type: 'favorite', value: 'x' }), { type: 'favorite', value: null });
  assert.deepEqual(normalizeFilter({ type: 'bogus' }), { type: 'all', value: null });
  assert.deepEqual(normalizeFilter(null), { type: 'all', value: null });
});

test('normalizeSavedSearches drops broken and duplicate rows and caps the list', () => {
  const raw = [
    { id: 'a', name: ' Winter ', query: 'snow', filter: { type: 'all' } },
    { id: 'a', name: 'Duplicate id' },
    { id: 'b', name: '' },
    { name: 'No id' },
    'nonsense',
  ];
  const list = normalizeSavedSearches(raw);
  assert.deepEqual(list, [{ id: 'a', name: 'Winter', query: 'snow', filter: { type: 'all', value: null } }]);
  const many = Array.from({ length: SAVED_SEARCH_MAX + 5 }, (_, i) => ({ id: `s${i}`, name: `Search ${i}` }));
  assert.equal(normalizeSavedSearches(many).length, SAVED_SEARCH_MAX);
  assert.deepEqual(normalizeSavedSearches(undefined), []);
});

test('savedSearchProblem explains what is missing', () => {
  assert.match(savedSearchProblem([], { name: '  ', query: 'x' }), /name/);
  assert.match(savedSearchProblem([], { name: 'Empty', query: '  ' }), /Type a search/);
  assert.equal(savedSearchProblem([], { name: 'Tagged', filter: { type: 'tag', value: 'travel' } }), null);
  const full = Array.from({ length: SAVED_SEARCH_MAX }, (_, i) => ({ id: `s${i}`, name: `Search ${i}`, query: 'a', filter: { type: 'all', value: null } }));
  assert.match(savedSearchProblem(full, { name: 'One more', query: 'b' }), /Remove a saved search/);
  // Replacing a search with the same name is allowed even at the limit.
  assert.equal(savedSearchProblem(full, { name: 'search 3', query: 'b' }), null);
});

test('addSavedSearch adds a search and replaces one with the same name', () => {
  let list = addSavedSearch([], { name: '  Trips ', query: ' rain ', filter: { type: 'tag', value: 'travel' } });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Trips');
  assert.equal(list[0].query, 'rain');
  assert.deepEqual(list[0].filter, { type: 'tag', value: 'travel' });
  const id = list[0].id;
  list = addSavedSearch(list, { name: 'trips', query: 'snow', filter: { type: 'all' } });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].query, 'snow');
  assert.equal(removeSavedSearch(list, id).length, 0);
});
