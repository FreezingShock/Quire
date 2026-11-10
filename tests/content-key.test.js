import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentKey } from '../src/controller/helpers.js';
import { createEntry } from '../src/model.js';

test('a change to only the mood or the weather counts as an edit, so it gets saved', () => {
  const entry = createEntry({ id: 'e1' });
  const base = contentKey(entry);
  assert.notEqual(contentKey({ ...entry, mood: 'great' }), base);
  assert.notEqual(contentKey({ ...entry, weather: 'rain' }), base);
  assert.equal(contentKey({ ...entry, mood: null }), base, 'unset and null are the same');
});
