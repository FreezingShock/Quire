import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import {
  DEFAULT_GADGETS,
  GADGETS,
  WORDS,
  addGadget,
  clockAngles,
  inkEntries,
  missingGadgets,
  moodGauge,
  moveGadget,
  normalizeGadgetList,
  removeGadget,
  streakGoal,
  wordOfTheDay,
} from '../src/gadgets.js';

test('a missing or broken saved list gives the defaults', () => {
  assert.deepEqual(normalizeGadgetList(undefined), [...DEFAULT_GADGETS]);
  assert.deepEqual(normalizeGadgetList('clock'), [...DEFAULT_GADGETS]);
});

test('normalizeGadgetList drops unknown ids and repeats, and keeps the saved order', () => {
  assert.deepEqual(normalizeGadgetList(['note', 'clock', 'note', 'bogus', 'slides']), ['note', 'clock', 'slides']);
});

test('an empty saved list stays empty, since the reader may remove every gadget', () => {
  assert.deepEqual(normalizeGadgetList([]), []);
});

test('addGadget appends a gadget once and ignores unknown ids', () => {
  const list = ['clock'];
  assert.deepEqual(addGadget(list, 'calendar'), ['clock', 'calendar']);
  assert.equal(addGadget(list, 'clock'), list);
  assert.equal(addGadget(list, 'nope'), list);
});

test('removeGadget takes out one gadget and leaves the rest in order', () => {
  assert.deepEqual(removeGadget(['clock', 'mood', 'note'], 'mood'), ['clock', 'note']);
});

test('missingGadgets lists what is off the sidebar, in catalog order', () => {
  const missing = missingGadgets(['clock', 'note']).map((gadget) => gadget.id);
  assert.deepEqual(missing, GADGETS.map((gadget) => gadget.id).filter((id) => id !== 'clock' && id !== 'note'));
});

test('moveGadget shifts a gadget up or down and stops at the ends', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveGadget(list, 'a', 1), ['b', 'a', 'c']);
  assert.deepEqual(moveGadget(list, 'c', -1), ['a', 'c', 'b']);
  assert.equal(moveGadget(list, 'a', -1), list);
  assert.equal(moveGadget(list, 'c', 1), list);
  assert.equal(moveGadget(list, 'zz', 1), list);
});

test('clockAngles turns the hour and minute hands through their hour and minute', () => {
  const angles = clockAngles(new Date(2026, 10, 10, 3, 30, 15));
  assert.equal(angles.hour, 105); // 3:30 is halfway from the 3 to the 4: 3.5 * 30
  assert.equal(angles.minute, 181.5); // 30 minutes and 15 seconds: 30.25 * 6
  assert.equal(angles.second, 90);
});

test('clockAngles wraps the twelve-hour dial at noon and midnight', () => {
  assert.equal(clockAngles(new Date(2026, 0, 1, 12, 0, 0)).hour, 0);
  assert.equal(clockAngles(new Date(2026, 0, 1, 0, 0, 0)).hour, 0);
});

test('streakGoal fills one cell per day up to the goal and marks it met', () => {
  assert.deepEqual(streakGoal({ current: 3, longest: 5 }), { current: 3, longest: 5, goal: 7, filled: 3, met: false });
  assert.deepEqual(streakGoal({ current: 9, longest: 9 }), { current: 9, longest: 9, goal: 7, filled: 7, met: true });
  assert.equal(streakGoal({ current: 0, longest: 0 }).filled, 0);
});

test('moodGauge averages the last two weeks and points the needle from Rough (left) to Great (right)', () => {
  const entries = [
    createEntry({ date: '2026-11-10', mood: 'great', body: 'x' }),
    createEntry({ date: '2026-11-09', mood: 'great', body: 'x' }),
  ];
  const gauge = moodGauge(entries, '2026-11-10');
  assert.equal(gauge.logged, 2);
  assert.equal(gauge.mood.id, 'great');
  assert.equal(gauge.needle, 90);
});

test('moodGauge with no moods has no needle', () => {
  assert.deepEqual(moodGauge([], '2026-11-10'), { average: null, mood: null, logged: 0, needle: null });
});

test('moodGauge puts a rough average at the left end', () => {
  const entries = [createEntry({ date: '2026-11-10', mood: 'rough', body: 'x' })];
  assert.equal(moodGauge(entries, '2026-11-10').needle, -90);
});

test('inkEntries keeps only entries with ink, skips the sample, and sorts newest edit first', () => {
  const ink = { ops: [{ t: 'pen' }], layers: [] };
  const entries = [
    createEntry({ id: 'a', date: '2026-11-01', updatedAt: '2026-11-01T10:00:00.000Z', ink }),
    createEntry({ id: 'b', date: '2026-11-02', updatedAt: '2026-11-05T10:00:00.000Z', ink }),
    createEntry({ id: 'c', date: '2026-11-03', updatedAt: '2026-11-09T10:00:00.000Z', body: 'no ink' }),
    createEntry({ id: 'd', date: '2026-11-04', updatedAt: '2026-11-08T10:00:00.000Z', ink, sample: true }),
  ];
  assert.deepEqual(inkEntries(entries).map((entry) => entry.id), ['b', 'a']);
});

test('inkEntries honors the limit', () => {
  const ink = { ops: [{ t: 'pen' }], layers: [] };
  const entries = Array.from({ length: 5 }, (_, i) => createEntry({ id: `e${i}`, date: '2026-11-01', updatedAt: `2026-11-0${i + 1}T10:00:00.000Z`, ink }));
  assert.equal(inkEntries(entries, 2).length, 2);
});

test('wordOfTheDay is stable for a day and changes from one day to the next', () => {
  assert.deepEqual(wordOfTheDay('2026-11-10'), wordOfTheDay('2026-11-10'));
  assert.notEqual(wordOfTheDay('2026-11-10').word, wordOfTheDay('2026-11-11').word);
});

test('wordOfTheDay cycles through the whole list before it repeats', () => {
  const words = new Set();
  for (let i = 0; i < WORDS.length; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    words.add(wordOfTheDay(day).word);
  }
  assert.equal(words.size, WORDS.length);
});
