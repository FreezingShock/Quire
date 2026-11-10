import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPTION_PREFS } from '../src/options.js';
import { loadPrefs } from '../src/prefs.js';

test('every pref the Options dialog edits has a saved default', () => {
  const defaults = loadPrefs();
  for (const key of OPTION_PREFS) {
    assert.ok(key in defaults, `missing default for ${key}`);
  }
});

test('the dialog owns each toggle once, so no pref is listed twice', () => {
  assert.equal(new Set(OPTION_PREFS).size, OPTION_PREFS.length);
});
