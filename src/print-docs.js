/**
 * Print layouts. Each kind turns a list of entries into the body of one print
 * job: a single entry, a journal log, drawings fitted one to a page, or stats.
 * Nothing here touches the DOM, so the layouts and numbers can be tested in
 * Node. printing.js owns the dialog and the print frame.
 *
 * Other modules add a kind with registerPrintKind({ id, label, defaultHeader,
 * scope, options, prepare, build }). `options` is [{ id, label, default }] for
 * a yes-or-no choice, or [{ id, label, type: 'choice', choices, default }] for
 * a pick from a list. `prepare({ entries, options })` may be async and returns
 * the pictures the layout needs. `build` gets them as `prepared`, along with
 * { entries, options, setup, today, range, inkUrl } and returns { body,
 * title?, empty? }. `inkUrl(entry)` gives a PNG data URL of the entry's drawing.
 */

import { escapeHtml, renderMarkdown, wordCount } from './markdown.js';
import { PAGE_WIDTH, inkHeightFor } from './export.js';
import { mediaResolver } from './media.js';
import { NORM_WIDTH } from './drawing.js';
import { KINDS, MOODS, WEATHERS, displayTitle, formatLongDate, formatShortDate, localISODate } from './model.js';
import {
  bucketSeries,
  daysBetween,
  dayStreaks,
  monthGrid,
  monthOf,
  moodAverage,
  moodCounts,
  moodForScore,
  moodSeries,
  summarizeDays,
} from './journal.js';

/** CSS pixels per millimetre at the 96 dpi that browsers use for print layout. */
const MM = 96 / 25.4;

/** Sheet sizes in millimetres. `css` is the name the @page size rule takes. */
export const PAPERS = Object.freeze([
  { id: 'letter', label: 'Letter (8.5 × 11 in)', css: 'letter', mm: [215.9, 279.4] },
  { id: 'a4', label: 'A4 (210 × 297 mm)', css: 'A4', mm: [210, 297] },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', css: 'legal', mm: [215.9, 355.6] },
  { id: 'a5', label: 'A5 (148 × 210 mm)', css: 'A5', mm: [148, 210] },
]);

export const MARGINS = Object.freeze([
  { id: 'narrow', label: 'Narrow (10 mm)', mm: 10 },
  { id: 'normal', label: 'Normal (16 mm)', mm: 16 },
  { id: 'wide', label: 'Wide (25 mm)', mm: 25 },
]);

export const DEFAULT_PAGE = Object.freeze({
  paper: 'letter',
  orientation: 'portrait',
  margin: 'normal',
  header: '',
  printDate: true,
  pageNumbers: true,
});

/** Style for the header and footer text, which sits in the page margins. */
const CHROME_FONT = 'font: 8.5pt/1.2 "Segoe UI", Tahoma, Arial, sans-serif; color: #6b655a;';

const MOOD_SHORT = Object.freeze({ great: 'Great', good: 'Good', okay: 'Okay', low: 'Low', rough: 'Rough' });
const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MAX_PLOT_DAYS = 120; // longer ranges plot weekly averages, as the mood chart on the dashboard does

/** Page size, margins and the printable area in CSS pixels, for a page setting. */
export function pageSetup(page = DEFAULT_PAGE) {
  const paper = PAPERS.find((item) => item.id === page.paper) ?? PAPERS[0];
  const margin = MARGINS.find((item) => item.id === page.margin) ?? MARGINS[1];
  const landscape = page.orientation === 'landscape';
  const [shortMm, longMm] = paper.mm;
  const width = (landscape ? longMm : shortMm) * MM;
  const height = (landscape ? shortMm : longMm) * MM;
  const marginPx = margin.mm * MM;
  return {
    paper,
    orientation: landscape ? 'landscape' : 'portrait',
    marginMm: margin.mm,
    widthPx: width,
    heightPx: height,
    contentWidth: width - 2 * marginPx,
    contentHeight: height - 2 * marginPx,
  };
}

