import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAMP_KINDS,
  applyOp,
  bendCurve,
  bezierPoint,
  hitOp,
  opBounds,
  resolveOps,
  selectionMatrix,
  straightCurve,
  visibleOps,
} from '../src/drawing.js';

const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `got ${actual}, want ${expected}`);
const nearPoint = (actual, expected) => {
  near(actual[0], expected[0]);
  near(actual[1], expected[1]);
};

/** A canvas context stand-in that records every drawing call, so ops can be replayed in Node. */
function recorder() {
  const calls = [];
  const target = { canvas: { width: 1000, height: 1000 } };
  const ctx = new Proxy(target, {
    get(obj, name) {
      if (name in obj) return obj[name];
      return (...args) => calls.push([name, ...args.map((a) => (Array.isArray(a) ? a.join(',') : a))]);
    },
    set(obj, name, value) {
      obj[name] = value;
      return true;
    },
  });
  return { ctx, calls };
}

const stroke = (id, points, extra = {}) => ({ t: 'stroke', id, tool: 'pencil', c: '#000000', w: 2, p: points, ...extra });
const rect = (id, a, b) => ({ t: 'rect', id, c: '#000000', w: 2, a, b });

test('a flip mirrors the selected ink about its center', () => {
  const ops = [stroke('s1', [[10, 0], [30, 40]]), { t: 'xform', ids: ['s1'], m: selectionMatrix('flip-h', 20, 0) }];
  const [op] = resolveOps(ops);
  assert.deepEqual(op.p, [[30, 0], [10, 40]]);
});

test('a clockwise turn sends a point above the center to the right of it', () => {
  const m = selectionMatrix('rotate-cw', 50, 50);
  // The point 10 units above the center.
  const mapped = [m[0] * 50 + m[2] * 40 + m[4], m[1] * 50 + m[3] * 40 + m[5]];
  nearPoint(mapped, [60, 50]);
});

test('counterclockwise is the reverse of clockwise', () => {
  const cw = selectionMatrix('rotate-cw', 30, 70);
  const ccw = selectionMatrix('rotate-ccw', 30, 70);
  const p = [12, 95];
  const turned = [cw[0] * p[0] + cw[2] * p[1] + cw[4], cw[1] * p[0] + cw[3] * p[1] + cw[5]];
  const back = [ccw[0] * turned[0] + ccw[2] * turned[1] + ccw[4], ccw[1] * turned[0] + ccw[3] * turned[1] + ccw[5]];
  nearPoint(back, p);
});

test('a resize scales the box and the line width, and keeps the center in place', () => {
  const ops = [rect('r1', [0, 0], [100, 50]), { t: 'xform', ids: ['r1'], m: selectionMatrix('resize', 50, 25, 0.5, 2) }];
  const [op] = resolveOps(ops);
  nearPoint(op.a, [25, -25]);
  nearPoint(op.b, [75, 75]);
  near(op.w, 2 * Math.sqrt(1));
});

test('a uniform half-size resize halves line width and stamp size', () => {
  const m = selectionMatrix('resize', 0, 0, 0.5, 0.5);
  const [stamp] = resolveOps([{ t: 'stamp', id: 'k', k: 'star', c: '#000', a: [100, 100], s: 80, w: 4 }, { t: 'xform', ids: ['k'], m }]);
  near(stamp.s, 40);
  near(stamp.w, 2);
  nearPoint(stamp.a, [50, 50]);
});

test('moves and transforms apply in the order they were made', () => {
  const base = stroke('s', [[10, 0]]);
  const flip = selectionMatrix('flip-h', 0, 0);
  const moveThenFlip = resolveOps([base, { t: 'move', ids: ['s'], dx: 10, dy: 0 }, { t: 'xform', ids: ['s'], m: flip }])[0];
  const flipThenMove = resolveOps([base, { t: 'xform', ids: ['s'], m: flip }, { t: 'move', ids: ['s'], dx: 10, dy: 0 }])[0];
  nearPoint(moveThenFlip.p[0], [-20, 0]);
  // Flipping first sends x=10 to x=-10, and the move then brings it back to 0.
  nearPoint(flipThenMove.p[0], [0, 0]);
});

