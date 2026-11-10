import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { dayStreaks, monthGrid, monthOf, shiftISODate, summarizeDays, todaysJournal } from '../src/journal.js';

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
