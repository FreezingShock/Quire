/**
 * Focus writing mode: the pure rules behind it (no DOM). The controller uses
 * these for the session word count, the goal progress, typewriter scrolling,
 * and which ambient sound is picked. The sounds themselves live in ambient.js.
 */

/** Ambient sounds that play while focus mode is on, and only when sound effects are on. */
export const AMBIENT_SOUNDS = Object.freeze([
  { id: 'off', label: 'Off' },
  { id: 'rain', label: 'Rain on a window' },
  { id: 'cafe', label: 'Café murmur' },
  { id: 'crt', label: 'CRT hum' },
]);

/** Any saved value that is not a known sound id falls back to off. */
export function normalizeAmbient(id) {
  return AMBIENT_SOUNDS.some((sound) => sound.id === id) ? id : 'off';
}

/** Largest goal the Options field accepts. */
export const MAX_WORD_GOAL = 100000;

/** A goal is a whole number of words. 0 means no goal. */
export function normalizeGoal(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_WORD_GOAL);
}

/**
 * Net words written this session: the entry's count now, minus its count when
 * the session began. Deleting words can lower it, but never below zero.
 */
export function sessionWords(words, baseline) {
  return Math.max(0, words - baseline);
}

/**
 * Progress toward a goal. `fraction` runs from 0 to 1 and stops at the goal.
 * `reached` is true once the session count meets the goal.
 */
export function goalProgress(count, goal) {
  if (!goal) return { active: false, fraction: 0, reached: false, label: '' };
  const fraction = Math.min(1, Math.max(0, count / goal));
  const reached = count >= goal;
  return {
    active: true,
    fraction,
    reached,
    label: `${Math.min(count, goal)} of ${goal} words`,
  };
}

/**
 * How far to scroll so the caret line sits at the middle of the viewport.
 * A small dead zone stops the page from twitching on every keystroke.
 */
export function typewriterDelta(caretY, centerY, deadband = 4) {
  const delta = caretY - centerY;
  return Math.abs(delta) < deadband ? 0 : Math.round(delta);
}
