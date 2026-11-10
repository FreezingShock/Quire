/**
 * The screensaver. After a set time with no input, Quire covers the window with
 * a Vista-style scene: Memories drifts drawings and On this day entries past,
 * and Aurora and Bubbles are abstract. Any movement, click, key, or scroll
 * returns to the page. With the passcode lock on, Memories shows Aurora instead,
 * so no entry drifts past, and waking locks Quire again.
 */

import { el } from './dom.js';
import { isBlankEntry, localISODate } from './model.js';
import { onThisDay } from './journal.js';
import { createScene } from './screensaver-scenes.js';

/** The screensavers Options offers. 'off' means none. */
export const SCREENSAVERS = Object.freeze([
  { id: 'off', label: 'None' },
  { id: 'memories', label: 'Memories' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'bubbles', label: 'Bubbles' },
]);

export const MIN_IDLE_MINUTES = 1;
export const MAX_IDLE_MINUTES = 60;
const DEFAULT_IDLE_MINUTES = 5;
const MEMORY_POOL = 24; // recent entries that can drift past, besides On this day
const CHECK_MS = 1000;
// Pointer movement smaller than this many pixels does not count, so a jittery desk does not wake the screen.
const MOVE_SLOP_PX = 6;

const IDS = new Set(SCREENSAVERS.map((item) => item.id));

export function normalizeScreensaver(id) {
  return IDS.has(id) ? id : 'off';
}

export function normalizeIdleMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_IDLE_MINUTES;
  return clamp(n, MIN_IDLE_MINUTES, MAX_IDLE_MINUTES);
}

/**
 * The scene that actually plays. Memories shows entries, so it is replaced by
 * Aurora while the passcode lock is on, and when there is nothing to remember yet.
 */
export function sceneFor(kind, { locked, hasMemories }) {
  if (kind === 'memories') return locked || !hasMemories ? 'aurora' : 'memories';
  return kind;
}

/** True once `minutes` have passed since `lastActivity`. */
export function idleReached(now, lastActivity, minutes) {
  return now - lastActivity >= minutes * 60_000;
}

/**
 * The memories a Memories screensaver can show: entries from this date in
 * earlier years first, then a sample of recent entries that have a drawing or
 * text. Sample and blank entries never show. Returns { list }, where each item
 * is { entry, yearsAgo, otd }. `rng` makes the shuffle repeatable in tests.
 */
