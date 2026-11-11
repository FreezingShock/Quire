import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { longestRun, recapLines, yearRecap } from '../src/recap.js';

const today = '2026-06-15';
const e = (id, date, fields = {}) => createEntry({ id, date, title: `Day ${id}`, body: 'word '.repeat(10), ...fields });

test('longestRun counts consecutive days and ignores gaps', () => {
  assert.equal(longestRun([]), 0);
  assert.equal(longestRun(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06']), 3);
  assert.equal(longestRun(['2026-02-27', '2026-02-28', '2026-03-01']), 3);
});

test('yearRecap counts one year, skips the sample, sealed and future entries', () => {
  const entries = [
    e('a', '2026-01-03', { mood: 'good', tags: ['travel'], favorite: true, body: 'one two three four five' }),
    e('b', '2026-01-04', { mood: 'good', tags: ['travel', 'winter'], kind: 'poem' }),
    e('c', '2026-03-10', { mood: 'low', tags: ['travel'] }),
    e('sample', '2026-01-01', { sample: true }),
    e('future', '2026-07-01'),
    e('sealed', '2026-02-02', { capsule: { openOn: '2030-01-01', sealedAt: '2026-02-02T00:00:00.000Z' } }),
    e('old', '2025-12-31'),
  ];
  const recap = yearRecap(entries, 2026, today);
  assert.equal(recap.entries, 3);
  assert.equal(recap.days, 3);
  assert.equal(recap.words, 25);
  // Day b and Day c both have 10 words; the earlier one in the list wins.
  assert.equal(recap.longest.title, 'Day b');
  assert.equal(recap.busiestMonth.name, 'January');
  assert.equal(recap.topMood.label, 'Good');
  assert.equal(recap.topTags[0].tag, 'travel');
  assert.equal(recap.topTags[0].count, 3);
  assert.equal(recap.first.date, '2026-01-03');
  assert.equal(recap.favorites, 1);
  assert.equal(recap.longestStreak, 2);
  assert.equal(recap.currentStreak, 0);
});

test('a past year has no current streak and an empty year reads as none', () => {
  const recap = yearRecap([e('a', '2024-05-05')], 2024, today);
  assert.equal(recap.currentStreak, null);
  const empty = yearRecap([], 2020, today);
  assert.equal(empty.entries, 0);
  assert.equal(empty.busiestMonth, null);
  assert.equal(empty.longest, null);
  const lines = recapLines(empty).map(([label]) => label);
  assert.ok(lines.includes('Longest run of days in a row'));
  assert.ok(!lines.includes('Busiest month'));
});
