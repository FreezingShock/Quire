/**
 * Per-browser UI preferences (font, theme, last open entry). These are
 * conveniences only, so every access is wrapped in try/catch.
 */

const KEY = 'quire:prefs';
const DEFAULTS = Object.freeze({ font: 'serif', dark: false, source: false, lastEntryId: null });

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is blocked (private mode, quota). The app keeps working without saved prefs.
  }
  return next;
}