test('text boxes stay upright under a flip and only move; a resize scales width and font size', () => {
  const text = { t: 'text', id: 'x', c: '#000', f: 'serif', s: 20, a: [100, 100], b: [300, 100], text: 'hi' };
  const [flipped] = resolveOps([text, { t: 'xform', ids: ['x'], m: selectionMatrix('flip-h', 200, 0) }]);
  assert.equal(flipped.s, 20);
  nearPoint(flipped.a, [300, 100]);
  near(flipped.b[0] - flipped.a[0], 200);
  const [big] = resolveOps([text, { t: 'xform', ids: ['x'], m: selectionMatrix('resize', 0, 0, 2, 2) }]);
  near(big.s, 40);
  near(big.b[0] - big.a[0], 400);
});

test('a straight curve puts its control points a third and two thirds along the chord', () => {
  const { c1, c2 } = straightCurve([0, 0], [90, 30]);
  nearPoint(c1, [30, 10]);
  nearPoint(c2, [60, 20]);
});

test('the first bend lifts the middle of the curve onto the pointer', () => {
  const snap = { a: [0, 0], b: [100, 0], ...straightCurve([0, 0], [100, 0]) };
  const target = [50, -30];
  const next = bendCurve(snap, 0.5, target, 'both');
  nearPoint(bezierPoint(snap.a, next.c1, next.c2, snap.b, 0.5), target);
});

test('the second bend reshapes the far half so the curve passes the pointer at t = 0.75', () => {
  const snap = { a: [0, 0], b: [100, 0], c1: [20, -20], c2: [70, -20] };
  const target = [85, 12];
  const next = bendCurve(snap, 0.75, target, 'end');
  nearPoint(bezierPoint(snap.a, next.c1, next.c2, snap.b, 0.75), target);
  nearPoint(next.c1, snap.c1);
});

test('a curve is hit near its path and not far from it', () => {
  const curve = { t: 'curve', id: 'c', c: '#000', w: 2, a: [0, 0], b: [100, 0], c1: [30, -40], c2: [70, -40] };
  const top = bezierPoint(curve.a, curve.c1, curve.c2, curve.b, 0.5);
  assert.equal(hitOp([curve], [top[0], top[1] + 1]), curve);
  assert.equal(hitOp([curve], [50, 80]), null);
});

test('a closed polygon is hit along its closing side, and an open one is not', () => {
  const pts = [[0, 0], [100, 0], [100, 100]];
  const open = { t: 'poly', id: 'p', c: '#000', w: 2, pts, closed: false };
  const closed = { ...open, id: 'q', closed: true };
  assert.equal(hitOp([open], [50, 50]), null);
  assert.equal(hitOp([closed], [50, 50]), closed);
});

test('bounds cover polygon points, stamp boxes, and the spray cloud around a spray stroke', () => {
  assert.deepEqual(opBounds({ t: 'poly', pts: [[5, 9], [40, 2], [12, 30]] }), [5, 2, 40, 30]);
  assert.deepEqual(opBounds({ t: 'stamp', a: [50, 50], s: 40 }), [30, 30, 70, 70]);
  const [x0] = opBounds({ t: 'stroke', tool: 'spray', w: 2, p: [[50, 50]] });
  assert.ok(x0 < 50 - 2 * 4 + 1e-9);
});

test('new ops are drawable ops: they show in the visible list, and a clear hides them', () => {
  const ops = [
    { t: 'curve', id: 'a', c: '#000', w: 2, a: [0, 0], b: [1, 1], c1: [0, 0], c2: [1, 1] },
    { t: 'poly', id: 'b', c: '#000', w: 2, pts: [[0, 0], [1, 1]] },
    { t: 'stamp', id: 'c', k: 'star', c: '#000', a: [5, 5], s: 40, w: 2 },
  ];
  assert.equal(visibleOps(ops).length, 3);
  assert.equal(visibleOps([...ops, { t: 'clear' }]).length, 0);
});

test('a spray stroke paints the same dots on every replay', () => {
  const op = stroke('s', [[100, 100], [104, 102], [108, 101]], { tool: 'spray', w: 3.75 });
  const first = recorder();
  const second = recorder();
  applyOp(first.ctx, op, 1);
  applyOp(second.ctx, op, 1);
  assert.ok(first.calls.length > 40, `expected many dots, got ${first.calls.length}`);
  assert.deepEqual(first.calls, second.calls);
});

test('every stamp kind draws without error', () => {
  for (const k of STAMP_KINDS) {
    const { ctx, calls } = recorder();
    applyOp(ctx, { t: 'stamp', k, c: '#c0392b', a: [200, 200], s: 80, w: 4 }, 1);
    assert.ok(calls.length > 0, `${k} drew nothing`);
  }
});
