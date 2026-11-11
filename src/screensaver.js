/**
 * The screensaver. After a set time with no input, Quire covers the window with
 * a Vista-style scene: Memories drifts drawings and On this day entries past,
 * Aurora and Bubbles are abstract, and a custom screensaver shows what its maker
 * picked. Any movement, click, scroll, or key returns to the page. With the
 * passcode lock on, Memories shows Aurora instead and a custom screensaver shows
 * only its background and message, so no entry drifts past, and waking locks
 * Quire again.
 */

import { el } from './dom.js';
import { isBlankEntry, localISODate } from './model.js';
import { onThisDay } from './journal.js';
import {
  customIdOf,
  customKind,
  normalizeCustoms,
  pickCustom,
} from './screensaver-custom.js';

/** The built-in screensavers Options offers. 'off' means none. */
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
const PHOTO_LOAD_MS = 4000; // a photo that will not decode in this long is left out
// Pointer movement smaller than this many pixels does not count, so a jittery desk does not wake the screen.
const MOVE_SLOP_PX = 6;

/** Every screensaver the picker offers: the built-ins, then the custom ones by name. */
export function screensaverOptions(customs = []) {
  return [
    ...SCREENSAVERS,
    ...normalizeCustoms(customs).map((config) => ({ id: customKind(config.id), label: config.name })),
  ];
}

/** A screensaver id that is built in, or a custom one that is saved. Anything else reads as off. */
export function normalizeScreensaver(id, customs = []) {
  const custom = customIdOf(id);
  if (custom !== null) {
    return normalizeCustoms(customs).some((config) => config.id === custom) ? id : 'off';
  }
  return SCREENSAVERS.some((item) => item.id === id) ? id : 'off';
}

export function normalizeIdleMinutes(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_IDLE_MINUTES;
  return clamp(n, MIN_IDLE_MINUTES, MAX_IDLE_MINUTES);
}

/**
 * The scene that actually plays. Memories shows entries, so it is replaced by
 * Aurora while the passcode lock is on, and when there is nothing to remember yet.
 * A custom screensaver stays a custom screensaver: under the lock it shows its
 * background and message only.
 */
export function sceneFor(kind, { locked, hasMemories }) {
  if (customIdOf(kind) !== null) return 'custom';
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

/**
 * Decodes each photo before the screensaver starts, so a card never waits on
 * one. Photos that fail or take too long are left out.
 */
async function loadPhotos(items) {
  const ready = [];
  await Promise.all(items.map(async (item) => {
    if (item.kind !== 'photo') {
      ready.push(item);
      return;
    }
    const img = new Image();
    img.src = item.src;
    try {
      await Promise.race([
        img.decode(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PHOTO_LOAD_MS)),
      ]);
      item.image = img;
      ready.push(item);
    } catch {
      // A photo that will not load is skipped.
    }
  }));
  // Keep the pick's order, so a shuffled pool stays shuffled.
  return items.filter((item) => ready.includes(item));
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
 * Starts the idle watch and returns { preview(draft?, onEnd?), stop() }.
 * `getPrefs()` returns the saved prefs. `getEntries({ photos })` loads the
 * entries, with their pictures when `photos` is true. `isLocked()` says whether
 * the passcode lock is on. `onWake()` runs when a locked screensaver is
 * dismissed, so Quire locks again.
 */
export function startScreensaver({ getPrefs, getEntries, isLocked, onWake, now = () => Date.now() }) {
  let lastActivity = now();
  let showing = false;
  let session = 0; // bumps on every show and dismiss, so a slow load never shows a stale scene
  let teardown = null;
  let afterDismiss = null;
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
    const after = afterDismiss;
    afterDismiss = null;
    after?.();
  }

  /** Shows `kind`. `config` is a custom screensaver's settings, which may be an unsaved draft. */
  async function show(kind, { config = null, onEnd = null } = {}) {
    if (showing) return;
    showing = true;
    afterDismiss = onEnd;
    const mine = ++session;
    const locked = Boolean(isLocked());
    const customs = normalizeCustoms(getPrefs().screensavers);
    const custom = customIdOf(kind) !== null ? (config ?? customs.find((item) => customKind(item.id) === kind) ?? null) : null;
    if (customIdOf(kind) !== null && !custom) {
      // A custom screensaver that was deleted while it was picked. Show the Memories instead.
      kind = 'memories';
    }

    // Entries are read only when they can be shown. Under the lock, a custom screensaver shows nothing from them.
    const wantsPhotos = Boolean(custom?.items.photos);
    const needsEntries = !locked && (kind === 'memories' || Boolean(custom));
    let entries = [];
    if (needsEntries) {
      try {
        entries = await getEntries({ photos: wantsPhotos });
      } catch {
        entries = [];
      }
    }
    if (mine !== session || !showing) return;
    // The scenes load on first use. Waking during that load ends the session, so check again before drawing.
    const { createScene } = await import('./screensaver-scenes.js');
    if (mine !== session || !showing) return;

    let list = [];
    if (custom) {
      list = locked ? [] : await loadPhotos(pickCustom(entries, custom));
    } else if (kind === 'memories') {
      list = pickMemories(entries, localISODate()).list;
    }
    if (mine !== session || !showing) return;

    const scene = sceneFor(kind, { locked, hasMemories: list.length > 0 });
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
    const painter = createScene(scene, { canvas, memories: list, config: custom, reduceMotion });
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
    const kind = normalizeScreensaver(prefs.screensaver, prefs.screensavers);
    if (kind === 'off' || document.hidden || somethingOwnsScreen()) return;
    if (idleReached(now(), lastActivity, normalizeIdleMinutes(prefs.screensaverMinutes))) {
      void show(kind);
    }
  }, CHECK_MS);

  return {
    /**
     * Options > Preview, and the custom screensaver editor's Preview. With a
     * `draft`, that unsaved custom screensaver is shown. `onEnd` runs when the
     * preview is dismissed, so the editor can open again.
     */
    preview(draft = null, onEnd = null) {
      if (draft) {
        void show(customKind(draft.id), { config: draft, onEnd });
        return;
      }
      const prefs = getPrefs();
      const kind = normalizeScreensaver(prefs.screensaver, prefs.screensavers);
      void show(kind === 'off' ? 'memories' : kind, { onEnd });
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
