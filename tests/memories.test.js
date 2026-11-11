import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { memoryCandidates, pickRandomMemory } from '../src/memories.js';

const today = '2026-06-15';
const written = (id, date, extra = {}) => createEntry({ id, date, title: `Entry ${id}`, body: `Words for ${id}.`, ...extra });

test('memoryCandidates leaves out the sample, blank entries and sealed capsules', () => {
  const entries = [
    written('a', '2025-01-02'),
    written('sample', '2025-01-03', { sample: true }),
    createEntry({ id: 'blank', date: '2025-01-04', title: '', body: '   ' }),
    written('sealed', '2025-01-05', { capsule: { openOn: '2030-01-01', sealedAt: '2025-01-05T00:00:00.000Z' } }),
  ];
  assert.deepEqual(memoryCandidates(entries, today).map((e) => e.id), ['a']);
});

test('memoryCandidates prefers past days over today', () => {
  const entries = [written('old', '2025-03-01'), written('now', today)];
  assert.deepEqual(memoryCandidates(entries, today).map((e) => e.id), ['old']);
});

test('memoryCandidates falls back to today when nothing is older', () => {
  const entries = [written('now', today)];
  assert.deepEqual(memoryCandidates(entries, today).map((e) => e.id), ['now']);
});

test('pickRandomMemory uses the random source to choose and stays in range', () => {
  const entries = [written('a', '2025-01-02'), written('b', '2025-01-03'), written('c', '2025-01-04')];
  assert.equal(pickRandomMemory(entries, today, () => 0).id, 'a');
  assert.equal(pickRandomMemory(entries, today, () => 0.5).id, 'b');
  assert.equal(pickRandomMemory(entries, today, () => 0.999999).id, 'c');
  assert.equal(pickRandomMemory(entries, today, () => 1).id, 'c');
});

test('pickRandomMemory returns null when there is nothing to reopen', () => {
  assert.equal(pickRandomMemory([], today), null);
  assert.equal(pickRandomMemory([written('s', '2025-01-01', { sample: true })], today), null);
});
