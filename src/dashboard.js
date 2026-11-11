/**
 * Numbers and lists for the homepage dashboard: the greeting, this month's
 * totals, the most recent entries, and the last seven days. Pure functions over
 * the entries list, so node:test covers them. Days are local YYYY-MM-DD strings.
 */

import { wordCount } from './markdown.js';
import { shiftISODate, summarizeDays } from './journal.js';

/**
 * "Good morning" from 5 to noon, "Good afternoon" until 6, and "Good evening" for the rest, late nights included.
 * With a name, the name follows: "Good morning, Nate".
 */
export function greetingFor(hour, name = '') {
  const base = hour < 5 || hour >= 18 ? 'Good evening' : hour < 12 ? 'Good morning' : 'Good afternoon';
  return name ? `${base}, ${name}` : base;
}

/** Whole calendar days from `from` to `to`, both YYYY-MM-DD. Read in UTC so no time zone shifts it. */
export function daysBetween(from, to) {
  const ms = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86400000);
}

/**
 * The welcome-back card's facts: the most recently changed written entry and
 * how many days ago that change was. Null when there is nothing written yet or
 * the last change is fewer than `minDays` days back. Sample and sealed entries
 * are left out by the caller.
 */
export function welcomeBack(entries, today, minDays = 3) {
  const written = entries.filter((entry) => !entry.sample);
  const [last] = recentEntries(written, 1);
  if (!last) return null;
  const changedOn = localDay(last.updatedAt);
  if (!changedOn) return null;
  const days = daysBetween(changedOn, today);
  return days >= minDays ? { days, entry: last, changedOn } : null;
}

/** The local YYYY-MM-DD for an ISO timestamp, or '' when it does not parse. */
function localDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
