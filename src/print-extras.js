/**
 * Print kinds for postcards and year in pixels. Each one renders its pictures in
 * `prepare`, which runs before the job is built. The layouts in print-docs.js
 * stay synchronous and testable, and the renderers stay where they are. The
 * renders are cached, so typing a header does not draw every card again.
 */

import { registerPrintKind } from './print-docs.js';
import { CARD, POSTCARD_TEMPLATES, drawPostcard, preparePostcard } from './postcard.js';
import { renderYearPoster, yearGrid } from './yearpixels.js';
import { localISODate } from './model.js';

/** Past this many cards a print is slow and long, so the rest are left out and the page says so. */
export const MAX_CARDS = 120;
const CACHE_LIMIT = 400;
const cache = new Map();

/** Keeps a render for next time. The cache is cleared when it fills, which is rare and cheap to refill. */
function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

const byDate = (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

/** A PNG of each entry's postcard in one template, keyed by entry id. */
export async function postcardImages(entries, templateId) {
  const sorted = [...entries].sort(byDate);
  const images = {};
  for (const entry of sorted.slice(0, MAX_CARDS)) {
    const key = `card|${entry.id}|${entry.updatedAt}|${templateId}`;
    if (!cache.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = CARD.width;
      canvas.height = CARD.height;
      drawPostcard(canvas, await preparePostcard(entry), templateId);
      remember(key, canvas.toDataURL('image/png'));
    }
    images[entry.id] = cache.get(key);
  }
  return { images, truncated: sorted.length > MAX_CARDS, total: sorted.length };
}

/** The calendar year the selection ends in: the latest entry's year. */
export function yearFor(entries) {
  const latest = entries.map((entry) => entry.date).sort().at(-1);
  return latest ? Number(latest.slice(0, 4)) : null;
}

/** The year poster as a PNG, drawn from the selected entries for the year they end in. */
export function yearPosterImage(entries, today = localISODate()) {
  const year = yearFor(entries);
  if (year === null) return { year: null, poster: null };
  const signature = entries.map((entry) => `${entry.id}${entry.updatedAt}`).sort().join('|');
  const key = `year|${year}|${today}|${signature}`;
  if (!cache.has(key)) remember(key, renderYearPoster(yearGrid(entries, year, today)).toDataURL('image/png'));
  return { year, poster: cache.get(key) };
}

registerPrintKind({
  id: 'postcards',
  label: 'Postcards, one per page',
  defaultHeader: 'Postcards',
  scope: 'entries',
  options: [
    {
      id: 'template',
      label: 'Template',
      type: 'choice',
      default: POSTCARD_TEMPLATES[0].id,
      choices: POSTCARD_TEMPLATES.map((template) => ({ id: template.id, label: template.label })),
    },
  ],
  prepare: ({ entries, options }) => postcardImages(entries, options.template),
  build({ entries, prepared, setup }) {
    const images = prepared.images ?? {};
    const cards = [...entries].sort(byDate).filter((entry) => images[entry.id]);
    if (!cards.length) return { body: '<p class="note-empty">No postcards to draw for these entries.</p>', empty: true };
    const note = prepared.truncated
      ? `<p class="note-empty">Printing the first ${cards.length} of ${prepared.total} postcards. Narrow the dates to print the rest.</p>`
      : '';
    const pages = cards
      .map((entry, index) => {
        const alt = entry.title ? `Postcard: ${entry.title}` : 'Postcard';
        return `<section class="fit-page${index > 0 ? ' break' : ''}">`
          + `<img class="fit-ink" alt="${alt.replace(/"/g, '&quot;')}" src="${images[entry.id]}" style="height: ${Math.floor(setup.contentHeight)}px">`
          + '</section>';
      })
      .join('');
    return { title: 'Postcards', body: pages + note };
  },
});

registerPrintKind({
  id: 'year',
  label: 'Year in pixels poster',
  defaultHeader: 'Year in pixels',
  scope: 'entries',
  options: [],
  prepare: ({ entries }) => yearPosterImage(entries),
  build({ prepared, setup }) {
    if (!prepared.poster) return { body: '<p class="note-empty">No entries to draw a year from.</p>', empty: true };
    return {
      title: `Year in pixels ${prepared.year}`,
      body: `<section class="fit-page"><img class="fit-ink" alt="Year ${prepared.year} in pixels" src="${prepared.poster}" style="height: ${Math.floor(setup.contentHeight)}px"></section>`,
    };
  },
});
