import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playSound } from '../src/sound.js';
import { loadPrefs } from '../src/prefs.js';

test('sound effects are off by default', () => {
  assert.equal(loadPrefs().sound, false);
});

test('playSound stays silent and never throws without audio or with sound off', () => {
  assert.doesNotThrow(() => playSound('startup'));
  assert.doesNotThrow(() => playSound('newEntry'));
  assert.doesNotThrow(() => playSound('no-such-sound'));
});
