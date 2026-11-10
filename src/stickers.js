/**
 * Stickers: the preset art drawn in code, pictures from the sticker library,
 * and the geometry that turns, sizes and places a sticker on the page.
 *
 * A sticker is one op, { t: 'sticker', a, s, r, m }: its centre `a`, its side
 * `s`, its turn `r` in radians, and `m`, 1 when it is mirrored. It shows either
 * a preset (`k`) or a picture (`img`). A picture's data URL is kept on the entry
 * under that id, so the sticker still shows after its library copy is deleted.
 *
 * Everything here is pure except the picture loader and the file helper, which
 * touch the browser. drawing.js imports from this module, so it imports nothing.
 */

export const STICKER_SIZE = 170;
export const MIN_STICKER_SIZE = 16;
export const MAX_STICKER_SIZE = 1200;
/** Longest side of a picture kept in the library, in pixels. */
const LIBRARY_SIDE = 256;

export const PRESET_STICKERS = [
  { id: 'star', label: 'Star' },
  { id: 'sun', label: 'Sun' },
  { id: 'smiley', label: 'Smiley' },
  { id: 'heart', label: 'Heart' },
  { id: 'check', label: 'Check' },
  { id: 'ribbon', label: 'Ribbon' },
  { id: 'balloon', label: 'Balloon' },
  { id: 'flower', label: 'Flower' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'stamp', label: 'Postage stamp' },
  { id: 'pin', label: 'Pushpin' },
];

// ---------- geometry (no DOM) ----------

/** Page-space corners of a sticker's square, starting top left and going clockwise. */
export function stickerCorners(op) {
  const h = op.s / 2;
  const c = Math.cos(op.r ?? 0);
  const s = Math.sin(op.r ?? 0);
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [op.a[0] + x * c - y * s, op.a[1] + x * s + y * c]);
}

/** The turn handle: a point `distance` above the top edge, on the sticker's own up direction. */
export function stickerKnob(op, distance) {
  const y = -op.s / 2 - distance;
  const c = Math.cos(op.r ?? 0);
  const s = Math.sin(op.r ?? 0);
  return [op.a[0] - y * s, op.a[1] + y * c];
}

/** Keeps a side inside the sizes a sticker can take. */
export function clampStickerSize(side) {
  return Math.min(MAX_STICKER_SIZE, Math.max(MIN_STICKER_SIZE, side));
}

// ---------- preset art ----------
// Each preset is drawn in a unit box centred on the origin: x and y run from -1 to 1.
// The box is scaled to the sticker's size before the art is painted.

function glossy(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, -1, 0, 1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fill();
}

function outline(ctx, color, width = 0.06) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** The soft white shine across the top of a glossy shape. */
function shine(ctx, x = 0, y = -0.45, rx = 0.5, ry = 0.2) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fill();
}

