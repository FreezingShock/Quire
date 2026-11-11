import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_ESTIMATE_PX, visibleRange } from '../src/virtual-rows.js';
import { formatShortDate } from '../src/model.js';

test('an empty list or an unknown row height builds nothing', () => {
  assert.deepEqual(visibleRange({ count: 0, rowHeight: 28, offset: 0, viewport: 500 }), { start: 0, end: 0 });
  assert.deepEqual(visibleRange({ count: 50, rowHeight: 0, offset: 0, viewport: 500 }), { start: 0, end: 0 });
});

test('the top of a list builds the rows on screen plus the overscan below them', () => {
  // 500px viewport at 28px rows is 18 rows, plus 8 rows of overscan below.
  assert.deepEqual(visibleRange({ count: 2000, rowHeight: 28, offset: 0, viewport: 500 }), { start: 0, end: 26 });
});

test('scrolling down moves the window and keeps the overscan above the screen', () => {
  // The viewport starts at row 100 (2800px), so rows 92 to 126 are built.
  assert.deepEqual(visibleRange({ count: 2000, rowHeight: 28, offset: 2800, viewport: 500 }), { start: 92, end: 126 });
});

test('a list that is scrolled above the table starts at the first row', () => {
  assert.deepEqual(visibleRange({ count: 2000, rowHeight: 28, offset: -300, viewport: 500 }), { start: 0, end: 26 });
});

test('the window never runs past the last row', () => {
  const range = visibleRange({ count: 30, rowHeight: 28, offset: 800, viewport: 500 });
  assert.equal(range.end, 30);
  assert.ok(range.start <= range.end);
  assert.deepEqual(visibleRange({ count: 30, rowHeight: 28, offset: 5000, viewport: 500 }), { start: 30, end: 30 });
});

test('the estimate is a sensible starting height for a one-line row', () => {
  assert.ok(ROW_ESTIMATE_PX >= 20 && ROW_ESTIMATE_PX <= 40);
});

test('short dates read the same as the browser formats them, and format once', () => {
  const iso = '2024-03-09';
  const expected = new Date(2024, 2, 9).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  assert.equal(formatShortDate(iso), expected);
  assert.equal(formatShortDate(iso), formatShortDate(iso));
});
