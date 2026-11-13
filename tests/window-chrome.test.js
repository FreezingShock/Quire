import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitBounds,
  platformOf,
  readStoredWindow,
  windowApi,
  writeStoredWindow,
} from '../src/desktop-shell.js';

const AREA = { left: 0, top: 0, width: 1920, height: 1040 };

/** A fake Tauri core: records each command and answers the ones the window needs. */
function fakeShell(platform = 'windows') {
  const calls = [];
  const answers = { is_maximized: false, scale_factor: 1, inner_size: { width: 1100, height: 720 }, outer_position: { x: 60, y: 40 } };
  const internals = {
    metadata: { currentWindow: { label: 'main' } },
    invoke: async (command, args) => {
      calls.push([command, args]);
      return answers[command.replace('plugin:window|', '')];
    },
    transformCallback: () => 1,
  };
  return {
    calls,
    scope: { __QUIRE_DESKTOP__: Object.freeze({ shell: 'tauri', version: '0.1.0', platform }), __TAURI_INTERNALS__: internals },
  };
}

test('a plain browser tab has no desktop shell', () => {
  assert.equal(windowApi({}, ''), null);
  assert.equal(windowApi({}, '?shell=other'), null);
});

test('?shell=desktop gives a preview that keeps the maximized flag in memory', async () => {
  const events = [];
  const api = windowApi({ dispatchEvent: (event) => events.push(event.type) }, '?x=1&shell=desktop');
  assert.equal(api.backend, 'preview');
  assert.equal(await api.isMaximized(), false);
  await api.toggleMaximize();
  assert.equal(await api.isMaximized(), true);
  assert.deepEqual(events, ['resize'], 'a change tells the page the window was resized');
  assert.equal(api.setBounds, undefined, 'the preview cannot set bounds, so it never restores a saved size');
});

test('the shell flag alone is not enough: the window commands must be there too', () => {
  assert.equal(windowApi({ __QUIRE_DESKTOP__: { shell: 'tauri', version: '0', platform: 'windows' } }, ''), null);
});

test('in the shell, window buttons call the Tauri window commands for the main window', async () => {
  const { calls, scope } = fakeShell();
  const api = windowApi(scope, '');
  assert.equal(api.backend, 'tauri');
  await api.minimize();
  await api.toggleMaximize();
  await api.close();
  await api.startResizeDragging('SouthEast');
  assert.deepEqual(calls.slice(0, 4), [
    ['plugin:window|minimize', { label: 'main' }],
    ['plugin:window|toggle_maximize', { label: 'main' }],
    ['plugin:window|close', { label: 'main' }],
    ['plugin:window|start_resize_dragging', { label: 'main', value: 'SouthEast' }],
  ]);
});

test('saved bounds are written in logical pixels, and restored as logical pixels', async () => {
  const { calls, scope } = fakeShell();
  const api = windowApi(scope, '');
  assert.deepEqual(await api.getBounds(), { x: 60, y: 40, width: 1100, height: 720 });
  await api.setBounds({ x: 10, y: 20, width: 900, height: 600 });
  assert.deepEqual(calls.at(-2), ['plugin:window|set_size', { label: 'main', value: { Logical: { width: 900, height: 600 } } }]);
  assert.deepEqual(calls.at(-1), ['plugin:window|set_position', { label: 'main', value: { Logical: { x: 10, y: 20 } } }]);
});

test('platformOf reads the platform the shell reports, then the browser', () => {
  assert.equal(platformOf({ __QUIRE_DESKTOP__: { shell: 'tauri', version: '0', platform: 'macos' } }), 'mac');
  assert.equal(platformOf({ __QUIRE_DESKTOP__: { shell: 'tauri', version: '0', platform: 'windows' } }), 'windows');
  assert.equal(platformOf({ navigator: { userAgentData: { platform: 'Windows' } } }), 'windows');
  assert.equal(platformOf({ navigator: { platform: 'MacIntel' } }), 'mac');
  assert.equal(platformOf({ navigator: { userAgent: 'X11; Linux x86_64' } }), 'other');
});

test('saved bounds that fit the screen come back unchanged', () => {
  const saved = { x: 100, y: 80, width: 1280, height: 800, maximized: false };
  assert.deepEqual(fitBounds(saved, AREA), { x: 100, y: 80, width: 1280, height: 800, maximized: false });
});

test('a window saved larger than the screen is cut down to it', () => {
  const fit = fitBounds({ x: 0, y: 0, width: 4000, height: 3000 }, AREA);
  assert.equal(fit.width, 1920);
  assert.equal(fit.height, 1040);
});

test('a window saved on a monitor that is gone is pulled back onscreen', () => {
  const fit = fitBounds({ x: 5000, y: -900, width: 1000, height: 700 }, AREA);
  assert.ok(fit.x <= 1920 - 120, 'at least the grab margin stays onscreen on the right');
  assert.ok(fit.y >= 0, 'the title bar is never above the top of the screen');
});

test('a window pushed far to the left still keeps its right side grabbable', () => {
  const fit = fitBounds({ x: -5000, y: 100, width: 1000, height: 700 }, AREA);
  assert.equal(fit.x, -1000 + 120);
});

test('tiny saved sizes are raised to the minimum window size', () => {
  const fit = fitBounds({ x: 0, y: 0, width: 100, height: 100 }, AREA);
  assert.equal(fit.width, MIN_WIDTH);
  assert.equal(fit.height, MIN_HEIGHT);
});

test('broken or missing saved bounds give null, so the default size is used', () => {
  assert.equal(fitBounds(null, AREA), null);
  assert.equal(fitBounds({ x: 'a', y: 0, width: 800, height: 600 }, AREA), null);
  assert.equal(fitBounds({ x: 0, y: 0 }, AREA), null);
});

test('a maximized flag is kept, so the window reopens maximized', () => {
  assert.equal(fitBounds({ x: 0, y: 0, width: 800, height: 600, maximized: true }, AREA).maximized, true);
});

test('stored bounds round trip, and a broken or blocked store reads as empty', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  writeStoredWindow({ x: 1, y: 2, width: 3, height: 4, maximized: false }, storage);
  assert.deepEqual(readStoredWindow(storage), { x: 1, y: 2, width: 3, height: 4, maximized: false });
  storage.setItem('quire.window', '{not json');
  assert.equal(readStoredWindow(storage), null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStoredWindow(blocked), null);
  assert.doesNotThrow(() => writeStoredWindow({}, blocked));
});
