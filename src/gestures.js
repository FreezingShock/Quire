/**
 * Touch gesture rules, kept free of the DOM so the node tests can check them.
 * touch.js feeds these the pointer's start and end points and the time between.
 *
 * - A press that stays put for HOLD_MS is a long-press, which opens the right-click menu.
 * - A quick, mostly sideways swipe moves to the next or previous entry.
 * - A quick, mostly downward swipe on a dialog's title closes the dialog.
 */

export const HOLD_MS = 500;
/** How far a finger can drift before a press stops counting as a hold. */
export const HOLD_SLOP = 10;
export const SWIPE_MIN_X = 72;
export const SWIPE_MAX_MS = 700;
/** A swipe must be this many times more sideways than up or down. */
export const SWIPE_RATIO = 2.5;
export const CLOSE_MIN_Y = 90;
export const CLOSE_MAX_MS = 1000;

/** True once a pointer has travelled far enough that the press is no longer a hold. */
export function movedBeyond(from, to, slop = HOLD_SLOP) {
  return Math.hypot(to.x - from.x, to.y - from.y) > slop;
}

/**
 * Reads a finished touch as an entry swipe. Returns +1 for a swipe left (the next
 * entry in the All entries order, which is older), -1 for a swipe right (the
 * previous, newer entry), or 0 when the motion is not a swipe.
 */
export function entrySwipeStep({ dx, dy, ms }) {
  if (ms > SWIPE_MAX_MS) return 0;
  if (Math.abs(dx) < SWIPE_MIN_X) return 0;
  if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** True when a finished touch is a downward swipe that should close a dialog. */
export function isCloseSwipe({ dx, dy, ms }) {
  if (ms > CLOSE_MAX_MS) return false;
  return dy >= CLOSE_MIN_Y && dy >= SWIPE_RATIO * Math.abs(dx);
}

/**
 * The id one step away in an ordered list, or null at either end. A missing
 * current id (for example a deleted entry) also gives null, so nothing jumps.
 */
export function neighbourId(ids, currentId, step) {
  const at = ids.indexOf(currentId);
  if (at === -1) return null;
  const next = ids[at + step];
  return next ?? null;
}