function starPath(ctx, outer, inner, points = 5, start = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = start + (i * Math.PI) / points;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

const PRESET_ART = {
  star(ctx) {
    starPath(ctx, 0.96, 0.42);
    glossy(ctx, '#fff8c4', '#e59b00');
    outline(ctx, '#8a5a00');
    shine(ctx, 0, -0.38, 0.28, 0.12);
  },

  sun(ctx) {
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.17) * 0.62, Math.sin(a - 0.17) * 0.62);
      ctx.lineTo(Math.cos(a) * 1, Math.sin(a) * 1);
      ctx.lineTo(Math.cos(a + 0.17) * 0.62, Math.sin(a + 0.17) * 0.62);
      ctx.closePath();
      glossy(ctx, '#ffd166', '#f08a00');
      outline(ctx, '#9a5200', 0.04);
    }
    ctx.beginPath();
    ctx.arc(0, 0, 0.58, 0, Math.PI * 2);
    glossy(ctx, '#fff9c9', '#f7b500');
    outline(ctx, '#9a5200', 0.05);
    shine(ctx, -0.05, -0.3, 0.3, 0.13);
  },

  smiley(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.92, 0, Math.PI * 2);
    glossy(ctx, '#fff7a8', '#f0b800');
    outline(ctx, '#8a6100');
    ctx.fillStyle = '#3a2a10';
    for (const x of [-0.33, 0.33]) {
      ctx.beginPath();
      ctx.ellipse(x, -0.22, 0.1, 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0.06, 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = 0.09;
    ctx.lineCap = 'round';
    ctx.stroke();
    shine(ctx, -0.1, -0.56, 0.5, 0.2);
  },

  heart(ctx) {
    const P = (u, v) => [(u * 2 - 1) * 0.95, (v * 2 - 1) * 0.95];
    ctx.beginPath();
    ctx.moveTo(...P(0.5, 0.9));
    ctx.bezierCurveTo(...P(0.1, 0.6), ...P(0, 0.4), ...P(0, 0.25));
    ctx.bezierCurveTo(...P(0, 0.1), ...P(0.1, 0), ...P(0.25, 0));
    ctx.bezierCurveTo(...P(0.37, 0), ...P(0.45, 0.07), ...P(0.5, 0.15));
    ctx.bezierCurveTo(...P(0.55, 0.07), ...P(0.63, 0), ...P(0.75, 0));
    ctx.bezierCurveTo(...P(0.9, 0), ...P(1, 0.1), ...P(1, 0.25));
    ctx.bezierCurveTo(...P(1, 0.4), ...P(0.9, 0.6), ...P(0.5, 0.9));
    ctx.closePath();
    glossy(ctx, '#ff9e9e', '#c4122c');
    outline(ctx, '#72091a');
    shine(ctx, -0.3, -0.3, 0.22, 0.13);
  },

  check(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.92, 0, Math.PI * 2);
    glossy(ctx, '#b4f7c0', '#1b9542');
    outline(ctx, '#115a28');
    ctx.beginPath();
    ctx.moveTo(-0.45, 0.02);
    ctx.lineTo(-0.12, 0.36);
    ctx.lineTo(0.5, -0.3);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    shine(ctx, 0, -0.6, 0.6, 0.18);
  },

  ribbon(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.8, 0.1);
    ctx.lineTo(-0.55, 0.9);
    ctx.lineTo(-0.34, 0.66);
    ctx.lineTo(-0.2, 0.1);
    ctx.closePath();
    glossy(ctx, '#5b9ee6', '#123f8c');
    outline(ctx, '#0c2a5e', 0.04);
    ctx.beginPath();
    ctx.moveTo(0.8, 0.1);
    ctx.lineTo(0.55, 0.9);
    ctx.lineTo(0.34, 0.66);
    ctx.lineTo(0.2, 0.1);
    ctx.closePath();
    glossy(ctx, '#5b9ee6', '#123f8c');
    outline(ctx, '#0c2a5e', 0.04);
    ctx.beginPath();
    ctx.roundRect(-0.95, -0.46, 1.9, 0.7, 0.14);
    glossy(ctx, '#a9d6ff', '#1d5fbf');
    outline(ctx, '#0c2a5e', 0.05);
    shine(ctx, 0, -0.27, 0.8, 0.12);
  },

  balloon(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.quadraticCurveTo(-0.15, 0.75, 0.1, 0.98);
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -0.22, 0.62, 0.74, 0, 0, Math.PI * 2);
    glossy(ctx, '#ffb3b3', '#b3152a');
    outline(ctx, '#6a0c17');
    ctx.beginPath();
    ctx.moveTo(-0.1, 0.5);
    ctx.lineTo(0.1, 0.5);
    ctx.lineTo(0, 0.63);
    ctx.closePath();
    ctx.fillStyle = '#8a0f20';
    ctx.fill();
    shine(ctx, -0.22, -0.5, 0.12, 0.2);
  },

  flower(ctx) {
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.42, 0.3, a, 0, Math.PI * 2);
      glossy(ctx, '#ffd9ec', '#e04d8a');
      outline(ctx, '#8a1d4f', 0.04);
    }
    ctx.beginPath();
    ctx.arc(0, 0, 0.26, 0, Math.PI * 2);
    glossy(ctx, '#fff6b0', '#e0a000');
    outline(ctx, '#8a5a00', 0.04);
  },

  leaf(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.9, 0.85);
    ctx.quadraticCurveTo(-0.98, -0.3, 0.85, -0.85);
    ctx.quadraticCurveTo(0.98, 0.35, -0.9, 0.85);
    ctx.closePath();
    glossy(ctx, '#cdf7a0', '#2c8a2c');
    outline(ctx, '#1f5c1f');
    ctx.beginPath();
    ctx.moveTo(-0.84, 0.8);
    ctx.lineTo(0.62, -0.68);
    ctx.strokeStyle = '#1f5c1f';
    ctx.lineWidth = 0.05;
    ctx.stroke();
  },

  cloud(ctx) {
    ctx.beginPath();
    ctx.arc(-0.45, 0.1, 0.42, 0, Math.PI * 2);
    ctx.moveTo(0.55, -0.1);
    ctx.arc(0.02, -0.12, 0.56, 0, Math.PI * 2);
    ctx.moveTo(0.87, 0.1);
    ctx.arc(0.45, 0.1, 0.42, 0, Math.PI * 2);
    ctx.roundRect(-0.87, 0.1, 1.74, 0.42, 0.21);
    // The dark stroke goes under the fill, so the seams where the puffs meet are covered.
    outline(ctx, '#4f7fae', 0.14);
    glossy(ctx, '#ffffff', '#9fc8ee');
    shine(ctx, 0, -0.25, 0.4, 0.12);
  },

  stamp(ctx) {
    ctx.beginPath();
    ctx.rect(-0.8, -0.95, 1.6, 1.9);
    ctx.fillStyle = '#fdfbf0';
    ctx.fill();
    ctx.setLineDash([0.09, 0.07]);
    outline(ctx, '#a48f5c', 0.05);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(-0.6, -0.7, 1.2, 1.15);
    glossy(ctx, '#9ad9ff', '#2b7bd0');
    ctx.beginPath();
    ctx.moveTo(-0.6, 0.45);
    ctx.lineTo(-0.1, -0.1);
    ctx.lineTo(0.2, 0.45);
    ctx.closePath();
    ctx.fillStyle = '#2e7d32';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.1, 0.45);
    ctx.lineTo(0.3, -0.2);
    ctx.lineTo(0.6, 0.45);
    ctx.closePath();
    ctx.fillStyle = '#1b5e20';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0.35, -0.42, 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-0.6, -0.7, 1.2, 1.15);
    outline(ctx, '#2a4d7a', 0.03);
  },

  pin(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.1);
    ctx.lineTo(0, 0.98);
    ctx.strokeStyle = '#6d6d6d';
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -0.35, 0.52, 0, Math.PI * 2);
    glossy(ctx, '#ff9a9a', '#c8102e');
    outline(ctx, '#6b0a18');
    shine(ctx, -0.16, -0.6, 0.2, 0.1);
  },
};

