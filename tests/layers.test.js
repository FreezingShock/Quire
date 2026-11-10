import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_LAYER,
  Drawing,
  hitOp,
  normalizeLayers,
  normalizeOps,
  opBounds,
  opsInRect,
  resolveOps,
  textLayout,
} from '../src/drawing.js';

// Fake 2D context: every character is half the font size wide.
const measure = {
  font: '',
  measureText(s) {
    return { width: s.length * parseFloat(this.font) * 0.5 };
  },
};

const stroke = (id, x, layer) => ({ id, t: 'stroke', tool: 'pencil', c: '#000000', w: 1, p: [[x, 10], [x + 20, 10]], ...(layer ? { l: layer } : {}) });
const box = (id, x, y) => ({ id, t: 'rect', c: '#000000', w: 1, a: [x, y], b: [x + 40, y + 30] });

test('layers default to one visible base layer, and bad entries are dropped', () => {
  assert.deepEqual(normalizeLayers(undefined), [{ id: BASE_LAYER, name: 'Layer 1', visible: true }]);
  const layers = normalizeLayers([{ id: 'a', name: '  Sky ', visible: false }, { id: 'a' }, { name: 'no id' }, { id: 'b' }]);
  assert.deepEqual(layers.map((l) => l.id), ['a', 'b']);
  assert.equal(layers[0].name, 'Sky');
  assert.equal(layers[0].visible, false);
  assert.equal(layers[1].visible, true);
});

test('ops from older saves get ids and keep their place, clear ops are left alone', () => {
  const ops = normalizeOps([{ t: 'rect', c: '#000', w: 1, a: [0, 0], b: [1, 1] }, { t: 'clear' }, 'junk', null]);
  assert.equal(ops.length, 2);
  assert.equal(typeof ops[0].id, 'string');
  assert.deepEqual(ops[1], { t: 'clear' });
});

test('move shifts the chosen ops, and later moves add up', () => {
  const ops = [stroke('s1', 0), stroke('s2', 100), { t: 'move', ids: ['s1'], dx: 10, dy: 5 }, { t: 'move', ids: ['s1'], dx: 1, dy: 0 }];
  const [first, second] = resolveOps(ops);
  assert.deepEqual(first.p[0], [11, 15]);
  assert.deepEqual(second.p[0], [100, 10]);
});

test('delete removes ops, and undoing the delete brings them back', () => {
  const d = new Drawing([stroke('s1', 0), stroke('s2', 50)]);
  d.commit({ t: 'delete', ids: ['s1'] });
  assert.deepEqual(resolveOps(d.ops).map((op) => op.id), ['s2']);
  d.undo();
  assert.deepEqual(resolveOps(d.ops).map((op) => op.id), ['s1', 's2']);
});

test('a clear removes earlier ops, and a layer clear only removes that layer', () => {
  const ops = [stroke('a', 0, 'bottom'), stroke('b', 0, 'top'), { t: 'clear', l: 'top' }, stroke('c', 0, 'top')];
  assert.deepEqual(resolveOps(ops).map((op) => op.id), ['a', 'c']);
  const all = [stroke('a', 0, 'bottom'), { t: 'clear' }, stroke('b', 0, 'top')];
  assert.deepEqual(resolveOps(all).map((op) => op.id), ['b']);
});

test('edit replaces a text box, and the last edit wins', () => {
  const text = { id: 't1', t: 'text', c: '#000', f: 'serif', s: 34, a: [10, 10], b: [300, 10], text: 'first' };
  const [resolved] = resolveOps([text, { t: 'edit', id: 't1', text: 'second' }, { t: 'edit', id: 't1', text: 'third' }]);
  assert.equal(resolved.text, 'third');
  assert.equal(text.text, 'first');
});

test('purgeLayer drops that layer, its clears, and resets redo', () => {
  const d = new Drawing([stroke('a', 0, 'keep'), stroke('b', 0, 'gone'), { t: 'clear', l: 'gone' }]);
  d.undo();
  assert.equal(d.canRedo, true);
  assert.equal(d.purgeLayer('gone'), true);
  assert.deepEqual(d.ops.map((op) => op.id), ['a']);
  assert.equal(d.canRedo, false);
  assert.equal(d.purgeLayer('missing'), false);
});

test('version changes on every edit so caches can tell', () => {
  const d = new Drawing();
  const v0 = d.version;
  d.commit(stroke('a', 0));
  const v1 = d.version;
  d.undo();
  assert.ok(v0 < v1 && v1 < d.version);
});

test('text layout wraps words to the box width and keeps the box at least 60 wide', () => {
  // Each character is 10 units at size 20, so a 100 unit box holds 10 characters.
  const op = { t: 'text', s: 20, f: 'serif', a: [0, 0], b: [100, 0], text: 'one two three four' };
  const layout = textLayout(measure, op, 1);
  assert.equal(layout.width, 100);
  assert.deepEqual(layout.lines, ['one two', 'three four']);
  assert.equal(layout.height, 2 * 20 * 1.25);
  const narrow = textLayout(measure, { ...op, b: [5, 0], text: 'abcdef\nx' }, 1);
  assert.equal(narrow.width, 60);
  assert.deepEqual(narrow.lines, ['abcdef', 'x']);
});

test('bounds cover strokes and text boxes, and fills have none', () => {
  assert.deepEqual(opBounds(stroke('s', 4)), [4, 10, 24, 10]);
  assert.equal(opBounds({ t: 'fill', c: '#000', at: [1, 1] }), null);
  const b = opBounds({ t: 'text', s: 20, f: 'sans', a: [10, 10], b: [110, 10], text: 'hi' }, measure);
  assert.deepEqual(b, [10, 10, 110, 10 + 25]);
});

test('hit testing finds the topmost op, and strokes are hit near the path only', () => {
  const ops = [box('r', 0, 0), stroke('s', 0)];
  assert.equal(hitOp(ops, [10, 10])?.id, 's');
  assert.equal(hitOp(ops, [30, 25])?.id, 'r');
  assert.equal(hitOp([stroke('s', 0)], [10, 200]), null);
});

test('rectangle selection picks every op whose box touches it', () => {
  const ops = [box('a', 0, 0), box('b', 500, 500), stroke('c', 60, null)];
  assert.deepEqual(opsInRect(ops, [30, 0, 80, 40]).sort(), ['a', 'c']);
  assert.deepEqual(opsInRect(ops, [900, 900, 950, 950]), []);
});
