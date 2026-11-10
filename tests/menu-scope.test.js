import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeItems } from '../src/controller/helpers.js';

const items = [
  { label: 'All entries' },
  'sep',
  { label: 'Save now', scope: 'editor' },
  { label: 'Open selected', scope: 'home' },
  'sep',
  { label: 'Passcode lock' },
];

test('items without a scope show in both views', () => {
  const labels = (view) => scopeItems(items, view).filter((item) => item !== 'sep').map((item) => item.label);
  assert.deepEqual(labels('home'), ['All entries', 'Open selected', 'Passcode lock']);
  assert.deepEqual(labels('editor'), ['All entries', 'Save now', 'Passcode lock']);
});

test('separators never lead, trail, or double up after items are dropped', () => {
  const home = scopeItems([{ label: 'A', scope: 'editor' }, 'sep', { label: 'B', scope: 'editor' }, 'sep', { label: 'C' }], 'home');
  assert.deepEqual(home, [{ label: 'C' }]);
  const editor = scopeItems([{ label: 'A' }, 'sep', { label: 'B', scope: 'home' }, 'sep'], 'editor');
  assert.deepEqual(editor, [{ label: 'A' }]);
});
