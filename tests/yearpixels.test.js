import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { daysInMonth, pixelState, yearGrid, yearSummaryText } from '../src/yearpixels.js';

const on = (date, extra = {}) => createEntry({ date, body: 'x', ...extra });

test('daysInMonth knows leap years and short months', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('a year has 365 squares, or 366 in a leap year, and 372 slots in total', () => {
  const squares = (year) => yearGrid([], year, '2030-01-01').months.flatMap((row) => row.cells).filter(Boolean).length;
  assert.equal(squares(2026), 365);
  assert.equal(squares(2028), 366);
  const grid = yearGrid([], 2026, '2030-01-01');
  assert.equal(grid.months.length, 12);
  assert.ok(grid.months.every((row) => row.cells.length === 31));
});

test('days that do not exist in a month are null cells, so Feb 30 is never drawn', () => {
  const feb = yearGrid([], 2026, '2030-01-01').months[1].cells;
  assert.equal(feb[27].date, '2026-02-28');
  assert.equal(feb[28], null);
  assert.equal(feb[30], null);
});

test('each square takes its state from the day: mood, written, empty, or future', () => {
  const entries = [
    on('2026-03-05', { mood: 'great' }),
    on('2026-03-06'), // written, no mood
    on('2026-03-07', { mood: 'rough' }),
    on('2026-03-07', { mood: 'good' }), // the day keeps the first mood it finds, most recent edit first
  ];
  const grid = yearGrid(entries, 2026, '2026-03-10');
  const march = grid.months[2].cells;
  assert.equal(pixelState(march[4]), 'great');
  assert.equal(pixelState(march[5]), 'written');
  assert.ok(['rough', 'good'].includes(pixelState(march[6])));
  assert.equal(pixelState(march[7]), 'empty');
  assert.equal(pixelState(march[9]), 'empty'); // March 10 is today, not future
  assert.equal(pixelState(march[10]), 'future'); // March 11
  assert.equal(pixelState(null), null);
});

test('sample entries do not color the year', () => {
  const grid = yearGrid([on('2026-03-05', { mood: 'great', sample: true })], 2026, '2026-03-10');
  assert.equal(pixelState(grid.months[2].cells[4]), 'empty');
  assert.equal(grid.stats.written, 0);
});

test('stats count days up to today and tally moods that were logged', () => {
  const entries = [
    on('2026-01-02', { mood: 'good' }),
    on('2026-01-03', { mood: 'good' }),
    on('2026-01-04', { mood: 'low' }),
    on('2026-01-05'),
    on('2026-06-01', { mood: 'rough' }), // after today, so it does not count
  ];
  const { stats } = yearGrid(entries, 2026, '2026-03-10');
  assert.equal(stats.elapsed, 31 + 28 + 10);
  assert.equal(stats.written, 4);
  assert.equal(stats.logged, 3);
  assert.equal(stats.top.id, 'good');
  assert.equal(stats.counts.rough, 0);
  assert.equal(yearSummaryText(yearGrid(entries, 2026, '2026-03-10')), '4 of 69 days written · 3 with a mood · most often good');
});

test('a year with no moods has no top mood', () => {
  const { stats } = yearGrid([on('2026-01-02')], 2026, '2026-03-10');
  assert.equal(stats.top, null);
  assert.equal(stats.logged, 0);
});
