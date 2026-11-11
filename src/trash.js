/**
 * Desk drawer rules: how long a deleted entry waits before it is removed for
 * good, and the line that says how much time is left. Pure functions, no DOM
 * and no storage, so they are covered by node:test.
 */

/** Days a deleted entry waits in the desk drawer before it is removed for good. */
export const TRASH_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a drawer entry is removed for good, as a Date. Null for entries that are not in the drawer, or whose time cannot be read. */
export function purgeDate(entry) {
  if (!entry?.deletedAt) return null;
  const deleted = Date.parse(entry.deletedAt);
  return Number.isNaN(deleted) ? null : new Date(deleted + TRASH_DAYS * DAY_MS);
}

/** True once an entry has waited in the drawer for all of its days. */
export function isExpired(entry, now = Date.now()) {
  const due = purgeDate(entry);
  return due !== null && now >= due.getTime();
}

/** Whole days left before removal, rounded up. Null when the entry is not in the drawer. */
export function daysLeft(entry, now = Date.now()) {
  const due = purgeDate(entry);
  if (!due) return null;
  return Math.max(0, Math.ceil((due.getTime() - now) / DAY_MS));
}

/** Splits drawer entries into those to keep and those past their days. */
export function splitExpired(entries, now = Date.now()) {
  const kept = [];
  const expired = [];
  for (const entry of entries) (isExpired(entry, now) ? expired : kept).push(entry);
  return { kept, expired };
}

/** The line under a drawer entry: how long it has left. Empty for entries outside the drawer. */
export function removalNote(entry, now = Date.now()) {
  const days = daysLeft(entry, now);
  if (days === null) return '';
  if (days === 0) return 'Due for removal';
  return `Removed for good in ${days} ${days === 1 ? 'day' : 'days'}`;
}
