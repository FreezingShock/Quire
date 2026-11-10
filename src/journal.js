/**
 * Pure helpers for the journal habit: the month grid, daily streaks, per-day
 * summaries, and picking today's journal. No DOM and no storage, so they are
 * covered by node:test. Days are local calendar dates as YYYY-MM-DD.
 */

import { MOODS, localISODate } from './model.js';

const WEEK = 7;
const DAY_MS = 86400000;
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
  // The first-run sample is not something the reader wrote, so it does not start a streak.
  const days = new Set(entries.filter((entry) => !entry.sample).map((entry) => entry.date));

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

/** Whole days from `from` to `to` (both YYYY-MM-DD). Zero for the same day, negative if `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Mood as a number from 1 (rough) to 5 (great) so a chart can plot it. Null for no mood. */
export function moodScore(id) {
  const index = MOODS.findIndex((mood) => mood.id === id);
  return index < 0 ? null : MOODS.length - index;
}

/**
 * One point for each of `days` days, ending on `endDate` and oldest first. Each
 * point has the day's mood (from summarizeDays) and its score, or nulls when no
 * entry on that day set a mood.
 */
export function moodSeries(entries, endDate, days) {
  const byDay = summarizeDays(entries);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = shiftISODate(endDate, -offset);
    const mood = byDay[date]?.mood ?? null;
    series.push({ date, mood, score: moodScore(mood) });
  }
  return series;
}

/**
 * Averages a daily series into buckets of `size` days, oldest first, so a long
 * range stays readable. A bucket's score is the mean of its logged days, and its
 * mood is the nearest option to that mean. Empty buckets have nulls.
 */
export function bucketSeries(series, size) {
  const buckets = [];
  for (let start = 0; start < series.length; start += size) {
    const slice = series.slice(start, start + size);
    const average = moodAverage(slice);
    buckets.push({
      date: slice[0].date,
      endDate: slice[slice.length - 1].date,
      score: average === null ? null : Math.round(average * 100) / 100,
      mood: average === null ? null : moodForScore(average).id,
    });
  }
  return buckets;
}

/** Mean mood score across the days that have one, or null when none do. */
export function moodAverage(series) {
  const scores = series.map((point) => point.score).filter((score) => score !== null);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** The mood nearest to an average score, as an option from MOODS. */
export function moodForScore(score) {
  if (score === null) return null;
  const rounded = Math.min(MOODS.length, Math.max(1, Math.round(score)));
  return MOODS[MOODS.length - rounded];
}

/** [{ id, label, count }] in MOODS order (great first), counting the days in a series at each mood. */
export function moodCounts(series) {
  return MOODS.map((mood) => ({
    id: mood.id,
    label: mood.label,
    count: series.filter((point) => point.mood === mood.id).length,
  }));
}

/**
 * Entries from this month and day in earlier years, grouped by how many years
 * back they are, nearest year first. Entries from today's year are left out.
 */
export function onThisDay(entries, today = localISODate()) {
  const [year, month, day] = today.split('-');
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.date.endsWith(`-${month}-${day}`)) continue;
    const yearsAgo = Number(year) - Number(entry.date.slice(0, 4));
    if (yearsAgo <= 0) continue;
    if (!groups.has(yearsAgo)) groups.set(yearsAgo, { yearsAgo, year: Number(entry.date.slice(0, 4)), entries: [] });
    groups.get(yearsAgo).entries.push(entry);
  }
  return [...groups.values()]
    .sort((a, b) => a.yearsAgo - b.yearsAgo)
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
}
