/**
 * Skins and accent colors for the window chrome. Pure, with no DOM, so the
 * rules are unit tested. The look for each skin lives in styles/skins.css
 * (and the Aero tokens in styles/app.css).
 */

export const SKINS = Object.freeze([
  { id: 'aero', label: 'Aero' },
  { id: 'aero-dark', label: 'Aero dark' },
  { id: 'basic', label: 'Aero Basic' },
  { id: 'luna', label: 'XP Luna' },
  { id: 'classic', label: 'Classic 98' },
]);

const SKIN_IDS = new Set(SKINS.map((skin) => skin.id));

/**
 * The skin to draw. Prefs saved before skins existed used `dark` for the dark
 * chrome, so that still maps to Aero dark when no skin has been picked.
 */
export function skinOf(prefs = {}) {
  if (SKIN_IDS.has(prefs.skin)) return prefs.skin;
  return prefs.dark ? 'aero-dark' : 'aero';
}

export function skinLabel(id) {
  return SKINS.find((skin) => skin.id === id)?.label ?? SKINS[0].label;
}

/** `#rgb` or `#rrggbb` (with or without the #) as lowercase `#rrggbb`, or null. */
export function normalizeAccent(value) {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  return `#${digits.toLowerCase()}`;
}

function channels(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Straight RGB blend. `t` is 0 for `a` and 1 for `b`. */
export function mixHex(a, b, t) {
  const from = channels(a);
  const to = channels(b);
  return toHex(from.map((v, i) => v + (to[i] - v) * t));
}

/** Rough perceived brightness from 0 (black) to 1 (white). */
export function brightnessOf(hex) {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Colors derived from one accent: the selection and button color, the title
 * bar glass, and the hover and press tints. Returns custom property names
 * (without the leading --) mapped to hex, or null when the accent is not a color.
 */
export function accentTokens(accent) {
  const base = normalizeAccent(accent);
  if (!base) return null;
  const white = '#ffffff';
  const black = '#000000';
  return {
    accent: base,
    'accent-hi': mixHex(base, white, 0.35),
    'accent-lo': mixHex(base, black, 0.15),
    'accent-ink': brightnessOf(base) > 0.6 ? '#1c2a3b' : white,
    'glass-hi': mixHex(base, white, 0.6),
    'glass-mid': base,
    'glass-lo': mixHex(base, black, 0.22),
    'hover-edge': mixHex(base, black, 0.1),
    'glow-hi': mixHex(base, white, 0.8),
    'glow-lo': mixHex(base, white, 0.6),
    'press-hi': mixHex(base, white, 0.5),
    'press-lo': mixHex(base, black, 0.1),
  };
}

/** Every custom property an accent can set, so the page can clear them again. */
export const ACCENT_PROPERTIES = Object.freeze(Object.keys(accentTokens('#2f6fbf')));
