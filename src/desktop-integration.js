/**
 * Native desktop integration: the parts of Quire that the Tauri shell adds
 * around the web app. The shell is the Rust side in src-tauri/. This file is
 * the web side. It only talks to the shell through the commands and the
 * `quire:intent` window event listed below, and every function here does
 * nothing in the browser build.
 *
 * Detection and invoke come from src/desktop.js (see docs/desktop.md). The native
 * features are one Rust plugin each in src-tauri/src/, and their commands are:
 *   plugin:quire-intents|take -> [intent] queued while the page was locked or loading
 *   plugin:quire-notify|send({ title, body, tag })
 *   plugin:quire-autostart|set_enabled({ enabled })
 *   plugin:quire-tray|set_enabled({ enabled })
 *   plugin:quire-files|read_text({ path }) -> text of a file the user opened
 * Live intents arrive as the window event `quire:intent`, with `detail` the intent.
 *
 * An intent is { name: 'new-entry' } | { name: 'quick-note' } | { name: 'open-file', path }.
 * The app only handles intents after the passcode is typed (see controller/desktop.js),
 * so the tray and the shortcut never write an entry past the lock.
 */

import { desktopInvoke, isDesktop } from './desktop.js';

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

/** Calls a native command of the shell. Resolves to undefined outside the shell, and when the shell refuses. */
export async function invokeShell(command, args = {}, scope = globalThis) {
  if (!isDesktop(scope)) return undefined;
  try {
    return await desktopInvoke(command, args, scope);
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