export function pickMemories(entries, today = localISODate(), rng = Math.random) {
  const usable = entries.filter((entry) => !entry.sample && !isBlankEntry(entry));
  const recalled = onThisDay(usable, today).flatMap((group) =>
    group.entries.map((entry) => ({ entry, yearsAgo: group.yearsAgo, otd: true })),
  );
  const shown = new Set(recalled.map((item) => item.entry.id));
  const others = usable
    .filter((entry) => !shown.has(entry.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MEMORY_POOL)
    .map((entry) => ({ entry, yearsAgo: 0, otd: false }));
  return { list: [...shuffle(recalled, rng), ...shuffle(others, rng)] };
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/** Something else owns the screen: the lock, an open dialog, or the startup splash. The screensaver waits. */
function somethingOwnsScreen() {
  return (
    document.documentElement.classList.contains('is-locked')
    || Boolean(document.querySelector('dialog[open]'))
    || Boolean(document.getElementById('splash'))
  );
}

/**
 * Starts the idle watch and returns { preview(), stop() }. `getPrefs()` returns
 * the saved prefs, `getEntries()` loads the entries for Memories, `isLocked()`
 * says whether the passcode lock is on, and `onWake()` runs when a locked
 * screensaver is dismissed, so Quire locks again.
 */
export function startScreensaver({ getPrefs, getEntries, isLocked, onWake, now = () => Date.now() }) {
  let lastActivity = now();
  let showing = false;
  let session = 0; // bumps on every show and dismiss, so a slow load never shows a stale scene
  let teardown = null;
  let swallowClick = false;

  const touch = () => {
    if (!showing) lastActivity = now();
  };

  // Input the page sees while the screensaver is off: any of it counts as activity.
  const activity = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
  for (const type of activity) window.addEventListener(type, touch, { capture: true, passive: true });
  window.addEventListener('scroll', touch, { capture: true, passive: true });
  // Coming back to the tab is activity, so a screensaver never snaps on the moment you return.
  const onVisibility = () => {
    if (!document.hidden) touch();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // A click that ends the screensaver should not also press whatever is under the pointer.
  const eatClick = (event) => {
    if (!swallowClick) return;
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', eatClick, { capture: true });

  function dismiss({ fromInput = false } = {}) {
    if (!showing) return;
    showing = false;
    session += 1;
    teardown?.();
    teardown = null;
    if (fromInput) {
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 400);
    }
    lastActivity = now();
    // A locked Quire wakes to the passcode, not to the entries.
    if (isLocked()) onWake?.();
  }

  async function show(kind) {
    if (showing) return;
    showing = true;
    const mine = ++session;
    const locked = Boolean(isLocked());
    let entries = [];
    if (kind === 'memories' && !locked) {
      try {
        entries = await getEntries();
      } catch {
        entries = [];
      }
    }
    if (mine !== session || !showing) return;

    const pool = pickMemories(entries, localISODate());
    const scene = sceneFor(kind, { locked, hasMemories: pool.list.length > 0 });
    const root = el('div', {
      class: 'screensaver',
      role: 'dialog',
      'aria-label': 'Screensaver. Move the mouse or press a key to return.',
      'data-scene': scene,
    });
    const canvas = el('canvas', { 'aria-hidden': 'true' });
    root.append(canvas);
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('is-on'));

    const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || getPrefs().motion === false;
    const painter = createScene(scene, { canvas, memories: pool.list, reduceMotion });
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      painter.resize(window.innerWidth, window.innerHeight, dpr);
    };
    size();

    let raf = 0;
    let last = null;
    const frame = (time) => {
      const dt = last === null ? 0 : Math.min(0.1, (time - last) / 1000);
      last = time;
      painter.frame(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', size);

    // Input that dismisses the screensaver. The first pointer move only records where the pointer is.
    let pointerAt = null;
    const onInput = (event) => {
      if (event.type === 'pointermove') {
        if (!pointerAt) {
          pointerAt = { x: event.clientX, y: event.clientY };
          return;
        }
        if (Math.abs(event.clientX - pointerAt.x) + Math.abs(event.clientY - pointerAt.y) < MOVE_SLOP_PX) return;
      }
      // The key or click that wakes the screen does nothing else.
      event.preventDefault();
      event.stopPropagation();
      dismiss({ fromInput: event.type !== 'keydown' });
    };
    const inputs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const type of inputs) window.addEventListener(type, onInput, { capture: true, passive: false });

    teardown = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      for (const type of inputs) window.removeEventListener(type, onInput, { capture: true });
      root.remove();
    };
  }

  const timer = setInterval(() => {
    if (showing) return;
    const prefs = getPrefs();
    const kind = normalizeScreensaver(prefs.screensaver);
    if (kind === 'off' || document.hidden || somethingOwnsScreen()) return;
    if (idleReached(now(), lastActivity, normalizeIdleMinutes(prefs.screensaverMinutes))) {
      void show(kind);
    }
  }, CHECK_MS);

  return {
    /** Options > Preview. Shows the chosen scene now, or Memories when the screensaver is set to None. */
    preview() {
      const kind = normalizeScreensaver(getPrefs().screensaver);
      void show(kind === 'off' ? 'memories' : kind);
    },
    stop() {
      clearInterval(timer);
      dismiss();
      for (const type of activity) window.removeEventListener(type, touch, { capture: true });
      window.removeEventListener('scroll', touch, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('click', eatClick, { capture: true });
    },
  };
}
