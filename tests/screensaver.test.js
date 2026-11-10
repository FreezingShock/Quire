import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  idleReached,
  normalizeIdleMinutes,
  normalizeScreensaver,
  pickMemories,
  sceneFor,
} from '../src/screensaver.js';
import { createEntry } from '../src/model.js';

const TODAY = '2026-11-10';
const seeded = (n) => {
  let s = n;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

function entry(fields) {
  return { ...createEntry({ body: 'Some words here.', ...fields }), updatedAt: fields.updatedAt ?? '2026-01-01T00:00:00.000Z' };
}

test('unknown screensaver ids read as off', () => {
  assert.equal(normalizeScreensaver('aurora'), 'aurora');
  assert.equal(normalizeScreensaver('pipes'), 'off');
  assert.equal(normalizeScreensaver(undefined), 'off');
});

test('idle minutes stay in range and fall back to five', () => {
  assert.equal(normalizeIdleMinutes(0), 1);
  assert.equal(normalizeIdleMinutes(9999), 60);
  assert.equal(normalizeIdleMinutes('12'), 12);
  assert.equal(normalizeIdleMinutes('nope'), 5);
});

test('idle time is measured from the last input', () => {
  const minute = 60_000;
  assert.equal(idleReached(5 * minute - 1, 0, 5), false);
  assert.equal(idleReached(5 * minute, 0, 5), true);
  assert.equal(idleReached(10 * minute, 9 * minute, 5), false);
});

test('with the passcode lock on, Memories falls back to Aurora', () => {
  assert.equal(sceneFor('memories', { locked: true, hasMemories: true }), 'aurora');
  assert.equal(sceneFor('memories', { locked: false, hasMemories: false }), 'aurora');
  assert.equal(sceneFor('memories', { locked: false, hasMemories: true }), 'memories');
  assert.equal(sceneFor('bubbles', { locked: true, hasMemories: true }), 'bubbles');
});

test('On this day entries from earlier years come first', () => {
  const entries = [
    entry({ id: 'recent', date: '2026-09-01', title: 'Recent', updatedAt: '2026-09-02T00:00:00.000Z' }),
    entry({ id: 'otd-1', date: '2025-11-10', title: 'Last year' }),
    entry({ id: 'otd-3', date: '2023-11-10', title: 'Three years' }),
    entry({ id: 'this-year', date: '2026-11-10', title: 'Today' }),
  ];
  const { list } = pickMemories(entries, TODAY, seeded(7));
  assert.deepEqual(list.slice(0, 2).map((m) => m.entry.id).sort(), ['otd-1', 'otd-3']);
  assert.ok(list.slice(0, 2).every((m) => m.otd));
  assert.equal(list.find((m) => m.entry.id === 'otd-3').yearsAgo, 3);
  assert.equal(list.find((m) => m.entry.id === 'this-year').otd, false, 'this year is never an On this day memory');
});

test('sample and blank entries never drift past', () => {
  const entries = [
    entry({ id: 'sample', date: '2025-11-10', body: 'Welcome', sample: true }),
    entry({ id: 'blank', date: '2025-11-10', body: '', title: '' }),
    entry({ id: 'real', date: '2025-11-10', body: 'Kept' }),
  ];
  const ids = pickMemories(entries, TODAY, seeded(3)).list.map((m) => m.entry.id);
  assert.deepEqual(ids, ['real']);
});

test('a title alone is enough to drift past, and a blank entry is not', () => {
  const entries = [
    entry({ id: 'text', date: '2026-02-02', body: 'Words' }),
    entry({ id: 'empty-title-only', date: '2026-02-03', body: '', title: 'Just a title' }),
  ];
  const ids = pickMemories(entries, TODAY, seeded(5)).list.map((m) => m.entry.id);
  assert.deepEqual(ids.sort(), ['empty-title-only', 'text']);
});

test('the pool holds at most 24 recent memories', () => {
  const entries = Array.from({ length: 40 }, (_, i) =>
    entry({ id: `e${i}`, date: '2026-01-01', body: `Entry ${i}`, updatedAt: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00.000Z` }),
  );
  assert.equal(pickMemories(entries, TODAY, seeded(1)).list.length, 24);
});
