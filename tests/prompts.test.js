import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, promptFor } from '../src/prompts.js';

test('every day gets a prompt from the list', () => {
  for (const day of ['2026-11-10', '2000-02-29', '1999-12-31']) {
    assert.ok(PROMPTS.includes(promptFor(day)));
  }
});

test('the same day always gives the same prompt', () => {
  assert.equal(promptFor('2026-11-10'), promptFor('2026-11-10'));
});

test('consecutive days get different prompts, and the cycle covers the whole list', () => {
  const seen = new Set();
  let day = '2026-01-01';
  for (let i = 0; i < PROMPTS.length; i += 1) {
    seen.add(promptFor(day));
    const [y, m, d] = day.split('-').map(Number);
    day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  assert.equal(seen.size, PROMPTS.length);
});

test('skip moves forward through the list, wrapping at the end', () => {
  const today = '2026-11-10';
  assert.notEqual(promptFor(today, 1), promptFor(today));
  assert.equal(promptFor(today, PROMPTS.length), promptFor(today));
  assert.equal(promptFor(today, 1), promptFor('2026-11-11'));
});

test('dates before 1970 still map inside the list', () => {
  assert.ok(PROMPTS.includes(promptFor('1960-06-15', 0)));
  assert.ok(PROMPTS.includes(promptFor('1960-06-15', -3)));
});

test('own prompts are mixed into the cycle, so they come up on some day', () => {
  const own = ['My first prompt', 'My second prompt'];
  const seen = new Set();
  // Sixty consecutive days cover the whole cycle of the two own prompts plus the built-in list.
  for (let day = 0; day < 60; day += 1) {
    const iso = new Date(Date.UTC(2026, 2, 1 + day)).toISOString().slice(0, 10);
    seen.add(promptFor(iso, 0, own));
  }
  assert.ok(seen.has('My first prompt'));
  assert.ok(seen.has('My second prompt'));
});

test('with no own prompts, the built-in cycle is unchanged', () => {
  assert.equal(promptFor('2026-11-10', 0, []), promptFor('2026-11-10'));
  assert.equal(promptFor('2026-11-10', 3, []), promptFor('2026-11-10', 3));
});
