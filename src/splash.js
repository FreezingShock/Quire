/**
 * Startup splash: the Quire mark settles in and a glass bar slides while the
 * entries load. It clears as soon as the library is ready, with a short fade,
 * so startup is never held back for the splash's own animation. A reload gets
 * a brief version (just the mark and the bar). It gives up after MAX_MS even if
 * startup stalls. View > Startup splash turns it off.
 */

import { loadPrefs } from './prefs.js';
import { playSound } from './sound.js';

// No minimum on show: the splash goes as soon as startup is ready.
const MIN_MS = 0;
const MIN_RELOAD_MS = 0;
const MAX_MS = 6000;
const FADE_MS = 300;
const FADE_RELOAD_MS = 200;

/** True when this page load is a browser reload, read from the Navigation Timing entry. */
export function isReload() {
  try {
    return globalThis.performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  } catch {
    return false;
  }
}

/** Returns { done() }. Call done() once the app has started. */
export function startSplash({ reload = isReload() } = {}) {
  const node = document.getElementById('splash');
  if (!node) return { done() {} };
  if (!loadPrefs().splash) {
    node.remove();
    return { done() {} };
  }
  if (reload) node.classList.add('is-quick');

  const minMs = reload ? MIN_RELOAD_MS : MIN_MS;
  const fadeMs = reload ? FADE_RELOAD_MS : FADE_MS;
  const shownAt = performance.now();
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    clearTimeout(timeout);
    node.classList.add('is-leaving');
    // The startup chime is for a real start, not a quick reload.
    if (!reload) playSound('startup');
    setTimeout(() => node.remove(), fadeMs);
  };
  const timeout = setTimeout(hide, MAX_MS);

  return {
    done() {
      const wait = Math.max(0, minMs - (performance.now() - shownAt));
      setTimeout(hide, wait);
    },
  };
}
