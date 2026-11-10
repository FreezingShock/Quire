/**
 * Entry model. Plain data only: no DOM, no storage. Storage adapters and the UI
 * both build on these helpers, so keep this file free of side effects.
 */

import { normalizeLayers, normalizeOps, visibleOps } from './drawing.js';

export const KINDS = Object.freeze([
  { id: 'journal', label: 'Journal' },
  { id: 'poem', label: 'Poem' },
  { id: 'blog', label: 'Blog post' },
  { id: 'note', label: 'Note' },
]);

/** How the day felt. Optional on each entry; null means not set. */
export const MOODS = Object.freeze([
  { id: 'great', label: 'Great' },
  { id: 'good', label: 'Good' },
  { id: 'okay', label: 'Okay' },
  { id: 'low', label: 'Low' },
  { id: 'rough', label: 'Rough' },
]);

/** What the sky was doing. Optional on each entry; null means not set. */
export const WEATHERS = Object.freeze([
  { id: 'sunny', label: 'Sunny' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'wind', label: 'Windy' },
  { id: 'storm', label: 'Storm' },
]);

export const DEFAULT_PAGE_COLOR = '#fffdf8';
export const SCHEMA_VERSION = 1;

const KIND_IDS = new Set(KINDS.map((kind) => kind.id));
const MOOD_IDS = new Set(MOODS.map((mood) => mood.id));
const WEATHER_IDS = new Set(WEATHERS.map((weather) => weather.id));
const HEX = /^#[0-9a-f]{6}$/i;

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Local calendar date as YYYY-MM-DD (journal days follow the user's clock, not UTC). */
export function localISODate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const NOTEBOOK_MAX = 40;

/** "  Travel  " -> "Travel". Blank or non-string names become null (no notebook). */
export function normalizeNotebook(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ').slice(0, NOTEBOOK_MAX);
  return name || null;
}

/**
 * Coerce any stored or imported record into the current schema. Unknown or
 * broken fields fall back to safe defaults instead of throwing.
 */
export function normalizeEntry(raw = {}) {
  const now = new Date().toISOString();
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : now;
  return {
    id: String(raw.id ?? newId()),
    title: String(raw.title ?? '').slice(0, 120),
    date: isISODate(raw.date) ? raw.date : localISODate(),
    kind: KIND_IDS.has(raw.kind) ? raw.kind : 'journal',
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [],
    // Older entries have neither field, so they read back as null. No schema bump needed.
    mood: MOOD_IDS.has(raw.mood) ? raw.mood : null,
    weather: WEATHER_IDS.has(raw.weather) ? raw.weather : null,
    // A notebook is a name. Entries with no notebook, and older entries, read back as null.
    notebook: normalizeNotebook(raw.notebook),
    pinned: raw.pinned === true,
    favorite: raw.favorite === true,
    body: typeof raw.body === 'string' ? raw.body : '',
    pageColor: HEX.test(raw.pageColor ?? '') ? raw.pageColor.toLowerCase() : DEFAULT_PAGE_COLOR,
    ink: {
      ops: normalizeOps(raw.ink?.ops),
      h: Number.isFinite(raw.ink?.h) ? raw.ink.h : 0,
      layers: normalizeLayers(raw.ink?.layers),
    },
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
    version: SCHEMA_VERSION,
  };
}

export function createEntry(fields = {}) {
  return normalizeEntry({ date: localISODate(), ...fields });
}

/** "travel, winter ,travel" -> ["travel", "winter"] */
export function parseTags(input) {
  const seen = new Set();
  for (const part of String(input ?? '').split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export function labelFor(list, id) {
  return list.find((item) => item.id === id)?.label ?? '';
}

export function firstHeading(body) {
  const match = /^#{1,3}\s+(.+)$/m.exec(body ?? '');
  return match ? match[1].trim() : '';
}

export function displayTitle(entry) {
  return (entry.title ?? '').trim() || firstHeading(entry.body) || 'Untitled';
}

/** An entry nobody has written in or drawn on. Blank entries are cleaned up when you leave them. */
export function isBlankEntry(entry) {
  return !(entry.title ?? '').trim() && !(entry.body ?? '').trim() && !visibleOps(entry.ink?.ops ?? []).length;
}

export function slugify(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'entry';
}

/** File name stem used for exports: 2026-11-09-monday-november-9 */
export function fileStem(entry) {
  return `${entry.date}-${slugify(displayTitle(entry))}`;
}

/** Newest day first, then most recently edited. */
export function compareEntries(a, b) {
  return b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt);
}

function dateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatLongDate(iso) {
  return dateFromISO(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(iso) {
  return dateFromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
