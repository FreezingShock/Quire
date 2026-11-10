/**
 * Where a picture sits on the page, after the way Google Docs places images:
 * in line with the text, wrapped with the text (square or tight, on the left or
 * the right), in front of the text, or behind it. The two front and behind modes
 * can be dragged anywhere, and every mode can be resized by its corner.
 *
 * A layout lives on the entry as `imageLayout[id]`. A picture with no layout is
 * in line at its natural size. Positions are stored as fractions of the text
 * column's width (so they hold on a phone and on a desktop) and as pixels down
 * from the line that holds the picture. Plain data and string helpers only: no
 * DOM, so the node tests can use them.
 */

export const MEDIA_MODES = Object.freeze([
  { id: 'inline', label: 'In line', hint: 'In line with the text, at its own line' },
  { id: 'square', label: 'Square', hint: 'Text wraps around a square box' },
  { id: 'tight', label: 'Tight', hint: 'Text wraps close to the picture outline' },
  { id: 'front', label: 'In front', hint: 'Drawn over the text, drag to move' },
  { id: 'behind', label: 'Behind', hint: 'Drawn under the text, drag to move' },
]);

export const MEDIA_SIDES = Object.freeze(['left', 'right']);

/** Width of a picture that is moved out of line, as a fraction of the text column. */
export const FLOAT_WIDTH = 0.45;
export const MIN_WIDTH = 0.08;
export const MAX_WIDTH = 1.4;
const MAX_SHIFT_X = 1;
const MAX_SHIFT_Y = 4000;

const MODE_IDS = new Set(MEDIA_MODES.map((mode) => mode.id));

export const DEFAULT_MEDIA_LAYOUT = Object.freeze({ mode: 'inline', side: 'left', w: 1, dx: 0, dy: 0 });

function clampTo(value, low, high, fallback) {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

/** One layout record, with every field in range. Unknown modes fall back to in line. */
export function normalizeMediaLayoutEntry(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: MODE_IDS.has(item.mode) ? item.mode : DEFAULT_MEDIA_LAYOUT.mode,
    side: item.side === 'right' ? 'right' : 'left',
    w: clampTo(item.w, MIN_WIDTH, MAX_WIDTH, DEFAULT_MEDIA_LAYOUT.w),
    dx: clampTo(item.dx, -MAX_SHIFT_X, MAX_SHIFT_X, 0),
    dy: clampTo(item.dy, -MAX_SHIFT_Y, MAX_SHIFT_Y, 0),
  };
}

/** Every picture layout on an entry, keyed by id. Anything that is not an object is dropped. */
export function normalizeMediaLayout(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, item] of Object.entries(raw)) {
    if (item && typeof item === 'object') out[id] = normalizeMediaLayoutEntry(item);
  }
  return out;
}

/** The layout a picture is drawn with: its saved one, or the in-line default. */
export function mediaLayoutOf(layouts, id) {
  return layouts && Object.hasOwn(layouts, id) ? layouts[id] : DEFAULT_MEDIA_LAYOUT;
}

export const isWrap = (mode) => mode === 'square' || mode === 'tight';
export const isPositioned = (mode) => mode === 'front' || mode === 'behind';

/** A layout after the user picks a new mode. Floating modes get a sensible width; in line keeps its size. */
export function layoutForMode(current, mode) {
  const next = { ...current, mode };
  if (mode !== 'inline' && current.w === DEFAULT_MEDIA_LAYOUT.w) next.w = FLOAT_WIDTH;
  if (mode === 'inline') {
    next.dx = 0;
    next.dy = 0;
  }
  return normalizeMediaLayoutEntry(next);
}

/** CSS classes for a picture's wrapper. Styles for each one are in styles/live.css. */
export function mediaClasses(layout) {
  const classes = ['lv-media', `is-${layout.mode}`];
  if (layout.mode !== 'inline' || layout.w !== DEFAULT_MEDIA_LAYOUT.w) classes.push('is-sized');
  if (isWrap(layout.mode)) classes.push(`is-wrap-${layout.side}`);
  if (isPositioned(layout.mode)) classes.push('is-positioned');
  return classes;
}

/** Inline CSS custom properties for a picture's wrapper. Numbers are written in plain decimal form. */
export function mediaStyle(layout) {
  return `--w:${layout.w};--dx:${layout.dx};--dy:${layout.dy}px`;
}
