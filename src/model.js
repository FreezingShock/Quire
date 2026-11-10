/**
 * Entry model. Plain data only: no DOM, no storage. Storage adapters and the UI
 * both build on these helpers, so keep this file free of side effects.
 */

import { normalizeLayers, normalizeOps, visibleOps } from './drawing.js';
import { normalizeMixtape } from './mixtape.js';

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
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const DATA_AUDIO = /^data:audio\/[a-z0-9.+-]+;base64,/i;
const MAX_SKETCH_H = 4000;

/** Pictures on an entry, keyed by id. Only data URLs for images are kept. */
function normalizeImages(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, src] of Object.entries(raw)) {
    if (typeof src === 'string' && DATA_IMAGE.test(src)) out[id] = src;
  }
  return out;
}

/** Voice notes on an entry, keyed by id. Only audio data URLs are kept. */
function normalizeAudio(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, src] of Object.entries(raw)) {
    if (typeof src === 'string' && DATA_AUDIO.test(src)) out[id] = src;
  }
  return out;
}

/** How long each voice note runs, in seconds, keyed by id. Kept so a printed page can show it. */
function normalizeAudioSeconds(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, seconds] of Object.entries(raw)) {
    if (Number.isFinite(seconds) && seconds >= 0) out[id] = Math.round(seconds);
  }
  return out;
}

/** Inline sketches on an entry, keyed by id. Each has a height and the ops drawn on it. */
function normalizeSketches(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, sketch] of Object.entries(raw)) {
    if (!sketch || typeof sketch !== 'object') continue;
    const h = Number.isFinite(sketch.h) ? Math.min(MAX_SKETCH_H, Math.max(60, sketch.h)) : 320;
    out[id] = { h, ops: normalizeOps(sketch.ops) };
  }
  return out;
}

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

export const PLACE_MAX = 60;

/** "  Lisbon  " -> "Lisbon". Blank or non-string places become null (no place). Typed by hand, never from GPS. */
export function normalizePlace(value) {
  if (typeof value !== 'string') return null;
  const place = value.trim().replace(/\s+/g, ' ').slice(0, PLACE_MAX).trim();
  return place || null;
}

/** How far ahead a time capsule can be sealed. */
export const CAPSULE_MAX_YEARS = 50;

/**
 * A time capsule: the day the entry opens, when it was sealed, and when it was
 * first opened. `notified` is set once the arrival notice has gone out. Null
 * for an ordinary entry, and for a record whose open day is missing or broken.
 */
export function normalizeCapsule(raw) {
  if (!raw || typeof raw !== 'object' || !isISODate(raw.openOn)) return null;
  return {
    openOn: raw.openOn,
    sealedAt: typeof raw.sealedAt === 'string' ? raw.sealedAt : new Date().toISOString(),
    unsealedAt: typeof raw.unsealedAt === 'string' ? raw.unsealedAt : null,
    notified: raw.notified === true,
  };
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
    // Where the entry was written, as a name you type. Older entries have none, so they read back as null.
    place: normalizePlace(raw.place),
    pinned: raw.pinned === true,
    favorite: raw.favorite === true,
    // The first-run sample entry is marked so streaks can skip it. Entries written by hand never set this.
    sample: raw.sample === true,
    // A time capsule stays closed until its day. See capsule.js for the rules.
    capsule: normalizeCapsule(raw.capsule),
    body: typeof raw.body === 'string' ? raw.body : '',
    // Pictures and sketches are referenced from the body by id. Older entries have neither, so both default to empty.
    images: normalizeImages(raw.images),
    // Voice notes are referenced from the body by id, the same way pictures are.
    audio: normalizeAudio(raw.audio),
    audioSeconds: normalizeAudioSeconds(raw.audioSeconds),
    sketches: normalizeSketches(raw.sketches),
    // Song links for the entry's mixtape. Older entries have none, so they read back as an empty list.
    mixtape: normalizeMixtape(raw.mixtape),
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
