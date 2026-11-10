/**
 * Custom screensavers: the settings a person makes for their own screensaver,
 * and the pick of entries it shows. Pure functions only, so the editor, the
 * scenes, and the tests all read the same rules.
 *
 * A custom screensaver shows drawings, photos, and writing from the entries
 * that match its notebooks and tags, with an optional 3D text message that
 * scrolls across the screen. Up to CUSTOM_LIMIT of them can be saved.
 */

import { isBlankEntry } from './model.js';
import { plainText } from './markdown.js';

export const CUSTOM_LIMIT = 6;
export const NAME_MAX = 40;
export const MESSAGE_MAX = 80;
const POOL_MAX = 40; // most items a custom screensaver draws from
const PHOTO_MAX = 12; // photos are decoded in advance, so only a few
const ID_RE = /^c[a-z0-9]{4,24}$/;
const HEX = /^#[0-9a-f]{6}$/i;

export const SPEEDS = Object.freeze([
  { id: 'slow', label: 'Slow', pace: 0.5 },
  { id: 'medium', label: 'Medium', pace: 1 },
  { id: 'fast', label: 'Fast', pace: 2 },
]);

export const TRANSITIONS = Object.freeze([
  { id: 'fade', label: 'Fade in' },
  { id: 'slide', label: 'Slide in' },
  { id: 'zoom', label: 'Zoom in' },
]);

export const BACKGROUNDS = Object.freeze([
  { id: 'vista', label: 'Vista blue' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'black', label: 'Black' },
  { id: 'solid', label: 'Solid color' },
]);

const SPEED_IDS = new Set(SPEEDS.map((item) => item.id));
const TRANSITION_IDS = new Set(TRANSITIONS.map((item) => item.id));
const BACKGROUND_IDS = new Set(BACKGROUNDS.map((item) => item.id));

export const DEFAULT_CUSTOM = Object.freeze({
  name: 'My screensaver',
  items: Object.freeze({ drawings: true, photos: true, text: true }),
  notebooks: Object.freeze([]),
  tags: Object.freeze([]),
  message: '',
  speed: 'medium',
  transition: 'fade',
  background: 'vista',
  color: '#0b2a57',
});

/** A new id for a custom screensaver. Ids are short and safe to put in a radio value. */
export function newCustomId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The screensaver id a custom screensaver goes by in prefs: 'custom:<id>'. */
export function customKind(id) {
  return `custom:${id}`;
}

/** The custom id inside a screensaver kind, or null for a built-in kind. */
export function customIdOf(kind) {
  return typeof kind === 'string' && kind.startsWith('custom:') ? kind.slice(7) : null;
}

function strings(raw, limit, max) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  for (const value of raw) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
    if (text) seen.add(text);
    if (seen.size === limit) break;
  }
  return [...seen];
}

/** Fills in anything missing or out of range, so a saved or hand-edited screensaver always works. */
export function normalizeCustom(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : newCustomId();
  const items = r.items && typeof r.items === 'object' ? r.items : {};
  return {
    id,
    name: String(r.name ?? '').trim().slice(0, NAME_MAX) || DEFAULT_CUSTOM.name,
    items: {
      drawings: items.drawings !== false,
      photos: items.photos !== false,
      text: items.text !== false,
    },
    notebooks: strings(r.notebooks, 12, 40),
    tags: strings(r.tags, 12, 32),
    message: String(r.message ?? '').replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX),
    speed: SPEED_IDS.has(r.speed) ? r.speed : DEFAULT_CUSTOM.speed,
    transition: TRANSITION_IDS.has(r.transition) ? r.transition : DEFAULT_CUSTOM.transition,
    background: BACKGROUND_IDS.has(r.background) ? r.background : DEFAULT_CUSTOM.background,
    color: HEX.test(r.color ?? '') ? r.color.toLowerCase() : DEFAULT_CUSTOM.color,
  };
}

/** The saved list, cleaned: invalid entries dropped, ids made unique, and the limit applied. */
export function normalizeCustoms(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const config = normalizeCustom(item);
    if (seen.has(config.id)) continue;
    seen.add(config.id);
    out.push(config);
    if (out.length === CUSTOM_LIMIT) break;
  }
  return out;
}

export function speedFactor(config) {
  return SPEEDS.find((item) => item.id === config.speed)?.pace ?? 1;
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The items a custom screensaver draws from: one per drawing, photo, or piece
 * of writing on each entry that matches its notebooks and tags. Sample and
 * blank entries never show. Newest entries are kept when there are too many.
 * Photos need `entries` that carry their pictures (see store.listFull).
 */
export function pickCustom(entries, config, rng = Math.random) {
  const notebooks = new Set(config.notebooks);
  const tags = new Set(config.tags.map((tag) => tag.toLowerCase()));
  // A photo alone counts as content, which isBlankEntry does not know about.
  const usable = entries
    .filter((entry) => !entry.sample && (!isBlankEntry(entry) || Object.keys(entry.images ?? {}).length > 0))
    .filter((entry) => !notebooks.size || notebooks.has(entry.notebook))
    .filter((entry) => !tags.size || entry.tags.some((tag) => tags.has(tag.toLowerCase())))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // One card per entry: its photo if photos are on, else its drawing, else its writing.
  const pool = [];
  let photoCount = 0;
  for (const entry of usable) {
    const src = Object.values(entry.images ?? {})[0];
    const hasDrawing = entry.ink?.ops?.length > 0;
    const hasWriting = Boolean(plainText(entry.body)) || (!hasDrawing && !src && Boolean(entry.title?.trim()));
    if (config.items.photos && src && photoCount < PHOTO_MAX) {
      pool.push({ kind: 'photo', entry, src, yearsAgo: 0, otd: false });
      photoCount += 1;
    } else if (config.items.drawings && hasDrawing) {
      pool.push({ kind: 'drawing', entry, yearsAgo: 0, otd: false });
    } else if (config.items.text && hasWriting) {
      pool.push({ kind: 'text', entry, yearsAgo: 0, otd: false });
    }
    if (pool.length === POOL_MAX) break;
  }
  return shuffle(pool, rng);
}
