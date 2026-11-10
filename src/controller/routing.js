/** View switching and hash routing for the Quire controller: the entries list, the editor, and back and forward. Mixed into QuireApp. */

import { HOME_ROUTE, routeEntryId } from './routes.js';
import { DEFAULT_PAGE_COLOR, isBlankEntry } from '../model.js';

export const routingMethods = {
  // ---------- views and routing ----------

  setView(view) {
    this.view = view;
    this.dom.app.dataset.view = view;
    this.menubar?.refresh();
    // Leaving the editor stops the mixtape player, since its song would keep playing from the hidden page.
    if (view !== 'editor') this.mixtape?.stop();
    this.keyPen?.refresh();
    if (view === 'editor') this.applyPrefs();
  },

  /** Saves the open entry, drops it if it is blank, and shows the entries list. */
  async showHome({ history: mode = 'push' } = {}) {
    this.commitTextDraft();
    this.commitDraft();
    await this.persist('leave');
    if (this.entry && isBlankEntry(this.snapshot())) {
      await this.store.remove(this.entry.id);
    }
    this.entry = null;
    this.layers = [];
    this.selection = new Set();
    this.lifted = null;
    this.renderLayers();
    this.lastSurface = 'text';
    // Load the list before the view appears, so a stale list never flashes.
    const entries = await this.store.list();
    this.home.setEntries(entries);
    this.setView('home');
    this.writeRoute(HOME_ROUTE, mode);
    this.updateHomeChrome(entries.length);
  },

  async refreshHome() {
    const entries = await this.store.list();
    this.home.setEntries(entries);
    if (this.view === 'home') this.updateHomeChrome(entries.length);
  },

  updateHomeChrome(count) {
    this.renderEntryPath();
    this.dom.windowTitle.textContent = 'All entries';
    document.title = 'All entries · Quire';
    this.dom.statusDate.textContent = '';
    this.dom.words.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
    this.dom.mode.textContent = 'Library';
    this.dom.hint.textContent = '';
    this.showStatus('');
  },

  /** `mode` is 'push', 'replace', or 'none' (for back and forward, which already moved the history). */
  writeRoute(hash, mode) {
    if (mode === 'none' || (location.hash || HOME_ROUTE) === hash) return;
    if (mode === 'replace') history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  },

  async onRouteChange() {
    const id = routeEntryId(location.hash);
    if (id) {
      if (this.view !== 'editor' || this.entry?.id !== id) await this.openEntry(id, { history: 'none' });
    } else if (this.view !== 'home') {
      await this.showHome({ history: 'none' });
    }
  },

  renderInkChip() {
    this.dom.inkChip.style.setProperty('--fg', this.fg);
    this.dom.inkChip.style.setProperty('--bg', this.entry?.pageColor ?? DEFAULT_PAGE_COLOR);
  },
};
