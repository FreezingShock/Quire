import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_FLAG, desktopInvoke, desktopShell, isDesktop, markDesktopShell } from '../src/desktop.js';

const tauriScope = () => ({
  [DESKTOP_FLAG]: { shell: 'tauri', version: '0.1.0', platform: 'windows' },
});

function fakeDocument() {
  const attributes = {};
  return {
    attributes,
    documentElement: {
      setAttribute: (name, value) => {
        attributes[name] = value;
      },
    },
  };
}

test('a browser or installed PWA is not the desktop shell', () => {
  assert.equal(desktopShell({}), null);
  assert.equal(isDesktop({}), false);
  assert.equal(desktopShell({ [DESKTOP_FLAG]: null }), null);
  assert.equal(desktopShell({ [DESKTOP_FLAG]: 'tauri' }), null, 'the flag must be an object');
});

test('the desktop shell reports its name, version and platform', () => {
  const shell = desktopShell(tauriScope());
  assert.deepEqual({ ...shell }, { shell: 'tauri', version: '0.1.0', platform: 'windows' });
  assert.equal(isDesktop(tauriScope()), true);
});

test('the description is frozen so page code cannot change it', () => {
  const shell = desktopShell(tauriScope());
  assert.equal(Object.isFrozen(shell), true);
});

test('missing fields fall back to safe strings', () => {
  const shell = desktopShell({ [DESKTOP_FLAG]: {} });
  assert.deepEqual({ ...shell }, { shell: 'unknown', version: '', platform: '' });
});

test('markDesktopShell tags <html> only inside the desktop shell', () => {
  const scope = { ...tauriScope(), document: fakeDocument() };
  assert.equal(markDesktopShell(scope).shell, 'tauri');
  assert.equal(scope.document.attributes['data-shell'], 'desktop');

  const web = { document: fakeDocument() };
  assert.equal(markDesktopShell(web), null);
  assert.equal(web.document.attributes['data-shell'], undefined);
});

test('desktopInvoke forwards commands only inside the desktop shell', async () => {
  const calls = [];
  const scope = {
    ...tauriScope(),
    __TAURI_INTERNALS__: { invoke: async (command, args) => (calls.push([command, args]), 'ok') },
  };
  assert.equal(await desktopInvoke('plugin:demo|ping', { a: 1 }, scope), 'ok');
  assert.deepEqual(calls, [['plugin:demo|ping', { a: 1 }]]);

  await assert.rejects(desktopInvoke('plugin:demo|ping', {}, {}), /desktop shell/);
});
