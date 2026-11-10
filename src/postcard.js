/**
 * Postcards: an entry set on a stamped postcard and saved as a PNG. The front
 * shows the picture (the drawing, else the first picture, else a plain scene),
 * the title and the start of the text, a postage stamp, and a postmark. Three
 * retro templates share one layout. The canvas is 1500 x 1000 px, a 6 x 4 inch
 * card at 250 dpi.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { displayTitle, fileStem, formatLongDate, labelFor, MOODS } from './model.js';
import { excerptOf } from './library.js';
import { mediaRefsIn } from './media.js';
import { renderInkCanvas, visibleOps } from './drawing.js';
import { roundRect } from './yearpixels.js';
import { downloadBlob, inkHeightFor } from './export.js';

export const CARD = { width: 1500, height: 1000 };
const MARGIN = 70;
const PICTURE = { x: MARGIN, y: MARGIN, w: 720, h: 860 };
const MESSAGE_X = 900;
const MESSAGE_RIGHT = CARD.width - MARGIN;
const STAMP = { w: 170, h: 200 };
const FONT_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const FONT_SANS = '"Segoe UI", Tahoma, Verdana, system-ui, sans-serif';
const EXCERPT_CHARS = 260;

/** Templates are data: the paper, frame, ink colors and whether the card has a sky. */
export const POSTCARD_TEMPLATES = Object.freeze([
  {
    id: 'stamped',
    label: 'Stamped',
    paper: ['#fdf8ea', '#f1e4c2'],
    ink: '#3a2a1e',
    accent: '#9c3b2a',
    rule: 'rgba(156, 59, 42, 0.18)',
    stamp: { field: '#f6d9c4', text: '#9c3b2a' },
    frame: 'rule',
  },
  {
    id: 'airmail',
    label: 'Airmail',
    paper: ['#fffdf7', '#fbf6ea'],
    ink: '#1f2a44',
    accent: '#2f5fb3',
    rule: 'rgba(47, 95, 179, 0.16)',
    stamp: { field: '#d7e5fa', text: '#2f5fb3' },
    frame: 'airmail',
  },
  {
    id: 'aero',
    label: 'Aero',
    paper: ['#ffffff', '#eef6fd'],
    ink: '#1d2b3f',
    accent: '#1b5bb8',
    rule: 'rgba(27, 91, 184, 0.14)',
    stamp: { field: '#d4efc5', text: '#2d7a2a' },
    frame: 'sky',
  },
]);

export function templateFor(id) {
  return POSTCARD_TEMPLATES.find((item) => item.id === id) ?? POSTCARD_TEMPLATES[0];
}

/**
 * What the front shows, gathered once so the preview and the thumbnails can
 * be redrawn without waiting on images again. `photo` is an <img> or null.
 */
