/**
 * Per-browser UI preferences (font, theme, last open entry). These are
 * conveniences only, so every access is wrapped in try/catch.
 */

const KEY = 'quire:prefs';
const DEFAULTS = Object.freeze({
  font: 'serif',
  dark: false,
  source: false,
  lastEntryId: null,
  showGrid: false,
  snapGrid: false,
  snapAngles: false,
  ribbonHidden: false,
  wallpaper: true,
  splash: true,
  sound: false,
  showPrompts: true,
  showOnThisDay: true,
  // Getting-started tips on the dashboard. "Got it" sets this. Options (Home tab) brings them back.
  tipsDismissed: false,
  // The first-run sample entry is written once. Deleting it does not bring it back.
  sampleSeeded: false,
  // Skin id (see skins.js); null means the old `dark` flag decides.
  skin: null,
  // Custom accent as #rrggbb, or null for the skin's own blue, red, or navy.
  accent: null,
  // Window animations. Only `false` turns them off.
  motion: true,
  // Daily reminder: { enabled, time as HH:MM, lastDay as YYYY-MM-DD when it last went out }.
  reminder: { enabled: false, time: '20:00', lastDay: null },
});

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
