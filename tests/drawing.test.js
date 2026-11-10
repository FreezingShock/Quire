import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drawing, inkExtent, strokeWidth } from '../src/drawing.js';

const stroke = (x) => ({ t: 'stroke', tool: 'pencil', c: '#000000', w: 1.4, p: [[x, 1], [x + 5, 9]] });

test('undo and redo move ops between the stack and the redo list', () => {
  const d = new Drawing();
  const a = stroke(1);
  const b = stroke(2);
  d.commit(a);
  d.commit(b);
  assert.equal(d.undo(), b);
  assert.equal(d.ops.length, 1);
  assert.equal(d.redo(), b);
  assert.equal(d.ops.length, 2);
});

test('a new op after undo discards the redo history', () => {
  const d = new Drawing();
  d.commit(stroke(1));
  d.undo();
  d.commit(stroke(3));
  assert.equal(d.canRedo, false);
  assert.equal(d.redo(), null);
});

test('clear is an undoable op and does nothing on an empty drawing', () => {
  const d = new Drawing();
  assert.equal(d.clear(), false);
  d.commit(stroke(1));
  assert.equal(d.clear(), true);
  assert.deepEqual(d.ops.at(-1), { t: 'clear' });
  d.undo();
  assert.equal(d.ops.length, 1);
  assert.equal(d.ops[0].t, 'stroke');
});

test('constructor copies the ops it receives', () => {
  const ops = [stroke(1)];
  const d = new Drawing(ops);
  d.commit(stroke(2));
  assert.equal(ops.length, 1);
});

test('ink extent is the lowest point drawn', () => {
  const ops = [
    stroke(1),
    { t: 'line', c: '#000', w: 1, a: [0, 40], b: [10, 700] },
    { t: 'fill', c: '#000', at: [5, 300] },
  ];
  assert.equal(inkExtent(ops), 700);
  assert.equal(inkExtent([]), 0);
});

test('stroke width grows with size and marker is wider than pencil', () => {
  assert.ok(strokeWidth('brush', 6) > strokeWidth('brush', 3));
  assert.ok(strokeWidth('marker', 3) > strokeWidth('pencil', 3));
});