/** A CSS string literal that is safe inside a <style> element. */
export function cssString(text) {
  const safe = String(text).replace(/\s+/g, ' ');
  return `"${safe.replace(/[\\"<>&]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

function pageRule(setup, chrome) {
  const boxes = [];
  if (chrome.header) boxes.push(`@top-center { content: ${cssString(chrome.header)}; ${CHROME_FONT} }`);
  if (chrome.date) boxes.push(`@bottom-left { content: ${cssString(chrome.date)}; ${CHROME_FONT} }`);
  if (chrome.pageNumbers) boxes.push(`@bottom-right { content: "Page " counter(page) " of " counter(pages); ${CHROME_FONT} }`);
  return `@page { size: ${setup.paper.css} ${setup.orientation}; margin: ${setup.marginMm}mm; ${boxes.join(' ')} }`;
}

/** The shared document shell: a paper-sized sheet on screen, the bare page when printed. */
export function printDocument({ title, stylesheet, fontStack, setup, chrome, css = '', body }) {
  const px = (value) => Math.round(value * 100) / 100;
  const marginPx = px(setup.marginMm * MM);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(stylesheet)}">
<style>
${pageRule(setup, chrome)}
:root { --page-font: ${fontStack}; }
html { background: #fff; }
body { margin: 0; color: #25221d; font-family: var(--page-font); }
.doc { box-sizing: border-box; background: #fff; }
@media screen {
  html { background: #6b707a; }
  body { padding: 18px 0 32px; }
  .doc {
    width: ${px(setup.widthPx)}px;
    min-height: ${px(setup.heightPx)}px;
    margin: 0 auto;
    padding: ${marginPx}px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }
}
@media print {
  .doc { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; }
}
${DOC_CSS}
${css}
</style>
</head>
<body>
<main class="doc">${body}</main>
</body>
</html>`;
}

const DOC_CSS = `
.break { break-before: page; }
.print-head { margin: 0 0 12px; }
.print-head h1 { font-size: 22px; line-height: 1.25; margin: 0 0 4px; }
.print-head p { margin: 0; font-size: 12px; color: #6f685b; }
.sheet { position: relative; box-sizing: border-box; }
.sheet-ink { position: absolute; left: 0; top: 0; }

.log-entry { break-inside: auto; margin: 0 0 22px; padding-bottom: 18px; border-bottom: 1px solid #d8d1c2; }
.log-entry:last-child { border-bottom: 0; }
.log-date { margin: 0; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #7a7263; }
.log-title { font-size: 20px; line-height: 1.25; margin: 2px 0 2px; }
.log-meta { margin: 0 0 10px; font-size: 12px; color: #6f685b; }
.log-ink { display: block; width: 100%; height: auto; margin: 12px 0 0; }

.fit-page { position: relative; }
.fit-caption { margin: 0 0 8px; font-size: 12px; color: #6f685b; }
.fit-ink { display: block; width: 100%; object-fit: contain; object-position: top left; }

.stat-section { margin: 0 0 24px; break-inside: avoid; }
.stat-section h2 { font-size: 15px; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #c9c1ae; }
.stat-table { border-collapse: collapse; font-size: 13px; }
.stat-table th { text-align: left; font-weight: 600; padding: 3px 18px 3px 0; color: #4d473d; }
.stat-table td { padding: 3px 0; }
.stat-chart { display: block; width: 100%; height: auto; }
.stat-chart text { font-size: 11px; fill: #6b655a; font-family: var(--page-font); }
.stat-chart .gridline { stroke: #e3dccb; stroke-width: 1; }
.stat-chart .trend { fill: none; stroke: #2f6fbf; stroke-width: 2; }
.stat-chart .dot { fill: #2f6fbf; }
.mood-counts { font-size: 12px; color: #4d473d; margin: 6px 0 0; }
.cal-month { break-inside: avoid; margin: 0 0 18px; }
.cal-month h3 { font-size: 13px; margin: 0 0 4px; }
.cal { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
.cal th { font-weight: 600; text-align: left; padding: 2px 4px; color: #6b655a; border-bottom: 1px solid #c9c1ae; }
.cal td { vertical-align: top; height: 46px; padding: 3px 4px; border: 1px solid #e3dccb; }
.cal td.out { background: #f6f3ec; color: #b7b0a0; border-color: #f0ebe0; }
.cal-num { display: block; font-size: 10px; color: #4d473d; }
.cal-count { display: block; font-size: 10px; color: #2f6fbf; margin-top: 2px; }
.cal-mood { display: block; font-size: 9px; color: #6b655a; }
.note-empty { font-size: 14px; color: #6f685b; padding: 24px 0; }
`;

