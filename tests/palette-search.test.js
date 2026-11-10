import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, normalizeText, rankItems } from '../src/palette-search.js';

test('normalizeText lowercases and turns punctuation into word breaks', () => {
  assert.equal(normalizeText('Ctrl+Shift+H'), 'ctrl shift h');
  assert.equal(normalizeText('  Today’s date  '), 'today s date');
});

test('an empty query matches everything with score 0', () => {
  assert.equal(matchScore('', 'New entry'), 0);
  assert.equal(matchScore('   ', 'New entry'), 0);
});

test('every query word has to match', () => {
  assert.equal(matchScore('new zebra', 'New entry'), null);
  assert.ok(matchScore('new entry', 'New entry') > 0);
});

test('letters in order with gaps still match, and tight matches score higher', () => {
  assert.ok(matchScore('nwent', 'New entry') !== null);
  assert.equal(matchScore('zz', 'New entry'), null);
  assert.ok(matchScore('ent', 'Entry') > matchScore('ent', 'Open the current document entries'));
});

test('ranking puts label matches ahead of group or keyword matches', () => {
  const items = [
    { id: 'a', label: 'Export as Markdown…', group: 'File' },
    { id: 'b', label: 'Heading 1', group: 'Format', keywords: 'markdown title' },
    { id: 'c', label: 'Markdown source mode', group: 'View' },
  ];
  const ids = rankItems(items, 'markdown').map((item) => item.id);
  // Both label matches come first; the one that starts with the query wins the tie-break.
  assert.deepEqual(ids.slice(0, 2).sort(), ['a', 'c']);
  assert.equal(ids[0], 'c');
  assert.equal(ids[2], 'b');
});

test('ranking keeps the original order for an empty query and respects the limit', () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ id: String(i), label: `Item ${i}` }));
  const ids = rankItems(items, '').map((item) => item.id);
  assert.equal(ids.length, 60);
  assert.equal(ids[0], '0');
  assert.equal(rankItems(items, '', { limit: 5 }).length, 5);
});

test('non-matching items are dropped', () => {
  const items = [{ id: 'a', label: 'Undo' }, { id: 'b', label: 'Redo' }];
  assert.deepEqual(rankItems(items, 'zzq').map((item) => item.id), []);
});
