/** Window chrome for the Quire controller: preferences, skin and accent, status text, and the title bar. Mixed into QuireApp. */

import { FONT_STACKS } from './constants.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { readingMinutes, wordCount } from '../markdown.js';
import { displayTitle, formatLongDate } from '../model.js';
import { openCustomEditor } from '../screensaver-editor.js';
import { CUSTOM_LIMIT, customKind, normalizeCustoms } from '../screensaver-custom.js';
import { forgetPrefs, savePrefs } from '../prefs.js';
import {
  ACCENT_PROPERTIES,
  accentTokens,
  normalizeAccent,
  isDark,
  skinOf,
} from '../skins.js';

export const chromeMethods = {
  // ---------- preferences and chrome ----------

  applyPrefs() {
    const root = document.documentElement;
    const skin = skinOf(this.prefs);
    root.dataset.skin = skin;
    root.dataset.theme = isDark(this.prefs) ? 'dark' : 'light';
    if (this.entry) this.rebuildInk();
    root.dataset.motion = this.prefs.motion === false ? 'off' : 'on';
    root.classList.toggle('typewriter', Boolean(this.prefs.typewriter));
    // A custom accent overrides the skin's selection and title bar colors. Without one, the skin's own colors show.
    const accent = accentTokens(this.prefs.accent);
    for (const name of ACCENT_PROPERTIES) {
      if (accent) root.style.setProperty(`--${name}`, accent[name]);
      else root.style.removeProperty(`--${name}`);
    }
    root.dataset.accent = accent ? 'custom' : 'skin';
    root.style.setProperty('--page-font', FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif);
    const source = Boolean(this.prefs.source);
    this.dom.editorEl.classList.toggle('is-source', source);
    this.dom.grid.hidden = !this.prefs.showGrid;
    if (this.view !== 'home') this.dom.mode.textContent = source ? 'Source' : 'Live preview';
    // Vista chrome: the Aero wallpaper, and the ribbon that can be minimized.
    root.classList.toggle('has-wallpaper', Boolean(this.prefs.wallpaper));
    this.home?.setStripOptions({
      showPrompts: Boolean(this.prefs.showPrompts),
      showOnThisDay: Boolean(this.prefs.showOnThisDay),
      showTips: !this.prefs.tipsDismissed,
      showGadgets: this.prefs.showGadgets !== false,
      gadgets: this.prefs.gadgets,
      name: this.prefs.name,
      showWelcome: this.prefs.showWelcome !== false,
      welcomeSeenDay: this.prefs.welcomeSeenDay,
      customPrompts: this.prefs.customPrompts,
    });
    const ribbonHidden = Boolean(this.prefs.ribbonHidden);
    this.dom.app.dataset.ribbon = ribbonHidden ? 'minimized' : 'shown';
    this.dom.ribbonToggle.innerHTML = icon(ribbonHidden ? 'chevronDown' : 'chevronUp');
    this.dom.ribbonToggle.setAttribute('aria-expanded', String(!ribbonHidden));
    this.dom.ribbonToggle.title = ribbonHidden ? 'Show the ribbon' : 'Minimize the ribbon';
    this.dom.ribbonToggle.setAttribute('aria-label', this.dom.ribbonToggle.title);
    // Focus mode: the ambient sound follows the sound setting, and the word goal follows Options.
    this.syncAmbient();
    this.refreshWordStatus();
  },

  /** The sticky note is sealed by the passcode lock like the rest of the store, so it waits a moment and writes once the typing pauses. */
  /** Saves the habit tracker's state. A failure is shown in the status bar. */
  saveHabits(state) {
    this.store?.setHabits(state).catch(() => this.showStatus('The habit tracker could not be saved.', true));
  },

  saveSavedSearches(list) {
    this.store?.setSavedSearches(list).catch(() => this.showStatus('The saved searches could not be saved.', true));
  },

  /**
   * Saved searches used to live in plain browser prefs, where the passcode lock
   * could not reach them. The first start after that change moves them into the
   * sealed store. The old copy is removed only after the store has taken it.
   */
  async loadSavedSearches() {
    const legacy = Array.isArray(this.prefs.savedSearches) ? this.prefs.savedSearches : null;
    let list = await this.store.getSavedSearches();
    if (legacy?.length && !list?.length) {
      list = legacy;
      await this.store.setSavedSearches(list);
    }
    if (legacy) this.prefs = forgetPrefs(['savedSearches']);
    return list ?? [];
  },

  saveSidebarNote(text) {
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.store?.setNote(text).catch(() => this.showStatus('The sticky note could not be saved.', true));
    }, 400);
  },

  setPref(patch) {
    this.prefs = savePrefs(patch);
    this.applyPrefs();
    this.requestSync();
  },

  async openOptions() {
    const { showOptions } = await import('../options.js');
    showOptions({
      get: () => this.prefs,
      set: (patch) => this.setPref(patch),
      pickAccent: (onChange) => this.pickAccent(onChange),
      onPreview: () => this.screensaver?.preview(),
      onCustomize: (id) => this.editCustomScreensaver(id),
    });
  },

  /**
   * Opens the editor for one custom screensaver, or a new one when `id` is null.
   * Options opens again when the editor closes, so its list is current.
   */
  editCustomScreensaver(id) {
    const customs = normalizeCustoms(this.prefs.screensavers);
    const config = id ? customs.find((item) => item.id === id) ?? null : null;
    const back = () => this.openOptions();
    openCustomEditor({
      config,
      getEntries: () => this.store.list(),
      onSave: (draft) => {
        const next = customs.some((item) => item.id === draft.id)
          ? customs.map((item) => (item.id === draft.id ? draft : item))
          : [...customs, draft].slice(0, CUSTOM_LIMIT);
        // A new screensaver becomes the one in use, so its first preview is what you see on idle.
        const patch = { screensavers: next };
        if (!config) patch.screensaver = customKind(draft.id);
        this.setPref(patch);
        back();
      },
      onDelete: (deletedId) => {
        const patch = { screensavers: customs.filter((item) => item.id !== deletedId) };
        if (this.prefs.screensaver === customKind(deletedId)) patch.screensaver = 'off';
        this.setPref(patch);
        back();
      },
      onCancel: back,
      onPreview: (draft, reopen) => this.screensaver?.preview(draft, reopen),
    });
  },

  /** Opens the system color chooser. Each change previews live and is saved as the custom accent. */
  pickAccent(onChange) {
    this.onAccentChange = onChange;
    if (!this.accentInput) {
      this.accentInput = el('input', { class: 'accent-picker', type: 'color', tabindex: '-1', 'aria-hidden': 'true' });
      this.accentInput.addEventListener('input', () => {
        const hex = normalizeAccent(this.accentInput.value);
        if (hex) {
          this.setPref({ accent: hex });
          this.onAccentChange?.();
        }
      });
      document.body.append(this.accentInput);
    }
    this.accentInput.value = normalizeAccent(this.prefs.accent) ?? '#2f6fbf';
    try {
      if (typeof this.accentInput.showPicker === 'function') this.accentInput.showPicker();
      else this.accentInput.click();
    } catch {
      this.accentInput.click();
    }
  },

  /** `state` drives the dot in the title bar: 'pending', 'saving', 'saved', 'error', or '' for a plain message. */
  showStatus(text, isError = false, state = isError ? 'error' : '') {
    this.dom.saveStatus.textContent = text;
    this.dom.saveStatus.classList.toggle('is-error', isError);
    this.dom.saveStatus.dataset.state = state;
    // The title bar is hidden in focus mode, so the save state also shows in the bar at the bottom.
    this.refreshWordStatus();
  },

  updateChrome() {
    // Only an open entry has a title and a word count. The entries list sets its own.
    if (!this.entry) return;
    const title = displayTitle({ title: this.dom.title.value.trim(), body: this.dom.editor.value });
    this.dom.windowTitle.textContent = title;
    document.title = `${title} · Quire`;
    this.dom.statusDate.textContent = this.entry ? formatLongDate(this.entry.date) : '';
    this.refreshWordStatus();
    this.renderEntryPath();
  },

  /** "120 words · 1 min read". The reading time is about 238 words a minute. */
  wordLabel(text) {
    const words = wordCount(text);
    if (!words) return '0 words';
    return `${words} ${words === 1 ? 'word' : 'words'} · ${readingMinutes(words)} min read`;
  },
};
