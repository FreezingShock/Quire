/**
 * Quire application controller. It wires the UI to the entry store, the drawing
 * layer, and the text editor. Text lives in a textarea (Markdown source) and
 * ink lives in a canvas laid over the sheet. The canvas has two layers: a base
 * canvas with every committed op, and the display canvas, which adds the stroke
 * in progress.
 */

import { createLocalStore } from './storage.js';
import {
  DEFAULT_PAGE_COLOR,
  MOODS,
  WEATHERS,
  createEntry,
  displayTitle,
  formatLongDate,
  isBlankEntry,
  isISODate,
  localISODate,
  newId,
  parseTags,
} from './model.js';
import { todaysJournal } from './journal.js';
import { countByNotebook } from './library.js';
import { readingMinutes, wordCount } from './markdown.js';
import { SKETCH_HEIGHT, mediaResolver, prepareImage } from './media.js';
import { LiveEditor } from './livetext.js';
import {
  BASE_LAYER,
  DEFAULT_TEXT_WIDTH,
  Drawing,
  InkStack,
  MAX_LAYERS,
  NORM_WIDTH,
  TEXT_FONTS,
  TEXT_SIZES,
  applyOp,
  hasInkOn,
  hitOp,
  inkExtent,
  layerOf,
  moveOp,
  newLayerId,
  normalizeLayers,
  opBounds,
  opsInRect,
  paintGrid,
  replayInk,
  resolveOps,
  sampleColor,
  strokeWidth,
  visibleLayerIds,
} from './drawing.js';
import { renderLayerPanel } from './layers.js';
import { shapeEnd, snapToGrid } from './snap.js';
import { FORMAT_BUTTONS, PALETTE, POINTER_TOOLS, SHAPE_TOOLS, STROKE_SIZES, TOOLS, TOOL_BY_KEY } from './tools.js';
import {
  blockInsertEdit,
  colorEdit,
  dividerEdit,
  enterEdit,
  insertEdit,
  toggleBlockEdit,
  wrapEdit,
} from './textops.js';
import { icon } from './icons.js';
import { el } from './dom.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { ACCENT_PROPERTIES, SKINS, accentTokens, normalizeAccent, skinOf } from './skins.js';
import { playSound } from './sound.js';
import {
  downloadBlob,
  exportDrawingPng,
  exportMarkdown,
  makeBackup,
  parseBackup,
  printEntry,
} from './export.js';
import { createMenuBar } from './menubar.js';
import { attachKeyboardPen } from './keypen.js';
import { confirmDialog, entriesDialog, notebookDialog, showAbout, showShortcuts } from './dialogs.js';
import { showOptions } from './options.js';
import { installState, promptInstall, showInstallHelp, startPwa, startReminders, REMINDER_DEFAULTS } from './pwa.js';
import { HomeView } from './home.js';
import { sampleEntry } from './onboarding.js';
import { MAX_VERSIONS, makeVersion, shouldKeepVersion } from './versions.js';
import { formatVersionTime, historyDialog } from './history.js';
import {
  FONT_STACKS,
  HOVER_SOUND_TARGETS,
  INCREMENTAL_OPS,
  NUDGE,
  NUDGE_FAST,
  SAVE_DELAY_MS,
  SIZE_LETTER_PX,
} from './controller/constants.js';
import { $, contentKey, fillSelect, formatTime, isTextTarget, penPressure, prevent } from './controller/helpers.js';
import { HOME_ROUTE, entryRoute, routeEntryId } from './controller/routes.js';

export class QuireApp {
  constructor() {
    this.dom = {
      windowTitle: $('#window-title'),
      titleWrap: $('#titlebar-entry'),
      saveStatus: $('#save-status'),
      menubar: $('#menubar'),
      ribbonToggle: $('#ribbon-toggle'),
      title: $('#entry-title'),
      date: $('#entry-date'),
      kind: $('#entry-kind'),
      mood: $('#entry-mood'),
      weather: $('#entry-weather'),
      tags: $('#entry-tags'),
      sheet: $('#sheet'),
      editorEl: $('#editor'),
      ink: $('#ink'),
      grid: $('#grid'),
      toolbox: $('#toolbox'),
      layers: null,
      swatches: $('#swatches'),
      inkChip: $('#ink-chip'),
      hint: $('#hint'),
      words: $('#status-words'),
      mode: $('#status-mode'),
      statusDate: $('#status-date'),
      app: $('.app'),
      home: $('#home'),
    };
    this.dom.editor = new LiveEditor(this.dom.editorEl, {
      onChange: () => this.onEditorChanged(),
      onHistory: (redo) => (redo ? this.redo() : this.undo()),
      onFiles: (files, range) => this.insertImages(files, range),
      inkStyle: () => ({ color: this.fg, size: this.size }),
    });
    this.prefs = loadPrefs();
    this.store = null;
    this.entry = null;
    this.drawing = new Drawing();
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.inkCtx = this.dom.ink.getContext('2d');
    this.gridCtx = this.dom.grid.getContext('2d');
    this.shiftHeld = false;
    this.rawEnd = null;
    this.scale = 1;
    this.tool = 'write';
    this.size = 3;
    this.fg = PALETTE[0];
    this.live = null;
    this.livePen = false;
    this.pointerId = null;
    this.stack = null; // per-layer canvases, rebuilt when the sheet size changes
    this.layers = [];
    this.activeLayer = BASE_LAYER;
    this.selection = new Set();
    this.selDrag = null; // { mode: 'marquee' | 'move', start, end } while a select drag runs
    this.lifted = null; // { ids, ops, dx, dy }: ops left off the base canvas while they are moved or edited
    this.textDraft = null; // { node, id, a, b, c, f, s, text } for the text box being typed
    this.index = null; // resolved ops and their bounds, rebuilt when the drawing changes
    this.lastSurface = 'text';
    this.saveTimer = 0;
    this.savedKey = null; // contentKey of the open entry as last written
    this.saveChain = Promise.resolve();
    this.frame = 0;
    this.syncFrame = 0;
    this.menubar = null;
    this.view = 'home'; // 'home' or 'editor'; the landing page is the entries list
    this.home = null;
  }

  async start() {
    fillSelect(this.dom.mood, MOODS, 'Not set');
    fillSelect(this.dom.weather, WEATHERS, 'Not set');
    this.applyPrefs();
    this.buildToolbox();
    this.buildSwatches();
    this.buildMenus();
    this.home = new HomeView(this.dom.home, {
      view: this.prefs.homeView,
      // applyPrefs runs before the view exists, so the saved card choices go in here too.
      showPrompts: Boolean(this.prefs.showPrompts),
      showOnThisDay: Boolean(this.prefs.showOnThisDay),
      showTips: !this.prefs.tipsDismissed,
      onOpen: (id) => this.openEntry(id),
      onNew: (options) => this.newEntry(options),
      onToday: () => this.openToday(),
      onWritePrompt: (prompt) => this.openToday({ prompt }),
      onHidePrompts: () => this.setPref({ showPrompts: false }),
      onDismissTips: () => this.setPref({ tipsDismissed: true }),
      onDelete: (id) => this.deleteEntry(id),
      onPatch: (id, fields) => this.patchEntry(id, fields),
      onViewChange: (view) => this.setPref({ homeView: view }),
    });
    this.bindEvents();
    this.setTool('write');
    this.store = await createLocalStore();
    if (this.store.kind === 'memory') {
      this.showStatus('Browser storage is unavailable. Entries will not survive a reload.', true);
    }
    startPwa({ onReady: () => this.showStatus('Quire is ready to work offline', false, 'saved') });
    startReminders({
      getReminder: () => this.prefs.reminder ?? REMINDER_DEFAULTS,
      saveReminder: (reminder) => this.setPref({ reminder }),
      hasEntryOn: async (day) => (await this.store.list()).some((entry) => entry.date === day),
    });
    await this.seedSampleEntry();
    // The site opens on the dashboard. A reload on an entry keeps that entry.
    const routed = routeEntryId(location.hash);
    const entries = await this.store.list();
    if (routed && entries.some((entry) => entry.id === routed)) {
      await this.openEntry(routed, { history: 'replace' });
    } else {
      await this.showHome({ history: 'replace' });
    }
  }

