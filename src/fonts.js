/**
 * Fonts on this computer. A writing font or a text box can be any font
 * installed here, not only the three built in. A chosen font is stored by
 * name (`family:Bahnschrift`), so a drawing made on one computer still opens
 * on another. A name the device lacks falls back to a generic family of the
 * same kind (serif, sans or mono), so the text stays readable.
 *
 * This module has no imports, so drawing.js and the controller can both use it.
 * The browser calls (queryLocalFonts, canvas measuring) run only when asked.
 */

/** The three built-in stacks. Keys are stored in prefs and in drawing ops. */
export const TEXT_FONTS = Object.freeze({
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
});

export const BUILT_IN_FONTS = Object.freeze(['serif', 'sans', 'mono']);
export const SYSTEM_PREFIX = 'family:';
/** Recent choices kept for the picker. */
export const MAX_RECENTS = 6;
const MAX_NAME = 80;

/**
 * Common fonts from Windows, macOS and Linux. Used when the browser cannot
 * list the computer's fonts: each one is measured to see whether it is there.
 */
export const CURATED_FONTS = Object.freeze([
  'Arial', 'Arial Black', 'Avenir', 'Aptos', 'American Typewriter', 'Baskerville', 'Bahnschrift',
  'Book Antiqua', 'Bookman Old Style', 'Brush Script MT', 'Calibri', 'Cambria', 'Candara',
  'Cascadia Code', 'Century Gothic', 'Chalkboard SE', 'Comic Sans MS', 'Consolas', 'Constantia',
  'Corbel', 'Courier New', 'DejaVu Sans', 'DejaVu Serif', 'Didot', 'Franklin Gothic Medium',
  'Futura', 'Garamond', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text',
  'Impact', 'Iowan Old Style', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
  'Lucida Console', 'Lucida Grande', 'Lucida Sans Unicode', 'Marker Felt', 'Menlo', 'Monaco',
  'Noto Sans', 'Noto Serif', 'Optima', 'Palatino Linotype', 'Rockwell', 'Segoe Print',
  'Segoe Script', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Ubuntu', 'Verdana',
]);

const MONO_NAME = /mono|code|console|courier|consol|menlo|monaco|typewriter|fixed|cascadia|terminal/i;
const SERIF_NAME = /serif|roman|garamond|georgia|times|palatino|antiqua|bookman|cambria|didot|baskerville|constantia|iowan|caslon|bodoni|hoefler|minion|cochin|charter|rockwell|century(?! gothic)|goudy|sabon|merriweather|libre/i;

/** Strips characters that could break out of a CSS value or a <style> block, and caps the length. */
export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f"'\\<>;{}]/g, '').trim().slice(0, MAX_NAME);
}

const BUILT_IN_LABELS = Object.freeze({ serif: 'Serif', sans: 'Sans', mono: 'Monospace' });

/** What a stored id is called in menus: 'Serif', or the plain family name. */
export function fontLabel(id) {
  return BUILT_IN_LABELS[id] ?? (isSystemFont(id) ? familyName(id) : BUILT_IN_LABELS.serif);
}

export function isBuiltIn(id) {
  return BUILT_IN_FONTS.includes(id);
}

export function isSystemFont(id) {
  return typeof id === 'string' && id.startsWith(SYSTEM_PREFIX) && cleanName(id.slice(SYSTEM_PREFIX.length)) !== '';
}

export function isKnownFont(id) {
  return isBuiltIn(id) || isSystemFont(id);
}

/** The stored id for a font installed here, such as `family:Bahnschrift`. */
export function systemFontId(name) {
  return `${SYSTEM_PREFIX}${cleanName(name)}`;
}

/** The plain font name in a stored id, or '' for a built-in or unknown id. */
export function familyName(id) {
  return isSystemFont(id) ? cleanName(id.slice(SYSTEM_PREFIX.length)) : '';
}

/** Any stored id that is not a known font falls back to the serif stack, as before. */
export function normalizeFontId(id) {
  return isKnownFont(id) ? id : 'serif';
}

/** The generic family a font falls back to, guessed from its name. */
export function genericOf(name) {
  if (MONO_NAME.test(name)) return 'mono';
  if (SERIF_NAME.test(name)) return 'serif';
  return 'sans';
}

/** The CSS font-family value for a stored id. Unknown ids get the serif stack. */
export function fontStackFor(id) {
  if (isSystemFont(id)) {
    const name = familyName(id);
    return `"${name}", ${TEXT_FONTS[genericOf(name)]}`;
  }
  return TEXT_FONTS[id] ?? TEXT_FONTS.serif;
}

