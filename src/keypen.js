/**
 * Keyboard pen for a drawing canvas. While the canvas has focus, the arrow keys
 * move a crosshair over it, Space or Enter puts the pen down and lifts it again,
 * and Escape lifts it. The pen sends the same pointer events a mouse would, so
 * every tool works the same way and no drawing code has to know about keys.
 *
 * Events are sent with a fixed pointer id and the mouse pointer type. That keeps
 * them apart from real pointers and means no pen pressure is recorded.
 */

import { el } from './dom.js';

const POINTER_ID = 4321;
const STEP = 8; // CSS pixels per arrow press; hold the key to move faster

/**
 * `isEnabled()` says whether the keyboard pen is on (a drawing tool is picked and an
 * entry is open). `getTool()` returns the tool id. `describe(enabled)` gives the
 * canvas its accessible name. `skipArrows()` lets the arrow keys through to the
 * page, for example when they nudge a selection instead.
 */
export function attachKeyboardPen(canvas, { isEnabled, getTool, describe, skipArrows = () => false }) {
  const cursor = el('div', { class: 'kb-pen', 'aria-hidden': 'true', hidden: true });
  const announcer = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  document.body.append(cursor, announcer);

  const pos = { x: 0, y: 0, placed: false };
  let down = false;

  function rect() {
    return canvas.getBoundingClientRect();
  }

  function clamp() {
    const r = rect();
    pos.x = Math.min(Math.max(pos.x, 0), r.width);
    pos.y = Math.min(Math.max(pos.y, 0), r.height);
  }

  function placeCursor() {
    const r = rect();
    cursor.style.transform = `translate(${r.left + pos.x - 8}px, ${r.top + pos.y - 8}px)`;
    cursor.classList.toggle('is-down', down);
  }

  function announce(text) {
    announcer.textContent = text;
  }

  function fire(type, shiftKey) {
    const r = rect();
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pressure: type === 'pointerup' ? 0 : 0.5,
        clientX: r.left + pos.x,
        clientY: r.top + pos.y,
        shiftKey: Boolean(shiftKey),
      }),
    );
  }

  function lift(shiftKey = false) {
    if (!down) return;
    down = false;
    fire('pointerup', shiftKey);
    announce('Pen up');
    placeCursor();
  }

  function press(shiftKey) {
    if (down) {
      lift(shiftKey);
      return;
    }
    // Fill and pick act on a single click, so they get a press and a release.
    if (getTool() === 'fill' || getTool() === 'pick') {
      fire('pointerdown', shiftKey);
      fire('pointerup', shiftKey);
      announce('Clicked');
      return;
    }
    down = true;
    fire('pointerdown', shiftKey);
    announce('Pen down');
    placeCursor();
  }

  function nudge(dx, dy, shiftKey) {
    pos.x += dx * STEP;
    pos.y += dy * STEP;
    clamp();
    if (down) fire('pointermove', shiftKey);
    placeCursor();
  }

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  /** The first key press shows the crosshair, so a mouse click on the page never leaves one behind. */
  function showCursor() {
    if (!pos.placed) {
      const r = rect();
      pos.x = r.width / 2;
      pos.y = r.height / 2;
      pos.placed = true;
    }
    clamp();
    cursor.hidden = false;
    placeCursor();
  }

  canvas.addEventListener('keydown', (event) => {
    if (!isEnabled()) return;
    const dir = ARROWS[event.key];
    if (dir) {
      if (skipArrows()) return;
      event.preventDefault();
      event.stopPropagation();
      if (cursor.hidden) showCursor();
      nudge(dir[0], dir[1], event.shiftKey);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (cursor.hidden) showCursor();
      press(event.shiftKey);
    } else if (event.key === 'Escape' && down) {
      event.preventDefault();
      event.stopPropagation();
      lift();
    }
  });

  canvas.addEventListener('blur', () => {
    lift();
    cursor.hidden = true;
  });

  // The cursor is fixed to the viewport, so it has to follow when anything scrolls.
  window.addEventListener('scroll', () => {
    if (!cursor.hidden) placeCursor();
  }, { capture: true, passive: true });

  /** Call after the tool or the open entry changes, so the canvas is focusable only when the pen works. */
  function refresh() {
    const on = isEnabled();
    canvas.tabIndex = on ? 0 : -1;
    canvas.setAttribute('aria-label', describe(on));
    if (on) canvas.setAttribute('role', 'application');
    else canvas.removeAttribute('role');
    if (!on) {
      lift();
      cursor.hidden = true;
    }
  }

  return { refresh };
}
