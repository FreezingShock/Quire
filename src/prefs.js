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
  // The Vista-style sidebar of gadgets beside the dashboard, and the gadgets it shows, in order.
  showGadgets: true,
  gadgets: ['clock', 'streak', 'mood', 'word', 'note', 'slides'],
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
  // Focus mode: keep the line being typed at the middle of the window.
  typewriter: false,
  // Focus mode: words to write this session. 0 means no goal.
  wordGoal: 0,
  // Focus mode: the ambient sound (see focus.js) and its volume from 0 to 1.
  ambient: 'off',
  ambientVolume: 0.5,
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
