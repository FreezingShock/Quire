/**
 * Saved searches: a name for a search text and list filter, kept in the
 * browser prefs. Pure, no DOM. A saved search keeps the query and one filter
 * (for example Tag: travel); the sort order is not saved.
 */
import { newId } from './model.js';

export const SAVED_SEARCH_MAX = 12;
export const SAVED_NAME_MAX = 40;
const FILTER_TYPES = ['all', 'pinned', 'favorite', 'notebook', 'place', 'kind', 'tag', 'mood', 'weather'];
// Filters that name one value. The others ignore the value.
const VALUED = ['notebook', 'place', 'kind', 'tag', 'mood', 'weather'];

/** A filter as stored: a known type, and a string value only where the type needs one. Anything else is "all". */
export function normalizeFilter(raw) {
  const type = FILTER_TYPES.includes(raw?.type) ? raw.type : 'all';
  const value = typeof raw?.value === 'string' && raw.value.trim() ? raw.value.trim().slice(0, 80) : null;
  if (VALUED.includes(type) && value) return { type, value };
  return { type: VALUED.includes(type) ? 'all' : type, value: null };
}

/** Saved searches read back from prefs. Broken rows, duplicate ids and rows past the limit are dropped. */
export function normalizeSavedSearches(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, SAVED_NAME_MAX) : '';
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, name, query: typeof item.query === 'string' ? item.query.slice(0, 200) : '', filter: normalizeFilter(item.filter) });
    if (list.length >= SAVED_SEARCH_MAX) break;
  }
  return list;
}

/** Why a search cannot be saved under this name, or null when it can. */
export function savedSearchProblem(list, { name, query = '', filter = { type: 'all', value: null } }) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Give the search a name.';
  if (!query.trim() && normalizeFilter(filter).type === 'all') return 'Type a search or pick a filter first.';
  const clash = list.some((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  if (!clash && list.length >= SAVED_SEARCH_MAX) return `Remove a saved search first. The limit is ${SAVED_SEARCH_MAX}.`;
  return null;
}

/** The list with this search added. A search with the same name is replaced. Call savedSearchProblem first. */
export function addSavedSearch(list, { name, query = '', filter }) {
  const trimmed = String(name).trim().slice(0, SAVED_NAME_MAX);
  const existing = list.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  const saved = { id: existing?.id ?? newId(), name: trimmed, query: query.trim().slice(0, 200), filter: normalizeFilter(filter) };
  return existing ? list.map((item) => (item.id === existing.id ? saved : item)) : [...list, saved];
}

export function removeSavedSearch(list, id) {
  return list.filter((item) => item.id !== id);
}
