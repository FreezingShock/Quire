/**
 * The scenes the screensaver paints on a canvas: Aurora, Bubbles, and Memories.
 * Each scene is created with `createScene(kind, { canvas, memories, reduceMotion })`
 * and returns `{ resize(width, height, dpr), frame(dt) }`, which screensaver.js
 * drives from one animation loop. Nothing here reads the page or the store.
 */

import { paintInk, NORM_WIDTH } from './drawing.js';
import { plainText } from './markdown.js';
import { displayTitle, formatLongDate } from './model.js';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', system-ui, -apple-system, sans-serif";

// A memory card is drawn at this size in CSS pixels, then scaled to fit the window.
const CARD_W = 220;
const CARD_H = 236;
const INK_X = 12;
const INK_Y = 30;
const INK_W = 196;
const INK_H = 150;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const rand = (low, high) => low + Math.random() * (high - low);

/** Shared canvas plumbing: sizes the backing store for the device pixel ratio and resets state each frame. */
function surface(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };
  return {
    ctx,
    view,
    resize(w, h, dpr) {
      view.w = w;
      view.h = h;
      view.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    begin() {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    },
  };
}

/** Cuts `text` so it fits in `maxWidth` with an ellipsis at the end. The font must already be set on `ctx`. */
function ellipsize(ctx, text, maxWidth) {
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.replace(/\s+$/, '')}…`;
}

/** `text` as it is when it fits on one line, otherwise cut with an ellipsis. */
function fit(ctx, text, maxWidth) {
  return ctx.measureText(text).width <= maxWidth ? text : ellipsize(ctx, text, maxWidth);
}

/** Breaks `text` into at most `maxLines` lines no wider than `maxWidth`. The last line ends with an ellipsis if words are left over. */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const trial = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(trial).width <= maxWidth) {
      line = trial;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------- Aurora ----------

const RIBBONS = Object.freeze([
  { rgb: [60, 242, 176], top: 0.2, wave: 0.1, speed: 0.2, thick: 0.2 },
  { rgb: [73, 214, 255], top: 0.3, wave: 0.12, speed: 0.16, thick: 0.18 },
  { rgb: [141, 107, 255], top: 0.4, wave: 0.09, speed: 0.25, thick: 0.22 },
  { rgb: [120, 255, 200], top: 0.5, wave: 0.07, speed: 0.31, thick: 0.13 },
]);

function createAurora(canvas, pace) {
  const s = surface(canvas);
  let time = 0;
  return {
    resize: s.resize,
    frame(dt) {
      time += dt * pace;
      s.begin();
      const { ctx, view } = s;
      const { w, h } = view;
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#03071a');
      bg.addColorStop(1, '#0a1d3d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // Additive blending makes the curtains glow where they overlap, the way the Vista screensaver did.
      ctx.globalCompositeOperation = 'lighter';
      for (const ribbon of RIBBONS) {
        const base = h * ribbon.top;
        const thick = h * ribbon.thick;
        const edge = (x) =>
          base
          + Math.sin(x * 0.0045 + time * ribbon.speed * 5) * h * ribbon.wave
          + Math.sin(x * 0.0014 - time * ribbon.speed * 3) * h * ribbon.wave * 0.7;
        ctx.beginPath();
        for (let x = 0; x <= w + 12; x += 12) {
          if (x === 0) ctx.moveTo(x, edge(x));
          else ctx.lineTo(x, edge(x));
        }
        for (let x = w + 12; x > 0; x -= 12) ctx.lineTo(x, edge(x) + thick);
        // Close the band at the left edge exactly, so no wedge is left between the two edges.
        ctx.lineTo(0, edge(0) + thick);
        ctx.closePath();
        const [r, g, b] = ribbon.rgb;
        const fill = ctx.createLinearGradient(0, base - h * ribbon.wave, 0, base + thick + h * ribbon.wave);
        fill.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        fill.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.4)`);
        fill.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}

// ---------- Bubbles ----------

