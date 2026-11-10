/**
 * Drawing model. Every mark is an op in normalized page units: x runs from 0 to
 * NORM_WIDTH across the sheet and y uses the same scale. A drawing therefore
 * keeps its shape when the window resizes. Ops are plain JSON, so they store
 * directly in the entry, and undo is just "pop the last op and replay".
 */

export const NORM_WIDTH = 1000;
const MARKER_ALPHA = 0.35;

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

/** Ordered list of ops plus a redo stack. Pure logic, no canvas. */
export class Drawing {
  #ops;
  #redo = [];

  constructor(ops = []) {
    this.#ops = Array.isArray(ops) ? [...ops] : [];
  }

  get ops() {
    return this.#ops;
  }

  get isEmpty() {
    return this.#ops.length === 0;
  }

  get canUndo() {
    return this.#ops.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  commit(op) {
    this.#ops.push(op);
    this.#redo.length = 0;
    return op;
  }

  undo() {
    const op = this.#ops.pop();
    if (op) this.#redo.push(op);
    return op ?? null;
  }

  redo() {
    const op = this.#redo.pop();
    if (op) this.#ops.push(op);
    return op ?? null;
  }

  /** Clearing is itself an op, so it can be undone. */
  clear() {
    if (this.isEmpty) return false;
    this.commit({ t: 'clear' });
    return true;
  }
}

/** Largest y used by any op, in normalized units. Used to size exports. */
export function inkExtent(ops) {
  let max = 0;
  for (const op of ops) {
    let points = [];
    if (op.t === 'stroke') points = op.p;
    else if (op.t === 'fill') points = [op.at];
    else if (op.a && op.b) points = [op.a, op.b];
    for (const point of points) {
      if (point[1] > max) max = point[1];
    }
  }
  return max;
}

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Scanline flood fill over device pixels. Fills the contiguous area that matches the seed pixel. */
export function floodFill(ctx, x, y, hex) {
  const { width, height } = ctx.canvas;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const start = (sy * width + sx) * 4;
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  const [r, g, b] = parseHex(hex);
  if (tr === r && tg === g && tb === b && ta === 255) return;

  const matches = (i) => data[i] === tr && data[i + 1] === tg && data[i + 2] === tb && data[i + 3] === ta;
  const paint = (i) => {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };

  const stack = [sx, sy];
  while (stack.length) {
    const py = stack.pop();
    const px = stack.pop();
    const row = py * width;
    if (!matches((row + px) * 4)) continue;

    let left = px;
    while (left > 0 && matches((row + left - 1) * 4)) left -= 1;
    let right = px;
    while (right < width - 1 && matches((row + right + 1) * 4)) right += 1;
    for (let i = left; i <= right; i += 1) paint((row + i) * 4);

    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= height) continue;
      let inRun = false;
      for (let i = left; i <= right; i += 1) {
        const ok = matches((ny * width + i) * 4);
        if (ok && !inRun) {
          stack.push(i, ny);
          inRun = true;
        } else if (!ok) {
          inRun = false;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Color under a device-pixel point, or null for blank page. */
export function sampleColor(ctx, x, y) {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= ctx.canvas.width || sy >= ctx.canvas.height) return null;
  const [r, g, b, a] = ctx.getImageData(sx, sy, 1, 1).data;
  return a === 0 ? null : toHex(r, g, b);
}

/** Draw one op. `scale` is device pixels per normalized unit. */
export function applyOp(ctx, op, scale) {
  const { canvas } = ctx;
  if (op.t === 'clear') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (op.t === 'fill') {
    floodFill(ctx, op.at[0] * scale, op.at[1] * scale, op.c);
    return;
  }

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
  }
  ctx.restore();
}

export function paintOps(ctx, ops, scale) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const op of ops) applyOp(ctx, op, scale);
}

/**
 * Standalone image of the drawing over the page color, for PNG and PDF export.
 * `normHeight` is the sheet height in normalized units.
 */
export function renderInkCanvas(ops, { pageColor, pixelWidth = 1600, normHeight = 1000 }) {
  const scale = pixelWidth / NORM_WIDTH;
  const width = Math.round(pixelWidth);
  const height = Math.round(normHeight * scale);

  const ink = document.createElement('canvas');
  ink.width = width;
  ink.height = height;
  paintOps(ink.getContext('2d'), ops, scale);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = pageColor;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(ink, 0, 0);
  return out;
}
