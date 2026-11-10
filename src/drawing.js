/**
 * Drawing model. Every mark is an op in normalized page units: x runs from 0 to
 * NORM_WIDTH across the sheet and y uses the same scale. A drawing therefore
 * keeps its shape when the window resizes. Ops are plain JSON, so they store
 * directly in the entry, and undo is just "pop the last op and replay".
 *
 * Each drawing op (stroke, line, rect, ellipse, fill, text) has a stable `id`
 * and belongs to a layer through `l`. Ops without `l` are on the first layer,
 * so entries saved before layers existed still open correctly. Later ops can
 * change earlier ones:
 *   move    { ids, dx, dy }  shifts the ops with those ids
 *   delete  { ids }          removes them
 *   edit    { id, text }     replaces the text of a text box
 *   clear   { l? }           wipes one layer, or every layer when `l` is absent
 * resolveOps() folds these into the list of ops that are actually on the page.
 */

import { GRID_STEP } from './snap.js';

export const NORM_WIDTH = 1000;
export const BASE_LAYER = 'base';
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

const DRAW_TYPES = new Set(['stroke', 'line', 'rect', 'ellipse', 'fill', 'text']);

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

function translateOp(op, dx, dy) {
  if (!dx && !dy) return op;
  // Points may carry a third value, the pen pressure, which must survive a move.
  const shift = (p) => [p[0] + dx, p[1] + dy, ...p.slice(2)];
  if (op.t === 'stroke') return { ...op, p: op.p.map(shift) };
  if (op.t === 'line' || op.t === 'rect' || op.t === 'ellipse' || op.t === 'text') {
    return { ...op, a: shift(op.a), b: shift(op.b) };
  }
  return op;
}

/** A copy of a drawable op moved by (dx, dy). Used for drag previews. */
export function moveOp(op, dx, dy) {
  return translateOp(op, dx, dy);
}

/**
 * The drawable ops that are on the page right now, in paint order. Move, delete
 * and edit ops are applied, and clears remove the ops they wipe out.
 */
export function resolveOps(ops) {
  const offsets = new Map();
  const removed = new Set();
  const texts = new Map();
  for (const op of ops) {
    if (op.t === 'move') {
      for (const id of op.ids ?? []) {
        const offset = offsets.get(id) ?? [0, 0];
        offset[0] += op.dx;
        offset[1] += op.dy;
        offsets.set(id, offset);
      }
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
    const offset = offsets.get(op.id);
    if (offset) next = translateOp(next, offset[0], offset[1]);
    if (op.t === 'text' && texts.has(op.id)) next = { ...next, text: texts.get(op.id) };
    live.push(next);
  }
  return live;
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
  return [x0, y0, x1, y1];
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
    const reach = HIT_PAD + (op.w ?? 0) / 2;
    if (op.t === 'stroke' || op.t === 'line') {
      const path = op.t === 'stroke' ? op.p : [op.a, op.b];
      if (!path?.length) continue;
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
