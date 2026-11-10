/**
 * Pure helpers for the home view: filtering, sorting, and summaries of entries.
 * No DOM and no storage, so they are covered by node:test.
 */

import { KINDS, MOODS, WEATHERS, compareEntries, displayTitle, labelFor } from './model.js';
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

/** Most search terms a query can carry. Extra words past this are ignored. */
const MAX_TERMS = 8;

/**
 * Splits a search box into terms. Words are separated by spaces, and text in
 * double quotes is one phrase: `"winter walk" harbor` -> ['winter walk', 'harbor'].
 * Terms are lowercased and de-duplicated.
 */
export function parseQuery(query = '') {
  const terms = [];
  const pattern = /"([^"]*)"?|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(query))) !== null) {
    const term = (match[1] ?? match[2] ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms.slice(0, MAX_TERMS);
}

/** Escapes text for use inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive matcher for any of the terms, or null when there are none. */
function termPattern(terms) {
  if (!terms.length) return null;
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return new RegExp(alternatives.join('|'), 'gi');
}

/**
 * Splits `text` into alternating plain and hit pieces: [{ text, hit }].
 * Used to highlight matches without building HTML.
 */
export function highlightParts(text, terms = []) {
  const source = String(text ?? '');
  const pattern = termPattern(terms);
  if (!pattern || !source) return [{ text: source, hit: false }];
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ text: source.slice(last), hit: false });
  return parts;
}

/**
 * The words that a search matches against for one entry: title, plain body,
 * tags, notebook, kind, and the mood and weather labels.
 */
function searchText(entry) {
  const feel = `${labelFor(MOODS, entry.mood)} ${labelFor(WEATHERS, entry.weather)}`;
  return [
    displayTitle(entry),
    plainText(entry.body),
    entry.tags.join(' '),
    entry.notebook ?? '',
    kindLabel(entry.kind),
    feel,
  ].join(' ');
}

/** True when every term appears somewhere in the entry. */
export function entryMatches(entry, terms) {
  if (!terms.length) return true;
  const haystack = searchText(entry).toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * A short piece of the entry's text around the first match, with ellipses
 * where it was cut. Without a match, or without a query, it is the excerpt.
 */
export function snippetOf(entry, terms = [], max = 160) {
  const text = plainText(entry.body);
  const pattern = termPattern(terms);
  const found = pattern ? pattern.exec(text) : null;
  if (!found) return excerptOf(entry, max);
  const lead = 50;
  let start = Math.max(0, found.index - lead);
  let end = Math.min(text.length, start + max);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < found.index) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > found.index + found[0].length) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * `filter` is { type, value }. Types: 'all', 'pinned', 'favorite', 'notebook',
 * 'kind', 'tag', 'mood', 'weather'.
 * `query` is a full-text search: every term (or quoted phrase) must appear in
 * the title, body, tags, notebook, kind, or mood and weather labels, ignoring case.
 */
export function filterEntries(entries, { filter = { type: 'all', value: null }, query = '' } = {}) {
  const terms = parseQuery(query);
  return entries.filter((entry) => {
    if (filter.type === 'pinned' && !entry.pinned) return false;
    if (filter.type === 'favorite' && !entry.favorite) return false;
    if (filter.type === 'notebook' && entry.notebook !== filter.value) return false;
    if (filter.type === 'kind' && entry.kind !== filter.value) return false;
    if (filter.type === 'tag' && !entry.tags.includes(filter.value)) return false;
    if (filter.type === 'mood' && entry.mood !== filter.value) return false;
    if (filter.type === 'weather' && entry.weather !== filter.value) return false;
    return entryMatches(entry, terms);
  });
}

const COMPARATORS = {
  title: (a, b) => displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }),
  date: (a, b) => a.date.localeCompare(b.date),
  kind: (a, b) => kindLabel(a.kind).localeCompare(kindLabel(b.kind)),
  words: (a, b) => wordCount(a.body) - wordCount(b.body),
  updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
};

/**
 * Returns a sorted copy. Pinned entries always come first, in the chosen order.
 * Ties fall back to newest-first, the store's default order.
 */
export function sortEntries(entries, { key = 'date', dir = 'desc' } = {}) {
  const compare = COMPARATORS[key] ?? COMPARATORS.date;
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || sign * compare(a, b) || compareEntries(a, b),
  );
}

/** { pinned, favorite } counts for the navigation pane. */
export function countFlags(entries) {
  return {
    pinned: entries.filter((entry) => entry.pinned).length,
    favorite: entries.filter((entry) => entry.favorite).length,
  };
}

/** [{ name, count }] for each notebook in use, sorted by name. */
export function countByNotebook(entries) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.notebook) counts.set(entry.notebook, (counts.get(entry.notebook) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([name, count]) => ({ name, count }));
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

/** Counts one optional field (mood or weather), in the order of its option list. Options nobody has used are left out. */
function countOptions(entries, field, options) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry[field]) counts.set(entry[field], (counts.get(entry[field]) ?? 0) + 1);
  }
  return options
    .filter((option) => counts.has(option.id))
    .map((option) => ({ id: option.id, label: option.label, count: counts.get(option.id) }));
}

/** [{ id, label, count }] for each mood in use. */
export function countByMood(entries) {
  return countOptions(entries, 'mood', MOODS);
}

/** [{ id, label, count }] for each weather in use. */
export function countByWeather(entries) {
  return countOptions(entries, 'weather', WEATHERS);
}
