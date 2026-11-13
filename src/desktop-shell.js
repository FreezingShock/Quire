/**
 * Window API behind Quire's own title bar in the desktop shell, and the rules for
 * remembering the window's size and place.
 *
 * Detection comes from src/desktop.js: the shell injects window.__QUIRE_DESKTOP__
 * before any page script. The window itself is driven through Tauri's window
 * commands (plugin:window|...), which the capability file
 * src-tauri/capabilities/window-chrome.json allows for the main window.
 *
 * ?shell=desktop in the address gives a preview for the browser and for tests.
 * It draws the same chrome, and its buttons only change the page's state.
 *
 * Remembered bounds live in localStorage. They are a per-device convenience, so
 * a failed read or write just means the default size.
 */

import { desktopShell } from './desktop.js';

export const WINDOW_KEY = 'quire.window';
/** The window's own minimum, set in src-tauri/src/lib.rs. Saved sizes are never restored below it. */
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 480;
/** How much of the window must stay on screen when it is restored, so the title bar can always be grabbed. */
const GRAB_MARGIN = 120;

/** The resize edges, and the direction each one passes to the shell's start_resize_dragging. */
export const RESIZE_EDGES = Object.freeze({
  n: 'North',
  s: 'South',
  e: 'East',
  w: 'West',
  ne: 'NorthEast',
  nw: 'NorthWest',
  se: 'SouthEast',
  sw: 'SouthWest',
});

/**
 * The window API, or null when there is no shell and no preview. `win` and
 * `search` are injectable so the rules can be unit tested without a browser.
 */
export function windowApi(win = globalThis, search = win.location?.search ?? '') {
  if (desktopShell(win)) return tauriApi(win);
  if (/(^|[?&])shell=desktop(&|$)/.test(search)) return previewApi(win);
  return null;
}

/**
 * The operating system the page runs on: 'mac', 'windows', or 'other'. The shell
 * reports its platform in __QUIRE_DESKTOP__; a browser is read from its own name.
 */
export function platformOf(win = globalThis) {
  const shell = desktopShell(win);
  const name = shell?.platform
    ?? win.navigator?.userAgentData?.platform
    ?? win.navigator?.platform
    ?? win.navigator?.userAgent
    ?? '';
  if (/mac|darwin/i.test(name)) return 'mac';
  if (/win/i.test(name)) return 'windows';
  return 'other';
}

/**
 * The Tauri window through its window commands. Every command names the window
 * by its label; the main window is "main". Bounds are logical pixels, like the
 * page's CSS pixels.
 */
function tauriApi(win) {
  const internals = win.__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== 'function') return null;
  const label = internals.metadata?.currentWindow?.label ?? 'main';
  const call = (command, args = {}) => internals.invoke(`plugin:window|${command}`, { label, ...args });
  return {
    backend: 'tauri',
    minimize: () => call('minimize'),
    toggleMaximize: () => call('toggle_maximize'),
    close: () => call('close'),
    isMaximized: () => call('is_maximized'),
    startDragging: () => call('start_dragging'),
    startResizeDragging: (direction) => call('start_resize_dragging', { value: direction }),
    /** Calls `callback` when the window moves. Returns the listener's promise. */
    onMoved(callback) {
      const handler = internals.transformCallback(() => callback());
      return internals.invoke('plugin:event|listen', { event: 'tauri://move', target: { kind: 'Window', label }, handler });
    },
    async getBounds() {
      const scale = await call('scale_factor');
      const size = await call('inner_size');
      const at = await call('outer_position');
      return { x: at.x / scale, y: at.y / scale, width: size.width / scale, height: size.height / scale };
    },
    async setBounds({ x, y, width, height }) {
      await call('set_size', { value: { Logical: { width, height } } });
      await call('set_position', { value: { Logical: { x, y } } });
    },
  };
}

/** The preview: the same buttons, with the maximized flag kept in memory. Nothing is sent to a real window. */
function previewApi(win) {
  let maximized = false;
  return {
    backend: 'preview',
    minimize() {},
    close() {},
    startDragging() {},
    startResizeDragging() {},
    async isMaximized() {
      return maximized;
    },
    async toggleMaximize() {
      maximized = !maximized;
      win.dispatchEvent?.(new Event('resize'));
      return maximized;
    },
  };
}

/** The usable area of the screen in logical pixels. Falls back to the window itself. */
export function screenArea(win = globalThis) {
  const screen = win.screen ?? {};
  const left = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
  const top = Number.isFinite(screen.availTop) ? screen.availTop : 0;
  const width = screen.availWidth || win.innerWidth || 1280;
  const height = screen.availHeight || win.innerHeight || 800;
  return { left, top, width, height };
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The saved bounds, fitted to the screen they are restored on. A monitor that is
 * gone, or a window saved larger than the screen, must not open off-screen.
 * Returns null when nothing usable was saved.
 */
export function fitBounds(saved, area) {
  if (!saved || typeof saved !== 'object') return null;
  if (![saved.x, saved.y, saved.width, saved.height].every(isNumber)) return null;
  const width = clamp(saved.width, MIN_WIDTH, Math.max(MIN_WIDTH, area.width));
  const height = clamp(saved.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, area.height));
  const x = clamp(saved.x, area.left - width + GRAB_MARGIN, area.left + area.width - GRAB_MARGIN);
  const y = clamp(saved.y, area.top, area.top + area.height - GRAB_MARGIN);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized: saved.maximized === true };
}

/** Reads the remembered bounds. A missing or broken value reads as null. */
export function readStoredWindow(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(WINDOW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeStoredWindow(bounds, storage = globalThis.localStorage) {
  try {
    storage?.setItem(WINDOW_KEY, JSON.stringify(bounds));
  } catch {
    // Storage can be full or blocked. The window still works, it just opens at its default size next time.
  }
}
