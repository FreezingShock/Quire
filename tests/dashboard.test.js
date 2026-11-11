import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { greetingFor, isFirstRun, lastDays, monthSummary, recentEntries, welcomeBack } from '../src/dashboard.js';

const on = (date, extra = {}) => createEntry({ date, body: 'one two three', ...extra });

test('greetingFor follows the hour of the day', () => {
  assert.equal(greetingFor(0), 'Good evening');
  assert.equal(greetingFor(8), 'Good morning');
  assert.equal(greetingFor(11), 'Good morning');
  assert.equal(greetingFor(12), 'Good afternoon');
  assert.equal(greetingFor(17), 'Good afternoon');
  assert.equal(greetingFor(18), 'Good evening');
});

test('isFirstRun is true only when every entry is the sample', () => {
  assert.equal(isFirstRun([]), false);
  assert.equal(isFirstRun([on('2026-11-10', { sample: true })]), true);
  assert.equal(isFirstRun([on('2026-11-10', { sample: true }), on('2026-11-09')]), false);
});

test('monthSummary counts entries and words in the month of today only', () => {
  const entries = [
    on('2026-11-01', { body: 'a b' }),
    on('2026-11-10', { body: 'a b c' }),
    on('2026-10-31', { body: 'a b c d e' }),
  ];
  assert.deepEqual(monthSummary(entries, '2026-11-10'), { count: 2, words: 5 });
  assert.deepEqual(monthSummary([], '2026-11-10'), { count: 0, words: 0 });
});

test('recentEntries returns the most recently edited entries first, up to the limit', () => {
  const entries = [
    createEntry({ id: 'a', date: '2026-01-01', updatedAt: '2026-01-02T10:00:00.000Z', body: '' }),
    createEntry({ id: 'b', date: '2026-01-05', updatedAt: '2026-03-01T10:00:00.000Z', body: '' }),
    createEntry({ id: 'c', date: '2026-01-03', updatedAt: '2026-02-01T10:00:00.000Z', body: '' }),
  ];
  assert.deepEqual(recentEntries(entries, 2).map((entry) => entry.id), ['b', 'c']);
  assert.equal(recentEntries(entries).length, 3);
  // The input array is not reordered.
  assert.deepEqual(entries.map((entry) => entry.id), ['a', 'b', 'c']);
});

test('lastDays returns seven days ending today, oldest first, with counts and moods', () => {
  const entries = [
    on('2026-11-04', { mood: 'great' }),
    on('2026-11-10', { mood: 'low' }),
    on('2026-11-10'),
    on('2026-10-01'),
  ];
  const days = lastDays(entries, '2026-11-10');
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => day.date), [
    '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10',
  ]);
  assert.deepEqual(days[0], { date: '2026-11-04', count: 1, mood: 'great', isToday: false });
  assert.deepEqual(days[1], { date: '2026-11-05', count: 0, mood: null, isToday: false });
  assert.deepEqual(days[6], { date: '2026-11-10', count: 2, mood: 'low', isToday: true });
});

test('lastDays crosses a month boundary', () => {
  const days = lastDays([], '2026-03-02');
  assert.equal(days[0].date, '2026-02-24');
  assert.equal(days[6].date, '2026-03-02');
});

test('greetingFor adds the name when one is set', () => {
  assert.equal(greetingFor(9, 'Nate'), 'Good morning, Nate');
  assert.equal(greetingFor(20, ''), 'Good evening');
});

test('welcomeBack appears only after the gap, and ignores sample entries', () => {
  const today = '2026-11-10';
  const old = createEntry({ date: '2026-11-01', body: 'Old page', title: 'Old page' });
  old.updatedAt = '2026-11-01T12:00:00.000Z';
  const sample = createEntry({ date: '2026-11-01', body: 'Sample', sample: true });
  sample.updatedAt = '2026-11-09T12:00:00.000Z';
  const back = welcomeBack([old, sample], today);
  assert.equal(back.entry.id, old.id);
  assert.equal(back.days, 9);

  const recent = createEntry({ date: '2026-11-09', body: 'Recent' });
  recent.updatedAt = '2026-11-09T12:00:00.000Z';
  assert.equal(welcomeBack([recent], today), null, 'two days away is not a gap yet');
  assert.equal(welcomeBack([], today), null);
  assert.equal(welcomeBack([sample], today), null, 'only the sample is not a history');
});