export async function preparePostcard(entry) {
  const hasInk = visibleOps(entry.ink?.ops ?? []).length > 0;
  let ink = null;
  if (hasInk) {
    ink = renderInkCanvas(entry.ink.ops, {
      pageColor: entry.pageColor,
      layers: entry.ink.layers,
      pixelWidth: 1200,
      normHeight: inkHeightFor(entry),
    });
  }
  let photo = null;
  if (!ink) {
    const ref = mediaRefsIn(entry.body).find((item) => item.kind === 'image' && entry.images?.[item.id]);
    if (ref) photo = await loadImage(entry.images[ref.id]);
  }
  const body = excerptOf(entry, EXCERPT_CHARS);
  return {
    entry,
    title: displayTitle(entry),
    body,
    mood: labelFor(MOODS, entry.mood),
    date: formatLongDate(entry.date),
    shortDate: shortDate(entry.date),
    year: entry.date.slice(0, 4),
    pageColor: entry.pageColor,
    source: ink ? 'drawing' : photo ? 'picture' : 'scene',
    picture: ink ?? photo,
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** "NOV 10 2026", the postmark format. Date parts are read directly so no timezone shifts the day. */
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  return `${month.toUpperCase()} ${d} ${y}`;
}

/** Draws the whole card for a template onto a canvas of CARD size, or a scaled copy of it. */
export function drawPostcard(canvas, data, templateId) {
  const template = templateFor(templateId);
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / CARD.width;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, CARD.width, CARD.height);

  paintBackground(ctx, template);
  paintPicture(ctx, data, template);
  paintMessage(ctx, data, template);
  paintStamp(ctx, data, template);
  paintPostmark(ctx, data, template);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

function paintBackground(ctx, template) {
  const { width: W, height: H } = CARD;
  if (template.frame === 'sky') {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2a6fc9');
    sky.addColorStop(1, '#bfe2fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4f9b3a';
    ctx.beginPath();
    ctx.ellipse(W * 0.2, H + 120, 760, 260, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6fb84e';
    ctx.beginPath();
    ctx.ellipse(W * 0.85, H + 160, 700, 230, 0, 0, Math.PI * 2);
    ctx.fill();
    // Card body: a glossy white panel inset from the edges.
    roundRect(ctx, 34, 34, W - 68, H - 68, 22);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    return;
  }
  const paper = ctx.createLinearGradient(0, 0, W, H);
  paper.addColorStop(0, template.paper[0]);
  paper.addColorStop(1, template.paper[1]);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  if (template.frame === 'rule') {
    // A hairline frame, like printed card stock.
    ctx.strokeStyle = 'rgba(122, 74, 40, 0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.strokeStyle = 'rgba(122, 74, 40, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(34, 34, W - 68, H - 68);
  } else if (template.frame === 'airmail') {
    // Red and blue diagonal stripes along the edges.
    const band = 22;
    const inset = band / 2 + 6;
    ctx.lineWidth = band;
    const path = () => {
      ctx.beginPath();
      ctx.rect(inset, inset, W - inset * 2, H - inset * 2);
    };
    ctx.strokeStyle = '#c8372d';
    ctx.setLineDash([]);
    path();
    ctx.stroke();
    ctx.strokeStyle = '#2f5fb3';
    ctx.setLineDash([36, 36]);
    path();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2f5fb3';
    ctx.font = `600 24px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    // Sits under the message, clear of the picture print.
    ctx.fillText('PAR AVION · AIRMAIL', (MESSAGE_X + MESSAGE_RIGHT) / 2, H - 58);
    ctx.textAlign = 'left';
  }
}

function paintPicture(ctx, data, template) {
  const { x, y, w, h } = PICTURE;
  // The print: a white mat with a soft shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x - 14, y - 14, w + 28, h + 28, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  if (data.picture && data.source === 'drawing') {
    // Fit the drawing inside the print, keeping its shape, on the page color.
    ctx.fillStyle = data.pageColor;
    ctx.fillRect(x, y, w, h);
    const fit = Math.min(w / data.picture.width, h / data.picture.height);
    const dw = data.picture.width * fit;
    const dh = data.picture.height * fit;
    ctx.drawImage(data.picture, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else if (data.picture && data.source === 'picture') {
    // Cover the print with the photo, cropped from the middle.
    const fit = Math.max(w / data.picture.naturalWidth, h / data.picture.naturalHeight);
    const dw = data.picture.naturalWidth * fit;
    const dh = data.picture.naturalHeight * fit;
    ctx.drawImage(data.picture, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    paintScene(ctx, data, template, { x, y, w, h });
  }
  ctx.restore();
}

/** No drawing or picture: a little landscape in the template's colors, with the title on it. */
function paintScene(ctx, data, template, { x, y, w, h }) {
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, template.stamp.field);
  sky.addColorStop(1, template.paper[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = template.accent;
  ctx.beginPath();
  ctx.arc(x + w * 0.72, y + h * 0.3, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = template.stamp.text;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.72);
  ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.5, x + w * 0.6, y + h * 0.7);
  ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.8, x + w, y + h * 0.6);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = template.ink;
  ctx.font = `600 58px ${FONT_SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText(data.title, x + w / 2, y + h * 0.5, w - 80);
  ctx.textAlign = 'left';
}

function paintMessage(ctx, data, template) {
  const left = MESSAGE_X;
  const width = MESSAGE_RIGHT - left;
  const divider = PICTURE.x + PICTURE.w + 50;
  ctx.strokeStyle = template.rule;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(divider, MARGIN + 30);
  ctx.lineTo(divider, CARD.height - MARGIN - 30);
  ctx.stroke();
  ctx.setLineDash([]);

  // Title, below the stamp.
  const titleTop = MARGIN + STAMP.h + 56;
  ctx.fillStyle = template.ink;
  ctx.font = `700 50px ${FONT_SERIF}`;
  const titleLines = wrap(ctx, data.title, width).slice(0, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, left, titleTop + i * 62));

  // Body, on ruled lines, as far as the card goes.
  const bodyTop = titleTop + titleLines.length * 62 + 26;
  const bodyBottom = CARD.height - MARGIN - 110;
  const lineHeight = 50;
  ctx.font = `34px ${FONT_SERIF}`;
  const lines = wrap(ctx, data.body, width);
  const room = Math.max(0, Math.floor((bodyBottom - bodyTop) / lineHeight));
  const shown = lines.slice(0, room);
  if (lines.length > room && shown.length) {
    shown[shown.length - 1] = `${shown[shown.length - 1].replace(/\s+\S*$/, '').trimEnd()}…`;
  }
  ctx.strokeStyle = template.rule;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < room; i += 1) {
    const ruleY = bodyTop + (i + 1) * lineHeight + 16;
    ctx.beginPath();
    ctx.moveTo(left, ruleY);
    ctx.lineTo(MESSAGE_RIGHT, ruleY);
    ctx.stroke();
  }
  ctx.fillStyle = template.ink;
  shown.forEach((line, i) => ctx.fillText(line, left, bodyTop + (i + 1) * lineHeight - 8));

  // Footer: the date and the mood, in the accent color.
  ctx.fillStyle = template.accent;
  ctx.font = `600 26px ${FONT_SANS}`;
  const footer = [data.date, data.mood].filter(Boolean).join('  ·  ');
  ctx.fillText(footer, left, CARD.height - MARGIN - 56);
}

function paintStamp(ctx, data, template) {
  const x = MESSAGE_RIGHT - STAMP.w;
  const y = MARGIN;
  const { w, h } = STAMP;
  // Perforated edge: a field of small holes punched out of the stamp.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = template.stamp.field;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = template.paper[0];
  for (let i = 0; i <= w; i += 16) {
    ctx.beginPath();
    ctx.arc(x + i, y, 7, 0, Math.PI * 2);
    ctx.arc(x + i, y + h, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i <= h; i += 16) {
    ctx.beginPath();
    ctx.arc(x, y + i, 7, 0, Math.PI * 2);
    ctx.arc(x + w, y + i, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  // Design: a framed panel with the year, like a printed definitive.
  ctx.strokeStyle = template.stamp.text;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 22, y + 22, w - 44, h - 44);
  ctx.fillStyle = template.stamp.text;
  ctx.textAlign = 'center';
  ctx.font = `700 26px ${FONT_SANS}`;
  ctx.fillText('QUIRE', x + w / 2, y + 66);
  ctx.font = `700 46px ${FONT_SERIF}`;
  ctx.fillText(data.year, x + w / 2, y + 128);
  ctx.font = `600 20px ${FONT_SANS}`;
  ctx.fillText('POST', x + w / 2, y + 162);
  ctx.textAlign = 'left';
}

function paintPostmark(ctx, data, template) {
  // A circular cancel, slightly overlapping the stamp, with three wavy bars.
  // Centered just left of the stamp, so it clips the stamp's edge and leaves the year legible.
  const cx = MESSAGE_RIGHT - STAMP.w - 62;
  const cy = MARGIN + 96;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = template.accent;
  ctx.fillStyle = template.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 68, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = `700 24px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('QUIRE', cx, cy - 14);
  ctx.font = `600 19px ${FONT_SANS}`;
  ctx.fillText(data.shortDate, cx, cy + 14);
  ctx.textAlign = 'left';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i += 1) {
    const yy = cy - 26 + i * 26;
    ctx.beginPath();
    ctx.moveTo(cx - 170, yy);
    for (let x = cx - 170; x <= cx - 86; x += 12) {
      ctx.lineTo(x, yy + (Math.sin((x - cx) / 14 + i) * 5));
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Splits text into lines that fit `maxWidth`, breaking on spaces and keeping existing newlines. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** PNG blob of one template, for saving or sharing. */
export function postcardBlob(data, templateId) {
  const canvas = drawPostcard(createCanvas(CARD.width, CARD.height), data, templateId);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the postcard.'))), 'image/png');
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Postcard dialog: pick a template from three thumbnails, see the card large,
 * then save the PNG or share it when the browser can share files.
 */
export async function postcardDialog(entry, { onStatus = () => {} } = {}) {
  const data = await preparePostcard(entry);
  const stem = fileStem(entry);
  let templateId = POSTCARD_TEMPLATES[0].id;

  const preview = el('canvas', { class: 'postcard-preview', width: CARD.width, height: CARD.height, 'aria-label': 'Postcard preview' });
  const thumbs = POSTCARD_TEMPLATES.map((template) => {
    const canvas = createCanvas(300, 200);
    drawPostcard(canvas, data, template.id);
    return el(
      'button',
      {
        class: 'postcard-thumb',
        type: 'button',
        'aria-pressed': String(template.id === templateId),
        'data-template': template.id,
        onClick: () => choose(template.id),
      },
      el('img', { src: canvas.toDataURL('image/png'), alt: '' }),
      el('span', {}, template.label),
    );
  });
  const note = el('p', { class: 'dialog-text postcard-note' }, sourceNote(data));

  const save = el('button', { class: 'btn btn-primary', type: 'button', onClick: () => saveCard() }, 'Save PNG');
  const share = el('button', { class: 'btn', type: 'button', hidden: true, onClick: () => shareCard() }, 'Share…');

  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide postcard-dialog' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, 'Postcard'),
      el('div', { class: 'postcard-thumbs', role: 'group', 'aria-label': 'Template' }, thumbs),
      preview,
      note,
      el(
        'div',
        { class: 'dialog-actions' },
        share,
        save,
        el('button', { class: 'btn', type: 'submit', value: 'close' }, 'Close'),
      ),
    ),
  );

  function choose(id) {
    templateId = id;
    drawPostcard(preview, data, id);
    for (const button of dialog.querySelectorAll('.postcard-thumb')) {
      button.setAttribute('aria-pressed', String(button.dataset.template === id));
    }
  }

  async function saveCard() {
    const blob = await postcardBlob(data, templateId);
    downloadBlob(blob, `${stem}-postcard.png`);
    onStatus('Saved postcard');
  }

  async function shareCard() {
    const blob = await postcardBlob(data, templateId);
    const file = new File([blob], `${stem}-postcard.png`, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: data.title });
    } catch (error) {
      if (error?.name !== 'AbortError') onStatus('Could not share the postcard');
    }
  }

  showDialog(dialog);
  choose(templateId);
  if (navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] })) share.hidden = false;
  return dialog;
}

function sourceNote(data) {
  if (data.source === 'drawing') return 'The picture on the front is your drawing.';
  if (data.source === 'picture') return 'The picture on the front is the first picture in the entry.';
  return 'No drawing or picture yet, so the front shows a plain scene. Draw on the entry and it appears here.';
}
