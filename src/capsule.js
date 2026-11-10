/**
 * Time capsules: an entry sealed until a day you pick. This file has no DOM and
 * no storage. It decides whether an entry is closed, what a closed entry shows
 * to the rest of the app, and how dates move.
 *
 * A capsule has three visible stages:
 *   sealed  the open day is still ahead. Nothing but the date and a countdown shows.
 *   ready   the open day has come, but the letter has not been unsealed yet.
 *   opened  the letter was unsealed. It is an ordinary entry from then on.
 */

import { CAPSULE_MAX_YEARS, isISODate, localISODate, normalizeCapsule } from './model.js';
import { normalizeLayers } from './drawing.js';

const DAY_MS = 86400000;

/** The stage an entry is in. `today` is a local YYYY-MM-DD string. */
export function capsuleStatus(entry, today = localISODate()) {
  const capsule = entry?.capsule;
  if (!capsule) return 'none';
  if (capsule.unsealedAt) return 'opened';
  return capsule.openOn > today ? 'sealed' : 'ready';
}

/** True while an entry is closed: sealed, or ready and not yet unsealed. */
export function isHidden(entry, today = localISODate()) {
  const status = capsuleStatus(entry, today);
  return status === 'sealed' || status === 'ready';
}

/**
 * The copy of a closed entry that the lists, calendar, and search work from.
 * It keeps the id, dates, pin and favorite flags, and the capsule, so rows can
 * still be opened and counted. Everything you wrote is blanked: title, text,
 * ink, sketches, pictures, tags, notebook, mood and weather.
 */
export function redactEntry(entry) {
  return {
    ...entry,
    title: 'Time capsule',
    body: '',
    tags: [],
    notebook: null,
    mood: null,
    weather: null,
    images: {},
    sketches: {},
    ink: { ops: [], h: 0, layers: normalizeLayers() },
  };
}

/** The list the home screen and the entry picker work from. Open entries pass through unchanged. */
export function redactSealed(entries, today = localISODate()) {
  return entries.map((entry) => (isHidden(entry, today) ? redactEntry(entry) : entry));
}

/** Whole calendar days from `today` to `openOn`. Counted in UTC, so daylight saving never shifts it. */
export function daysUntil(openOn, today = localISODate()) {
  const ms = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(openOn) - ms(today)) / DAY_MS);
}

/** "Opens tomorrow", "Opens in 12 days", or "Ready to open". Empty for an entry with no capsule, or one already opened. */
export function countdownText(entry, today = localISODate()) {
  const status = capsuleStatus(entry, today);
  if (status === 'ready') return 'Ready to open';
  if (status !== 'sealed') return '';
  const days = daysUntil(entry.capsule.openOn, today);
  return days === 1 ? 'Opens tomorrow' : `Opens in ${days} days`;
}

/** Adds days, months, or years to a YYYY-MM-DD date. A day that does not exist in the target month is clamped to its last day. */
export function addToISODate(iso, { days = 0, months = 0, years = 0 } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  const monthIndex = m - 1 + months + years * 12;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, lastDay) + days)).toISOString().slice(0, 10);
}

/** The earliest and latest open day a capsule can be given, counted from `today`. */
export function sealDateRange(today = localISODate()) {
  return {
    min: addToISODate(today, { days: 1 }),
    max: addToISODate(today, { years: CAPSULE_MAX_YEARS }),
  };
}

/** Why an open day cannot be used, as a sentence for the dialog. Empty when it is fine. */
export function sealDateProblem(openOn, today = localISODate()) {
  if (!isISODate(openOn)) return 'Pick a day to open the letter on.';
  if (openOn <= today) return 'Pick a day after today. A capsule opens on a later day.';
  if (openOn > addToISODate(today, { years: CAPSULE_MAX_YEARS })) {
    return `Pick a day within ${CAPSULE_MAX_YEARS} years from today.`;
  }
  return '';
}

/** The entry with a fresh seal that opens on `openOn`. Nothing else changes. */
export function sealedEntry(entry, openOn, now = new Date()) {
  return { ...entry, capsule: normalizeCapsule({ openOn, sealedAt: now.toISOString(), unsealedAt: null, notified: false }) };
}

/** The entry with its open day moved. The arrival notice is sent again for the new day. */
export function rescheduledEntry(entry, openOn) {
  return { ...entry, capsule: { ...entry.capsule, openOn, notified: false } };
}

/** The entry marked as unsealed now. It is an ordinary entry after this. */
export function unsealedEntry(entry, now = new Date()) {
  return { ...entry, capsule: { ...entry.capsule, unsealedAt: now.toISOString() } };
}

/** Closed capsules, the soonest open day first. Used for the capsule card on the dashboard. */
export function upcomingCapsules(entries, today = localISODate()) {
  return entries
    .filter((entry) => isHidden(entry, today))
    .sort((a, b) => a.capsule.openOn.localeCompare(b.capsule.openOn) || a.id.localeCompare(b.id));
}
