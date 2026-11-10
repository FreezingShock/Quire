import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REMINDER_DEFAULTS, reminderDue } from '../src/pwa.js';

const ROOT = new URL('../', import.meta.url);

const on = { enabled: true, time: '20:00', lastDay: null };

test('reminders are off by default', () => {
  assert.equal(REMINDER_DEFAULTS.enabled, false);
  assert.equal(reminderDue(REMINDER_DEFAULTS, new Date(2026, 10, 10, 23, 0)), false);
});

test('a reminder waits for its time', () => {
  assert.equal(reminderDue(on, new Date(2026, 10, 10, 19, 59)), false);
  assert.equal(reminderDue(on, new Date(2026, 10, 10, 20, 0)), true);
  assert.equal(reminderDue(on, new Date(2026, 10, 10, 22, 30)), true);
});

test('a reminder goes out once a day', () => {
  assert.equal(reminderDue({ ...on, lastDay: '2026-11-10' }, new Date(2026, 10, 10, 21, 0)), false);
  assert.equal(reminderDue({ ...on, lastDay: '2026-11-09' }, new Date(2026, 10, 10, 21, 0)), true);
});

test('a disabled reminder never fires, and a bad time falls back to 20:00', () => {
  assert.equal(reminderDue({ ...on, enabled: false }, new Date(2026, 10, 10, 21, 0)), false);
  assert.equal(reminderDue({ ...on, time: 'soon' }, new Date(2026, 10, 10, 19, 59)), false);
  assert.equal(reminderDue({ ...on, time: 'soon' }, new Date(2026, 10, 10, 20, 0)), true);
});

/** Every file the app loads from src/, src/controller/, styles/ and assets/ must be in the service worker's precache list. */
test('the service worker precaches every shipped module, stylesheet, and asset', () => {
  const sw = readFileSync(new URL('sw.js', ROOT), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]));
  const list = (dir, ext) =>
    readdirSync(new URL(dir, ROOT))
      .filter((name) => (ext ? name.endsWith(ext) : true))
      .map((name) => `${dir}${name}`);
  const shipped = [
    ...list('src/', '.js'),
    ...list('src/controller/', '.js'),
    ...list('styles/', '.css'),
    ...list('assets/'),
  ];
  const missing = shipped.filter((file) => !listed.has(file));
  assert.deepEqual(missing, [], 'add these files to SHELL in sw.js');
});
