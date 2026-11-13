import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_DEFAULTS,
  DOWNLOAD_URL,
  baseName,
  invokeShell,
  isNewerVersion,
  normalizeIntent,
  openKind,
  quickCaptureLabel,
  shouldCheckUpdate,
  updateNotice,
  wantsNativeNotice,
} from '../src/desktop-integration.js';
import { desktopShell, isDesktop } from '../src/desktop.js';
import { loadPrefs } from '../src/prefs.js';
import { OPTION_PREFS } from '../src/options.js';

const shellScope = { __QUIRE_DESKTOP__: { shell: 'tauri', version: '0.4.0', platform: 'windows' } };

test('shell commands do nothing in the browser', async () => {
  let called = false;
  const scope = { __TAURI_INTERNALS__: { invoke: async () => { called = true; return 'x'; } } };
  assert.equal(await invokeShell('plugin:quire-intents|take', {}, scope), undefined);
  assert.equal(called, false);
});

test('shell commands go through the internals and survive a refusal', async () => {
  const calls = [];
  const scope = {
    ...shellScope,
    __TAURI_INTERNALS__: { invoke: async (command, args) => { calls.push([command, args]); return ['ok']; } },
  };
  assert.deepEqual(await invokeShell('plugin:quire-intents|take', {}, scope), ['ok']);
  assert.deepEqual(calls, [['plugin:quire-intents|take', {}]]);

  const failing = { ...shellScope, __TAURI_INTERNALS__: { invoke: async () => { throw new Error('denied'); } } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await invokeShell('plugin:quire-notify|send', { title: 'Quire' }, failing), undefined);
  } finally {
    console.warn = warn;
  }
});

test('only the three known intents get through, and a path must be present', () => {
  assert.deepEqual(normalizeIntent({ name: 'new-entry' }), { name: 'new-entry' });
  assert.deepEqual(normalizeIntent({ name: 'quick-note', extra: 1 }), { name: 'quick-note' });
  assert.deepEqual(normalizeIntent({ name: 'open-file', path: 'C:\\Users\\nate\\quire-backup-2026-11-13.json' }), {
    name: 'open-file',
    path: 'C:\\Users\\nate\\quire-backup-2026-11-13.json',
  });
  assert.equal(normalizeIntent({ name: 'open-file', path: '   ' }), null);
  assert.equal(normalizeIntent({ name: 'open-file' }), null);
  assert.equal(normalizeIntent({ name: 'quit' }), null);
  assert.equal(normalizeIntent('new-entry'), null);
  assert.equal(normalizeIntent(null), null);
});

test('a backup restores and a journal file imports; other files are refused', () => {
  assert.equal(openKind('quire-backup-2026-11-13.json'), 'restore');
  assert.equal(openKind('Quire-Backup-old.JSON'), 'restore');
  assert.equal(openKind('Journal.json'), 'import');
  assert.equal(openKind('2026-11-12.md'), 'import');
  assert.equal(openKind('notes.txt'), 'import');
  assert.equal(openKind('setup.exe'), null);
  assert.equal(openKind('quire-backup-2026.zip'), null);
  assert.equal(openKind(undefined), null);
});

test('file names come out of Windows and POSIX paths alike', () => {
  assert.equal(baseName('C:\\Users\\nate\\Documents\\day.md'), 'day.md');
  assert.equal(baseName('/home/nate/day.md'), 'day.md');
  assert.equal(baseName('day.md'), 'day.md');
  assert.equal(baseName(''), '');
});

test('versions compare by their numbers, not as text', () => {
  assert.equal(isNewerVersion('0.10.0', '0.9.9'), true);
  assert.equal(isNewerVersion('v1.0', '0.9.9'), true);
  assert.equal(isNewerVersion('0.4.0', '0.4.0'), false);
  assert.equal(isNewerVersion('0.3.9', '0.4.0'), false);
  assert.equal(isNewerVersion('0.4.1', '0.4'), true);
  assert.equal(isNewerVersion('latest', '0.4.0'), false);
  assert.equal(isNewerVersion('0.5.0', 'unknown'), false);
});

test('an update notice needs a newer, well-formed release', () => {
  assert.deepEqual(updateNotice({ tag_name: 'v0.5.0' }, '0.4.0'), { version: '0.5.0', url: DOWNLOAD_URL });
  assert.equal(updateNotice({ tag_name: '0.4.0' }, '0.4.0'), null);
  assert.equal(updateNotice({ tag_name: 'v0.5.0-beta' }, '0.4.0'), null);
  assert.equal(updateNotice({}, '0.4.0'), null);
  assert.equal(updateNotice(null, '0.4.0'), null);
});

test('the update check runs once a day', () => {
  assert.equal(shouldCheckUpdate(null, '2026-11-13'), true);
  assert.equal(shouldCheckUpdate('2026-11-12', '2026-11-13'), true);
  assert.equal(shouldCheckUpdate('2026-11-13', '2026-11-13'), false);
  assert.equal(shouldCheckUpdate(null, ''), false);
});

test('reminders go to the shell only in the desktop app with the pref on', () => {
  assert.equal(wantsNativeNotice({ desktopNotify: true }, shellScope), true);
  assert.equal(wantsNativeNotice({ desktopNotify: false }, shellScope), false);
  assert.equal(wantsNativeNotice({ desktopNotify: true }, {}), false);
  assert.equal(wantsNativeNotice({}, shellScope), true);
});

test('the quick-capture label follows the platform', () => {
  assert.equal(quickCaptureLabel('windows'), 'Ctrl+Alt+Q');
  assert.equal(quickCaptureLabel('macos'), 'Cmd+Option+Q');
  assert.equal(quickCaptureLabel(''), 'Ctrl+Alt+Q');
});

test('closing quits unless the user keeps the tray; tray is off by default', () => {
  assert.equal(DESKTOP_DEFAULTS.trayIcon, false);
});

test('every desktop pref has a saved default that matches the module', () => {
  const defaults = loadPrefs();
  for (const [key, value] of Object.entries(DESKTOP_DEFAULTS)) {
    assert.ok(key in defaults, `missing default for ${key}`);
    assert.equal(defaults[key], value, `prefs.js and desktop-integration.js disagree on ${key}`);
  }
  for (const key of ['launchAtLogin', 'trayIcon', 'desktopNotify']) {
    assert.ok(OPTION_PREFS.includes(key), `${key} should be on the Options dialog`);
  }
});