/** Recent system fonts, newest first, without duplicates, built-ins or junk. */
export function normalizeRecents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const id of list) {
    if (isSystemFont(id) && !out.includes(id)) out.push(systemFontId(familyName(id)));
    if (out.length >= MAX_RECENTS) break;
  }
  return out;
}

/** Puts a font at the front of the recents. Built-in fonts are already in the picker, so they are not stored. */
export function addRecent(list, id) {
  const current = normalizeRecents(list);
  if (!isSystemFont(id)) return current;
  const next = systemFontId(familyName(id));
  return normalizeRecents([next, ...current.filter((item) => item !== next)]);
}

/** Unique, cleaned family names in A-to-Z order. */
export function listFamilies(names) {
  const set = new Set();
  for (const name of names ?? []) {
    const clean = cleanName(name);
    if (clean) set.add(clean);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Names that match every word of the query. Names that start with the query
 * come first, then the rest in A-to-Z order.
 */
export function filterFamilies(names, query) {
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...names];
  const hits = names.filter((name) => {
    const lower = name.toLowerCase();
    return words.every((word) => lower.includes(word));
  });
  const first = words[0];
  return hits.sort((a, b) => {
    const rank = Number(b.toLowerCase().startsWith(first)) - Number(a.toLowerCase().startsWith(first));
    return rank || a.localeCompare(b);
  });
}

/** Family names from the Local Font Access API. It lists each font once per style, so names are merged here. */
export function familiesFromLocalFonts(fonts) {
  return listFamilies((fonts ?? []).map((font) => font?.family));
}

const DETECT_TEXT = 'mmmmmlliWWQ@#0123 Hamburgefonstiv';
const FALLBACKS = ['serif', 'sans-serif', 'monospace'];

/**
 * Which of `candidates` are installed. `measure(cssFont, text)` returns a
 * width. A font is there when it draws differently from at least one generic
 * fallback, because a missing font draws exactly like its fallback.
 */
export function detectInstalled(candidates, measure) {
  const found = [];
  for (const name of candidates) {
    const clean = cleanName(name);
    if (!clean) continue;
    const present = FALLBACKS.some((generic) => {
      const withFont = measure(`72px "${clean}", ${generic}`, DETECT_TEXT);
      const without = measure(`72px ${generic}`, DETECT_TEXT);
      return Math.abs(withFont - without) > 0.5;
    });
    if (present) found.push(clean);
  }
  return listFamilies(found);
}

/* ---------- browser calls, made only when the picker asks ---------- */

let externalLister = null;

/**
 * A desktop shell can register its own font list, such as a native command,
 * for WebViews that cannot list fonts. `lister` returns family names, or a
 * promise of them. Pass null to remove it.
 */
export function useFontLister(lister) {
  externalLister = typeof lister === 'function' ? lister : null;
}

/** 'granted', 'prompt', 'denied', or 'unsupported' for the Local Font Access API. */
export async function localFontAccess() {
  if (typeof globalThis.queryLocalFonts !== 'function' || !globalThis.isSecureContext) return 'unsupported';
  try {
    const status = await globalThis.navigator?.permissions?.query({ name: 'local-fonts' });
    return status?.state ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

/** Measures text with a canvas. Returns null when there is no canvas, as in a test run. */
function canvasMeasure() {
  const context = globalThis.document?.createElement?.('canvas')?.getContext?.('2d');
  if (!context) return null;
  return (font, text) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

/**
 * The fonts this computer has, as `{ source, families }`. `source` says where
 * the list came from, so the picker can explain it:
 * 'local' (the browser listed every font), 'app' (the desktop shell),
 * 'curated' (Quire checked its common list), or 'none'.
 */
export async function listSystemFonts({ allowPrompt = false } = {}) {
  let access = await localFontAccess();
  if (externalLister) {
    try {
      return { source: 'app', families: listFamilies(await externalLister()) };
    } catch {
      // Fall through to the browser's own way.
    }
  }
  if (access === 'granted' || (access === 'prompt' && allowPrompt)) {
    try {
      const fonts = await globalThis.queryLocalFonts();
      return { source: 'local', families: familiesFromLocalFonts(fonts), access: 'granted' };
    } catch {
      // The person said no, or the call failed. Read the state again so the picker shows the right prompt.
      access = await localFontAccess();
    }
  }
  const measure = canvasMeasure();
  const families = measure ? detectInstalled(CURATED_FONTS, measure) : [];
  return { source: measure ? 'curated' : 'none', families, access };
}
