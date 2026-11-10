/**
 * Drawing model. Every mark is an op in normalized page units: x runs from 0 to
 * NORM_WIDTH across the sheet and y uses the same scale. A drawing therefore
 * keeps its shape when the window resizes. Ops are plain JSON, so they store
 * directly in the entry, and undo is just "pop the last op and replay".
 *
 * Each drawing op (stroke, line, rect, ellipse, curve, poly, stamp, fill, text)
 * has a stable `id` and belongs to a layer through `l`. Ops without `l` are on
 * the first layer, so entries saved before layers existed still open correctly.
 * A stroke with tool 'spray' is a path too, painted as scattered dots.
 * Later ops can change earlier ones:
 *   move    { ids, dx, dy }  shifts the ops with those ids
 *   xform   { ids, m }       maps the ops with those ids through an affine matrix
 *                            (flip, rotate, or resize about the selection's center)
 *   delete  { ids }          removes them
 *   edit    { id, text }     replaces the text of a text box
 *   clear   { l? }           wipes one layer, or every layer when `l` is absent
 * resolveOps() folds these into the list of ops that are actually on the page.
 */

import { GRID_STEP } from './snap.js';

export const NORM_WIDTH = 1000;
export const BASE_LAYER = 'base';
/** The layer that holds doodles drawn in a page margin (see ink-canvas.js). */
export const MARGIN_LAYER = 'margins';
export const MAX_LAYERS = 12;
const MARKER_ALPHA = 0.35;
const TEXT_LINE_SPACING = 1.25;
const MIN_TEXT_WIDTH = 60;
const HIT_PAD = 4;

/** Font stacks for text boxes, keyed the same way as the writing font preference. */
export const TEXT_FONTS = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

/** Font size in normalized units for the three size buttons (1, 3, 6). */
export const TEXT_SIZES = { 1: 20, 3: 34, 6: 56 };
export const DEFAULT_TEXT_WIDTH = 300;

const DRAW_TYPES = new Set(['stroke', 'line', 'rect', 'ellipse', 'curve', 'poly', 'stamp', 'fill', 'text']);

/** Stamp sizes (box side in normalized units) for the size row at 1, 3 and 6. */
export const STAMP_SIZES = { 1: 40, 3: 80, 6: 140 };
export const STAMP_KINDS = ['star', 'heart', 'smile', 'arrow', 'bolt', 'cloud'];
/** A spray stroke scatters dots out to this many times its width. */
export const SPRAY_SPREAD = 4;