/** Entries that a multi-entry print uses: no sample entry, and only the chosen notebook and dates. */
export function selectEntries(entries, { notebook = '', from = '', to = '' } = {}) {
  return entries.filter(
    (entry) =>
      !entry.sample
      && (!notebook || entry.notebook === notebook)
      && (!from || entry.date >= from)
      && (!to || entry.date <= to),
  );
}

export function notebooksIn(entries) {
  return [...new Set(entries.map((entry) => entry.notebook).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function labelOf(list, id) {
  return list.find((item) => item.id === id)?.label ?? '';
}

function sheetHtml(entry, { inkUrl, setup, hasInk }) {
  const zoom = setup.contentWidth / PAGE_WIDTH;
  const height = inkHeightFor(entry);
  const cssHeight = Math.round((height / NORM_WIDTH) * PAGE_WIDTH);
  // The drawing is multiplied over the text, so it renders on white and the sheet color shows once.
  const ink = hasInk ? inkUrl(entry, { plain: true }) : '';
  const kind = labelOf(KINDS, entry.kind) || 'Journal';
  return {
    head: `<header class="print-head"><h1>${escapeHtml(displayTitle(entry))}</h1><p>${escapeHtml(`${kind} · ${formatLongDate(entry.date)}`)}</p></header>`,
    sheet: `<div class="sheet" style="zoom: ${zoom.toFixed(4)}; background: ${escapeHtml(entry.pageColor)}; width: ${PAGE_WIDTH}px; padding: 56px 72px 72px 88px;">`
      + `<div class="sheet-text">${renderMarkdown(entry.body, { media: mediaResolver(entry) })}</div>`
      + (ink ? `<img class="sheet-ink" alt="" src="${ink}" style="width: ${PAGE_WIDTH}px; height: ${cssHeight}px; mix-blend-mode: multiply;">` : '')
      + '</div>',
  };
}

function metaLine(entry, { withWords = false } = {}) {
  const parts = [labelOf(KINDS, entry.kind)];
  if (entry.mood) parts.push(`Mood: ${labelOf(MOODS, entry.mood)}`);
  if (entry.weather) parts.push(`Weather: ${labelOf(WEATHERS, entry.weather)}`);
  if (entry.notebook) parts.push(`Notebook: ${entry.notebook}`);
  if (entry.tags?.length) parts.push(entry.tags.map((tag) => `#${tag}`).join(' '));
  if (withWords) parts.push(`${wordCount(entry.body)} words`);
  return parts.filter(Boolean).join(' · ');
}

const byDateThenCreated = (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

// ---------- the four built-in kinds ----------

const entryKind = {
  id: 'entry',
  label: 'This entry',
  defaultHeader: '',
  scope: 'current',
  options: [{ id: 'ink', label: 'Include the drawing', default: true }],
  build({ entries, options, setup, inkUrl }) {
    const entry = entries[0];
    if (!entry) return { body: '', empty: true };
    const parts = sheetHtml(entry, { inkUrl, setup, hasInk: options.ink && entry.ink.ops.length > 0 });
    return { title: displayTitle(entry), body: `${parts.head}${parts.sheet}` };
  },
};

const logKind = {
  id: 'log',
  label: 'Journal log',
  defaultHeader: 'Journal log',
  scope: 'entries',
  options: [
    { id: 'meta', label: 'Mood, weather, notebook and tags', default: true },
    { id: 'ink', label: 'Include drawings', default: true },
    { id: 'words', label: 'Show word counts', default: false },
    { id: 'breaks', label: 'Start each entry on a new page', default: false },
    { id: 'newest', label: 'Newest entries first', default: false },
  ],
  build({ entries, options, inkUrl }) {
    if (!entries.length) return { body: '<p class="note-empty">No entries match these settings.</p>', empty: true };
    const ordered = [...entries].sort(byDateThenCreated);
    if (options.newest) ordered.reverse();
    const body = ordered
      .map((entry, index) => {
        const ink = options.ink && entry.ink.ops.length > 0 ? `<img class="log-ink" alt="" src="${inkUrl(entry)}">` : '';
        const meta = options.meta || options.words ? `<p class="log-meta">${escapeHtml(metaLine(entry, { withWords: options.words }))}</p>` : '';
        const breaks = options.breaks && index > 0 ? ' break' : '';
        return `<article class="log-entry${breaks}">`
          + `<p class="log-date">${escapeHtml(formatLongDate(entry.date))}</p>`
          + `<h2 class="log-title">${escapeHtml(displayTitle(entry))}</h2>`
          + meta
          + `<div class="sheet-text">${renderMarkdown(entry.body, { media: mediaResolver(entry) })}</div>`
          + ink
          + '</article>';
      })
      .join('');
    return { title: 'Journal log', body };
  },
};

const drawingsKind = {
  id: 'drawings',
  label: 'Drawings, one per page',
  defaultHeader: 'Drawings',
  scope: 'entries',
  options: [{ id: 'caption', label: 'Caption with the date and title', default: true }],
  build({ entries, options, setup, inkUrl }) {
    const drawn = entries.filter((entry) => entry.ink.ops.length > 0).sort(byDateThenCreated);
    if (!drawn.length) return { body: '<p class="note-empty">None of these entries has a drawing.</p>', empty: true };
    // One drawing per page: the picture fills the printable height less the caption line.
    const captionHeight = options.caption ? 30 : 0;
    const height = Math.max(0, Math.floor(setup.contentHeight - captionHeight - 2));
    const body = drawn
      .map((entry, index) => {
        const caption = options.caption
          ? `<p class="fit-caption">${escapeHtml(`${formatLongDate(entry.date)} · ${displayTitle(entry)}`)}</p>`
          : '';
        return `<section class="fit-page${index > 0 ? ' break' : ''}">`
          + caption
          + `<img class="fit-ink" alt="${escapeHtml(displayTitle(entry))}" src="${inkUrl(entry)}" style="height: ${height}px">`
          + '</section>';
      })
      .join('');
    return { title: 'Drawings', body };
  },
};

const statsKind = {
  id: 'stats',
  label: 'Stats: mood chart and calendar',
  defaultHeader: 'Stats',
  scope: 'entries',
  options: [
    { id: 'summary', label: 'Summary numbers', default: true },
    { id: 'mood', label: 'Mood chart', default: true },
    { id: 'calendar', label: 'Calendar', default: true },
  ],
  build({ entries, options, today, range }) {
    const stats = statsFor(entries, { today, from: range.from, to: range.to });
    if (!stats) return { body: '<p class="note-empty">No entries match these settings.</p>', empty: true };
    const sections = [];
    if (options.summary) sections.push(summarySection(stats));
    if (options.mood) sections.push(moodSection(stats));
    if (options.calendar) sections.push(calendarSection(stats));
    return { title: 'Stats', body: sections.join('') };
  },
};

const BUILT_IN = [entryKind, logKind, drawingsKind, statsKind];
const registry = [...BUILT_IN];

/** Adds a print kind, or replaces one with the same id. Other modules call this to add Year in pixels and postcards. */
export function registerPrintKind(kind) {
  const at = registry.findIndex((item) => item.id === kind.id);
  if (at >= 0) registry[at] = kind;
  else registry.push(kind);
}

export function printKinds() {
  return [...registry];
}

export function kindById(id) {
  return registry.find((kind) => kind.id === id) ?? null;
}

/** The option values a kind starts with, merged with whatever the user saved. */
export function optionsFor(kind, saved = {}) {
  const out = {};
  for (const option of kind.options ?? []) {
    if (option.type === 'choice') {
      const picked = saved[option.id];
      out[option.id] = option.choices.some((choice) => choice.id === picked) ? picked : option.default;
    } else {
      out[option.id] = typeof saved[option.id] === 'boolean' ? saved[option.id] : Boolean(option.default);
    }
  }
  return out;
}

/**
 * The HTML of one print job. `entries` is already selected for the kind, and
 * `range` holds the from and to dates the selection used.
 * Returns { title, html, empty }, where `empty` means there is nothing to print.
 */
export function buildPrintJob({
  kindId,
  entries,
  options = {},
  page = DEFAULT_PAGE,
  range = {},
  today = localISODate(),
  fontStack,
  stylesheet,
  inkUrl,
  prepared = {},
}) {
  const kind = kindById(kindId) ?? entryKind;
  const setup = pageSetup(page);
  const result = kind.build({ entries, options: optionsFor(kind, options), setup, today, range, inkUrl, prepared });
  const chrome = {
    header: String(page.header ?? '').trim(),
    date: page.printDate ? `Printed ${formatLongDate(today)}` : '',
    pageNumbers: Boolean(page.pageNumbers),
  };
  const title = result.title ?? kind.label;
  const html = printDocument({
    title,
    stylesheet,
    fontStack,
    setup,
    chrome,
    body: result.body,
  });
  return { title, html, empty: Boolean(result.empty) };
}

// ---------- stats ----------

/**
 * The numbers behind the stats kind, for the range the entries cover (or the
 * range the caller passes). Null when there is nothing to count.
 */
export function statsFor(entries, { today = localISODate(), from = '', to = '' } = {}) {
  if (!entries.length) return null;
  const dates = entries.map((entry) => entry.date).sort();
  const start = from || dates[0];
  const end = to || dates[dates.length - 1] || today;
  if (start > end) return null;

  const days = daysBetween(start, end) + 1;
  const daily = moodSeries(entries, end, days);
  const size = days > 720 ? 30 : days > MAX_PLOT_DAYS ? 7 : 1;
  const plotted = size === 1 ? daily : bucketSeries(daily, size);
  const byDay = summarizeDays(entries);
  const streak = dayStreaks(entries, today);
  const average = moodAverage(daily);

  const months = [];
  const last = monthOf(end);
  let { year, month } = monthOf(start);
  while (year * 12 + month <= last.year * 12 + last.month) {
    months.push(monthGrid(year, month));
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return {
    start,
    end,
    days,
    entryCount: entries.length,
    wordTotal: entries.reduce((sum, entry) => sum + wordCount(entry.body), 0),
    daysWithEntries: Object.keys(byDay).length,
    streak,
    average,
    averageMood: average === null ? null : moodForScore(average),
    counts: moodCounts(daily),
    plotted,
    plotSize: size,
    byDay,
    months,
  };
}

function summarySection(stats) {
  const rows = [
    ['Range', `${formatShortDate(stats.start)} to ${formatShortDate(stats.end)}`],
    ['Entries', String(stats.entryCount)],
    ['Words', stats.wordTotal.toLocaleString()],
    ['Days with an entry', `${stats.daysWithEntries} of ${stats.days}`],
    ['Current streak', `${stats.streak.current} ${stats.streak.current === 1 ? 'day' : 'days'}`],
    ['Longest streak', `${stats.streak.longest} ${stats.streak.longest === 1 ? 'day' : 'days'}`],
    ['Average mood', stats.averageMood ? `${stats.averageMood.label} (${stats.average.toFixed(1)} of 5)` : 'No moods logged'],
  ];
  return `<section class="stat-section"><h2>Summary</h2><table class="stat-table">${rows
    .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}</table></section>`;
}

/** Mood line chart as SVG. Gaps show days with no mood. Labels and numbers only, so the markup is safe. */
export function moodChartSvg(points, { width = 720, height = 230 } = {}) {
  const pad = { left: 88, right: 14, top: 12, bottom: 28 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = points.length;
  const top = MOODS.length;
  const x = (i) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (score) => pad.top + ((top - score) / (top - 1)) * innerH;

  const grid = MOODS.map((mood, index) => {
    const gy = y(top - index).toFixed(1);
    return `<line class="gridline" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"/>`
      + `<text x="${pad.left - 8}" y="${gy}" dy="0.35em" text-anchor="end">${escapeHtml(mood.label)}</text>`;
  }).join('');

  let path = '';
  let pen = false;
  points.forEach((point, i) => {
    if (point.score === null || point.score === undefined) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(point.score).toFixed(1)} `;
    pen = true;
  });

  const radius = n > 180 ? 1.4 : n > 60 ? 2.4 : 3.8;
  const dots = points
    .map((point, i) =>
      point.score === null || point.score === undefined
        ? ''
        : `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="${radius}"/>`,
    )
    .join('');

  const mid = Math.floor((n - 1) / 2);
  const labelIndexes = [0, mid, n - 1].filter((i, pos, all) => all.indexOf(i) === pos);
  const xLabels = labelIndexes
    .map((i) => {
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      return `<text x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}">${escapeHtml(formatShortDate(points[i].date))}</text>`;
    })
    .join('');

  return `<svg class="stat-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mood across ${n} points">`
    + `${grid}<path class="trend" d="${path.trim()}"/>${dots}${xLabels}</svg>`;
}

function moodSection(stats) {
  const range = stats.plotSize === 1 ? 'each day' : stats.plotSize === 7 ? 'weekly averages' : 'monthly averages';
  const counts = stats.counts.filter((item) => item.count > 0);
  const countText = counts.length
    ? counts.map((item) => `${MOOD_SHORT[item.id] ?? item.label}: ${item.count} ${item.count === 1 ? 'day' : 'days'}`).join(' · ')
    : 'No moods logged in this range.';
  return `<section class="stat-section"><h2>Mood chart</h2>`
    + `<p class="mood-counts">Shown as ${range}.</p>`
    + moodChartSvg(stats.plotted)
    + `<p class="mood-counts">${escapeHtml(countText)}</p></section>`;
}

function calendarSection(stats) {
  return `<section class="stat-section"><h2>Calendar</h2>${stats.months.map((grid) => monthTable(grid, stats)).join('')}</section>`;
}

function monthTable(grid, stats) {
  const title = new Date(Date.UTC(grid.year, grid.month, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const head = `<tr>${WEEKDAYS.map((day) => `<th scope="col">${day}</th>`).join('')}</tr>`;
  const rows = grid.weeks
    .map((week) => {
      const cells = week.map((cell) => {
        if (!cell.inMonth || cell.date < stats.start || cell.date > stats.end) {
          return `<td class="out"><span class="cal-num">${cell.day}</span></td>`;
        }
        const day = stats.byDay[cell.date];
        const count = day?.count ?? 0;
        const countLabel = count ? `<span class="cal-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>` : '';
        const mood = day?.mood ? `<span class="cal-mood">${escapeHtml(MOOD_SHORT[day.mood] ?? '')}</span>` : '';
        return `<td><span class="cal-num">${cell.day}</span>${countLabel}${mood}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
  return `<div class="cal-month"><h3>${escapeHtml(title)}</h3><table class="cal"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

