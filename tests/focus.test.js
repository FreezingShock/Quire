import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_SOUNDS,
  MAX_WORD_GOAL,
  goalProgress,
  normalizeAmbient,
  normalizeGoal,
  sessionWords,
  typewriterDelta,
} from '../src/focus.js';
import { loadPrefs } from '../src/prefs.js';
import { OPTION_PREFS } from '../src/options.js';

test('ambient sounds are off by default and unknown ids fall back to off', () => {
  assert.equal(loadPrefs().ambient, 'off');
  assert.equal(normalizeAmbient('rain'), 'rain');
  assert.equal(normalizeAmbient('cafe'), 'cafe');
  assert.equal(normalizeAmbient('crt'), 'crt');
  assert.equal(normalizeAmbient('thunder'), 'off');
  assert.equal(normalizeAmbient(undefined), 'off');
  assert.deepEqual(
    AMBIENT_SOUNDS.map((sound) => sound.id),
    ['off', 'rain', 'cafe', 'crt'],
  );
});

test('the word goal is a whole number from 0 to the maximum', () => {
  assert.equal(normalizeGoal(0), 0);
  assert.equal(normalizeGoal('250'), 250);
  assert.equal(normalizeGoal(249.6), 250);
  assert.equal(normalizeGoal(-30), 0);
  assert.equal(normalizeGoal('abc'), 0);
  assert.equal(normalizeGoal(NaN), 0);
  assert.equal(normalizeGoal(MAX_WORD_GOAL + 5000), MAX_WORD_GOAL);
});

test('session words are net words since the session began, never negative', () => {
  assert.equal(sessionWords(120, 100), 20);
  assert.equal(sessionWords(100, 100), 0);
  assert.equal(sessionWords(80, 100), 0);
});

test('goal progress fills toward the goal and stops at it', () => {
  const off = goalProgress(40, 0);
  assert.equal(off.active, false);
  assert.equal(off.fraction, 0);
  assert.equal(off.reached, false);

  const half = goalProgress(125, 250);
  assert.equal(half.active, true);
  assert.equal(half.fraction, 0.5);
  assert.equal(half.reached, false);
  assert.equal(half.label, '125 of 250 words');

  const done = goalProgress(300, 250);
  assert.equal(done.fraction, 1);
  assert.equal(done.reached, true);
  assert.equal(done.label, '250 of 250 words');

  assert.equal(goalProgress(-5, 250).fraction, 0);
});

test('typewriter scrolling moves the caret line to the middle, with a dead zone', () => {
  assert.equal(typewriterDelta(300, 300), 0);
  assert.equal(typewriterDelta(302, 300), 0); // inside the dead zone
  assert.equal(typewriterDelta(340, 300), 40); // caret is below the middle, scroll down
  assert.equal(typewriterDelta(260, 300), -40); // caret is above the middle, scroll up
  assert.equal(typewriterDelta(340.4, 300), 40);
});

test('the focus prefs have saved defaults and are listed in Options', () => {
  const defaults = loadPrefs();
  assert.equal(defaults.typewriter, false);
  assert.equal(defaults.wordGoal, 0);
  assert.equal(defaults.ambientVolume, 0.5);
  for (const key of ['typewriter', 'wordGoal', 'ambient', 'ambientVolume']) {
    assert.ok(OPTION_PREFS.includes(key), `${key} is missing from OPTION_PREFS`);
  }
});