  /**
   * First run: a library with no entries gets one sample entry, once. The flag
   * is set on the first start whatever happens, so a deleted sample stays
   * deleted and a library that already has entries never gets one.
   */
  async seedSampleEntry() {
    if (this.prefs.sampleSeeded) return;
    this.prefs = savePrefs({ sampleSeeded: true });
    if ((await this.store.list()).length) return;
    await this.store.save(createEntry(sampleEntry(localISODate())));
  }

  // ---------- preferences and chrome ----------

  applyPrefs() {
    const root = document.documentElement;
    const skin = skinOf(this.prefs);
    root.dataset.skin = skin;
    root.dataset.theme = skin === 'aero-dark' ? 'dark' : 'light';
    root.dataset.motion = this.prefs.motion === false ? 'off' : 'on';
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
    });
    const ribbonHidden = Boolean(this.prefs.ribbonHidden);
    this.dom.app.dataset.ribbon = ribbonHidden ? 'minimized' : 'shown';
    this.dom.ribbonToggle.innerHTML = icon(ribbonHidden ? 'chevronDown' : 'chevronUp');
    this.dom.ribbonToggle.setAttribute('aria-expanded', String(!ribbonHidden));
    this.dom.ribbonToggle.title = ribbonHidden ? 'Show the ribbon' : 'Minimize the ribbon';
    this.dom.ribbonToggle.setAttribute('aria-label', this.dom.ribbonToggle.title);
  }

  setPref(patch) {
    this.prefs = savePrefs(patch);
    this.applyPrefs();
    this.requestSync();
  }

  openOptions() {
    showOptions({
      get: () => this.prefs,
      set: (patch) => this.setPref(patch),
      pickAccent: (onChange) => this.pickAccent(onChange),
    });
  }

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
  }

  /** `state` drives the dot in the title bar: 'pending', 'saving', 'saved', 'error', or '' for a plain message. */
  showStatus(text, isError = false, state = isError ? 'error' : '') {
    this.dom.saveStatus.textContent = text;
    this.dom.saveStatus.classList.toggle('is-error', isError);
    this.dom.saveStatus.dataset.state = state;
  }

  updateChrome() {
    const title = displayTitle({ title: this.dom.title.value.trim(), body: this.dom.editor.value });
    this.dom.windowTitle.textContent = title;
    document.title = `${title} · Quire`;
    this.dom.statusDate.textContent = this.entry ? formatLongDate(this.entry.date) : '';
    this.dom.words.textContent = this.wordLabel(this.dom.editor.value);
  }

  /** "120 words · 1 min read". The reading time is about 238 words a minute. */
  wordLabel(text) {
    const words = wordCount(text);
    if (!words) return '0 words';
    return `${words} ${words === 1 ? 'word' : 'words'} · ${readingMinutes(words)} min read`;
  }

  // ---------- views and routing ----------

  setView(view) {
    this.view = view;
    this.dom.app.dataset.view = view;
    this.keyPen?.refresh();
    if (view === 'editor') this.applyPrefs();
  }

  /** Saves the open entry, drops it if it is blank, and shows the entries list. */
  async showHome({ history: mode = 'push' } = {}) {
    this.commitTextDraft();
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
  }

  async refreshHome() {
    const entries = await this.store.list();
    this.home.setEntries(entries);
    if (this.view === 'home') this.updateHomeChrome(entries.length);
  }

  updateHomeChrome(count) {
    this.dom.windowTitle.textContent = 'All entries';
    document.title = 'All entries · Quire';
    this.dom.statusDate.textContent = '';
    this.dom.words.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
    this.dom.mode.textContent = 'Library';
    this.dom.hint.textContent = '';
    this.showStatus('');
  }

  /** `mode` is 'push', 'replace', or 'none' (for back and forward, which already moved the history). */
  writeRoute(hash, mode) {
    if (mode === 'none' || (location.hash || HOME_ROUTE) === hash) return;
    if (mode === 'replace') history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  }

  async onRouteChange() {
    const id = routeEntryId(location.hash);
    if (id) {
      if (this.view !== 'editor' || this.entry?.id !== id) await this.openEntry(id, { history: 'none' });
    } else if (this.view !== 'home') {
      await this.showHome({ history: 'none' });
    }
  }

  renderInkChip() {
    this.dom.inkChip.style.setProperty('--fg', this.fg);
    this.dom.inkChip.style.setProperty('--bg', this.entry?.pageColor ?? DEFAULT_PAGE_COLOR);
  }

  // ---------- building the UI ----------

  toolButton(tool) {
    const button = el('button', {
      class: 'tool-btn',
      type: 'button',
      'data-tool-id': tool.id,
      title: `${tool.label} (${tool.key})`,
      'aria-label': tool.label,
      'aria-pressed': 'false',
      onMousedown: prevent,
      onClick: () => this.setTool(tool.id),
    });
    button.innerHTML = icon(tool.icon);
    return button;
  }

  buildToolbox() {
    const tools = el('div', { class: 'tool-grid', role: 'group', 'aria-label': 'Tools' }, TOOLS.map((tool) => this.toolButton(tool)));
    const sizes = el('div', { class: 'size-row', role: 'radiogroup', 'aria-label': 'Stroke width', onKeydown: (event) => this.onSizeKeydown(event) }, STROKE_SIZES.map((size) =>
      el(
        'button',
        {
          class: 'size-btn',
          type: 'button',
          role: 'radio',
          'aria-label': `Stroke ${size}`,
          'aria-checked': String(size === this.size),
          // Only the chosen width is in the Tab order; arrow keys move between the others.
          tabindex: size === this.size ? '0' : '-1',
          'data-size': size,
          onMousedown: prevent,
          onClick: () => this.setSize(size),
        },
        el('span', { style: `height: ${size}px` }),
      ),
    ));
    const format = el(
      'div',
      { class: 'format-grid', role: 'group', 'aria-label': 'Text formatting' },
      FORMAT_BUTTONS.map((item) =>
        el(
          'button',
          {
            class: `format-btn ${item.cls ?? ''}`.trim(),
            type: 'button',
            title: item.label,
            'aria-label': item.label,
            onMousedown: prevent,
            onClick: () => this.applyFormat(item.id),
          },
          item.text,
        ),
      ),
    );
    this.dom.layers = el('div', { class: 'layer-panel', 'aria-label': 'Layers' });
    this.dom.toolbox.replaceChildren(tools, sizes, format, this.dom.layers);
    this.renderLayers();
  }

  /** Mirrors the layer list into the toolbox panel. */
  renderLayers() {
    if (!this.dom.layers) return;
    renderLayerPanel(
      this.dom.layers,
      { layers: this.layers, activeId: this.activeLayer, enabled: Boolean(this.entry) },
      {
        onSelect: (id) => this.selectLayer(id),
        onToggle: (id) => this.toggleLayer(id),
        onRename: (id, name) => this.renameLayer(id, name),
        onMove: (id, dir) => this.moveLayer(id, dir),
        onAdd: () => this.addLayer(),
        onDelete: (id) => this.deleteLayer(id),
      },
    );
  }

  buildSwatches() {
    this.dom.swatches.replaceChildren(
      ...PALETTE.map((hex) =>
        el('button', {
          class: 'swatch',
          type: 'button',
          title: `${hex}: click for ink, right-click for page color`,
          'aria-label': `Color ${hex}`,
          style: `background: ${hex}`,
          onMousedown: prevent,
          onClick: () => this.pickColor(hex),
          onContextmenu: (event) => {
            event.preventDefault();
            this.setPageColor(hex);
          },
        }),
      ),
    );
  }

  buildMenus() {
    const menus = [
      {
        label: 'File',
        items: () => [
          { label: 'All entries', shortcut: 'Ctrl+Shift+H', action: () => this.showHome() },
          'sep',
          { label: 'New entry', shortcut: 'Ctrl+N', action: () => this.newEntry() },
          { label: "Today's entry", shortcut: 'Alt+T', action: () => this.openToday() },
          { label: 'Open entry…', shortcut: 'Ctrl+O', action: () => this.showEntries() },
          { label: 'Delete entry…', disabled: !this.entry, action: () => this.entry && this.deleteEntry(this.entry.id) },
          'sep',
          { label: 'Move to notebook…', disabled: !this.entry, action: () => this.entry && this.moveEntryToNotebook(this.entry.id) },
          {
            label: this.entry?.pinned ? 'Unpin from top' : 'Pin to top',
            disabled: !this.entry,
            action: () => this.entry && this.patchEntry(this.entry.id, { pinned: !this.entry.pinned }),
          },
          {
            label: this.entry?.favorite ? 'Remove from favorites' : 'Add to favorites',
            disabled: !this.entry,
            action: () => this.entry && this.patchEntry(this.entry.id, { favorite: !this.entry.favorite }),
          },
          'sep',
          { label: 'Save now', shortcut: 'Ctrl+S', action: () => this.persist() },
          { label: 'Save version now', disabled: !this.entry, action: () => this.saveVersionNow() },
          { label: 'Version history…', disabled: !this.entry, action: () => this.showVersions() },
          'sep',
          { label: 'Export as Markdown…', shortcut: 'Ctrl+E', disabled: !this.entry, action: () => this.exportMarkdown() },
          { label: 'Export drawing as PNG…', disabled: !this.entry || this.drawing.isEmpty, action: () => this.exportDrawing() },
          { label: 'Print or save as PDF…', shortcut: 'Ctrl+P', disabled: !this.entry, action: () => this.printPdf() },
          'sep',
          { label: 'Back up all entries…', action: () => this.backup() },
          { label: 'Restore from backup…', action: () => this.restore() },
          ...(installState() === 'installed' ? [] : ['sep', { label: 'Install Quire…', action: () => this.installQuire() }]),
        ],
      },
      {
        label: 'Edit',
        items: () => [
          { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.undo() },
          { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => this.redo() },
          'sep',
          {
            label: 'Select all text',
            shortcut: 'Ctrl+A',
            action: () => {
              this.prepareEditing();
              this.dom.editor.select();
            },
          },
          'sep',
          { label: 'Delete selection', shortcut: 'Del', disabled: !this.selection.size, action: () => this.deleteSelection() },
          { label: 'Clear current layer', disabled: !this.entry || !hasInkOn(this.drawing.ops, this.activeLayer), action: () => this.clearInk(this.activeLayer) },
          { label: 'Clear all layers', disabled: this.drawing.isEmpty, action: () => this.clearInk() },
        ],
      },
      {
        label: 'Format',
        items: () => [
          { label: 'Heading 1', action: () => this.applyFormat('h1') },
          { label: 'Heading 2', action: () => this.applyFormat('h2') },
          { label: 'Heading 3', action: () => this.applyFormat('h3') },
          { label: 'Quote', action: () => this.applyFormat('quote') },
          { label: 'Bulleted list', action: () => this.applyFormat('ul') },
          { label: 'Numbered list', action: () => this.applyFormat('ol') },
          { label: 'Checklist', action: () => this.applyFormat('task') },
          { label: 'Divider', action: () => this.applyFormat('divider') },
          'sep',
          { label: 'Bold', shortcut: 'Ctrl+B', action: () => this.applyFormat('bold') },
          { label: 'Italic', shortcut: 'Ctrl+I', action: () => this.applyFormat('italic') },
          'sep',
          { label: 'Swap ink and page color', action: () => this.swapInkAndPage() },
          { label: 'Reset page color', action: () => this.setPageColor(DEFAULT_PAGE_COLOR) },
          { label: 'Reset ink color', action: () => this.setInk(PALETTE[0]) },
        ],
      },
      {
        label: 'Insert',
        items: () => [
          { label: 'Image…', disabled: !this.entry, action: () => this.pickImages() },
          { label: 'Sketch between paragraphs', disabled: !this.entry, action: () => this.insertSketch() },
          'sep',
          { label: 'Today’s date', action: () => this.insertText(formatLongDate(localISODate())) },
          { label: 'Current time', action: () => this.insertText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) },
        ],
      },
      {
        label: 'View',
        items: () => [
          { label: 'Source mode', check: true, checked: Boolean(this.prefs.source), action: () => this.setPref({ source: !this.prefs.source }) },
          'sep',
          { label: 'Show grid', check: true, checked: Boolean(this.prefs.showGrid), action: () => this.setPref({ showGrid: !this.prefs.showGrid }) },
          { label: 'Snap to grid', check: true, checked: Boolean(this.prefs.snapGrid), action: () => this.setPref({ snapGrid: !this.prefs.snapGrid }) },
          'sep',
          { label: 'Options…', shortcut: 'Ctrl+,', action: () => this.openOptions() },
        ],
      },
      {
        label: 'Skin',
        items: () => {
          const current = skinOf(this.prefs);
          return SKINS.map((skin) => ({
            label: skin.label,
            check: true,
            checked: current === skin.id,
            action: () => this.setPref({ skin: skin.id }),
          }));
        },
      },
      {
        label: 'Help',
        items: () => [
          { label: 'Keyboard shortcuts', shortcut: 'F1', action: () => showShortcuts() },
          { label: 'About Quire', action: () => showAbout() },
        ],
      },
    ];
    this.menubar = createMenuBar(this.dom.menubar, menus);
  }

  bindEvents() {
    const { editor, editorEl, title, date, kind, mood, weather, tags, ink, sheet } = this.dom;
    this.dom.ribbonToggle.addEventListener('click', () => this.setPref({ ribbonHidden: !this.prefs.ribbonHidden }));
    editorEl.addEventListener('keydown', (event) => this.onEditorKeydown(event));
    this.dom.windowTitle.addEventListener('click', () => this.startRename());
    // The rename field lives in the title bar. Its focus state drives the animation.
    title.addEventListener('focus', () => {
      this.renameStart = title.value;
      this.dom.titleWrap.classList.add('is-renaming');
    });
    title.addEventListener('blur', () => this.dom.titleWrap.classList.remove('is-renaming'));
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        editor.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        title.value = this.renameStart ?? title.value;
        this.onFieldChanged();
        editor.focus();
      }
    });
    title.addEventListener('input', () => this.onFieldChanged());
    date.addEventListener('input', () => this.onFieldChanged());
    kind.addEventListener('change', () => this.onFieldChanged());
    mood.addEventListener('change', () => this.onFieldChanged());
    weather.addEventListener('change', () => this.onFieldChanged());
    tags.addEventListener('input', () => this.onFieldChanged());

    ink.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    ink.addEventListener('pointermove', (event) => this.onPointerMove(event));
    ink.addEventListener('pointerup', (event) => this.onPointerUp(event));
    ink.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    // Keyboard drawing: arrows move the pen over the page, Space puts it down. See keypen.js.
    this.keyPen = attachKeyboardPen(ink, {
      isEnabled: () => Boolean(this.entry) && POINTER_TOOLS.has(this.tool),
      getTool: () => this.tool,
      skipArrows: () => this.tool === 'select' && this.selection.size > 0,
      describe: (on) =>
        on
          ? `Drawing page, ${TOOLS.find((tool) => tool.id === this.tool)?.label ?? 'drawing'} tool. Arrow keys move the pen, Space or Enter puts it down and lifts it, Escape lifts it.`
          : 'Drawing layer. Pick a drawing tool to draw on the page.',
    });

    // Pageless: a click on the empty space under the text continues at the end, so a line break is always one Enter away.
    sheet.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.tool !== 'write' || event.target.closest('#editor')) return;
      event.preventDefault();
      const end = this.dom.editor.value.length;
      this.dom.editor.setSelectionRange(end, end);
      this.dom.editor.focus({ preventScroll: true });
    });

    new ResizeObserver(() => this.requestSync()).observe(sheet);
    document.addEventListener('keydown', (event) => this.onGlobalKeydown(event));
    // Shift can be pressed or released mid-drag, so a shape follows it live.
    const trackShift = (event) => {
      if (this.shiftHeld === event.shiftKey) return;
      this.shiftHeld = event.shiftKey;
      if (this.live && SHAPE_TOOLS.has(this.live.t)) {
        this.updateShapeEnd();
        this.requestRedraw();
      }
    };
    document.addEventListener('keydown', trackShift);
    document.addEventListener('keyup', trackShift);
    // A file dropped outside the text should not make the browser open it in place of the page.
    // A faint tick as the mouse reaches a button or a tile, when sound effects are on.
    let hovered = null;
    document.addEventListener(
      'pointerover',
      (event) => {
        const target = event.pointerType === 'mouse' && event.target instanceof Element ? event.target.closest(HOVER_SOUND_TARGETS) : null;
        if (target === hovered) return;
        hovered = target;
        if (target) playSound('hover');
      },
      { passive: true },
    );
    const dragsFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    window.addEventListener('dragover', (event) => {
      if (dragsFiles(event)) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (dragsFiles(event)) event.preventDefault();
    });
    this.imageInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-hidden': 'true' });
    this.imageInput.addEventListener('change', () => {
      const files = Array.from(this.imageInput.files ?? []);
      this.imageInput.value = '';
      if (files.length) this.insertImages(files, this.pendingRange);
    });
    document.body.append(this.imageInput);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
    window.addEventListener('pagehide', () => this.persist());
    window.addEventListener('popstate', () => this.onRouteChange());
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
      this.showStatus(`Something went wrong: ${event.reason?.message ?? event.reason}`, true);
    });
  }

  // ---------- tools and modes ----------

  setTool(id) {
    this.commitTextDraft();
    this.tool = id;
    this.dom.ink.dataset.tool = id;
    for (const button of this.dom.toolbox.querySelectorAll('[data-tool-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.toolId === id));
    }
    this.keyPen?.refresh();
    const tool = TOOLS.find((item) => item.id === id);
    this.dom.hint.textContent = tool?.hint ?? '';
    if (id !== 'select' && this.selection.size) {
      this.selection = new Set();
      this.requestRedraw();
    }
    this.renderSizeRow();
    // Picking a drawing tool takes focus out of any text field, so tool keys work and letters are not typed.
    if (id === 'write') this.dom.editor.focus({ preventScroll: true });
    else if (isTextTarget(document.activeElement)) document.activeElement.blur();
  }

  setSize(size) {
    this.size = size;
    for (const button of this.dom.toolbox.querySelectorAll('[data-size]')) {
      const selected = Number(button.dataset.size) === size;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  /** Arrow keys move through the stroke widths and pick the new one, as in a radio group. */
  onSizeKeydown(event) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const index = STROKE_SIZES.indexOf(this.size);
    const next = STROKE_SIZES[(index + step + STROKE_SIZES.length) % STROKE_SIZES.length];
    this.setSize(next);
    this.dom.toolbox.querySelector(`[data-size="${next}"]`)?.focus();
  }

  /** The size row means stroke width for drawing tools and font size for the text box tool. */
  renderSizeRow() {
    const textMode = this.tool === 'text';
    const row = this.dom.toolbox.querySelector('.size-row');
    if (!row) return;
    row.classList.toggle('is-text', textMode);
    for (const button of row.querySelectorAll('[data-size]')) {
      const size = Number(button.dataset.size);
      button.setAttribute('aria-label', textMode ? `Text size ${size}` : `Stroke ${size}`);
      button.title = textMode ? 'Text size' : 'Stroke width';
      const bar = button.querySelector('span');
      if (textMode) {
        bar.className = 'size-letter';
        bar.style.height = '';
        bar.style.fontSize = `${SIZE_LETTER_PX[size] ?? 14}px`;
        bar.textContent = 'A';
      } else {
        bar.className = '';
        bar.style.height = `${size}px`;
        bar.style.fontSize = '';
        bar.textContent = '';
      }
    }
  }

  /** Clicking the entry name in the title bar swaps it for the rename field. */
  startRename() {
    if (!this.entry) return;
    // The field is hidden until the class is set, so set it before focusing.
    this.dom.titleWrap.classList.add('is-renaming');
    this.dom.title.focus();
    this.dom.title.select();
  }

  /** Switches to the Write tool so the text can take input. */
  prepareEditing() {
    this.setTool('write');
  }

  setInk(hex) {
    this.fg = hex;
    this.renderInkChip();
  }

  setPageColor(hex) {
    if (!this.entry) return;
    this.entry.pageColor = hex;
    this.dom.sheet.style.backgroundColor = hex;
    this.renderInkChip();
    this.scheduleSave();
  }

  swapInkAndPage() {
    if (!this.entry) return;
    const oldPage = this.entry.pageColor;
    this.setPageColor(this.fg);
    this.setInk(oldPage);
  }

  /** Swatch click: colors the selected text if there is any, and sets the ink. */
  pickColor(hex) {
    const ta = this.dom.editor;
    if (this.tool === 'write' && ta.selectionStart !== ta.selectionEnd) {
      const edit = colorEdit(ta.value, ta.selectionStart, ta.selectionEnd, hex);
      if (edit) this.applyEdit(edit);
    }
    this.setInk(hex);
  }

  // ---------- text editing ----------

  /** Applies an edit description from textops.js. The editor keeps its own undo history. */
  applyEdit({ from, to, insert, selStart, selEnd }) {
    const ta = this.dom.editor;
    ta.focus({ preventScroll: true });
    ta.setRangeText(insert, from, to);
    ta.setSelectionRange(selStart, selEnd);
  }

  applyFormat(kind) {
    this.prepareEditing();
    const ta = this.dom.editor;
    const { value, selectionStart: s, selectionEnd: e } = ta;
    let edit;
    if (kind === 'bold') edit = wrapEdit(value, s, e, '**', '**');
    else if (kind === 'italic') edit = wrapEdit(value, s, e, '*', '*');
    else if (kind === 'divider') edit = dividerEdit(value, s, e);
    else edit = toggleBlockEdit(value, s, e, kind);
    this.applyEdit(edit);
  }

  insertText(text) {
    this.prepareEditing();
    const ta = this.dom.editor;
    this.applyEdit(insertEdit(ta.selectionStart, ta.selectionEnd, text));
  }

  /** Menu: opens the file picker, remembering where the text caret is. */
  pickImages() {
    if (!this.entry) return;
    this.prepareEditing();
    const ta = this.dom.editor;
    this.pendingRange = { start: ta.selectionStart, end: ta.selectionEnd };
    this.imageInput.click();
  }

  /**
   * Adds picked, pasted or dropped pictures to the entry and places a reference
   * line for each at `range`. The bytes are stored on the entry, not in the text.
   */
  async insertImages(files, range = null) {
    const entry = this.entry;
    if (!entry) return;
    const refs = [];
    for (const file of files) {
      try {
        const { src, alt } = await prepareImage(file);
        if (this.entry !== entry) return; // The entry was switched while the picture was read.
        const id = newId();
        entry.images[id] = src;
        refs.push(`![${alt}](quire-image:${id})`);
      } catch (error) {
        this.showStatus(`Could not add ${file.name || 'that picture'}: ${error.message}`, true);
      }
    }
    if (!refs.length || this.entry !== entry) return;
    const ta = this.dom.editor;
    const from = Math.min(range?.start ?? ta.selectionStart, ta.value.length);
    const to = Math.min(Math.max(from, range?.end ?? from), ta.value.length);
    this.applyEdit(blockInsertEdit(ta.value, from, to, refs.join('\n')));
    this.showStatus(refs.length === 1 ? 'Picture added' : `${refs.length} pictures added`);
  }

  /** Menu: a blank sketch on its own line between the paragraphs at the caret. */
  insertSketch() {
    if (!this.entry) return;
    this.prepareEditing();
    const id = newId();
    this.entry.sketches[id] = { h: SKETCH_HEIGHT, ops: [] };
    const ta = this.dom.editor;
    this.applyEdit(blockInsertEdit(ta.value, ta.selectionStart, ta.selectionEnd, `![Sketch](quire-sketch:${id})`));
  }

  onEditorChanged() {
    this.lastSurface = 'text';
    this.updateChrome();
    this.scheduleSave();
  }

  onEditorKeydown(event) {
    const ta = this.dom.editor;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && ta.selectionStart === ta.selectionEnd) {
      const edit = enterEdit(ta.value, ta.selectionStart);
      if (edit) {
        event.preventDefault();
        this.applyEdit(edit);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        this.applyFormat(key === 'b' ? 'bold' : 'italic');
      }
    }
  }

  onFieldChanged() {
    if (!this.entry) return;
    this.entry.title = this.dom.title.value.slice(0, 120);
    if (isISODate(this.dom.date.value)) this.entry.date = this.dom.date.value;
    this.entry.kind = this.dom.kind.value;
    this.entry.mood = this.dom.mood.value || null;
    this.entry.weather = this.dom.weather.value || null;
    this.entry.tags = parseTags(this.dom.tags.value);
    this.updateChrome();
    this.scheduleSave();
  }

  // ---------- drawing ----------

  requestSync() {
    if (this.syncFrame) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.syncCanvas();
    });
  }

  /** Resize the canvases to the sheet. A size change makes new layer canvases and replays the ops. */
  syncCanvas() {
    const { sheet, ink } = this.dom;
    const cssW = sheet.clientWidth;
    const cssH = sheet.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    const resized = this.base.width !== w || this.base.height !== h;
    if (resized) {
      this.base.width = w;
      this.base.height = h;
      ink.width = w;
      ink.height = h;
      this.dom.grid.width = w;
      this.dom.grid.height = h;
      this.stack = new InkStack(w, h);
    }
    this.scale = w / NORM_WIDTH;
    if (resized) this.rebuildInk();
    if (this.prefs.showGrid) paintGrid(this.gridCtx, this.scale);
    this.positionTextDraft();
    this.redraw();
  }

  /** Replays every op into the layer stack, then composites the visible layers onto the base canvas. */
  rebuildInk() {
    if (!this.stack) return;
    this.stack.setLayers(this.layers.map((layer) => layer.id));
    this.stack.reset();
    replayInk(this.stack, this.drawing.ops, this.scale, this.lifted?.ids ?? null);
    this.stack.composite(this.baseCtx, visibleLayerIds(this.layers));
    this.redraw();
  }

  /** Resolved ops with their bounds. Cached until the drawing changes. */
  inkIndex() {
    if (this.index?.drawing === this.drawing && this.index.version === this.drawing.version) return this.index;
    const ops = resolveOps(this.drawing.ops);
    const bounds = new Map();
    for (const op of ops) {
      const box = opBounds(op);
      if (box) bounds.set(op.id, box);
    }
    this.index = { drawing: this.drawing, version: this.drawing.version, ops, bounds };
    return this.index;
  }

  /** Ops on visible layers only. Selection and hit tests use these. */
  visibleOps() {
    const visible = new Set(visibleLayerIds(this.layers));
    return this.inkIndex().ops.filter((op) => visible.has(layerOf(op)));
  }

  /** Device-pixel scale of the drawing layer on screen, for placing the text field. */
  inkCssScale() {
    const width = this.dom.ink.getBoundingClientRect().width;
    return width ? width / NORM_WIDTH : 1;
  }

  redraw() {
    const ctx = this.inkCtx;
    ctx.clearRect(0, 0, this.dom.ink.width, this.dom.ink.height);
    ctx.drawImage(this.base, 0, 0);
    if (this.lifted?.ops.length) {
      const { dx, dy } = this.lifted;
      for (const op of this.lifted.ops) applyOp(ctx, moveOp(op, dx, dy), this.scale);
    }
    if (this.live) {
      if (this.live.t === 'textbox') this.dashedBox(ctx, this.live.a, this.live.b);
      else applyOp(ctx, this.live, this.scale);
    }
    this.drawSelectionFrame(ctx);
  }

  requestRedraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.redraw();
    });
  }

  /** Dashed Paint-style box between two points in normalized units. */
  dashedBox(ctx, a, b) {
    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.min(a[0], b[0]) * s;
    const y0 = Math.min(a[1], b[1]) * s;
    const x1 = Math.max(a[0], b[0]) * s;
    const y1 = Math.max(a[1], b[1]) * s;
    ctx.save();
    ctx.strokeStyle = '#2b5797';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    ctx.restore();
  }

  /** Dashed boxes around the selected ops, and the marquee while it is dragged. */
  drawSelectionFrame(ctx) {
    const marquee = this.selDrag?.mode === 'marquee';
    if (!this.selection.size && !marquee) return;
    const s = this.scale;
    const { bounds } = this.inkIndex();
    const dx = this.lifted?.dx ?? 0;
    const dy = this.lifted?.dy ?? 0;
    for (const id of this.selection) {
      const box = bounds.get(id);
      if (!box) continue;
      const moved = this.lifted?.ids.has(id);
      const ox = moved ? dx : 0;
      const oy = moved ? dy : 0;
      this.dashedBox(ctx, [box[0] + ox - 3, box[1] + oy - 3], [box[2] + ox + 3, box[3] + oy + 3]);
    }
    if (marquee) this.dashedBox(ctx, [this.selDrag.start.x, this.selDrag.start.y], [this.selDrag.end.x, this.selDrag.end.y]);
  }

  /** Records an op on the drawing and brings the canvas up to date. Drawing ops are added in place; the rest replay. */
  commit(op) {
    this.drawing.commit(op);
    this.lastSurface = 'ink';
    if (INCREMENTAL_OPS.has(op.t) && this.stack && !this.lifted) {
      this.stack.apply(op, this.scale);
      this.stack.composite(this.baseCtx, visibleLayerIds(this.layers));
      this.redraw();
    } else {
      this.rebuildInk();
    }
    this.scheduleSave();
    return op;
  }

  undoInk() {
    if (!this.drawing.undo()) return;
    this.rebuildInk();
    this.scheduleSave();
  }

  redoInk() {
    if (!this.drawing.redo()) return;
    this.rebuildInk();
    this.scheduleSave();
  }

  /** Clears one layer when `layer` is given, otherwise every layer. Undoable. */
  clearInk(layer) {
    if (this.drawing.isEmpty) return;
    this.commit(layer === undefined ? { t: 'clear' } : { t: 'clear', l: layer });
  }

  /** Undo follows the surface you touched last: ink or text. */
  undo() {
    this.commitTextDraft();
    if (this.lastSurface === 'ink' && this.drawing.canUndo) {
      this.undoInk();
      return;
    }
    this.dom.editor.undo();
  }

  redo() {
    this.commitTextDraft();
    if (this.lastSurface === 'ink' && this.drawing.canRedo) {
      this.redoInk();
      return;
    }
    this.dom.editor.redo();
  }

  pointFromEvent(event) {
    const rect = this.dom.ink.getBoundingClientRect();
    const f = NORM_WIDTH / rect.width;
    return {
      x: Math.round((event.clientX - rect.left) * f * 10) / 10,
      y: Math.round((event.clientY - rect.top) * f * 10) / 10,
    };
  }

  capturePointer(event) {
    try {
      this.dom.ink.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; drawing still works without it.
    }
    this.pointerId = event.pointerId;
  }

  onPointerDown(event) {
    if (event.button !== 0 || !POINTER_TOOLS.has(this.tool) || !this.entry) return;
    const p = this.pointFromEvent(event);
    if (this.tool === 'pick') {
      const hex = sampleColor(this.baseCtx, p.x * this.scale, p.y * this.scale) ?? this.entry?.pageColor ?? DEFAULT_PAGE_COLOR;
      this.setInk(hex);
      return;
    }
    if (this.tool === 'select') {
      event.preventDefault(); // keeps the editor from taking focus or selecting text under the sheet
      this.shiftHeld = event.shiftKey;
      this.capturePointer(event);
      this.beginSelect(event, p);
      return;
    }
    if (this.tool === 'text') {
      // Without this, the mousedown focus change blurs the text field as soon as it opens.
      event.preventDefault();
      this.commitTextDraft();
      this.capturePointer(event);
      this.beginText(p);
      return;
    }
    this.ensureActiveVisible();
    if (this.tool === 'fill') {
      this.commit({ t: 'fill', l: this.activeLayer, c: this.fg, at: [p.x, p.y] });
      return;
    }
    this.capturePointer(event);
    this.shiftHeld = event.shiftKey;
    this.rawEnd = [p.x, p.y];
    const w = Math.round(strokeWidth(this.tool, this.size) * 100) / 100;
    // With snap to grid on, a drag starts on the nearest grid node.
    const start = this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
    // Only pen input records pressure, and the highlighter ignores it, so mouse and touch strokes stay as they were.
    this.livePen = event.pointerType === 'pen' && this.tool !== 'marker';
    this.live = SHAPE_TOOLS.has(this.tool)
      ? { t: this.tool, l: this.activeLayer, c: this.fg, w, a: start, b: start }
      : { t: 'stroke', l: this.activeLayer, tool: this.tool, c: this.fg, w, p: [this.livePen ? [...start, penPressure(event)] : start] };
    this.requestRedraw();
  }

  constraints() {
    return { shift: this.shiftHeld, grid: Boolean(this.prefs.snapGrid), angles: Boolean(this.prefs.snapAngles) };
  }

  /** Recomputes a shape's end from the raw pointer, so Shift and snapping apply at every move. */
  updateShapeEnd() {
    if (!this.live || !SHAPE_TOOLS.has(this.live.t) || !this.rawEnd) return;
    this.live.b = shapeEnd(this.live.t, this.live.a, this.rawEnd, this.constraints());
  }

  onPointerMove(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
    if (this.selDrag) {
      this.updateSelectDrag(this.pointFromEvent(event));
      this.requestRedraw();
      return;
    }
    if (!this.live) return;
    if (this.live.t === 'stroke') {
      const pts = this.live.p;
      const coalesced = event.getCoalescedEvents?.() ?? [];
      for (const sample of coalesced.length ? coalesced : [event]) {
        const p = this.pointFromEvent(sample);
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) >= 0.5) {
          pts.push(this.livePen ? [p.x, p.y, penPressure(sample)] : [p.x, p.y]);
        }
      }
    } else if (this.live.t === 'textbox') {
      const p = this.pointFromEvent(event);
      this.live.b = this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
    } else {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    this.requestRedraw();
  }

  onPointerUp(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
    this.pointerId = null;
    try {
      if (this.dom.ink.hasPointerCapture(event.pointerId)) this.dom.ink.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore: the pointer was already released.
    }
    if (this.selDrag) {
      this.finishSelectDrag();
      return;
    }
    if (!this.live) return;
    if (this.live.t === 'textbox') {
      this.finishTextBox();
      return;
    }
    if (SHAPE_TOOLS.has(this.live.t)) {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    const op = this.live;
    this.live = null;
    this.rawEnd = null;
    if (op.t !== 'stroke' && op.a[0] === op.b[0] && op.a[1] === op.b[1]) {
      this.redraw();
      return;
    }
    this.commit(op);
  }

  // ---------- select and move ----------

  /** A press on an op selects it and starts a move. A press on empty page starts a marquee. */
  beginSelect(event, p) {
    const hit = hitOp(this.visibleOps(), [p.x, p.y]);
    if (hit) {
      if (!this.selection.has(hit.id)) {
        if (!event.shiftKey) this.selection = new Set();
        this.selection.add(hit.id);
      }
      this.startMove(p);
    } else {
      if (!event.shiftKey) this.selection = new Set();
      this.selDrag = { mode: 'marquee', start: p, end: p, base: new Set(this.selection) };
    }
    this.requestRedraw();
  }

  /** Lifts the selected ops off the base canvas so the drag can show them moving. */
  startMove(p) {
    const ids = new Set(this.selection);
    const ops = this.visibleOps().filter((op) => ids.has(op.id));
    this.lifted = { ids, ops, dx: 0, dy: 0 };
    this.selDrag = { mode: 'move', start: p, end: p };
    this.rebuildInk();
  }

  updateSelectDrag(p) {
    const drag = this.selDrag;
    drag.end = p;
    if (drag.mode === 'move') {
      this.lifted.dx = p.x - drag.start.x;
      this.lifted.dy = p.y - drag.start.y;
      return;
    }
    const rect = [
      Math.min(drag.start.x, p.x),
      Math.min(drag.start.y, p.y),
      Math.max(drag.start.x, p.x),
      Math.max(drag.start.y, p.y),
    ];
    this.selection = new Set([...drag.base, ...opsInRect(this.visibleOps(), rect)]);
  }

  finishSelectDrag() {
    const drag = this.selDrag;
    this.selDrag = null;
    if (drag.mode === 'marquee') {
      this.requestRedraw();
      return;
    }
    const { ids, dx, dy } = this.lifted;
    this.lifted = null;
    if (dx || dy) this.commit({ t: 'move', ids: [...ids], dx, dy });
    else this.rebuildInk();
  }

  deleteSelection() {
    if (!this.selection.size || !this.entry) return;
    const ids = [...this.selection];
    this.selection = new Set();
    this.commit({ t: 'delete', ids });
  }

  nudgeSelection(dx, dy) {
    if (!this.selection.size || !this.entry) return;
    this.commit({ t: 'move', ids: [...this.selection], dx, dy });
  }

  // ---------- text boxes ----------

  /** Pressing empty page starts a box. Pressing existing text edits it. */
  beginText(p) {
    this.ensureActiveVisible();
    const hit = hitOp(this.visibleOps().filter((op) => op.t === 'text'), [p.x, p.y]);
    if (hit) {
      this.startTextEdit(hit);
      return;
    }
    const start = this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
    this.live = { t: 'textbox', a: start, b: start };
    this.requestRedraw();
  }

  finishTextBox() {
    const { a, b } = this.live;
    this.live = null;
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const width = x1 - x0 < 40 ? DEFAULT_TEXT_WIDTH : x1 - x0;
    const font = TEXT_FONTS[this.prefs.font] ? this.prefs.font : 'serif';
    this.openTextDraft({
      id: null,
      a: [x0, a[1]],
      b: [x0 + width, a[1]],
      c: this.fg,
      f: font,
      s: TEXT_SIZES[this.size] ?? TEXT_SIZES[3],
      text: '',
    });
    this.requestRedraw();
  }

  startTextEdit(op) {
    this.lifted = { ids: new Set([op.id]), ops: [], dx: 0, dy: 0 };
    this.openTextDraft({ id: op.id, a: op.a, b: op.b, c: op.c, f: op.f ?? 'serif', s: op.s, text: op.text ?? '' });
    this.rebuildInk();
  }

  openTextDraft(draft) {
    const node = el('textarea', {
      class: 'text-draft',
      rows: 1,
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': 'Text box',
      onKeydown: (event) => this.onTextDraftKeydown(event),
      onInput: () => this.sizeTextDraft(),
      onBlur: () => this.commitTextDraft(),
    });
    node.value = draft.text;
    this.dom.sheet.append(node);
    this.textDraft = { ...draft, node };
    this.positionTextDraft();
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }

  /** Puts the text field over its box, at the same size and font the canvas uses. */
  positionTextDraft() {
    const draft = this.textDraft;
    if (!draft) return;
    const f = this.inkCssScale();
    const { node } = draft;
    node.style.left = `${draft.a[0] * f}px`;
    node.style.top = `${draft.a[1] * f}px`;
    node.style.width = `${Math.max(60, Math.abs(draft.b[0] - draft.a[0])) * f}px`;
    node.style.fontSize = `${draft.s * f}px`;
    node.style.fontFamily = TEXT_FONTS[draft.f] ?? TEXT_FONTS.serif;
    node.style.color = draft.c;
    this.sizeTextDraft();
  }

  sizeTextDraft() {
    const node = this.textDraft?.node;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }

  onTextDraftKeydown(event) {
    // The field keeps every key, including Ctrl+Z, so typing never reaches the shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) {
      event.preventDefault();
      this.commitTextDraft();
    }
  }

  /** Writes the typed text to the drawing, or removes an emptied box. Safe to call when nothing is open. */
  commitTextDraft() {
    const draft = this.textDraft;
    if (!draft) return;
    this.textDraft = null;
    draft.node.remove();
    this.lifted = null;
    const text = draft.node.value.replace(/\s+$/u, '');
    if (draft.id) {
      if (!text.trim()) this.commit({ t: 'delete', ids: [draft.id] });
      else if (text !== draft.text) this.commit({ t: 'edit', id: draft.id, text });
      else this.rebuildInk();
    } else if (text.trim()) {
      this.commit({ t: 'text', l: this.activeLayer, c: draft.c, f: draft.f, s: draft.s, a: draft.a, b: draft.b, text });
    } else {
      this.rebuildInk();
    }
  }

  // ---------- layers ----------

  /** Drawing on a hidden layer shows it first, so the stroke is not lost. */
  ensureActiveVisible() {
    const layer = this.layers.find((item) => item.id === this.activeLayer);
    if (layer && !layer.visible) {
      layer.visible = true;
      this.changeLayers();
    }
  }

  /** Layer structure changed: refresh the panel, replay the ops, and save. */
  changeLayers() {
    this.renderLayers();
    this.rebuildInk();
    this.scheduleSave();
  }

  selectLayer(id) {
    if (id === this.activeLayer) return;
    this.commitTextDraft(); // the open text box belongs to the layer it was started on // a re-render here would detach a row that is being double-clicked
    this.activeLayer = id;
    this.renderLayers();
  }

  toggleLayer(id) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) return;
    this.commitTextDraft();
    layer.visible = !layer.visible;
    this.changeLayers();
  }

  renameLayer(id, name) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) return;
    layer.name = name.slice(0, 40);
    this.renderLayers();
    this.scheduleSave();
  }

  moveLayer(id, dir) {
    const index = this.layers.findIndex((item) => item.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= this.layers.length) return;
    this.commitTextDraft();
    [this.layers[index], this.layers[target]] = [this.layers[target], this.layers[index]];
    this.changeLayers();
  }

  addLayer() {
    if (!this.entry) return;
    if (this.layers.length >= MAX_LAYERS) {
      this.showStatus(`A page holds up to ${MAX_LAYERS} layers`, true);
      return;
    }
    this.commitTextDraft();
    let n = this.layers.length + 1;
    while (this.layers.some((layer) => layer.name === `Layer ${n}`)) n += 1;
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayer);
    const layer = { id: newLayerId(), name: `Layer ${n}`, visible: true };
    this.layers.splice(index + 1, 0, layer);
    this.activeLayer = layer.id;
    this.changeLayers();
  }

  async deleteLayer(id) {
    const index = this.layers.findIndex((item) => item.id === id);
    if (!this.entry || index < 0) return;
    if (this.layers.length < 2) {
      this.showStatus('A page needs at least one layer', true);
      return;
    }
    const layer = this.layers[index];
    if (hasInkOn(this.drawing.ops, id)) {
      const ok = await confirmDialog({
        title: 'Delete this layer?',
        message: `“${layer.name}” and everything drawn on it will be removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    this.commitTextDraft();
    this.drawing.purgeLayer(id);
    this.layers.splice(index, 1);
    if (this.activeLayer === id) this.activeLayer = this.layers[Math.max(0, index - 1)].id;
    this.selection = new Set();
    this.changeLayers();
  }

  // ---------- saving ----------

  /** Current entry with the live text and ink, cloned so async work never shares mutable state. */
  snapshot() {
    const { sheet } = this.dom;
    const ratio = sheet.clientWidth ? sheet.clientHeight / sheet.clientWidth : 0.8;
    const h = Math.round(Math.max(ratio * NORM_WIDTH, inkExtent(this.drawing.ops) + 20));
    return structuredClone({
      ...this.entry,
      body: this.dom.editor.value,
      ink: { ops: this.drawing.ops, h, layers: this.layers },
    });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.showStatus('Unsaved changes…', false, 'pending');
    this.saveTimer = setTimeout(() => this.persist(), SAVE_DELAY_MS);
  }

  /**
   * Saves the open entry and keeps a version when the rules in versions.js say
   * so. `reason` is 'auto' (after a pause in editing), 'leave' (before switching
   * entries), or 'manual'. Resolves true when a version was kept.
   */
  persist(reason = 'auto') {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.entry) return this.saveChain;
    const entry = this.snapshot();
    const key = contentKey(entry);
    // Nothing changed since the last write, so skip the write. That keeps "Modified" meaning "last edited".
    // A leave or manual save can still keep a version of this content, so the version rules run.
    if (key === this.savedKey) {
      this.saveChain = this.saveChain
        .then(() => this.keepVersion(entry, reason))
        .then((kept) => {
          this.showStatus(`Saved at ${formatTime(new Date())}${kept ? ' · version kept' : ''}`, false, 'saved');
          return kept;
        })
        .catch((error) => {
          console.error(error);
          this.showStatus(`Could not save: ${error.message}`, true);
          return false;
        });
      return this.saveChain;
    }
    this.savedKey = key;
    entry.updatedAt = new Date().toISOString();
    this.saveChain = this.saveChain
      .then(async () => {
        this.showStatus('Saving…', false, 'saving');
        await this.store.save(entry);
        const kept = await this.keepVersion(entry, reason);
        this.showStatus(`Saved at ${formatTime(new Date())}${kept ? ' · version kept' : ''}`, false, 'saved');
        return kept;
      })
      .catch((error) => {
        console.error(error);
        this.savedKey = null; // The write failed, so the next save must try again.
        this.showStatus(`Could not save: ${error.message}`, true);
        return false;
      });
    return this.saveChain;
  }

  /** Stores a version of `entry` if the rules call for one. Returns true when one was kept. */
  async keepVersion(entry, reason) {
    const latest = await this.store.latestVersion(entry.id);
    if (!shouldKeepVersion({ entry, latest, reason })) return false;
    await this.store.saveVersion(makeVersion(entry, reason), MAX_VERSIONS);
    return true;
  }

  // ---------- entries ----------

  async openEntry(id, { history: mode = 'push' } = {}) {
    if (this.entry?.id === id && this.view === 'editor') return;
    this.commitTextDraft();
    await this.persist('leave');
    if (this.entry && isBlankEntry(this.snapshot())) {
      await this.store.remove(this.entry.id);
    }
    const next = await this.store.get(id);
    if (!next) {
      await this.showHome({ history: 'replace' });
      this.showStatus('That entry no longer exists.', true);
      return;
    }
    this.entry = next;
    this.dom.editor.setMedia(next);
    this.dom.editor.value = next.body;
    this.dom.title.value = next.title;
    this.dom.date.value = next.date;
    this.dom.kind.value = next.kind;
    this.dom.mood.value = next.mood ?? '';
    this.dom.weather.value = next.weather ?? '';
    this.dom.tags.value = next.tags.join(', ');
    this.drawing = new Drawing(next.ink.ops);
    this.layers = normalizeLayers(next.ink.layers);
    this.savedKey = contentKey(next);
    this.activeLayer = this.layers[this.layers.length - 1].id;
    this.selection = new Set();
    this.lifted = null;
    this.index = null;
    this.dom.sheet.style.backgroundColor = next.pageColor;
    this.lastSurface = 'text';
    this.setView('editor');
    this.writeRoute(entryRoute(id), mode);
    this.renderLayers();
    this.syncCanvas();
    this.rebuildInk();
    this.renderInkChip();
    this.updateChrome();
    this.setPref({ lastEntryId: id });
    this.showStatus('');
    this.dom.editor.focus({ preventScroll: true });
  }

  /** Starts a blank entry. `fields` can set the date, e.g. when a calendar day is picked. */
  async newEntry(fields = {}) {
    const entry = createEntry(fields);
    await this.store.save(entry);
    await this.openEntry(entry.id);
    this.dom.title.focus();
    playSound('newEntry');
  }

  /**
   * Opens today's most recently edited journal entry, or starts a new journal for today.
   * A new journal can start from a writing prompt, set as a quote so the first line is ready to answer.
   */
  async openToday({ prompt } = {}) {
    await this.persist();
    const today = localISODate();
    const existing = todaysJournal(await this.store.list(), today);
    if (existing) await this.openEntry(existing.id);
    else await this.newEntry({ date: today, kind: 'journal', body: prompt ? `> ${prompt}\n\n` : '' });
  }

  showEntries() {
    entriesDialog({
      load: async () => {
        await this.persist();
        return this.store.list();
      },
      currentId: this.entry?.id,
      onOpen: (id) => this.openEntry(id),
      onNew: () => this.newEntry(),
      onDelete: (id) => this.deleteEntry(id),
    });
  }

  /**
   * Changes pin, favorite, or notebook on a stored entry. Any unsaved text of
   * the open entry is written first, so this never drops an edit. The open
   * entry's copy is updated to match.
   */
  async patchEntry(id, fields) {
    await this.persist();
    const current = await this.store.get(id);
    if (!current) return;
    const saved = await this.store.save({ ...current, ...fields });
    if (this.entry?.id === id) {
      this.entry = { ...this.entry, notebook: saved.notebook, pinned: saved.pinned, favorite: saved.favorite };
    }
    await this.refreshHome();
  }

  async moveEntryToNotebook(id) {
    await this.persist();
    const entries = await this.store.list();
    const current = entries.find((entry) => entry.id === id);
    if (!current) return;
    notebookDialog({
      entryName: displayTitle(current),
      notebooks: countByNotebook(entries).map((notebook) => notebook.name),
      current: current.notebook,
      onSave: (notebook) => {
        if (notebook !== current.notebook) this.patchEntry(id, { notebook });
      },
    });
  }

  async deleteEntry(id) {
    this.commitTextDraft();
    const target = await this.store.get(id);
    if (!target) return;
    const ok = await confirmDialog({
      title: 'Delete this entry?',
      message: `“${displayTitle(target)}” and its drawing will be removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await this.saveChain;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const isCurrent = this.entry?.id === id;
    if (isCurrent) this.entry = null;
    await this.store.remove(id);
    if (isCurrent) await this.showHome({ history: 'replace' });
    else await this.refreshHome();
    this.showStatus('Entry deleted');
    playSound('delete');
  }

  // ---------- version history ----------

  /** Keeps a version now, even inside the autosave interval. Returns the message to show. */
  async saveVersionNow() {
    if (!this.entry) return '';
    if (isBlankEntry(this.snapshot())) return 'Nothing to save as a version yet.';
    const kept = await this.persist('manual');
    const message = kept ? 'Version saved.' : 'No changes since the last version.';
    this.showStatus(message, false, 'saved');
    return message;
  }

  async showVersions() {
    if (!this.entry) return;
    await this.persist();
    const entry = this.entry;
    historyDialog({
      load: () => this.store.listVersions(entry.id),
      onRestore: (version) => this.restoreVersion(version),
      onSaveNow: () => this.saveVersionNow(),
      onDelete: (version) => this.deleteVersion(version),
      // Pictures are kept with the entry. Sketches come from the version's own strokes, falling back to the current ones.
      mediaFor: (version) =>
        mediaResolver({
          images: entry.images,
          sketches: { ...entry.sketches, ...(version.content.sketches ?? {}) },
          pageColor: version.content.pageColor,
        }),
    });
  }

  /** Puts a version's content back into the open entry. What was there is kept as a version first, so the restore can be undone. */
  async restoreVersion(version) {
    if (!this.entry || version.entryId !== this.entry.id) return;
    await this.persist();
    await this.keepVersion(this.snapshot(), 'restore');

    const c = structuredClone(version.content);
    Object.assign(this.entry, { title: c.title, date: c.date, kind: c.kind, tags: c.tags, pageColor: c.pageColor });
    // Sketches are restored in place, so the sketch pads on the page show the restored strokes.
    for (const [id, sketch] of Object.entries(c.sketches ?? {})) {
      if (Object.hasOwn(this.entry.sketches, id)) Object.assign(this.entry.sketches[id], sketch);
      else this.entry.sketches[id] = sketch;
    }
    this.dom.editor.value = c.body;
    this.dom.title.value = c.title;
    this.dom.date.value = c.date;
    this.dom.kind.value = c.kind;
    this.dom.tags.value = c.tags.join(', ');
    this.drawing = new Drawing(c.ink.ops);
    this.dom.sheet.style.backgroundColor = c.pageColor;
    this.lastSurface = 'text';
    this.renderInkChip();
    this.syncCanvas();
    this.updateChrome();
    await this.persist();
    this.showStatus(`Restored the version from ${formatVersionTime(version.savedAt)}`, false, 'saved');
  }

  async deleteVersion(version) {
    const ok = await confirmDialog({
      title: 'Delete this version?',
      message: `The copy from ${formatVersionTime(version.savedAt)} is removed from this browser. The entry itself is not changed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return false;
    await this.store.removeVersion(version.id);
    this.showStatus('Version deleted');
    return true;
  }

  // ---------- export, backup, restore ----------

  async exportMarkdown() {
    if (!this.entry) return;
    await exportMarkdown(this.snapshot());
    this.showStatus('Exported Markdown');
    playSound('export');
  }

  async exportDrawing() {
    if (!this.entry) return;
    if (this.drawing.isEmpty) {
      this.showStatus('Nothing drawn yet');
      return;
    }
    await exportDrawingPng(this.snapshot());
    this.showStatus('Exported drawing');
    playSound('export');
  }

  printPdf() {
    if (!this.entry) return;
    printEntry(this.snapshot(), { fontStack: FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif });
  }

  /** Uses the browser's install prompt when it offered one. Otherwise it explains the browser's own steps. */
  async installQuire() {
    if (installState() !== 'available') {
      showInstallHelp();
      return;
    }
    if ((await promptInstall()) === 'accepted') this.showStatus('Quire is installing…', false, 'saved');
  }

  async backup() {
    await this.persist();
    const entries = await this.store.listFull();
    const versions = await this.store.listAllVersions();
    downloadBlob(makeBackup(entries, versions), `quire-backup-${localISODate()}.json`);
    this.showStatus(`Backed up ${entries.length} entries and ${versions.length} versions`);
  }

  restore() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) await this.restoreFrom(file);
    });
    document.body.append(input);
    input.click();
  }

  async restoreFrom(file) {
    const { entries, versions } = parseBackup(await file.text());
    await this.persist();
    // Drop the in-memory entry first, so a stale copy cannot overwrite the restored one.
    this.entry = null;
    for (const entry of entries) await this.store.save(entry);
    // Only versions whose entry is in this backup are restored. Same ids overwrite, so restoring twice adds nothing.
    const restored = new Set(entries.map((entry) => entry.id));
    const usable = versions.filter((version) => restored.has(version.entryId));
    for (const version of usable) await this.store.saveVersion(version, MAX_VERSIONS);
    await this.showHome();
    this.showStatus(`Restored ${entries.length} entries and ${usable.length} versions`);
  }

  // ---------- keyboard ----------

  onGlobalKeydown(event) {
    if (document.querySelector('dialog[open]')) return;
    const typing = isTextTarget(event.target);
    const key = event.key.toLowerCase();

    if (event.key === 'F1') {
      event.preventDefault();
      showShortcuts();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && key === 't') {
      event.preventDefault();
      this.openToday();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (this.view === 'home' && key === 'f') {
        event.preventDefault();
        this.home.focusSearch();
        return;
      }
      switch (key) {
        case 'h':
          if (event.shiftKey) {
            event.preventDefault();
            this.showHome();
          }
          break;
        case 'n':
          event.preventDefault();
          this.newEntry();
          break;
        case 'o':
          event.preventDefault();
          this.showEntries();
          break;
        case 's':
          event.preventDefault();
          this.persist();
          break;
        case 'e':
          event.preventDefault();
          this.exportMarkdown();
          break;
        case 'p':
          event.preventDefault();
          this.printPdf();
          break;
        case ',':
          event.preventDefault();
          this.openOptions();
          break;
        case 'z':
        case 'y': {
          if (typing && this.lastSurface === 'text') break; // native text undo
          event.preventDefault();
          if (key === 'y' || event.shiftKey) this.redo();
          else this.undo();
          break;
        }
        default:
          break;
      }
      return;
    }
    if (typing || event.altKey || this.view === 'home') return;
    if (this.selection.size) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.deleteSelection();
        return;
      }
      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (nudge) {
        event.preventDefault();
        this.nudgeSelection(...nudge);
        return;
      }
    }
    if (event.key === 'Escape' && this.selection.size) {
      this.selection = new Set();
      this.requestRedraw();
      return;
    }
    const toolId = TOOL_BY_KEY[key];
    if (toolId) {
      event.preventDefault();
      this.setTool(toolId);
    }
  }
}
