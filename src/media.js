/**
 * Pictures and inline sketches that belong to an entry. A picture is stored as a
 * data URL in `entry.images[id]`. A sketch is a small set of drawing ops in
 * `entry.sketches[id]`, shown inline between paragraphs. The entry's text refers
 * to both by id, for example ![Beach](quire-image:<id>). The helpers that do not
 * touch the DOM are exported first, so the node tests can use them.
 */

import { renderInkCanvas } from './drawing.js';

/** Largest file accepted from disk or the clipboard. Bigger files are refused with a message. */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
/** Longest edge of a stored picture, in pixels. Larger pictures are scaled down before they are saved. */
export const MAX_EDGE = 1600;
/** Pictures at or under this size that already fit MAX_EDGE are stored as the original file. */
const KEEP_AS_IS_BYTES = 2 * 1024 * 1024;
/** Pixel width of a sketch rendered for print, export and history previews. */
export const SKETCH_PRINT_WIDTH = 1200;

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function extensionFor(type) {
  return EXTENSIONS[type] ?? 'png';
}

/** Splits a base64 data URL into its media type and the base64 text. Null for anything else. */
export function dataUrlParts(dataUrl) {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(dataUrl ?? ''));
  return match ? { type: match[1], base64: match[2] } : null;
}

export function dataUrlBytes(dataUrl) {
  const parts = dataUrlParts(dataUrl);
  if (!parts) return null;
  const binary = atob(parts.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function dataUrlToBlob(dataUrl) {
  const parts = dataUrlParts(dataUrl);
  const bytes = dataUrlBytes(dataUrl);
  return bytes ? new Blob([bytes], { type: parts.type }) : null;
}

/** Alt text from a file name: no extension, and no characters that would break the Markdown. */
export function altFor(name) {
  return (
    String(name ?? '')
      .replace(/\.[^.]+$/, '')
      .replace(/[[\]()\\\n]/g, '')
      .trim()
      .slice(0, 60) || 'Image'
  );
}

export function imageFiles(list) {
  return Array.from(list ?? []).filter((file) => file && String(file.type ?? '').startsWith('image/'));
}

/** The media ids a text refers to, in order of first use. */
export function mediaRefsIn(text) {
  const seen = new Map();
  for (const match of String(text ?? '').matchAll(/!\[[^\]\n]*\]\(quire-(image|sketch|audio):([A-Za-z0-9_-]+)\)/g)) {
    const key = `${match[1]}:${match[2]}`;
    if (!seen.has(key)) seen.set(key, { kind: match[1], id: match[2] });
  }
  return [...seen.values()];
}

/** Source for a picture or sketch id on an entry, or null when it is not there. Sketches are rendered once per call. */
export function mediaResolver(entry) {
  const cache = new Map();
  return (kind, id) => {
    const key = `${kind}:${id}`;
    if (cache.has(key)) return cache.get(key);
    let src = null;
    if (kind === 'image' && Object.hasOwn(entry?.images ?? {}, id)) {
      src = entry.images[id];
    } else if (kind === 'audio' && Object.hasOwn(entry?.audio ?? {}, id)) {
      src = entry.audio[id];
    } else if (kind === 'sketch' && Object.hasOwn(entry?.sketches ?? {}, id)) {
      src = sketchDataUrl(entry.sketches[id], entry.pageColor, SKETCH_PRINT_WIDTH);
    }
    cache.set(key, src);
    return src;
  };
}

/** A sketch as a PNG on the page color, for print, export and previews. */
export function sketchDataUrl(sketch, pageColor, pixelWidth = SKETCH_PRINT_WIDTH) {
  const canvas = renderInkCanvas(sketch.ops, { pageColor, pixelWidth, normHeight: sketch.h });
  return canvas.toDataURL('image/png');
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Turns a picked, pasted or dropped file into the data URL an entry stores.
 * Large photos are scaled to MAX_EDGE. GIFs and SVGs keep their original bytes,
 * so animation and vector shapes survive.
 */
export async function prepareImage(file) {
  if (file.size > MAX_INPUT_BYTES) throw new Error('The file is larger than 15 MB.');
  const alt = altFor(file.name);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return { src: await readAsDataUrl(file), alt };
  }
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot read that image.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This browser cannot read that image.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) {
    bitmap.close?.();
    return { src: await readAsDataUrl(file), alt };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  // PNG and WebP can hold transparency, so they stay PNG. Everything else is saved as JPEG.
  const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp';
  return { src: canvas.toDataURL(keepsAlpha ? 'image/png' : 'image/jpeg', 0.9), alt };
}

/** A blank sketch record. Height is in the same normalized units as the page (the page is 1000 wide). */
export const SKETCH_HEIGHT = 320;
export function newSketch() {
  return { h: SKETCH_HEIGHT, ops: [] };
}
