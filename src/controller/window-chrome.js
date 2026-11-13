/**
 * Window chrome for the desktop shell and the installed PWA. In a desktop build
 * the window has no frame of its own, so this draws the caption buttons, makes
 * the title bar drag the window, and adds the resize edges. It also remembers
 * the window's size and place. An installed PWA that asks for
 * window-controls-overlay keeps the system's buttons and only leaves room for
 * them. Mixed into QuireApp. The shell rules live in src/desktop-shell.js.
 */

import { captionIcon } from '../icons.js';
import {
  RESIZE_EDGES,
  fitBounds,
  platformOf,
  readStoredWindow,
  screenArea,
  windowApi,
  writeStoredWindow,
} from '../desktop-shell.js';

/** Controls that take their own clicks, so a press on them never starts a drag. */
const NO_DRAG = 'button, input, select, textarea, a, [data-no-drag]';

/** A call into the shell that may refuse. A refusal leaves the window as it was. */
function quietly(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
  return result;
}

export const windowChromeMethods = {
  initWindowChrome() {
    const api = windowApi();
    this.windowApi = api;
    if (!api) {
      this.watchOverlay();
      return;
    }
    const root = document.documentElement;
    root.dataset.shell = 'desktop';
    // On Mac the system draws the traffic lights at top left, so Quire's own caption buttons are hidden there (see styles/window-chrome.css).
    root.dataset.platform = platformOf();
    this.mountCaptionButtons();
    this.bindTitleBar(api);
    this.bindResizeEdges(api);
    this.applyWindowState(false);
    this.trackWindow(api);
    this.restoreWindow(api);
  },

  /** The three caption buttons. The maximize button holds both glyphs and CSS shows the one that fits the state. */
  mountCaptionButtons() {
    const controls = document.getElementById('window-controls');
    if (!controls) return;
    for (const button of controls.querySelectorAll('[data-wc]')) {
      const name = button.dataset.wc;
      button.innerHTML = name === 'maximize' ? `${captionIcon('maximize')}${captionIcon('restore')}` : captionIcon(name);
    }
    controls.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-wc]');
      if (!button) return;
      const api = this.windowApi;
      if (button.dataset.wc === 'minimize') quietly(api.minimize());
      else if (button.dataset.wc === 'maximize') this.toggleWindowMaximized();
      else if (button.dataset.wc === 'close') {
        this.persist?.();
        quietly(api.close());
      }
    });
  },

  /** Press on the title bar to drag the window, double-click to maximize. Buttons and fields keep their own clicks. */
  bindTitleBar(api) {
    const bar = document.querySelector('.titlebar');
    if (!bar) return;
    bar.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(NO_DRAG) || event.target.closest('.window-controls')) return;
      if (event.detail === 2) {
        event.preventDefault();
        this.toggleWindowMaximized();
      } else if (event.detail === 1) {
        quietly(api.startDragging());
      }
    });
  },

  /** The thin edges and corners drag a resize. They are hidden while the window is maximized. */
  bindResizeEdges(api) {
    for (const edge of document.querySelectorAll('.resize-edge')) {
      const direction = RESIZE_EDGES[edge.dataset.edge];
      if (!direction) continue;
      edge.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || this.windowMaximized) return;
        event.preventDefault();
        quietly(api.startResizeDragging(direction));
      });
    }
  },

  async toggleWindowMaximized() {
    const api = this.windowApi;
    if (!api) return;
    try {
      await api.toggleMaximize();
      this.applyWindowState(await api.isMaximized());
    } catch {
      // The shell refused the change. The window keeps its size, and the buttons keep their state.
    }
  },

  /** The maximize button reads Maximize or Restore, and the CSS follows data-window on the page. */
  applyWindowState(maximized) {
    this.windowMaximized = Boolean(maximized);
    const root = document.documentElement;
    root.dataset.window = this.windowMaximized ? 'maximized' : 'normal';
    const button = document.querySelector('.wc-max');
    if (button) {
      const label = this.windowMaximized ? 'Restore' : 'Maximize';
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  },

  /** Keeps the window state current and remembers its last normal size and place, so the next launch opens there. */
  trackWindow(api) {
    let timer = null;
    const remember = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const maximized = await api.isMaximized();
          this.applyWindowState(maximized);
          if (!api.getBounds) return;
          const previous = readStoredWindow() ?? {};
          if (maximized) {
            // While maximized the size is the screen's, so keep the normal size from before.
            writeStoredWindow({ ...previous, maximized: true });
          } else {
            writeStoredWindow({ ...(await api.getBounds()), maximized: false });
          }
        } catch {
          // A shell that cannot report its bounds just does not remember them.
        }
      }, 400);
    };
    globalThis.addEventListener('resize', remember);
    quietly(api.onMoved?.(remember));
  },

  /** Opens the window where it was last left, fitted to the screen. Only a shell that can set bounds does this. */
  async restoreWindow(api) {
    if (!api.setBounds) return;
    const fit = fitBounds(readStoredWindow(), screenArea());
    if (!fit) return;
    try {
      await api.setBounds(fit);
      if (fit.maximized && !(await api.isMaximized())) await api.toggleMaximize();
      this.applyWindowState(await api.isMaximized());
    } catch {
      // The window keeps its default size when the shell refuses the saved one.
    }
  },

  /**
   * An installed PWA that uses window-controls-overlay: the system draws the
   * buttons, and the title bar only leaves room for them (styles/window-chrome.css).
   */
  watchOverlay() {
    const overlay = globalThis.navigator?.windowControlsOverlay;
    if (!overlay) return;
    const sync = () => {
      const root = document.documentElement;
      if (overlay.visible) root.dataset.shell = 'overlay';
      else if (root.dataset.shell === 'overlay') delete root.dataset.shell;
    };
    overlay.addEventListener('geometrychange', sync);
    sync();
  },
};
