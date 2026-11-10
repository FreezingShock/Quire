/**
 * Pure helpers for the journal habit: the month grid, daily streaks, per-day
 * summaries, and picking today's journal. No DOM and no storage, so they are
 * covered by node:test. Days are local calendar dates as YYYY-MM-DD.
 */

import { localISODate } from './model.js';

const WEEK = 7;
const GRID_WEEKS = 6; // always six rows, so the calendar does not jump in height between months

/** The ISO date `days` after (or before, when negative) `iso`. Uses UTC math, so DST never shifts a day. */
export function shiftISODate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Six weeks of cells for the month. `month` is 0-based, as in Date. Cells
 * outside the month are included so every row is full. Weeks start on Sunday.
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = first.getUTCDay();
  const start = Date.UTC(year, month, 1 - lead);
  const weeks = [];
  for (let w = 0; w < GRID_WEEKS; w += 1) {
    const row = [];
    for (let d = 0; d < WEEK; d += 1) {
      const ms = start + (w * WEEK + d) * 86400000;
      const cell = new Date(ms);
      row.push({
        date: cell.toISOString().slice(0, 10),
        day: cell.getUTCDate(),
        inMonth: cell.getUTCMonth() === month,
      });
    }
    weeks.push(row);
  }
  return { year, month, weeks };
}

/** Year and 0-based month for a YYYY-MM-DD string. */
export function monthOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { year: y, month: m - 1 };
}

/**
 * Streaks count days with at least one entry. The current streak runs back
 * from today, or from yesterday when today has nothing yet, so a streak is not
 * broken before the day is over. `longest` is the best run in the whole history.
 */
export function dayStreaks(entries, today = localISODate()) {
  const days = new Set(entries.map((entry) => entry.date));

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const day of [...days].sort()) {
    run = prev && shiftISODate(prev, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }

  const todayDone = days.has(today);
  let cursor = todayDone ? today : shiftISODate(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = shiftISODate(cursor, -1);
  }
  return { current, longest, todayDone };
}

/**
 * { 'YYYY-MM-DD': { count, mood, weather } } for every day with entries. The
 * mood and weather come from the most recently edited entry that set them.
 */
export function summarizeDays(entries) {
  const byDay = {};
  const byRecency = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const entry of entries) {
    const day = byDay[entry.date] ?? { count: 0, mood: null, weather: null };
    day.count += 1;
    byDay[entry.date] = day;
  }
  for (const entry of byRecency) {
    const day = byDay[entry.date];
    if (!day.mood && entry.mood) day.mood = entry.mood;
    if (!day.weather && entry.weather) day.weather = entry.weather;
  }
  return byDay;
}

/** The most recently edited journal entry dated `today`, or null. */
export function todaysJournal(entries, today = localISODate()) {
  let best = null;
  for (const entry of entries) {
    if (entry.kind !== 'journal' || entry.date !== today) continue;
    if (!best || entry.updatedAt > best.updatedAt) best = entry;
  }
  return best;
}
