import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENT_PROPERTIES, accentTokens, brightnessOf, mixHex, normalizeAccent, skinOf } from '../src/skins.js';

test('skinOf prefers an explicit skin and maps the old dark pref to Aero dark', () => {
  assert.equal(skinOf({}), 'aero');
  assert.equal(skinOf({ dark: true }), 'aero-dark');
  assert.equal(skinOf({ dark: true, skin: 'luna' }), 'luna');
  assert.equal(skinOf({ skin: 'nope' }), 'aero');
  assert.equal(skinOf(), 'aero');
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