/** Paints a preset in the unit box. Unknown ids fall back to the star. */
export function drawPresetArt(ctx, id) {
  (PRESET_ART[id] ?? PRESET_ART.star)(ctx);
}

// ---------- drawing on the page ----------

/** Pictures from the library, keyed by sticker id, once they are decoded. */
const pictures = new Map();

/** Starts decoding a picture kept on an entry. `onReady` runs once it can be drawn. */
export function loadStickerPicture(id, src, onReady) {
  if (!id || !src || pictures.has(id)) return;
  const img = new Image();
  img.onload = () => onReady?.(id);
  img.src = src;
  pictures.set(id, img);
}

/** Paints one sticker op. `scale` is device pixels per normalized unit, as for other ops. */
export function drawSticker(ctx, op, scale) {
  const half = (op.s / 2) * scale;
  ctx.save();
  ctx.translate(op.a[0] * scale, op.a[1] * scale);
  ctx.rotate(op.r ?? 0);
  if (op.m) ctx.scale(-1, 1);
  if (op.img) {
    const img = pictures.get(op.img);
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, -half, -half, half * 2, half * 2);
  } else {
    ctx.scale(half, half);
    drawPresetArt(ctx, op.k);
  }
  ctx.restore();
}

/** Paints a preset into a canvas for the sticker sheet. */
export function paintPresetPreview(canvas, id) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size * 0.44, size * 0.44);
  drawPresetArt(ctx, id);
  ctx.restore();
}

/**
 * A picture file as a square PNG for the library. The picture is fitted inside
 * the square, so a sticker is never stretched. Transparency is kept.
 */
export async function stickerFromFile(file) {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot read that image.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This browser cannot read that image.');
  }
  const scale = Math.min(1, LIBRARY_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = LIBRARY_SIDE;
  canvas.height = LIBRARY_SIDE;
  canvas.getContext('2d').drawImage(bitmap, (LIBRARY_SIDE - w) / 2, (LIBRARY_SIDE - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/png');
}
