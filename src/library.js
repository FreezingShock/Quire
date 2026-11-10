/**
 * Pure helpers for the home view: filtering, sorting, and summaries of entries.
 * No DOM and no storage, so they are covered by node:test.
 */

import { KINDS, compareEntries, displayTitle } from './model.js';
import { plainText, wordCount } from './markdown.js';

/** Default direction for each sortable column. */
export const SORTS = Object.freeze({
  title: { label: 'Title', dir: 'asc' },
  date: { label: 'Date', dir: 'desc' },
  kind: { label: 'Kind', dir: 'asc' },
  words: { label: 'Words', dir: 'desc' },
  updatedAt: { label: 'Modified', dir: 'desc' },
});

const KIND_LABELS = new Map(KINDS.map((kind) => [kind.id, kind.label]));

export function kindLabel(id) {
  return KIND_LABELS.get(id) ?? id;
}

/** Plain-text preview of the body, cut at a word boundary when it runs long. */
export function excerptOf(entry, max = 200) {
  const text = plainText(entry.body);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * `filter` is { type: 'all' | 'kind' | 'tag', value }. `query` matches the
 * title, body, tags, and kind label, ignoring case.
 */
export function filterEntries(entries, { filter = { type: 'all', value: null }, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.type === 'kind' && entry.kind !== filter.value) return false;
    if (filter.type === 'tag' && !entry.tags.includes(filter.value)) return false;
    if (!q) return true;
    const haystack = `${displayTitle(entry)} ${entry.body} ${entry.tags.join(' ')} ${kindLabel(entry.kind)}`;
    return haystack.toLowerCase().includes(q);
  });
}

const COMPARATORS = {
  title: (a, b) => displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }),
  date: (a, b) => a.date.localeCompare(b.date),
  kind: (a, b) => kindLabel(a.kind).localeCompare(kindLabel(b.kind)),
  words: (a, b) => wordCount(a.body) - wordCount(b.body),
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
};

/** Returns a sorted copy. Ties fall back to newest-first, the store's default order. */
export function sortEntries(entries, { key = 'date', dir = 'desc' } = {}) {
  const compare = COMPARATORS[key] ?? COMPARATORS.date;
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => sign * compare(a, b) || compareEntries(a, b));
}

/** { journal: 3, poem: 0, ... } for every kind, including empty ones. */
export function countByKind(entries) {
  const counts = Object.fromEntries(KINDS.map((kind) => [kind.id, 0]));
  for (const entry of entries) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  return counts;
}

/** [{ tag, count }] sorted alphabetically. */
export function countByTag(entries) {
  const counts = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([tag, count]) => ({ tag, count }));
}
