import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constrainLine, constrainSquare, shapeEnd, snapToGrid } from '../src/snap.js';

const angleOf = ([x, y]) => (Math.atan2(y, x) * 180) / Math.PI;
const near = (actual, expected, eps = 0.15) => assert.ok(Math.abs(actual - expected) < eps, `got ${actual}, want ${expected}`);

test('snapToGrid rounds each axis to the nearest grid node', () => {
  assert.deepEqual(snapToGrid([37, 12]), [25, 0]);
  assert.deepEqual(snapToGrid([38, 13]), [50, 25]);
  assert.deepEqual(snapToGrid([-14, 0]), [-25, 0]);
});

test('a nearly horizontal drag becomes exactly horizontal and keeps its length', () => {
  const end = constrainLine([100, 100], [300, 110], 45);
  near(end[1], 100);
  near(end[0], 100 + Math.hypot(200, 10));
});

test('a diagonal-ish drag snaps to 45 degrees and keeps its length', () => {
  const end = constrainLine([100, 100], [200, 190], 45);
  const len = Math.hypot(100, 90);
  near(end[0], 100 + len * Math.SQRT1_2);
  near(end[1], 100 + len * Math.SQRT1_2);
});

test('a 15 degree snap lands on a multiple of 15 degrees', () => {
  const end = constrainLine([0, 0], [100, 30], 15);
  near(angleOf(end), 15, 0.01);
  near(Math.hypot(...end), Math.hypot(100, 30));
});

test('a zero-length line stays at its start', () => {
  assert.deepEqual(constrainLine([5, 5], [5, 5], 45), [5, 5]);
});

test('constrainSquare keeps the longer drag and the direction the pointer went', () => {
  assert.deepEqual(constrainSquare([100, 100], [160, 130]), [160, 160]);
  assert.deepEqual(constrainSquare([100, 100], [40, 130]), [40, 160]);
  assert.deepEqual(constrainSquare([100, 100], [60, 40]), [40, 40]);
  assert.deepEqual(constrainSquare([100, 100], [100, 100]), [100, 100]);
});

test('shapeEnd with shift makes a rectangle or ellipse square and a line 45 degrees', () => {
  assert.deepEqual(shapeEnd('rect', [0, 0], [200, 120], { shift: true }), [200, 200]);
  assert.deepEqual(shapeEnd('ellipse', [0, 0], [-50, 120], { shift: true }), [-120, 120]);
  const line = shapeEnd('line', [0, 0], [200, 60], { shift: true });
  near(line[1], 0); // 16.7 degrees rounds to 0
  const diagonal = shapeEnd('line', [0, 0], [100, 90], { shift: true });
  near(angleOf(diagonal), 45, 0.01);
});

test('without modifiers a shape end is the raw point', () => {
  assert.deepEqual(shapeEnd('ellipse', [10, 10], [123.4, 77.7]), [123.4, 77.7]);
});

test('grid snapping moves a rectangle corner onto the grid', () => {
  assert.deepEqual(shapeEnd('rect', [0, 0], [212, 98], { grid: true }), [200, 100]);
});

test('shift and grid together give a square whose corners sit on the grid', () => {
  // Start snaps to [25, 25] in the tool. The end snaps to [225, 175], and the square takes the longer side, 200.
  assert.deepEqual(shapeEnd('rect', [25, 25], [213, 180], { shift: true, grid: true }), [225, 225]);
});

test('shift wins over the 15 degree snap on lines', () => {
  assert.deepEqual(
    shapeEnd('line', [0, 0], [100, 30], { shift: true, angles: true }),
    shapeEnd('line', [0, 0], [100, 30], { shift: true }),
  );
});
