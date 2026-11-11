import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entrySwipeStep, isCloseSwipe, movedBeyond, neighbourId } from '../src/gestures.js';

test('a finger that stays within the slop still counts as a hold', () => {
  assert.equal(movedBeyond({ x: 100, y: 100 }, { x: 106, y: 108 }), false);
  assert.equal(movedBeyond({ x: 100, y: 100 }, { x: 120, y: 100 }), true);
});

test('a quick sideways swipe moves one entry, left for next and right for previous', () => {
  assert.equal(entrySwipeStep({ dx: -120, dy: 6, ms: 250 }), 1);
  assert.equal(entrySwipeStep({ dx: 120, dy: -10, ms: 250 }), -1);
});

test('short, slow, or mostly vertical motion is not an entry swipe', () => {
  assert.equal(entrySwipeStep({ dx: -40, dy: 0, ms: 200 }), 0, 'too short');
  assert.equal(entrySwipeStep({ dx: -150, dy: 0, ms: 900 }), 0, 'too slow');
  assert.equal(entrySwipeStep({ dx: -90, dy: 80, ms: 200 }), 0, 'more vertical than sideways');
});

test('a downward swipe closes a dialog only when it is mostly vertical and long enough', () => {
  assert.equal(isCloseSwipe({ dx: 4, dy: 120, ms: 300 }), true);
  assert.equal(isCloseSwipe({ dx: 4, dy: 40, ms: 300 }), false, 'too short');
  assert.equal(isCloseSwipe({ dx: 150, dy: 100, ms: 300 }), false, 'mostly sideways');
  assert.equal(isCloseSwipe({ dx: 4, dy: 120, ms: 3000 }), false, 'too slow');
});

test('neighbours stop at the ends of the list and never wrap', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(neighbourId(ids, 'b', 1), 'c');
  assert.equal(neighbourId(ids, 'b', -1), 'a');
  assert.equal(neighbourId(ids, 'c', 1), null);
  assert.equal(neighbourId(ids, 'a', -1), null);
  assert.equal(neighbourId(ids, 'gone', 1), null);
});
