/**
 * Finger input for Quire. Three things, all driven by touch pointers only, so
 * mouse and keyboard behave as before:
 *
 * - Long-press on a control, list row, or panel opens the same context menu a
 *   right-click would. The text editor and the drawing layer keep their own
 *   press handling (selecting words, drawing), so a press there is left alone.
 * - A quick sideways swipe on the page moves to the next or previous entry.
 *   It is ignored while a dialog is open or a draft is in progress.
 * - A quick downward swipe on a dialog's title closes that dialog.
 *
 * The rules and thresholds live in gestures.js.
 */

import { HOLD_MS, entrySwipeStep, isCloseSwipe, movedBeyond } from './gestures.js';

/** Presses here belong to the browser or the page's own drawing, so no long-press menu. */
const NO_HOLD = 'input, textarea, select, canvas, [contenteditable="true"], [data-no-hold]';
/** A swipe that starts on a field, a canvas, or a control with its own drag is not a page swipe. */
const NO_SWIPE = 'input, textarea, select, canvas, [data-no-swipe]';
/** How long after a long-press the click that follows the lift is swallowed. */
const HOLD_CLICK_GUARD_MS = 350;
/** A native contextmenu this soon after a touch is the browser's own long-press. */
const NATIVE_HOLD_WINDOW_MS = 2000;

/**
 * @param {object} options
 * @param {() => boolean} options.canSwipeEntry  whether a sideways swipe may change entries right now
 * @param {(step: number) => void} options.onSwipeEntry  called with +1 (next, older) or -1 (previous, newer)
 */
export function wireTouchGestures({ canSwipeEntry, onSwipeEntry }) {
  let press = null; // the touch being tracked: { id, start, last, target, dialog, held, timer }
  let touchAt = -Infinity;
  let clickGuardUntil = 0;

  function fireHold(current) {
    current.held = true;
    current.timer = null;
    navigator.vibrate?.(10);
    const target = current.target.isConnected ? current.target : document.elementFromPoint(current.last.x, current.last.y);
    // A synthetic contextmenu takes the same path as a right-click, so each surface's own menu opens.
    target?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: current.last.x,
        clientY: current.last.y,
        button: 2,
        buttons: 2,
        view: window,
      }),
    );
  }

  function releaseDialog(dialog) {
    if (!dialog) return;
    dialog.style.transition = 'transform 0.16s ease';
    dialog.style.transform = '';
    setTimeout(() => dialog.style.removeProperty('transition'), 180);
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      touchAt = performance.now();
      if (press?.timer) clearTimeout(press.timer);
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        press = null;
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      const current = {
        id: event.pointerId,
        start: { ...point, t: performance.now() },
        last: point,
        target,
        dialog: target.closest('dialog[open] .dialog-title')?.closest('dialog') ?? null,
        held: false,
        timer: null,
      };
      if (!target.closest(NO_HOLD)) current.timer = setTimeout(() => fireHold(current), HOLD_MS);
      press = current;
    },
    true,
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!press || event.pointerId !== press.id) return;
      press.last = { x: event.clientX, y: event.clientY };
      if (press.timer && movedBeyond(press.start, press.last)) {
        clearTimeout(press.timer);
        press.timer = null;
      }
      if (press.dialog && !press.held) {
        // Follow the finger down a little, so the swipe to close feels direct.
        const drop = Math.max(0, press.last.y - press.start.y);
        press.dialog.style.transform = `translateY(${Math.min(drop, 240) * 0.6}px)`;
      }
    },
    true,
  );

  function finish(event, cancelled) {
    if (!press || event.pointerId !== press.id) return;
    const current = press;
    press = null;
    if (current.timer) clearTimeout(current.timer);
    if (current.held) {
      clickGuardUntil = performance.now() + HOLD_CLICK_GUARD_MS;
      return;
    }
    if (cancelled) {
      releaseDialog(current.dialog);
      return;
    }
    const motion = {
      dx: current.last.x - current.start.x,
      dy: current.last.y - current.start.y,
      ms: performance.now() - current.start.t,
    };
    if (current.dialog) {
      releaseDialog(current.dialog);
      if (isCloseSwipe(motion)) current.dialog.close();
      return;
    }
    const step = entrySwipeStep(motion);
    if (!step || current.target.closest(NO_SWIPE)) return;
    if (current.target.closest('#editor') && !window.getSelection()?.isCollapsed) return; // a text selection is in progress
    if (canSwipeEntry()) onSwipeEntry(step);
  }

  document.addEventListener('pointerup', (event) => finish(event, false), true);
  document.addEventListener('pointercancel', (event) => finish(event, true), true);

  // The click that follows a long-press lands on whatever is under the finger. It must not activate it.
  document.addEventListener(
    'click',
    (event) => {
      if (performance.now() < clickGuardUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  // Chrome on Android sends its own contextmenu for a long-press. The synthetic one above replaces it,
  // so the browser's copy is dropped, except over fields and the editor where the browser's own menu is wanted.
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (!event.isTrusted || performance.now() - touchAt > NATIVE_HOLD_WINDOW_MS) return;
      if (event.target instanceof Element && event.target.closest(NO_HOLD)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
