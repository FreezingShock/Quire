/**
 * Startup splash: a glassy Aero screen with the Quire mark and a pulsing ring
 * while the entries load. It stays for at least MIN_MS so it never flashes, and
 * it gives up after MAX_MS even if startup stalls. View > Startup splash turns it off.
 */

import { loadPrefs } from './prefs.js';
import { playSound } from './sound.js';

const MIN_MS = 1400;
const MAX_MS = 6000;
const FADE_MS = 700;

/** Returns { done() }. Call done() once the app has started. */
export function startSplash() {
  const node = document.getElementById('splash');
  if (!node) return { done() {} };
  if (!loadPrefs().splash) {
    node.remove();
    return { done() {} };
  }

  const shownAt = performance.now();
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    clearTimeout(timeout);
    node.classList.add('is-leaving');
    playSound('startup');
    setTimeout(() => node.remove(), FADE_MS);
  };
  const timeout = setTimeout(hide, MAX_MS);

  return {
    done() {
      const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
      setTimeout(hide, wait);
    },
  };
}
