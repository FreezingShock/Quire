import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeIndex, moveIndex, normalizeOptions, selectedIndex, typeaheadIndex } from '../src/dropdown.js';

const items = normalizeOptions([
  { value: 'great', label: 'Great' },
  { value: 'good', label: 'Good' },
  { value: 'okay', label: 'Okay', disabled: true },
  { value: 'low', label: 'Low' },
  { value: 'rough', label: 'Rough' },
]);

test('normalizeOptions takes value/label, model id/label, and plain strings', () => {
  assert.deepEqual(normalizeOptions([{ id: 'rain', label: 'Rain' }]), [{ value: 'rain', label: 'Rain', disabled: false }]);
  assert.deepEqual(normalizeOptions(['a']), [{ value: 'a', label: 'a', disabled: false }]);
  assert.deepEqual(normalizeOptions([{ value: '', label: 'Not set' }])[0], { value: '', label: 'Not set', disabled: false });
  assert.deepEqual(normalizeOptions(undefined), []);
});

test('selectedIndex finds the value, or -1 when nothing offers it', () => {
  assert.equal(selectedIndex(items, 'low'), 3);
  assert.equal(selectedIndex(items, 'snow'), -1);
  assert.equal(selectedIndex(items, ''), -1);
});

test('moveIndex steps by one and skips disabled options', () => {
  assert.equal(moveIndex(items, 1, 1), 3, 'skips the disabled Okay');
  assert.equal(moveIndex(items, 3, -1), 1, 'skips it going back too');
  assert.equal(moveIndex(items, 0, -1), 0, 'stays put at the top');
  assert.equal(moveIndex(items, 4, 1), 4, 'stays put at the bottom');
  assert.equal(moveIndex(items, -1, 1), 0, 'from nothing, the first step lands on the top');
  assert.equal(moveIndex([], -1, 1), -1, 'an empty list has nowhere to go');
});

test('edgeIndex gives the first or last enabled option', () => {
  assert.equal(edgeIndex(items), 0);
  assert.equal(edgeIndex(items, true), 4);
  assert.equal(edgeIndex([{ label: 'A', disabled: true }]), -1);
  assert.equal(edgeIndex([]), -1);
});

test('typeaheadIndex jumps to the first match after the current option', () => {
  assert.equal(typeaheadIndex(items, 'l', 0), 3, 'Low, past the current row');
  assert.equal(typeaheadIndex(items, 'R', -1), 4, 'case does not matter');
  assert.equal(typeaheadIndex(items, 'gr', 0), 0, 'a longer string starts at the current option');
  assert.equal(typeaheadIndex(items, 'zz', 0), -1);
  assert.equal(typeaheadIndex(items, '', 0), -1);
  assert.equal(typeaheadIndex([], 'a', -1), -1);
});

test('repeating one letter cycles through the options that start with it', () => {
  const kinds = normalizeOptions(['Journal', 'Poem', 'Blog post', 'Note']);
  assert.equal(typeaheadIndex(kinds, 'b', -1), 2);
  assert.equal(typeaheadIndex(kinds, 'b', 2), 2, 'wraps back to the only other B-match, which is itself');
  assert.equal(typeaheadIndex(kinds, 'n', 0), 3);
});

test('typeaheadIndex skips disabled options', () => {
  assert.equal(typeaheadIndex(items, 'o', -1), -1, 'the only O option is disabled');
});