export function newOpId() {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newLayerId() {
  return `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Stroke width in normalized units for a tool and a size of 1, 3 or 6. */
export function strokeWidth(tool, size) {
  switch (tool) {
    case 'pencil': return 1.4;
    case 'brush': return size * 2.5;
    case 'marker': return size * 5;
    case 'eraser': return size * 7;
    default: return size * 1.25;
  }
}

/** Layer list, bottom first. Always has at least one layer. */
export function normalizeLayers(raw) {
  const seen = new Set();
  const layers = [];
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, MAX_LAYERS)) {
      const id = typeof item?.id === 'string' ? item.id.slice(0, 40) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = String(item.name ?? '').trim().slice(0, 40);
      layers.push({ id, name: name || `Layer ${layers.length + 1}`, visible: item.visible !== false });
    }
  }
  if (!layers.length) layers.push({ id: BASE_LAYER, name: 'Layer 1', visible: true });
  return layers;
}

/** Drops malformed ops and gives drawing ops from older saves an id. */
export function normalizeOps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((op) => op && typeof op === 'object' && typeof op.t === 'string')
    .map((op) => (DRAW_TYPES.has(op.t) && !op.id ? { ...op, id: newOpId() } : op));
}

export function layerOf(op) {
  return op.l ?? BASE_LAYER;
}

export function visibleLayerIds(layers) {
  return layers.filter((layer) => layer.visible).map((layer) => layer.id);
}

/**
 * The ops still on the sheet. A clear hides the ops before it: a clear with no
 * layer hides every layer, and a clear with a layer hides only that layer. Undo
 * keeps the clears, so the ink can come back.
 */
export function visibleOps(ops) {
  const visible = [];
  let all = false;
  const cleared = new Set();
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op.t === 'clear') {
      if (op.l === undefined) all = true;
      else cleared.add(op.l);
    } else if (DRAW_TYPES.has(op.t) && !all && !cleared.has(layerOf(op))) {
      visible.push(op);
    }
  }
  return visible.reverse();
}

export function hasInkOn(ops, layer) {
  return visibleOps(ops).some((op) => layerOf(op) === layer);
}

/** Ordered list of ops plus a redo stack. Pure logic, no canvas. */
export class Drawing {
  #ops;
  #redo = [];
  #version = 0;

  constructor(ops = []) {
    this.#ops = Array.isArray(ops) ? [...ops] : [];
  }

  get ops() {
    return this.#ops;
  }

  get isEmpty() {
    return visibleOps(this.#ops).length === 0;
  }

  get canUndo() {
    return this.#ops.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  /** Increases on every change, so callers can cache anything derived from the ops. */
  get version() {
    return this.#version;
  }

  commit(op) {
    if (DRAW_TYPES.has(op.t) && !op.id) op.id = newOpId();
    this.#ops.push(op);
    this.#redo.length = 0;
    this.#version += 1;
    return op;
  }

  undo() {
    const op = this.#ops.pop();
    if (op) this.#redo.push(op);
    if (op) this.#version += 1;
    return op ?? null;
  }

  redo() {
    const op = this.#redo.pop();
    if (op) this.#ops.push(op);
    if (op) this.#version += 1;
    return op ?? null;
  }

  /** Clearing is itself an op, so it can be undone. Pass a layer to clear only that layer. */
  clear(layer) {
    if (this.isEmpty) return false;
    this.commit(layer === undefined ? { t: 'clear' } : { t: 'clear', l: layer });
    return true;
  }

  /**
   * Removes everything on a layer. Used when a layer is deleted. This is not
   * undoable, so the caller confirms first.
   */
  purgeLayer(layer) {
    const kept = this.#ops.filter((op) => {
      if (op.t === 'clear') return op.l !== layer;
      return !(DRAW_TYPES.has(op.t) && layerOf(op) === layer);
    });
    if (kept.length === this.#ops.length) return false;
    this.#ops = kept;
    this.#redo.length = 0;
    this.#version += 1;
    return true;
  }
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Affine matrices use the SVG layout [a, b, c, d, e, f]: the point (x, y) maps
 * to (a*x + c*y + e, b*x + d*y + f).
 */
export function translationMatrix(dx, dy) {
  return [1, 0, 0, 1, dx, dy];
}

/** The matrix that applies `n` first, then `m`. */
function composeMatrix(m, n) {
  const [a1, b1, c1, d1, e1, f1] = n;
  const [a2, b2, c2, d2, e2, f2] = m;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

const isIdentity = (m) => m.every((v, i) => v === IDENTITY[i]);

/**
 * Matrix for a selection transform about the point (cx, cy): 'flip-h', 'flip-v',
 * 'rotate-cw', 'rotate-ccw', or 'resize' with the scale factors kx and ky.
 */
export function selectionMatrix(kind, cx, cy, kx = 1, ky = 1) {
  const round = (m) => m.map((v) => Math.round(v * 10000) / 10000);
  switch (kind) {
    case 'flip-h': return round([-1, 0, 0, 1, 2 * cx, 0]);
    case 'flip-v': return round([1, 0, 0, -1, 0, 2 * cy]);
    case 'rotate-cw': return round([0, 1, -1, 0, cx + cy, cy - cx]);
    case 'rotate-ccw': return round([0, -1, 1, 0, cx - cy, cx + cy]);
    case 'resize': return round([kx, 0, 0, ky, cx * (1 - kx), cy * (1 - ky)]);
    default: throw new Error(`Unknown selection transform: ${kind}`);
  }
}

/**
 * Maps one drawable op through an affine matrix. Ids and styles are kept. Line
 * widths, stamp sizes and font sizes scale with the matrix's area factor, so a
 * half-size resize makes the ink half size. Text boxes stay upright: flips and
 * rotations only move them, and a resize changes their width and font size.
 */
function transformOp(op, m) {
  if (isIdentity(m)) return op;
  const [a, b, c, d, e, f] = m;
  const k = Math.sqrt(Math.abs(a * d - b * c));
  // Points may carry a third value, the pen pressure, which must survive a move.
  const map = (p) => [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f, ...p.slice(2)];
  if (op.t === 'stroke') return { ...op, p: op.p.map(map), w: op.w * k };
  if (op.t === 'line' || op.t === 'rect' || op.t === 'ellipse') {
    return { ...op, a: map(op.a), b: map(op.b), w: op.w * k };
  }
  if (op.t === 'curve') {
    return { ...op, a: map(op.a), b: map(op.b), c1: map(op.c1), c2: map(op.c2), w: op.w * k };
  }
  if (op.t === 'poly') return { ...op, pts: op.pts.map(map), w: op.w * k };
  if (op.t === 'stamp') return { ...op, a: map(op.a), s: op.s * k, w: op.w * k };
  if (op.t === 'text') {
    const a0 = map(op.a);
    const width = Math.abs(op.b[0] - op.a[0]) * k;
    return { ...op, a: a0, b: [a0[0] + width, a0[1] + (op.b[1] - op.a[1])], s: (Number(op.s) || TEXT_SIZES[3]) * k };
  }
  return op;
}

/** A copy of a drawable op moved by (dx, dy). Used for drag previews. */
export function moveOp(op, dx, dy) {
  return transformOp(op, translationMatrix(dx, dy));
}

/**
 * The drawable ops that are on the page right now, in paint order. Move, xform,
 * delete and edit ops are applied in the order they were made, and clears remove
 * the ops they wipe out.
 */
export function resolveOps(ops) {
  const mats = new Map();
  const removed = new Set();
  const texts = new Map();
  for (const op of ops) {
    if (op.t === 'move') {
      const shift = translationMatrix(op.dx, op.dy);
      for (const id of op.ids ?? []) mats.set(id, composeMatrix(shift, mats.get(id) ?? IDENTITY));
    } else if (op.t === 'xform') {
      for (const id of op.ids ?? []) mats.set(id, composeMatrix(op.m, mats.get(id) ?? IDENTITY));
    } else if (op.t === 'delete') {
      for (const id of op.ids ?? []) removed.add(id);
    } else if (op.t === 'edit') {
      texts.set(op.id, op.text);
    }
  }

  let live = [];
  for (const op of ops) {
    if (op.t === 'clear') {
      live = op.l === undefined ? [] : live.filter((item) => layerOf(item) !== op.l);
      continue;
    }
    if (!DRAW_TYPES.has(op.t) || removed.has(op.id)) continue;
    let next = op;
    const m = mats.get(op.id);
    if (m) next = transformOp(next, m);
    if (op.t === 'text' && texts.has(op.id)) next = { ...next, text: texts.get(op.id) };
    live.push(next);
  }
  return live;
}

/** Control points for a straight curve from a to b: the points one third and two thirds along the chord. */
export function straightCurve(a, b) {
  return {
    c1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
    c2: [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3],
  };
}

/** A point on a cubic Bezier curve at parameter t. */
export function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const f0 = u * u * u;
  const f1 = 3 * u * u * t;
  const f2 = 3 * u * t * t;
  const f3 = t * t * t;
  return [
    f0 * p0[0] + f1 * p1[0] + f2 * p2[0] + f3 * p3[0],
    f0 * p0[1] + f1 * p1[1] + f2 * p2[1] + f3 * p3[1],
  ];
}

const CURVE_STEPS = 24;

/** The curve sampled into a polyline, for bounds and hit tests. */
export function curvePoints(op) {
  const points = [];
  for (let i = 0; i <= CURVE_STEPS; i += 1) points.push(bezierPoint(op.a, op.c1, op.c2, op.b, i / CURVE_STEPS));
  return points;
}

/**
 * Moves a curve's control points so the curve passes through `target` at
 * parameter t. 'both' moves both controls, which bends the whole middle. 'end'
 * moves only the second control, which reshapes the far half. `snap` is the
 * curve as it was when the bend started, so a drag never piles up.
 */
export function bendCurve(snap, t, target, which) {
  const [ax, ay] = bezierPoint(snap.a, snap.c1, snap.c2, snap.b, t);
  const dx = target[0] - ax;
  const dy = target[1] - ay;
  const u = 1 - t;
  if (which === 'both') {
    const w = 3 * t * u;
    return {
      c1: [snap.c1[0] + dx / w, snap.c1[1] + dy / w],
      c2: [snap.c2[0] + dx / w, snap.c2[1] + dy / w],
    };
  }
  const w = 3 * u * t * t;
  return { c1: [...snap.c1], c2: [snap.c2[0] + dx / w, snap.c2[1] + dy / w] };
}

let measureCanvas = null;
/** A 2D context used only for measuring text, so layout works outside a drawing context. */
function measureContext() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d');
  return measureCanvas;
}

function wrapText(ctx, text, maxWidth, scale) {
  const measure = (s) => ctx.measureText(s).width / scale;
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (!line && measure(word) > maxWidth) {
        // A word wider than the box is broken across lines, one character at a time.
        let chunk = '';
        for (const ch of word) {
          if (chunk && measure(chunk + ch) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Wrapped lines and box size for a text op. `scale` is device pixels per
 * normalized unit; widths and heights come back in normalized units either way.
 * The context's font is set as a side effect.
 */
export function textLayout(ctx, op, scale = 1) {
  const size = Number(op.s) || TEXT_SIZES[3];
  ctx.font = `${size * scale}px ${TEXT_FONTS[op.f] ?? TEXT_FONTS.serif}`;
  const width = Math.max(MIN_TEXT_WIDTH, Math.abs(op.b[0] - op.a[0]));
  const lines = wrapText(ctx, op.text ?? '', width, scale);
  const lineHeight = size * TEXT_LINE_SPACING;
  return { lines, width, lineHeight, height: lines.length * lineHeight };
}

/** Bounding box [x0, y0, x1, y1] of the stroke's path, without its width. Null for fills and clears. */
export function opBounds(op, measure) {
  let points;
  if (op.t === 'stroke') {
    points = op.p;
  } else if (op.t === 'line' || op.t === 'rect' || op.t === 'ellipse') {
    if (!op.a || !op.b) return null;
    points = [op.a, op.b];
  } else if (op.t === 'curve') {
    if (!op.a || !op.b || !op.c1 || !op.c2) return null;
    points = curvePoints(op);
  } else if (op.t === 'poly') {
    points = op.pts;
  } else if (op.t === 'stamp') {
    if (!op.a) return null;
    const half = op.s / 2;
    points = [[op.a[0] - half, op.a[1] - half], [op.a[0] + half, op.a[1] + half]];
  } else if (op.t === 'text') {
    if (!op.a || !op.b) return null;
    const layout = textLayout(measure ?? measureContext(), op, 1);
    points = [op.a, [op.a[0] + layout.width, op.a[1] + layout.height]];
  } else {
    return null;
  }
  if (!points?.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  // A spray reaches well past its path, so its box covers the dots too.
  const spray = op.t === 'stroke' && op.tool === 'spray' ? op.w * SPRAY_SPREAD : 0;
  return [x0 - spray, y0 - spray, x1 + spray, y1 + spray];
}

/** The polyline a path-like op is hit-tested against. Null for ops that are hit by their box. */
function pathOf(op) {
  if (op.t === 'stroke') return op.p;
  if (op.t === 'line') return [op.a, op.b];
  if (op.t === 'curve') return curvePoints(op);
  if (op.t === 'poly') return op.closed ? [...op.pts, op.pts[0]] : op.pts;
  return null;
}

/** How far a path's ink reaches from the path itself. A spray reaches its whole cloud. */
function reachOf(op) {
  if (op.t === 'stroke' && op.tool === 'spray') return (op.w ?? 0) * SPRAY_SPREAD;
  return (op.w ?? 0) / 2;
}

/** Largest y used by any op, in normalized units. Used to size exports. */
export function inkExtent(ops) {
  let max = 0;
  for (const op of resolveOps(ops)) {
    if (op.t === 'fill') {
      max = Math.max(max, op.at[1]);
      continue;
    }
    const bounds = opBounds(op);
    if (bounds && bounds[3] > max) max = bounds[3];
  }
  return max;
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The topmost op under a point. Strokes and lines are hit near their path, and
 * everything else by its box. Returns null when nothing is under the point.
 */
export function hitOp(ops, point, measure) {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    const reach = HIT_PAD + reachOf(op);
    const path = pathOf(op);
    if (path) {
      if (!path.length) continue;
      if (path.length === 1) {
        if (Math.hypot(point[0] - path[0][0], point[1] - path[0][1]) <= reach) return op;
        continue;
      }
      for (let j = 1; j < path.length; j += 1) {
        if (distanceToSegment(point, path[j - 1], path[j]) <= reach) return op;
      }
      continue;
    }
    const b = opBounds(op, measure);
    if (!b) continue;
    if (point[0] >= b[0] - reach && point[0] <= b[2] + reach && point[1] >= b[1] - reach && point[1] <= b[3] + reach) {
      return op;
    }
  }
  return null;
}

/** Ids of the ops whose boxes touch a rectangle [x0, y0, x1, y1]. */
export function opsInRect(ops, [x0, y0, x1, y1], measure) {
  const ids = [];
  for (const op of ops) {
    const b = opBounds(op, measure);
    if (!b) continue;
    const pad = (op.w ?? 0) / 2;
    if (b[0] - pad <= x1 && b[2] + pad >= x0 && b[1] - pad <= y1 && b[3] + pad >= y0) ids.push(op.id);
  }
  return ids;
}

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Scanline flood fill. The region is found on `srcCtx`, which is the composite
 * of every layer, so fills stop at ink on any layer. The region is painted onto
 * `dstCtx`, the layer the fill belongs to.
 */
export function floodFill(srcCtx, dstCtx, x, y, hex) {
  const { width, height } = srcCtx.canvas;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;

  const data = srcCtx.getImageData(0, 0, width, height).data;
  const start = (sy * width + sx) * 4;
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  const [r, g, b] = parseHex(hex);
  if (tr === r && tg === g && tb === b && ta === 255) return;

  const matches = (i) => data[i] === tr && data[i + 1] === tg && data[i + 2] === tb && data[i + 3] === ta;
  const mask = new Uint8Array(width * height);

  const stack = [sx, sy];
  while (stack.length) {
    const py = stack.pop();
    const px = stack.pop();
    const row = py * width;
    if (mask[row + px] || !matches((row + px) * 4)) continue;

    let left = px;
    while (left > 0 && !mask[row + left - 1] && matches((row + left - 1) * 4)) left -= 1;
    let right = px;
    while (right < width - 1 && !mask[row + right + 1] && matches((row + right + 1) * 4)) right += 1;
    for (let i = left; i <= right; i += 1) mask[row + i] = 1;

    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inRun = false;
      for (let i = left; i <= right; i += 1) {
        const idx = ny * width + i;
        const ok = !mask[idx] && matches(idx * 4);
        if (ok && !inRun) {
          stack.push(i, ny);
          inRun = true;
        } else if (!ok) {
          inRun = false;
        }
      }
    }
  }

  const out = dstCtx.getImageData(0, 0, width, height);
  const pixels = out.data;
  for (let p = 0; p < mask.length; p += 1) {
    if (!mask[p]) continue;
    const i = p * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  dstCtx.putImageData(out, 0, 0);
}

/** Color under a device-pixel point, or null for blank page. */
export function sampleColor(ctx, x, y) {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= ctx.canvas.width || sy >= ctx.canvas.height) return null;
  const [r, g, b, a] = ctx.getImageData(sx, sy, 1, 1).data;
  return a === 0 ? null : toHex(r, g, b);
}

/**
 * A small seeded random generator (mulberry32). The seed comes from the point's
 * place in the path and its position, so a spray lands the same way on every replay.
 */
function seededRandom(index, x, y) {
  let s = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(Math.round(x * 100), 0x85ebca6b) ^ Math.imul(Math.round(y * 100), 0xc2b2ae35)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spray paint: every sample on the path scatters dots over a disc. */
function drawSpray(ctx, op, scale) {
  const radius = op.w * SPRAY_SPREAD;
  const count = Math.round(6 + op.w * 4);
  const dot = Math.max(1, Math.round(scale * 1.2));
  ctx.fillStyle = op.c;
  op.p.forEach((p, i) => {
    const rand = seededRandom(i, p[0], p[1]);
    for (let k = 0; k < count; k += 1) {
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * radius;
      ctx.fillRect(
        Math.round((p[0] + Math.cos(angle) * dist) * scale),
        Math.round((p[1] + Math.sin(angle) * dist) * scale),
        dot,
        dot,
      );
    }
  });
}

/**
 * Stamp shapes, drawn in a box centered on the stamp. Most are filled
 * silhouettes. The smile is an outline with eyes and a mouth.
 */
function drawStamp(ctx, op, scale) {
  const x = op.a[0] * scale;
  const y = op.a[1] * scale;
  const r = (op.s / 2) * scale;
  // Unit coordinates run from 0 to 1 across the box.
  const U = (u, v) => [x + (u * 2 - 1) * r, y + (v * 2 - 1) * r];
  const polygon = (points) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...U(p[0], p[1])) : ctx.moveTo(...U(p[0], p[1]))));
    ctx.closePath();
    ctx.fill();
  };
  switch (op.k) {
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(...U(0.5, 0.9));
      ctx.bezierCurveTo(...U(0.1, 0.6), ...U(0, 0.4), ...U(0, 0.25));
      ctx.bezierCurveTo(...U(0, 0.1), ...U(0.1, 0), ...U(0.25, 0));
      ctx.bezierCurveTo(...U(0.37, 0), ...U(0.45, 0.07), ...U(0.5, 0.15));
      ctx.bezierCurveTo(...U(0.55, 0.07), ...U(0.63, 0), ...U(0.75, 0));
      ctx.bezierCurveTo(...U(0.9, 0), ...U(1, 0.1), ...U(1, 0.25));
      ctx.bezierCurveTo(...U(1, 0.4), ...U(0.9, 0.6), ...U(0.5, 0.9));
      ctx.closePath();
      ctx.fill();
      break;
    case 'star':
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? r * 0.45 : r;
        const p = [x + Math.cos(angle) * rad, y + Math.sin(angle) * rad];
        if (i) ctx.lineTo(...p);
        else ctx.moveTo(...p);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'arrow':
      polygon([[0, 0.36], [0.58, 0.36], [0.58, 0.08], [1, 0.5], [0.58, 0.92], [0.58, 0.64], [0, 0.64]]);
      break;
    case 'bolt':
      polygon([[0.62, 0], [0.1, 0.58], [0.45, 0.58], [0.34, 1], [0.9, 0.38], [0.55, 0.38], [0.7, 0]]);
      break;
    case 'cloud':
      for (const [cx, cy, rad] of [[0.25, 0.5, 0.2], [0.5, 0.36, 0.26], [0.75, 0.5, 0.2]]) {
        ctx.beginPath();
        ctx.arc(x + (cx * 2 - 1) * r, y + (cy * 2 - 1) * r, rad * 2 * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(x - 0.7 * r, y + 0.1 * r, 1.4 * r, 0.4 * r);
      break;
    case 'smile':
      ctx.beginPath();
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + sign * 0.36 * r, y - 0.28 * r, Math.max(0.5, op.w * scale * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y + 0.05 * r, r * 0.52, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    default:
      polygon([[0.5, 0], [1, 1], [0, 1]]);
  }
}

/** Draw one non-fill op onto a canvas context. `scale` is device pixels per normalized unit. */
export function applyOp(ctx, op, scale) {
  const { canvas } = ctx;
  if (op.t === 'clear') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (op.t === 'fill') return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  ctx.lineWidth = op.w * scale;

  if (op.t === 'stroke') {
    if (op.tool === 'spray') {
      drawSpray(ctx, op, scale);
      ctx.restore();
      return;
    }
    if (op.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    if (op.tool === 'marker') ctx.globalAlpha = MARKER_ALPHA;
    const pts = op.p;
    // Pen strokes carry a pressure value per point. The highlighter stays even, since
    // overlapping translucent segments would darken at every joint.
    if (pts[0].length > 2 && op.tool !== 'marker') {
      drawPressureStroke(ctx, pts, op.w, scale);
      ctx.restore();
      return;
    }
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0][0] * scale, pts[0][1] * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
      }
      ctx.stroke();
    }
  } else if (op.t === 'line') {
    ctx.beginPath();
    ctx.moveTo(op.a[0] * scale, op.a[1] * scale);
    ctx.lineTo(op.b[0] * scale, op.b[1] * scale);
    ctx.stroke();
  } else if (op.t === 'curve') {
    ctx.beginPath();
    ctx.moveTo(op.a[0] * scale, op.a[1] * scale);
    ctx.bezierCurveTo(op.c1[0] * scale, op.c1[1] * scale, op.c2[0] * scale, op.c2[1] * scale, op.b[0] * scale, op.b[1] * scale);
    ctx.stroke();
  } else if (op.t === 'poly') {
    ctx.beginPath();
    op.pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * scale, p[1] * scale) : ctx.moveTo(p[0] * scale, p[1] * scale)));
    if (op.closed) ctx.closePath();
    ctx.stroke();
  } else if (op.t === 'stamp') {
    drawStamp(ctx, op, scale);
  } else if (op.t === 'rect') {
    ctx.strokeRect(
      op.a[0] * scale,
      op.a[1] * scale,
      (op.b[0] - op.a[0]) * scale,
      (op.b[1] - op.a[1]) * scale,
    );
  } else if (op.t === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      ((op.a[0] + op.b[0]) / 2) * scale,
      ((op.a[1] + op.b[1]) / 2) * scale,
      (Math.abs(op.b[0] - op.a[0]) / 2) * scale,
      (Math.abs(op.b[1] - op.a[1]) / 2) * scale,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (op.t === 'text') {
    const layout = textLayout(ctx, op, scale);
    ctx.fillStyle = op.c;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, op.a[0] * scale, (op.a[1] + i * layout.lineHeight) * scale);
    });
  }
  ctx.restore();
}

/** Width multiplier for a pen pressure in 0 to 1. A typical press (about 0.6) draws the nominal width. */
export function penFactor(pressure) {
  const p = Math.min(1, Math.max(0, pressure ?? 0.5));
  return 0.2 + 1.3 * p;
}

/** Stroke with a width that follows pen pressure. Each segment takes the average pressure of its ends. */
function drawPressureStroke(ctx, pts, width, scale) {
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * scale, pts[0][1] * scale, (width * penFactor(pts[0][2]) * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay, ap] = pts[i - 1];
    const [bx, by, bp] = pts[i];
    ctx.lineWidth = width * penFactor((ap + bp) / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(ax * scale, ay * scale);
    ctx.lineTo(bx * scale, by * scale);
    ctx.stroke();
  }
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * One offscreen canvas per layer. Ops paint into their own layer, so the eraser
 * only rubs out ink on the layer you are on, and a clear wipes one layer. Layers
 * are composited bottom first when the stack is shown.
 */
export class InkStack {
  #width;
  #height;
  #make;
  #canvases = new Map();
  #scratch = null;
  #order = [];

  constructor(width, height, make = makeCanvas) {
    this.#width = width;
    this.#height = height;
    this.#make = make;
  }

  /** Layer ids, bottom first. Fills read every layer listed here. */
  setLayers(ids) {
    this.#order = [...ids];
    for (const id of [...this.#canvases.keys()]) {
      if (!this.#order.includes(id)) this.#canvases.delete(id);
    }
  }

  reset() {
    for (const canvas of this.#canvases.values()) {
      canvas.getContext('2d').clearRect(0, 0, this.#width, this.#height);
    }
  }

  #ctxFor(id) {
    let canvas = this.#canvases.get(id);
    if (!canvas) {
      canvas = this.#make(this.#width, this.#height);
      this.#canvases.set(id, canvas);
    }
    return canvas.getContext('2d');
  }

  apply(op, scale) {
    if (op.t === 'clear' && op.l === undefined) {
      for (const canvas of this.#canvases.values()) applyOp(canvas.getContext('2d'), op, scale);
      return;
    }
    if (op.t === 'clear') {
      applyOp(this.#ctxFor(op.l), op, scale);
      return;
    }
    if (op.t === 'fill') {
      if (!this.#scratch) this.#scratch = this.#make(this.#width, this.#height).getContext('2d');
      this.composite(this.#scratch, this.#order);
      floodFill(this.#scratch, this.#ctxFor(layerOf(op)), op.at[0] * scale, op.at[1] * scale, op.c);
      return;
    }
    applyOp(this.#ctxFor(layerOf(op)), op, scale);
  }

  /** Draws the listed layers, in the order given, onto `ctx`. */
  composite(ctx, ids) {
    ctx.clearRect(0, 0, this.#width, this.#height);
    for (const id of ids) {
      const canvas = this.#canvases.get(id);
      if (canvas) ctx.drawImage(canvas, 0, 0);
    }
  }
}

/** Replays the resolved ops into a stack. Ids in `exclude` are left out. */
export function replayInk(stack, ops, scale, exclude = null) {
  for (const op of resolveOps(ops)) {
    if (!exclude?.has(op.id)) stack.apply(op, scale);
  }
}

/** Standalone paint of a drawing's visible layers into `ctx`. Used for thumbnails and exports. */
export function paintInk(ctx, ops, layers, scale) {
  const list = normalizeLayers(layers);
  const stack = new InkStack(ctx.canvas.width, ctx.canvas.height);
  stack.setLayers(list.map((layer) => layer.id));
  replayInk(stack, ops, scale);
  stack.composite(ctx, visibleLayerIds(list));
}

const GRID_COLOR = 'rgba(96, 110, 128, 0.32)';

/** Draws the snap grid as 1 device pixel lines every `step` normalized units. `scale` is device pixels per unit. */
export function paintGrid(ctx, scale, step = GRID_STEP) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x * scale <= width; x += step) {
    const px = Math.round(x * scale) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
  }
  for (let y = 0; y * scale <= height; y += step) {
    const py = Math.round(y * scale) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Standalone image of the drawing over the page color, for PNG and PDF export.
 * `normHeight` is the sheet height in normalized units.
 */
export function renderInkCanvas(ops, { pageColor, layers, pixelWidth = 1600, normHeight = 1000 }) {
  const scale = pixelWidth / NORM_WIDTH;
  const width = Math.round(pixelWidth);
  const height = Math.round(normHeight * scale);

  const ink = document.createElement('canvas');
  ink.width = width;
  ink.height = height;
  paintInk(ink.getContext('2d'), ops, layers, scale);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = pageColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(ink, 0, 0);
  return out;
}