function createBubbles(canvas, pace) {
  const s = surface(canvas);
  let bubbles = [];
  let scale = 1;
  let time = 0;

  const spawn = (anywhere) => {
    const { w, h } = s.view;
    const r = (14 + Math.random() * 40) * scale;
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + r + Math.random() * h * 0.3,
      r,
      rise: (24 + Math.random() * 56) * scale,
      wobble: (6 + Math.random() * 12) * scale,
      freq: 0.5 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
    };
  };

  return {
    resize(w, h, dpr) {
      s.resize(w, h, dpr);
      scale = clamp(Math.min(w, h) / 800, 0.6, 1.5);
      const count = clamp(Math.round((w * h) / 26000), 12, 60);
      while (bubbles.length < count) bubbles.push(spawn(true));
      bubbles.length = count;
    },
    frame(dt) {
      time += dt * pace;
      s.begin();
      const { ctx, view } = s;
      const { w, h } = view;
      // The XP-style backdrop: a bright blue light in the middle, deepening toward the corners.
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.8);
      bg.addColorStop(0, '#3d8fe6');
      bg.addColorStop(0.45, '#1a4fa8');
      bg.addColorStop(1, '#06194a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i];
        b.y -= b.rise * dt * pace;
        if (b.y + b.r < -10) bubbles[i] = spawn(false);
        const bubble = bubbles[i];
        const x = bubble.x + Math.sin(time * bubble.freq + bubble.phase) * bubble.wobble;
        const { y, r } = bubble;

        // A clear body that brightens toward the rim, like a soap bubble.
        const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
        body.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
        body.addColorStop(0.75, 'rgba(190, 230, 255, 0.10)');
        body.addColorStop(0.94, 'rgba(255, 255, 255, 0.34)');
        body.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.stroke();

        // The window glint at the upper left.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.42, y - r * 0.46, r * 0.2, r * 0.11, -0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

// ---------- Memories ----------

/** The card face for one memory: a paper print with the drawing, or the text on ruled paper. Drawn once and cached. */
function renderCard(memory, dpr) {
  const { entry, yearsAgo, otd } = memory;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD_W * dpr);
  canvas.height = Math.round(CARD_H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // The paper, with a faint border.
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, CARD_W - 1, CARD_H - 1);

  if (otd) {
    // On this day cards wear a Vista blue label bar across the top.
    const bar = ctx.createLinearGradient(0, 0, 0, 22);
    bar.addColorStop(0, '#5ea5f0');
    bar.addColorStop(1, '#2f78d6');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, CARD_W, 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 10.5px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`ON THIS DAY · ${yearsAgo} ${yearsAgo === 1 ? 'YEAR' : 'YEARS'} AGO`, 10, 11.5);
  } else {
    // Other cards get a strip of translucent tape, like a photo corner.
    ctx.save();
    ctx.translate(CARD_W / 2, 12);
    ctx.rotate(-0.05);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(-34, -8, 68, 16);
    ctx.strokeRect(-34, -8, 68, 16);
    ctx.restore();
  }

  const title = displayTitle(entry);
  ctx.textBaseline = 'alphabetic';

  if (entry.ink?.ops?.length > 0) {
    // Drawings sit on the paper at their true width, cropped to the top of the page.
    const ink = document.createElement('canvas');
    ink.width = Math.round(INK_W * dpr);
    ink.height = Math.round(INK_H * dpr);
    const inkCtx = ink.getContext('2d');
    inkCtx.fillStyle = entry.pageColor || '#fffdf8';
    inkCtx.fillRect(0, 0, ink.width, ink.height);
    paintInk(inkCtx, entry.ink.ops, entry.ink.layers, (INK_W * dpr) / NORM_WIDTH);
    ctx.drawImage(ink, INK_X, INK_Y, INK_W, INK_H);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.strokeRect(INK_X + 0.5, INK_Y + 0.5, INK_W - 1, INK_H - 1);
    ctx.fillStyle = '#1b2430';
    ctx.font = `600 12.5px ${SERIF}`;
    ctx.fillText(fit(ctx, title, INK_W), INK_X, INK_Y + INK_H + 18);
  } else {
    // Writing with no drawing: the title and the start of the text on ruled notepaper.
    // Every line of text sits on one ruled row, so the words never cross a rule.
    const row = (k) => INK_Y + 22 + k * 18;
    ctx.strokeStyle = 'rgba(95, 127, 166, 0.22)';
    for (let k = 0; row(k) <= INK_Y + INK_H; k++) {
      ctx.beginPath();
      ctx.moveTo(INK_X, row(k) + 0.5);
      ctx.lineTo(INK_X + INK_W, row(k) + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = '#1b2430';
    ctx.font = `700 15px ${SERIF}`;
    const titleLines = wrapLines(ctx, title, INK_W, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, INK_X, row(i) - 4));
    // The Markdown heading often repeats the title, so the first words are dropped when they do.
    let body = plainText(entry.body);
    if (body.startsWith(title)) body = body.slice(title.length).trim();
    if (body) {
      ctx.fillStyle = '#34404e';
      ctx.font = `13px ${SERIF}`;
      const first = titleLines.length + 1;
      const maxRows = Math.floor((INK_Y + INK_H - row(first)) / 18) + 1;
      wrapLines(ctx, body, INK_W, Math.max(1, maxRows)).forEach((line, i) => ctx.fillText(line, INK_X, row(first + i) - 4));
    }
  }

  // Under the picture: the date, in small gray type.
  ctx.fillStyle = '#5a6675';
  ctx.font = `10.5px ${SANS}`;
  ctx.fillText(fit(ctx, formatLongDate(entry.date), INK_W), INK_X, CARD_H - 14);
  return canvas;
}

function createMemories(canvas, memories, pace) {
  const s = surface(canvas);
  const images = new Map();
  let cards = [];
  let cursor = 0;
  let scale = 1;

  const imageFor = (memory) => {
    const key = `${memory.entry.id}:${memory.otd ? memory.yearsAgo : 0}`;
    if (!images.has(key)) images.set(key, renderCard(memory, s.view.dpr));
    return images.get(key);
  };

  /** Gives a card the next memory, with a fresh place, drift, and lifetime. `anywhere` lets it start anywhere on screen. */
  const respawn = (card, anywhere) => {
    const { w, h } = s.view;
    const memory = memories[cursor % memories.length];
    cursor += 1;
    const cw = CARD_W * scale;
    const ch = CARD_H * scale;
    card.image = imageFor(memory);
    card.x = anywhere ? rand(w * 0.04, Math.max(w * 0.04, w * 0.96 - cw)) : rand(-cw * 0.3, w - cw * 0.7);
    card.y = anywhere ? rand(h * 0.06, Math.max(h * 0.06, h * 0.94 - ch)) : rand(h * 0.1, Math.max(h * 0.1, h * 0.9 - ch));
    card.vx = rand(-9, 9) * scale * pace;
    card.vy = rand(-6, 6) * scale * pace;
    card.rot = rand(-0.08, 0.08);
    card.vr = rand(-0.012, 0.012) * pace;
    card.life = 0;
    card.total = rand(10, 16);
  };

  return {
    resize(w, h, dpr) {
      s.resize(w, h, dpr);
      scale = clamp(Math.min(w, h) / 640, 0.6, 1.6);
      // Enough cards to fill the window without crowding it.
      const count = clamp(Math.round((w * h) / (CARD_W * scale * CARD_H * scale * 3.2)), 2, 9);
      while (cards.length < count) {
        const card = {};
        respawn(card, true);
        cards.push(card);
      }
      cards.length = count;
    },
    frame(dt) {
      s.begin();
      const { ctx, view } = s;
      const { w, h } = view;
      // A deep Vista-blue backdrop, lit faintly from the top.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0d3266');
      bg.addColorStop(1, '#041633');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, h) * 0.7);
      glow.addColorStop(0, 'rgba(120, 180, 255, 0.18)');
      glow.addColorStop(1, 'rgba(120, 180, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const cw = CARD_W * scale;
      const ch = CARD_H * scale;
      for (const card of cards) {
        card.life += dt * pace;
        if (card.life >= card.total) respawn(card, false);
        card.x += card.vx * dt;
        card.y += card.vy * dt;
        card.rot += card.vr * dt;
        // Each card fades in and out at the ends of its life.
        const alpha = clamp(Math.min(card.life / 1.2, (card.total - card.life) / 1.2), 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 16 * scale;
        ctx.shadowOffsetY = 6 * scale;
        ctx.translate(card.x + cw / 2, card.y + ch / 2);
        ctx.rotate(card.rot);
        ctx.drawImage(card.image, -cw / 2, -ch / 2, cw, ch);
        ctx.restore();
      }
    },
  };
}

/**
 * Builds a scene of `kind` ('aurora', 'bubbles', or 'memories') on `canvas`.
 * `memories` is the list from pickMemories(), and must not be empty for 'memories'.
 * `reduceMotion` slows every scene to a third of its pace.
 */
export function createScene(kind, { canvas, memories = [], reduceMotion = false }) {
  const pace = reduceMotion ? 0.35 : 1;
  if (kind === 'bubbles') return createBubbles(canvas, pace);
  if (kind === 'memories' && memories.length) return createMemories(canvas, memories, pace);
  return createAurora(canvas, pace);
}
