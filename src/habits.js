/**
 * Habit tracker: a short list of habits and the days each one was done. Pure,
 * no DOM. Days are local YYYY-MM-DD strings, as everywhere else.
 *
 * State shape: { habits: [{ id, name, createdAt }], days: { 'YYYY-MM-DD': [habitId, ...] } }
 */
import { newId, isISODate } from './model.js';
import { shiftISODate } from './journal.js';

export const HABIT_MAX = 12;
export const HABIT_NAME_MAX = 40;

export function emptyHabits() {
  return { habits: [], days: {} };
}

/** A saved habit state, cleaned up: broken habits, unknown or repeated ids, and bad days are dropped. */
export function normalizeHabits(raw) {
  if (!raw || typeof raw !== 'object') return emptyHabits();
  const habits = [];
  const ids = new Set();
  for (const item of Array.isArray(raw.habits) ? raw.habits : []) {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, HABIT_NAME_MAX) : '';
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!name || !id || ids.has(id) || habits.length >= HABIT_MAX) continue;
    ids.add(id);
    habits.push({ id, name, createdAt: isISODate(item.createdAt) ? item.createdAt : '' });
  }
  const days = {};
  for (const [day, list] of Object.entries(raw.days && typeof raw.days === 'object' ? raw.days : {})) {
    if (!isISODate(day) || !Array.isArray(list)) continue;
    const done = [...new Set(list)].filter((id) => ids.has(id));
    if (done.length) days[day] = done;
  }
  return { habits, days };
}

/** Why a habit cannot be added under this name, or null when it can. */
export function habitProblem(state, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Type the habit first.';
  if (state.habits.some((habit) => habit.name.toLowerCase() === trimmed.toLowerCase())) return 'You already track that habit.';
  if (state.habits.length >= HABIT_MAX) return `The limit is ${HABIT_MAX} habits. Remove one first.`;
  return null;
}

export function addHabit(state, name, today, id = newId()) {
  if (habitProblem(state, name)) return state;
  const habit = { id, name: String(name).trim().slice(0, HABIT_NAME_MAX), createdAt: today };
  return { ...state, habits: [...state.habits, habit] };
}

/** The habit and every day it was checked off on are removed. */
export function removeHabit(state, id) {
  const days = {};
  for (const [day, list] of Object.entries(state.days)) {
    const kept = list.filter((item) => item !== id);
    if (kept.length) days[day] = kept;
  }
  return { habits: state.habits.filter((habit) => habit.id !== id), days };
}

export function isDone(state, id, day) {
  return (state.days[day] ?? []).includes(id);
}

/** Checks a habit off for a day, or clears the check if it was already set. */
export function toggleHabit(state, id, day) {
  if (!state.habits.some((habit) => habit.id === id) || !isISODate(day)) return state;
  const list = state.days[day] ?? [];
  const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  const days = { ...state.days };
  if (next.length) days[day] = next;
  else delete days[day];
  return { ...state, days };
}

/**
 * Days in a row the habit was done, ending today. If today is not done yet,
 * the count starts from yesterday, so a streak is not broken before the day ends.
 */
export function habitStreak(state, id, today) {
  let day = isDone(state, id, today) ? today : shiftISODate(today, -1);
  let count = 0;
  while (isDone(state, id, day)) {
    count += 1;
    day = shiftISODate(day, -1);
  }
  return count;
}

/** The last `count` days, oldest first, ending on `today`. */
export function recentDays(today, count = 7) {
  return Array.from({ length: count }, (_, index) => shiftISODate(today, index - (count - 1)));
}
