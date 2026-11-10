import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InkStack, replayInk, resolveOps } from '../src/drawing.js';

/**
 * A canvas stand-in that records every stroke and fill with the state and the path it was
 * drawn with. Two replays draw the same pixels when their recorded events match.
 */
function canvasRecorder(label, events) {
  let state = {
    strokeStyle: '#000000', fillStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
  };
  const saved = [];
  let path = [];
  const target = { canvas: { width: 1, height: 1 } };
  return new Proxy(target, {
    get(obj, name) {
      if (name === 'canvas') return obj.canvas;
      if (name in state) return state[name];
      if (name === 'save') return () => saved.push({ ...state });
      if (name === 'restore') return () => { state = saved.pop() ?? state; };
      if (name === 'beginPath') return () => { path = []; };
      if (name === 'moveTo' || name === 'lineTo') return (x, y) => path.push([name, x, y]);
      if (name === 'stroke' || name === 'fill') {
        return () => events.push({ label, call: name, state: { ...state }, path: path.map((p) => [...p]) });
      }
      return (...args) => events.push({ label, call: name, args });
    },
    set(obj, name, value) {
      state[name] = value;
      return true;
    },
  });
}

function makeStack(events) {
  let count = 0;
  const make = () => {
    const ctx = canvasRecorder(count, events);
    count += 1;
    return { width: 1, height: 1, getContext: () => ctx };
  };
  return new InkStack(1280, 1600, make);
}

/** The original replay: every op on its own through apply(). */
function replayPerOp(stack, ops, scale, exclude = null) {
  for (const op of resolveOps(ops)) {
    if (!exclude?.has(op.id)) stack.apply(op, scale);
  }
}

const pen = (id, pts, extra = {}) => ({ t: 'stroke', id, l: 'base', tool: 'pen', c: '#1b1b1b', w: 2, p: pts, ...extra });

function replayBoth(ops, scale, exclude = null) {
  const old = [];
  replayPerOp(makeStack(old), ops, scale, exclude);
  const runs = [];
  replayInk(makeStack(runs), ops, scale, exclude);
  return { old, runs };
}

test('a run of plain pen strokes draws the same strokes as one op at a time', () => {
  const ops = [
    pen('a', [[10, 10], [20, 14], [30, 12]]),
    pen('b', [[12, 8], [24, 20]]),
    pen('c', [[50, 50], [60, 50]], { c: '#c0392b' }),
    pen('d', [[50, 60], [70, 60]], { c: '#c0392b', w: 4 }),
    { t: 'stroke', id: 'e', l: 'base', tool: 'pen', c: '#c0392b', w: 4, p: [[5, 5]] },
    pen('f', [[1, 1], [2, 2]], { l: 'ink2' }),
    pen('g', [[1, 2, 0.5], [3, 4, 0.8]]),
    { t: 'stroke', id: 'h', l: 'base', tool: 'marker', c: '#ffff00', w: 8, p: [[100, 100], [120, 100]] },
    { t: 'stroke', id: 'k', l: 'base', tool: 'eraser', c: '#000000', w: 6, p: [[30, 30], [40, 30]] },
    pen('i', [[30, 30], [90, 40]]),
    pen('skip', [[0, 0], [9, 9]]),
    pen('j', [[40, 40], [41, 41]]),
  ];
  const { old, runs } = replayBoth(ops, 1.28, new Set(['skip']));
  assert.ok(old.length > 8, `expected several strokes, got ${old.length}`);
  assert.deepEqual(runs, old);
});

test('a long mixed drawing replays to the same strokes, layer by layer', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const colors = ['#1b1b1b', '#c0392b', '#2e86de'];
  const ops = [];
  for (let k = 0; k < 400; k += 1) {
    const pts = Array.from({ length: 2 + Math.floor(rnd() * 10) }, () => [rnd() * 900, rnd() * 1100]);
    const layer = rnd() < 0.2 ? 'ink2' : 'base';
    const color = colors[Math.floor(rnd() * colors.length)];
    const width = rnd() < 0.5 ? 2 : 5;
    if (rnd() < 0.05) ops.push({ t: 'stroke', id: `e${k}`, l: layer, tool: 'eraser', c: '#000000', w: 8, p: pts });
    else ops.push(pen(`p${k}`, pts, { l: layer, c: color, w: width }));
  }
  const { old, runs } = replayBoth(ops, 0.9);
  assert.ok(old.length > 300);
  assert.deepEqual(runs, old);
});

test('a clear keeps its order around the runs', () => {
  const ops = [
    pen('a', [[10, 10], [60, 60]]),
    pen('b', [[12, 10], [62, 60]]),
    { t: 'clear', id: 'c1', l: 'base' },
    pen('c', [[10, 90], [60, 90]]),
    pen('d', [[20, 20], [30, 30]]),
  ];
  const { old, runs } = replayBoth(ops, 1);
  assert.deepEqual(runs, old);
});
