import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENT_PROPERTIES, accentTokens, brightnessOf, isDark, mixHex, normalizeAccent, skinOf, themeOf } from '../src/skins.js';

test('skinOf prefers an explicit skin and falls back to Aero', () => {
  assert.equal(skinOf({}), 'aero');
  assert.equal(skinOf({ skin: 'luna' }), 'luna');
  assert.equal(skinOf({ dark: true, skin: 'luna' }), 'luna');
  assert.equal(skinOf({ skin: 'nope' }), 'aero');
  assert.equal(skinOf(), 'aero');
});

test('the dark switch applies to every skin', () => {
  assert.deepEqual(themeOf({ skin: 'classic', dark: true }), { skin: 'classic', dark: true });
  assert.deepEqual(themeOf({ skin: 'basic' }), { skin: 'basic', dark: false });
  assert.equal(isDark({ skin: 'luna', dark: true }), true);
  assert.equal(isDark({}), false);
});

test('prefs saved with the old aero-dark skin or the old dark flag map to Aero dark', () => {
  assert.deepEqual(themeOf({ skin: 'aero-dark' }), { skin: 'aero', dark: true });
  assert.deepEqual(themeOf({ dark: true }), { skin: 'aero', dark: true });
  assert.equal(skinOf({ skin: 'aero-dark' }), 'aero');
});

test('normalizeAccent accepts short and long hex colors and rejects everything else', () => {
  assert.equal(normalizeAccent('#ABC'), '#aabbcc');
  assert.equal(normalizeAccent(' 2f6fbf '), '#2f6fbf');
  assert.equal(normalizeAccent('#2F6FBF'), '#2f6fbf');
  assert.equal(normalizeAccent('red'), null);
  assert.equal(normalizeAccent('#12345'), null);
  assert.equal(normalizeAccent(null), null);
});

test('accentTokens derives a full ramp that keeps the picked color as the accent', () => {
  const tokens = accentTokens('#d03030');
  assert.equal(tokens.accent, '#d03030');
  assert.equal(tokens['glass-mid'], '#d03030');
  assert.deepEqual(Object.keys(tokens), [...ACCENT_PROPERTIES]);
  for (const value of Object.values(tokens)) assert.match(value, /^#[0-9a-f]{6}$/);
  assert.equal(accentTokens('not a color'), null);
});

test('accent ink flips to dark text on a light accent', () => {
  assert.equal(accentTokens('#ffe066')['accent-ink'], '#1c2a3b');
  assert.equal(accentTokens('#1d3f8a')['accent-ink'], '#ffffff');
});

test('mixHex blends between two colors and brightnessOf runs black to white', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#102030', '#102030', 0.7), '#102030');
  assert.equal(brightnessOf('#000000'), 0);
  assert.ok(Math.abs(brightnessOf('#ffffff') - 1) < 1e-9);
});
