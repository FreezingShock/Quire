/**
 * Numbers and lists for the homepage dashboard: the greeting, this month's
 * totals, the most recent entries, and the last seven days. Pure functions over
 * the entries list, so node:test covers them. Days are local YYYY-MM-DD strings.
 */

import { wordCount } from './markdown.js';
import { shiftISODate, summarizeDays } from './journal.js';

/** "Good morning" from 5 to noon, "Good afternoon" until 6, and "Good evening" for the rest, late nights included. */
export function greetingFor(hour) {
  if (hour < 5 || hour >= 18) return 'Good evening';
  if (hour < 12) return 'Good morning';
  return 'Good afternoon';
}

/** True when the only entries are the first-run sample, so the page can greet a new reader. */
export function isFirstRun(entries) {
  return entries.length > 0 && entries.every((entry) => entry.sample);
}

/** Entries dated in the same month as `today`, with their combined word count. */
export function monthSummary(entries, today) {
  const month = today.slice(0, 7);
  const inMonth = entries.filter((entry) => entry.date.startsWith(month));
  const words = inMonth.reduce((sum, entry) => sum + wordCount(entry.body), 0);
  return { count: inMonth.length, words };
}

/** The most recently edited entries, newest edit first. */
export function recentEntries(entries, limit = 6) {
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

/**
 * The last `count` days ending on `today`, oldest first. Each day has its entry
 * count and the mood most recently set on it, or null.
 */
export function lastDays(entries, today, count = 7) {
  const byDay = summarizeDays(entries);
  return Array.from({ length: count }, (_, index) => {
    const date = shiftISODate(today, index - (count - 1));
    const info = byDay[date];
    return { date, count: info?.count ?? 0, mood: info?.mood ?? null, isToday: date === today };
  });
}
