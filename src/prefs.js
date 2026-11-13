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
  // Screensaver (see screensaver.js): the scene, or 'off', and the idle minutes before it starts.
  screensaver: 'off',
  screensaverMinutes: 5,
  // Library sidebar: which collapsible sections are open (see nav-sections.js).
  navSections: { library: true, notebooks: true, saved: true, tags: false, mood: false, weather: false },
  // Custom screensavers made in the editor (see screensaver-custom.js), up to six.
  screensavers: [],
  // Personal (see personal.js): the name in the greeting, the welcome-back card and the day it was hidden, and your own prompts.
  name: '',
  showWelcome: true,
  welcomeSeenDay: null,
  customPrompts: [],
  // Desktop app only (see desktop-integration.js): launch at sign-in, keep in the tray, native reminders, and the daily update check.
  launchAtLogin: false,
  trayIcon: false,
  desktopNotify: true,
  updateCheckDay: null,
  dismissedUpdate: null,
});

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Removes keys from the saved prefs. Used for settings that moved into the
 * sealed store, so they no longer sit in plain browser storage.
 */
export function forgetPrefs(keys) {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
    for (const key of keys) delete raw[key];
    globalThis.localStorage?.setItem(KEY, JSON.stringify(raw));
  } catch {
    // Storage is blocked. The old copy stays until a later start can remove it.
  }
  return loadPrefs();
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
