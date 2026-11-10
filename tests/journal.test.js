import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import {
  dayStreaks,
  daysBetween,
  monthGrid,
  monthOf,
  bucketSeries,
  moodAverage,
  moodCounts,
  moodForScore,
  moodScore,
  moodSeries,
  onThisDay,
  shiftISODate,
  summarizeDays,
  todaysJournal,
} from '../src/journal.js';

const on = (date, extra = {}) => createEntry({ date, body: 'x', ...extra });

test('shiftISODate moves across month and year ends', () => {
  assert.equal(shiftISODate('2026-11-09', 1), '2026-11-10');
  assert.equal(shiftISODate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftISODate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftISODate('2028-02-28', 1), '2028-02-29');
});

test('monthGrid is six full Sunday-first weeks around the month', () => {
  // November 2026 starts on a Sunday, so no leading days.
  const nov = monthGrid(2026, 10);
  assert.equal(nov.weeks.length, 6);
  assert.ok(nov.weeks.every((week) => week.length === 7));
  assert.equal(nov.weeks[0][0].date, '2026-11-01');
  assert.equal(nov.weeks[0][0].inMonth, true);
  assert.equal(nov.weeks[5][6].date, '2026-12-12');
  assert.equal(nov.weeks[5][6].inMonth, false);

  // February 2026 starts on a Sunday too; March 2026 starts on a Sunday; June 2026 starts on a Monday.
  const june = monthGrid(2026, 5);
  assert.equal(june.weeks[0][0].date, '2026-05-31');
  assert.equal(june.weeks[0][0].inMonth, false);
  assert.equal(june.weeks[0][1].date, '2026-06-01');
  assert.equal(june.weeks[0][1].inMonth, true);
});

test('monthGrid lists each day of the month exactly once', () => {
  const cells = monthGrid(2028, 1).weeks.flat().filter((cell) => cell.inMonth);
  assert.equal(cells.length, 29); // leap February
  assert.deepEqual(cells.map((cell) => cell.day), Array.from({ length: 29 }, (_, i) => i + 1));
});

test('monthOf reads a date back into a 0-based month', () => {
  assert.deepEqual(monthOf('2026-11-09'), { year: 2026, month: 10 });
});

test('dayStreaks counts back from today when today has an entry', () => {
  const entries = [on('2026-11-08'), on('2026-11-09'), on('2026-11-10')];
  assert.deepEqual(dayStreaks(entries, '2026-11-10'), { current: 3, longest: 3, todayDone: true });
});

test('dayStreaks keeps yesterday alive until today is written', () => {
  const entries = [on('2026-11-08'), on('2026-11-09')];
  assert.deepEqual(dayStreaks(entries, '2026-11-10'), { current: 2, longest: 2, todayDone: false });
});

test('dayStreaks is zero after a missed day but keeps the best run', () => {
  const entries = [on('2026-11-01'), on('2026-11-02'), on('2026-11-03'), on('2026-11-07')];
  assert.deepEqual(dayStreaks(entries, '2026-11-10'), { current: 0, longest: 3, todayDone: false });
});

test('dayStreaks counts several entries on one day once', () => {
  const entries = [on('2026-11-09'), on('2026-11-09'), on('2026-11-09', { kind: 'poem' })];
  assert.deepEqual(dayStreaks(entries, '2026-11-09'), { current: 1, longest: 1, todayDone: true });
  assert.deepEqual(dayStreaks([], '2026-11-09'), { current: 0, longest: 0, todayDone: false });
});

test('summarizeDays counts entries and takes mood and weather from the latest edit', () => {
  const entries = [
    on('2026-11-09', { id: 'a', updatedAt: '2026-11-09T08:00:00.000Z', mood: 'low' }),
    on('2026-11-09', { id: 'b', updatedAt: '2026-11-09T20:00:00.000Z', mood: 'good', weather: 'rain' }),
    on('2026-11-10', { id: 'c', updatedAt: '2026-11-10T09:00:00.000Z' }),
  ];
  const summary = summarizeDays(entries);
  assert.deepEqual(summary['2026-11-09'], { count: 2, mood: 'good', weather: 'rain' });
  assert.deepEqual(summary['2026-11-10'], { count: 1, mood: null, weather: null });
  assert.equal(summary['2026-11-11'], undefined);
});

test("todaysJournal picks the latest journal dated today and ignores other kinds", () => {
  const entries = [
    on('2026-11-10', { id: 'old', kind: 'journal', updatedAt: '2026-11-10T06:00:00.000Z' }),
    on('2026-11-10', { id: 'new', kind: 'journal', updatedAt: '2026-11-10T18:00:00.000Z' }),
    on('2026-11-10', { id: 'poem', kind: 'poem', updatedAt: '2026-11-10T23:00:00.000Z' }),
    on('2026-11-09', { id: 'yday', kind: 'journal', updatedAt: '2026-11-09T23:00:00.000Z' }),
  ];
  assert.equal(todaysJournal(entries, '2026-11-10').id, 'new');
  assert.equal(todaysJournal(entries, '2026-11-12'), null);
});

