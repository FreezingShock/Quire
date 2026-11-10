/**
 * Random memory: picks one past entry to reopen. Pure, no DOM.
 * Sealed time capsules, the first-run sample and blank entries are never picked.
 */
import { isHidden } from './capsule.js';
import { isBlankEntry, localISODate } from './model.js';

/** Entries a random memory can land on. Past days win; today's entries only count when there is nothing older. */
export function memoryCandidates(entries, today = localISODate()) {
  const usable = entries.filter((entry) => !entry.sample && !isHidden(entry, today) && !isBlankEntry(entry));
  const past = usable.filter((entry) => entry.date < today);
  return past.length ? past : usable;
}

/** One entry at random from the candidates, or null when there is nothing to pick. `random` returns a number in [0, 1). */
export function pickRandomMemory(entries, today = localISODate(), random = Math.random) {
  const pool = memoryCandidates(entries, today);
  if (!pool.length) return null;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}
