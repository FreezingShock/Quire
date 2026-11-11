import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_MAX, PROMPT_MAX_COUNT, PROMPT_MAX_LENGTH, formatPromptLines, normalizeName, normalizePrompts, parsePromptLines } from '../src/personal.js';

test('normalizeName trims, collapses spaces, and caps the length', () => {
  assert.equal(normalizeName('  Nate   Anderson  '), 'Nate Anderson');
  assert.equal(normalizeName('   '), '');
  assert.equal(normalizeName(42), '');
  assert.equal(normalizeName(undefined), '');
  assert.equal(normalizeName('x'.repeat(NAME_MAX + 10)).length, NAME_MAX);
});

test('normalizePrompts drops blanks, repeats, and non-strings', () => {
  assert.deepEqual(normalizePrompts(['  What is new?  ', '', 'What is new?', 7, null, 'Second']), ['What is new?', 'Second']);
  assert.deepEqual(normalizePrompts('not a list'), []);
});

test('normalizePrompts caps the count and the length of each prompt', () => {
  const many = Array.from({ length: PROMPT_MAX_COUNT + 5 }, (_, i) => `Prompt ${i}`);
  assert.equal(normalizePrompts(many).length, PROMPT_MAX_COUNT);
  const [long] = normalizePrompts(['a'.repeat(PROMPT_MAX_LENGTH + 50)]);
  assert.equal(long.length, PROMPT_MAX_LENGTH);
});

test('parsePromptLines reads one prompt per line, and formatPromptLines writes them back', () => {
  const parsed = parsePromptLines('First one\r\n\n  Second one  \n');
  assert.deepEqual(parsed, ['First one', 'Second one']);
  assert.equal(formatPromptLines(parsed), 'First one\nSecond one');
  assert.deepEqual(parsePromptLines(undefined), []);
});
