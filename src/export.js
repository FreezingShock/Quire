/** Export and backup: Markdown (with drawing in a ZIP), PNG, and JSON backups. Printing lives in printing.js. */

import { createZip } from './zip.js';
import { SKETCH_PRINT_WIDTH, dataUrlBytes, dataUrlParts, extensionFor, mediaRefsIn, sketchDataUrl } from './media.js';
import { displayTitle, fileStem, localISODate, normalizeEntry } from './model.js';
import { inkExtent, renderInkCanvas, visibleOps } from './drawing.js';
import { normalizeVersion } from './versions.js';

const encoder = new TextEncoder();
/** Sheet width in CSS px. Ink coordinates are scaled against it when printed. */
export const PAGE_WIDTH = 820;

export function inkHeightFor(entry) {
  return Math.max(entry.ink.h || 0, inkExtent(entry.ink.ops) + 20, 600);
}

const MEDIA_REF_CAPTURE = /!\[([^\]\n]*)\]\(quire-(image|sketch):([A-Za-z0-9_-]+)\)/g;

/** Pictures and sketches that the text refers to, as files for the ZIP next to the Markdown. */
export function mediaExports(entry) {
  const files = [];
  for (const { kind, id } of mediaRefsIn(entry.body)) {
    if (kind === 'image' && Object.hasOwn(entry.images ?? {}, id)) {
      const src = entry.images[id];
      const bytes = dataUrlBytes(src);
      if (bytes) files.push({ kind, id, path: `images/${id}.${extensionFor(dataUrlParts(src).type)}`, data: bytes });
    } else if (kind === 'sketch' && Object.hasOwn(entry.sketches ?? {}, id)) {
      const png = dataUrlBytes(sketchDataUrl(entry.sketches[id], entry.pageColor, SKETCH_PRINT_WIDTH));
      files.push({ kind, id, path: `sketches/${id}.png`, data: png });
    }
  }
  return files;
}

/** `mediaPaths` maps "kind:id" to the file path inside the ZIP, so the links still work after export. */
export function entryToMarkdown(entry, { drawingName = null, mediaPaths = new Map() } = {}) {
  const front = [
    '---',
    `title: ${JSON.stringify(displayTitle(entry))}`,
    `date: ${entry.date}`,
    `kind: ${entry.kind}`,
    ...(entry.mood ? [`mood: ${entry.mood}`] : []),
    ...(entry.weather ? [`weather: ${entry.weather}`] : []),
    `tags: [${entry.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    '---',
  ].join('\n');
  const parts = [front];
  if (entry.body.trim()) {
    parts.push(
      entry.body
        .trimEnd()
        .replace(MEDIA_REF_CAPTURE, (match, alt, kind, id) => {
          const path = mediaPaths.get(`${kind}:${id}`);
          return path ? `![${alt}](${encodeURI(path)})` : match;
        }),
    );
  }
  if (drawingName) parts.push(`![Drawing](${encodeURI(drawingName)})`);
  return `${parts.join('\n\n')}\n`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function inkPngBlob(entry) {
  const canvas = renderInkCanvas(entry.ink.ops, {
    pageColor: entry.pageColor,
    layers: entry.ink.layers,
    pixelWidth: 1600,
    normHeight: inkHeightFor(entry),
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the drawing.'))), 'image/png');
  });
}

/**
 * Markdown file alone, or a .zip with the Markdown plus the drawing PNG and the
 * pictures and sketches the text refers to.
 */
export async function exportMarkdown(entry) {
  const stem = fileStem(entry);
  const media = mediaExports(entry);
  const hasInk = visibleOps(entry.ink.ops).length > 0;
  if (!hasInk && !media.length) {
    downloadBlob(new Blob([entryToMarkdown(entry)], { type: 'text/markdown;charset=utf-8' }), `${stem}.md`);
    return;
  }
  const drawingName = hasInk ? `${stem}-drawing.png` : null;
  const mediaPaths = new Map(media.map((file) => [`${file.kind}:${file.id}`, file.path]));
  const files = [{ name: `${stem}.md`, data: encoder.encode(entryToMarkdown(entry, { drawingName, mediaPaths })) }];
  if (hasInk) files.push({ name: drawingName, data: new Uint8Array(await (await inkPngBlob(entry)).arrayBuffer()) });
  for (const file of media) files.push({ name: file.path, data: file.data });
  downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), `${stem}.zip`);
}

export async function exportDrawingPng(entry) {
  downloadBlob(await inkPngBlob(entry), `${fileStem(entry)}-drawing.png`);
}

/** Format 1. `versions` is optional, so backups from before version history still restore. */
export function makeBackup(entries, versions = [], stickers = []) {
  const payload = {
    app: 'quire',
    format: 1,
    exportedAt: new Date().toISOString(),
    date: localISODate(),
    entries,
    versions,
    stickers,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'quire' || !Array.isArray(data.entries)) {
    throw new Error('This file is not a Quire backup.');
  }
  const versions = Array.isArray(data.versions) ? data.versions.map(normalizeVersion).filter(Boolean) : [];
  // Older backups have no sticker library. A sticker without a picture is dropped.
  const stickers = Array.isArray(data.stickers)
    ? data.stickers.filter((item) => typeof item?.id === 'string' && /^data:image\//.test(String(item.src ?? '')))
    : [];
  return { entries: data.entries.map((entry) => normalizeEntry(entry)), versions, stickers };
}
