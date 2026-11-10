import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HABIT_MAX,
  addHabit,
  habitProblem,
  habitStreak,
  isDone,
  normalizeHabits,
  recentDays,
  removeHabit,
  toggleHabit,
} from '../src/habits.js';

const today = '2026-06-15';

test('normalizeHabits drops broken habits and unknown checks', () => {
  const state = normalizeHabits({
    habits: [
      { id: 'a', name: '  Water  ', createdAt: '2026-06-01' },
      { id: 'a', name: 'Duplicate' },
      { id: 'b', name: '' },
      { name: 'No id' },
    ],
    days: { '2026-06-14': ['a', 'ghost', 'a'], 'not-a-day': ['a'], '2026-06-13': ['ghost'] },
  });
  assert.deepEqual(state.habits, [{ id: 'a', name: 'Water', createdAt: '2026-06-01' }]);
  assert.deepEqual(state.days, { '2026-06-14': ['a'] });
  assert.deepEqual(normalizeHabits(null), { habits: [], days: {} });
});

test('habitProblem stops duplicates, blanks and going past the limit', () => {
  let state = { habits: [], days: {} };
  assert.match(habitProblem(state, '   '), /Type/);
  state = addHabit(state, 'Walk', today, 'w');
  assert.match(habitProblem(state, 'walk'), /already/);
  for (let i = 0; i < HABIT_MAX - 1; i += 1) state = addHabit(state, `Habit ${i}`, today, `h${i}`);
  assert.equal(state.habits.length, HABIT_MAX);
  assert.match(habitProblem(state, 'One more'), /limit/);
  assert.equal(addHabit(state, 'One more', today, 'x').habits.length, HABIT_MAX);
});

test('toggleHabit checks and clears a day, and removeHabit clears its checks', () => {
  let state = addHabit({ habits: [], days: {} }, 'Read', today, 'r');
  state = toggleHabit(state, 'r', today);
  assert.equal(isDone(state, 'r', today), true);
  state = toggleHabit(state, 'r', today);
  assert.equal(isDone(state, 'r', today), false);
  assert.equal(state.days[today], undefined);
  state = toggleHabit(state, 'r', today);
  state = removeHabit(state, 'r');
  assert.deepEqual(state, { habits: [], days: {} });
  assert.equal(toggleHabit(state, 'nope', today), state);
});

test('habitStreak counts back from today and waits for today before breaking', () => {
  let state = addHabit({ habits: [], days: {} }, 'Stretch', today, 's');
  for (const day of ['2026-06-13', '2026-06-14', '2026-06-15']) state = toggleHabit(state, 's', day);
  assert.equal(habitStreak(state, 's', today), 3);
  // Today is not checked yet, so yesterday's run still counts.
  state = toggleHabit(state, 's', today);
  state = toggleHabit(state, 's', today);
  assert.equal(habitStreak(state, 's', today), 3);
  // A gap two days back ends the run.
  state = toggleHabit({ habits: state.habits, days: { '2026-06-12': ['s'] } }, 's', '2026-06-14');
  assert.equal(habitStreak(state, 's', '2026-06-15'), 1);
  assert.equal(habitStreak(state, 's', '2026-06-20'), 0);
});

test('recentDays returns the last days oldest first', () => {
  assert.deepEqual(recentDays('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(recentDays(today).length, 7);
  assert.equal(recentDays(today).at(-1), today);
});
