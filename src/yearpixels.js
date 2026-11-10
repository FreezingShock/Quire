/**
 * Year in pixels: one square for every day of a year. Each month is a row and
 * each day of the month is a column, so a date always sits under its own day
 * number. The grid model is pure (no DOM). renderYearPoster draws the same grid
 * to a canvas for a poster PNG.
 */

import { MOODS, localISODate } from './model.js';
import { summarizeDays } from './journal.js';

/** Fill for each square, keyed by the square's state. Moods match the mood chart. */
export const PIXEL_COLORS = Object.freeze({
  great: '#2e9e4f',
  good: '#6aa83c',
  okay: '#d9a22b',
  low: '#5b7fd6',
  rough: '#b03a2a',
  written: '#8c8577', // an entry that day, but no mood
  empty: '#e6e1d4', // a past day with nothing written
  future: '#f7f4ec', // a day that has not happened yet
});

const MAX_DAYS = 31;
const pad = (n) => String(n).padStart(2, '0');

/** Days in a month, where `month` is 1 to 12. Date.UTC day 0 is the last day of the month before. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Square state for a day cell: a mood id, 'written', 'empty', or 'future'.
 * `today` decides future days. Days are YYYY-MM-DD, so string order is date order.
 */
export function pixelState(cell) {
  if (!cell) return null;
  if (cell.future) return 'future';
  if (cell.mood) return cell.mood;
  return cell.written ? 'written' : 'empty';
}

/**
 * The grid for one calendar year. `months` has twelve rows of 31 cells. A cell
 * is null where the month has no such day (Feb 30, for example). Sample entries
 * are left out, as they are in streaks. `stats` counts the days up to today.
 */
export function yearGrid(entries, year, today = localISODate()) {
  const byDay = summarizeDays(entries.filter((entry) => !entry.sample));
  const counts = Object.fromEntries(MOODS.map((mood) => [mood.id, 0]));
  let elapsed = 0;
  let written = 0;
  let logged = 0;

  const months = [];
  for (let month = 1; month <= 12; month += 1) {
    const length = daysInMonth(year, month);
    const cells = [];
    for (let day = 1; day <= MAX_DAYS; day += 1) {
      if (day > length) {
        cells.push(null);
        continue;
      }
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const summary = byDay[date] ?? null;
      const future = date > today;
      const mood = summary?.mood ?? null;
      if (!future) elapsed += 1;
      if (!future && summary) written += 1;
      if (!future && mood) {
        logged += 1;
        counts[mood] += 1;
      }
      cells.push({ date, day, future, written: Boolean(summary), mood, isToday: date === today });
    }
    months.push({ month, label: monthLabel(year, month), cells });
  }

  const top = MOODS.reduce((best, mood) => (counts[mood.id] > (best ? counts[best.id] : 0) ? mood : best), null);
  return {
    year,
    months,
    stats: {
      elapsed,
      written,
      logged,
      counts,
      top: logged ? top : null,
    },
  };
}

/** Short month name in the reader's language, e.g. "Mar". */
function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}

/** Sentence for the stats, shared by the app view and the poster. */
export function yearSummaryText({ stats }) {
  const parts = [`${stats.written} of ${stats.elapsed} days written`];
  if (stats.logged) parts.push(`${stats.logged} with a mood`);
  if (stats.top) parts.push(`most often ${stats.top.label.toLowerCase()}`);
  return parts.join(' · ');
}

const FONT = '"Segoe UI", Tahoma, Verdana, system-ui, sans-serif';
const POSTER = { width: 1800, height: 1200 };

/**
 * Draws the year as a poster with a Vista-style window frame. Returns the
 * canvas. Canvas and document are only touched inside this function.
 */
export function renderYearPoster(grid) {
  const { width: W, height: H } = POSTER;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Desktop backdrop: a sky gradient, as on the Aero wallpaper.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2a6fc9');
  sky.addColorStop(1, '#bfe2fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // The window: a frosted white body under a blue title bar.
  const frame = { x: 40, y: 40, w: W - 80, h: H - 80, r: 16 };
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.r);
  ctx.fillStyle = '#f5f9fe';
  ctx.fill();
  ctx.save();
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.r);
  ctx.clip();
  const bar = ctx.createLinearGradient(0, frame.y, 0, frame.y + 64);
  bar.addColorStop(0, '#6fb2f2');
  bar.addColorStop(0.5, '#2f7ad6');
  bar.addColorStop(1, '#1b5bb8');
  ctx.fillStyle = bar;
  ctx.fillRect(frame.x, frame.y, frame.w, 64);
  ctx.restore();
  ctx.strokeStyle = '#1b4f9c';
  ctx.lineWidth = 2;
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, frame.r);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 26px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`Quire · ${grid.year} in pixels`, frame.x + 24, frame.y + 33);
  ctx.textBaseline = 'alphabetic';

  // Heading and stats.
  const left = 110;
  ctx.fillStyle = '#0a246a';
  ctx.font = `700 96px ${FONT}`;
  ctx.fillText(String(grid.year), left, 240);
  ctx.fillStyle = '#3d4a60';
  ctx.font = `30px ${FONT}`;
  ctx.fillText(yearSummaryText(grid), left + 260, 226);

  // Grid: day numbers across the top, month names down the side.
  const pitch = 48;
  const size = 38;
  const gridX = 220;
  const gridY = 300;
  ctx.font = `16px ${FONT}`;
  ctx.fillStyle = '#6b778c';
  ctx.textAlign = 'center';
  for (let day = 1; day <= MAX_DAYS; day += 1) {
    ctx.fillText(String(day), gridX + (day - 1) * pitch + size / 2, gridY - 12);
  }
  ctx.textAlign = 'right';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = '#2b3a55';
  grid.months.forEach((row, index) => {
    const cy = gridY + index * pitch + size / 2;
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, gridX - 18, cy);
  });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  grid.months.forEach((row, index) => {
    row.cells.forEach((cell, col) => {
      if (!cell) return;
      const x = gridX + col * pitch;
      const y = gridY + index * pitch;
      roundRect(ctx, x, y, size, size, 6);
      ctx.fillStyle = PIXEL_COLORS[pixelState(cell)];
      ctx.fill();
      if (cell.isToday) {
        ctx.strokeStyle = '#0a246a';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    });
  });

  // Legend along the bottom of the grid.
  const legendY = gridY + 12 * pitch + 44;
  const legend = [...MOODS.map((mood) => [mood.id, mood.label]), ['written', 'Written, no mood'], ['empty', 'Nothing written']];
  let lx = gridX;
  ctx.font = `22px ${FONT}`;
  for (const [state, label] of legend) {
    roundRect(ctx, lx, legendY - 22, 28, 28, 5);
    ctx.fillStyle = PIXEL_COLORS[state];
    ctx.fill();
    ctx.fillStyle = '#3d4a60';
    ctx.fillText(label, lx + 40, legendY);
    lx += 40 + ctx.measureText(label).width + 36;
  }

  ctx.fillStyle = '#6b778c';
  ctx.font = `20px ${FONT}`;
  ctx.fillText('Each square is one day. Its color is the mood you logged that day.', gridX, legendY + 96);
  return canvas;
}

/** PNG blob of the poster, for download or sharing. */
export function posterBlob(grid) {
  const canvas = renderYearPoster(grid);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the poster.'))), 'image/png');
  });
}

/** Adds a rounded-rectangle path to the context. Callers fill or stroke it. */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
