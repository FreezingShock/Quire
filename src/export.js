/** Export and backup: Markdown (with drawing in a ZIP), PNG, print-to-PDF, and JSON backups. */

import { escapeHtml, renderMarkdown } from './markdown.js';
import { createZip } from './zip.js';
import { SKETCH_PRINT_WIDTH, dataUrlBytes, dataUrlParts, extensionFor, mediaRefsIn, mediaResolver, sketchDataUrl } from './media.js';
import { KINDS, displayTitle, fileStem, formatLongDate, localISODate, normalizeEntry } from './model.js';
import { NORM_WIDTH, inkExtent, renderInkCanvas, visibleOps } from './drawing.js';
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

/**
 * Print or save as PDF. The sheet is laid out at PAGE_WIDTH and zoomed to fit
 * the printable width, so text wraps the same way as on screen. The drawing is
 * positioned in normalized units and scales with the page.
 */
export function printEntry(entry, { fontStack }) {
  const height = inkHeightFor(entry);
  const cssHeight = Math.round((height / NORM_WIDTH) * PAGE_WIDTH);
  const hasInk = entry.ink.ops.length > 0;
  const inkUrl = hasInk
    ? renderInkCanvas(entry.ink.ops, { pageColor: entry.pageColor, layers: entry.ink.layers, pixelWidth: 1640, normHeight: height }).toDataURL('image/png')
    : '';
  const kind = KINDS.find((k) => k.id === entry.kind)?.label ?? 'Journal';
  const title = escapeHtml(displayTitle(entry));
  const meta = escapeHtml(`${kind} · ${formatLongDate(entry.date)}`);
  const stylesheet = new URL('../styles/reader.css', import.meta.url).href;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="${stylesheet}">
<style>
@page { margin: 16mm; }
:root { --page-font: ${fontStack}; }
html, body { margin: 0; background: #fff; }
body { color: #25221d; font-family: var(--page-font); }
.print-head { width: 672px; margin: 0 0 12px; }
.print-head h1 { font-size: 22px; line-height: 1.25; margin: 0 0 4px; }
.print-head p { margin: 0; font-size: 12px; color: #6f685b; }
.sheet { position: relative; width: ${PAGE_WIDTH}px; zoom: 0.82; box-sizing: border-box; background: ${entry.pageColor}; padding: 56px 72px 72px 88px; }
.sheet-ink { position: absolute; left: 0; top: 0; width: ${PAGE_WIDTH}px; height: ${cssHeight}px; }
</style>
</head>
<body>
<header class="print-head"><h1>${title}</h1><p>${meta}</p></header>
<main class="sheet"><div class="sheet-text">${renderMarkdown(entry.body, { media: mediaResolver(entry) })}</div>${hasInk ? `<img class="sheet-ink" alt="" src="${inkUrl}">` : ''}</main>
</body>
</html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'Print preview');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  frame.addEventListener(
    'load',
    async () => {
      const win = frame.contentWindow;
      await Promise.all([...win.document.images].map((img) => img.decode().catch(() => {})));
      if (win.document.fonts?.ready) await win.document.fonts.ready;
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 1500);
    },
    { once: true },
  );
  frame.srcdoc = html;
  document.body.append(frame);
}

/** Format 1. `versions` is optional, so backups from before version history still restore. */
export function makeBackup(entries, versions = []) {
  const payload = {
    app: 'quire',
    format: 1,
    exportedAt: new Date().toISOString(),
    date: localISODate(),
    entries,
    versions,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'quire' || !Array.isArray(data.entries)) {
    throw new Error('This file is not a Quire backup.');
  }
  const versions = Array.isArray(data.versions) ? data.versions.map(normalizeVersion).filter(Boolean) : [];
  return { entries: data.entries.map((entry) => normalizeEntry(entry)), versions };
}