test('daysBetween counts whole calendar days, across month and leap-year edges', () => {
  assert.equal(daysBetween('2026-11-10', '2026-11-10'), 0);
  assert.equal(daysBetween('2026-11-01', '2026-11-10'), 9);
  assert.equal(daysBetween('2026-11-10', '2026-11-01'), -9);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('moodScore maps the mood list to 1 (rough) through 5 (great)', () => {
  assert.equal(moodScore('great'), 5);
  assert.equal(moodScore('okay'), 3);
  assert.equal(moodScore('rough'), 1);
  assert.equal(moodScore(null), null);
  assert.equal(moodScore('unknown'), null);
});

test('moodSeries gives one point per day, oldest first, with gaps where nothing was logged', () => {
  const entries = [
    on('2026-11-08', { mood: 'low' }),
    on('2026-11-10', { mood: 'great' }),
    on('2026-11-10', { mood: 'good' }), // same day: the most recently edited mood wins
  ];
  entries[2].updatedAt = '2099-01-01T00:00:00.000Z';
  const series = moodSeries(entries, '2026-11-10', 4);
  assert.deepEqual(series.map((point) => point.date), ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(series.map((point) => point.score), [null, 2, null, 4]);
  assert.equal(series[3].mood, 'good');
});

test('moodAverage ignores days without a mood and returns null when there are none', () => {
  const series = moodSeries([on('2026-11-08', { mood: 'great' }), on('2026-11-09', { mood: 'low' })], '2026-11-10', 5);
  assert.equal(moodAverage(series), 3.5);
  assert.equal(moodAverage(moodSeries([], '2026-11-10', 5)), null);
});

test('moodForScore picks the nearest mood and clamps to the list', () => {
  assert.equal(moodForScore(null), null);
  assert.equal(moodForScore(4.4).id, 'good');
  assert.equal(moodForScore(4.6).id, 'great');
  assert.equal(moodForScore(0.2).id, 'rough');
});

test('moodCounts lists every mood in order, with zeros for unused ones', () => {
  const series = moodSeries(
    [on('2026-11-08', { mood: 'good' }), on('2026-11-09', { mood: 'good' }), on('2026-11-10', { mood: 'rough' })],
    '2026-11-10',
    5,
  );
  assert.deepEqual(
    moodCounts(series).map((item) => [item.id, item.count]),
    [['great', 0], ['good', 2], ['okay', 0], ['low', 0], ['rough', 1]],
  );
});

test('onThisDay groups earlier years on the same month and day, nearest year first', () => {
  const entries = [
    on('2023-11-10', { title: 'three back' }),
    on('2025-11-10', { title: 'one back' }),
    on('2025-11-10', { title: 'one back, later' }),
    on('2026-11-10', { title: 'this year, skipped' }),
    on('2025-11-11', { title: 'wrong day' }),
    on('2024-06-10', { title: 'wrong month' }),
  ];
  entries[2].updatedAt = '2099-01-01T00:00:00.000Z';
  const groups = onThisDay(entries, '2026-11-10');
  assert.deepEqual(groups.map((group) => group.yearsAgo), [1, 3]);
  assert.deepEqual(groups.map((group) => group.year), [2025, 2023]);
  // Within a year, the most recently edited entry comes first.
  assert.equal(groups[0].entries[0].title, 'one back, later');
  assert.equal(groups[0].entries.length, 2);
});

test('onThisDay is empty when nothing was written on this day in an earlier year', () => {
  assert.deepEqual(onThisDay([on('2026-11-10')], '2026-11-10'), []);
});

test('bucketSeries averages each run of days and keeps empty buckets as gaps', () => {
  const series = moodSeries(
    [on('2026-11-02', { mood: 'great' }), on('2026-11-03', { mood: 'low' }), on('2026-11-09', { mood: 'okay' })],
    '2026-11-10',
    14,
  );
  const buckets = bucketSeries(series, 7);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].date, '2026-10-28');
  assert.equal(buckets[0].endDate, '2026-11-03');
  assert.equal(buckets[0].score, 3.5);
  assert.equal(buckets[0].mood, 'good'); // 3.5 rounds up
  assert.equal(buckets[1].date, '2026-11-04');
  assert.equal(buckets[1].score, 3);
  assert.equal(bucketSeries(moodSeries([], '2026-11-10', 7), 7)[0].score, null);
});
