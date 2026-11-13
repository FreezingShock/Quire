/**
 * Native desktop integration: the parts of Quire that the Tauri shell adds
 * around the web app. The shell is the Rust side in src-tauri/. This file is
 * the web side. It only talks to the shell through the commands and the
 * `quire:intent` window event listed below, and every function here does
 * nothing in the browser build.
 *
 * Shell contract:
 * - `window.__QUIRE_DESKTOP__` is set before any page script runs: { shell, version, platform }.
 * - Commands (invoked through `__TAURI_INTERNALS__.invoke`):
 *   desktop_take_intents() -> [intent] queued while Quire was not ready (a tray click, a
 *     shortcut, a file opened from the file manager, a second launch).
 *   desktop_notify({ title, body, tag })
 *   desktop_set_autostart({ enabled })
 *   desktop_set_tray({ enabled })
 *   desktop_read_file({ path }) -> text of a file the user opened, read by the shell.
 * - Window event `quire:intent`, with `detail` an intent object, for intents while Quire runs.
 *
 * An intent is { name: 'new-entry' } | { name: 'quick-note' } | { name: 'open-file', path }.
 * The app only handles intents after the passcode is typed (see controller/desktop.js),
 * so the tray and the shortcut never write an entry past the lock.
 */

/** Prefs this module reads or writes. Each one has a default in prefs.js. */
export const DESKTOP_DEFAULTS = Object.freeze({
  // Start Quire when the user signs in to the computer.
  launchAtLogin: false,
  // Keep Quire in the tray (menu bar on macOS) when its window closes. Off means closing quits.
  trayIcon: false,
  // Send reminders as native notifications instead of browser notifications.
  desktopNotify: true,
  // The day (YYYY-MM-DD) the update check last ran, and the version the user chose to skip.
  updateCheckDay: null,
  dismissedUpdate: null,
});

/** The quick-capture shortcut as the platform shows it. The shell registers the same key. */
export function quickCaptureLabel(platform = '') {
  return /mac|darwin/i.test(platform) ? 'Cmd+Option+Q' : 'Ctrl+Alt+Q';
}
export const DOWNLOAD_URL = 'https://github.com/FreezingShock/Quire/releases/latest';
export const RELEASES_API = 'https://api.github.com/repos/FreezingShock/Quire/releases/latest';

const INTENT_NAMES = new Set(['new-entry', 'quick-note', 'open-file']);
const VERSION = /^\d+(\.\d+){0,3}$/;

/** The shell's details, or null in the browser. `scope` is injectable for tests. */
export function desktopShell(scope = globalThis) {
  const shell = scope?.__QUIRE_DESKTOP__;
  if (!shell || typeof shell !== 'object') return null;
  return Object.freeze({
    shell: String(shell.shell ?? 'tauri'),
    version: String(shell.version ?? '0.0.0'),
    platform: String(shell.platform ?? ''),
  });
}

export function isDesktop(scope = globalThis) {
  return desktopShell(scope) !== null;
}

/** Calls a shell command. Resolves to undefined in the browser, and when the shell refuses. */
export async function invokeShell(command, args = {}, scope = globalThis) {
  const invoke = scope?.__TAURI_INTERNALS__?.invoke;
  if (!isDesktop(scope) || typeof invoke !== 'function') return undefined;
  try {
    return await invoke(command, args);
  } catch (error) {
    console.warn(`Desktop command ${command} failed:`, error);
    return undefined;
  }
}

/** Checks a raw intent from the shell. Anything unknown or incomplete becomes null and is ignored. */
export function normalizeIntent(raw) {
  if (!raw || typeof raw !== 'object' || !INTENT_NAMES.has(raw.name)) return null;
  if (raw.name === 'open-file') {
    return typeof raw.path === 'string' && raw.path.trim() ? { name: 'open-file', path: raw.path } : null;
  }
  return { name: raw.name };
}

/**
 * What to do with a file the user opened. A Quire backup restores; a Day One
 * export or Markdown files import. Anything else is refused, so the shell
 * never sends Quire a file type it cannot read.
 */
export function openKind(name) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  if (/^quire-backup.*\.json$/i.test(base)) return 'restore';
  if (/\.(json|md|markdown|txt)$/i.test(base)) return 'import';
  return null;
}

/** The file's name without its folders, for both Windows and POSIX paths. */
export function baseName(path) {
  return String(path ?? '').split(/[\\/]/).pop() ?? '';
}

/** True when `latest` is a higher version than `current`. Both are dotted numbers, with an optional leading v. */
export function isNewerVersion(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function versionParts(value) {
  const text = String(value ?? '').trim().replace(/^v/i, '');
  if (!VERSION.test(text)) return null;
  return text.split('.').map((part) => Number(part));
}

/**
 * The update notice for a GitHub release, or null when there is nothing newer
 * or the release does not look right. Quire is not signed, so the notice links
 * to the download page instead of installing anything.
 */
export function updateNotice(release, current) {
  const version = String(release?.tag_name ?? '').trim().replace(/^v/i, '');
  if (!VERSION.test(version) || !isNewerVersion(version, current)) return null;
  return { version, url: DOWNLOAD_URL };
}

/** The update check runs at most once a day, and never on the browser build. */
export function shouldCheckUpdate(lastDay, today) {
  return Boolean(today) && lastDay !== today;
}

/** Shows reminders as native notifications only when the shell is there and the pref is on. */
export function wantsNativeNotice(prefs, scope = globalThis) {
  return isDesktop(scope) && prefs?.desktopNotify !== false;
}
