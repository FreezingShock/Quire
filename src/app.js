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
  createEntry,
  displayTitle,
  formatLongDate,
  isBlankEntry,
  isISODate,
  localISODate,
  parseTags,
} from './model.js';
import { wordCount } from './markdown.js';
import { LiveEditor } from './livetext.js';
import { Drawing, NORM_WIDTH, applyOp, inkExtent, paintGrid, paintOps, sampleColor, strokeWidth } from './drawing.js';
import { shapeEnd, snapToGrid } from './snap.js';
import { FORMAT_BUTTONS, PALETTE, POINTER_TOOLS, SHAPE_TOOLS, STROKE_SIZES, TOOLS, TOOL_BY_KEY } from './tools.js';
import {
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
import { confirmDialog, entriesDialog, showAbout, showShortcuts } from './dialogs.js';
import { HomeView } from './home.js';

const SAVE_DELAY_MS = 400;
const FONT_STACKS = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
const FONT_LABELS = { serif: 'Serif', sans: 'Sans', mono: 'Monospace' };

const $ = (selector) => document.querySelector(selector);
const prevent = (event) => event.preventDefault();

/** Pen pressure rounded to two places. Pens without a reading fall back to a typical press. */
const penPressure = (event) => (event.pressure > 0 ? Math.round(event.pressure * 100) / 100 : 0.5);

/** Routes are plain hashes: #/ is the home view, #/entry/<id> is one entry. */
const HOME_ROUTE = '#/';
const entryRoute = (id) => `#/entry/${encodeURIComponent(id)}`;

function routeEntryId(hash) {
  const match = /^#\/entry\/(.+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function isTextTarget(node) {
  return Boolean(node) && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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
      tags: $('#entry-tags'),
      sheet: $('#sheet'),
      editorEl: $('#editor'),
      ink: $('#ink'),
      grid: $('#grid'),
      toolbox: $('#toolbox'),
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
    this.lastSurface = 'text';
    this.saveTimer = 0;
    this.saveChain = Promise.resolve();
    this.frame = 0;
    this.syncFrame = 0;
    this.menubar = null;
    this.view = 'home'; // 'home' or 'editor'; the landing page is the entries list
    this.home = null;
  }

  async start() {
    this.applyPrefs();
    this.buildToolbox();
    this.buildSwatches();
    this.buildMenus();
    this.home = new HomeView(this.dom.home, {
      view: this.prefs.homeView,
      onOpen: (id) => this.openEntry(id),
      onNew: () => this.newEntry(),
      onDelete: (id) => this.deleteEntry(id),
      onViewChange: (view) => this.setPref({ homeView: view }),
    });
    this.bindEvents();
    this.setTool('write');
    this.store = await createLocalStore();
    if (this.store.kind === 'memory') {
      this.showStatus('Browser storage is unavailable. Entries will not survive a reload.', true);
    }
    // The site opens on the entries list. A reload on an entry keeps that entry.
    const routed = routeEntryId(location.hash);
    const entries = await this.store.list();
    if (routed && entries.some((entry) => entry.id === routed)) {
      await this.openEntry(routed, { history: 'replace' });
    } else {
      await this.showHome({ history: 'replace' });
    }
  }

  // ---------- preferences and chrome ----------

  applyPrefs() {
    const root = document.documentElement;
    root.dataset.theme = this.prefs.dark ? 'dark' : 'light';
    root.style.setProperty('--page-font', FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif);
    const source = Boolean(this.prefs.source);
    this.dom.editorEl.classList.toggle('is-source', source);
    this.dom.grid.hidden = !this.prefs.showGrid;
    if (this.view !== 'home') this.dom.mode.textContent = source ? 'Source' : 'Live preview';
    for (const button of document.querySelectorAll('[data-source]')) {
      button.setAttribute('aria-pressed', String(source));
    }
    // Vista chrome: the Aero wallpaper, and the ribbon that can be minimized.
    root.classList.toggle('has-wallpaper', Boolean(this.prefs.wallpaper));
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

  showStatus(text, isError = false) {
    this.dom.saveStatus.textContent = text;
    this.dom.saveStatus.classList.toggle('is-error', isError);
  }

  updateChrome() {
    const title = displayTitle({ title: this.dom.title.value.trim(), body: this.dom.editor.value });
    this.dom.windowTitle.textContent = title;
    document.title = `${title} · Quire`;
    this.dom.statusDate.textContent = this.entry ? formatLongDate(this.entry.date) : '';
    this.dom.words.textContent = `${wordCount(this.dom.editor.value)} words`;
  }

  // ---------- views and routing ----------

  setView(view) {
    this.view = view;
    this.dom.app.dataset.view = view;
    if (view === 'editor') this.applyPrefs();
  }

  /** Saves the open entry, drops it if it is blank, and shows the entries list. */
  async showHome({ history: mode = 'push' } = {}) {
    await this.persist();
    if (this.entry && isBlankEntry(this.snapshot())) {
      await this.store.remove(this.entry.id);
    }
    this.entry = null;
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
    const sizes = el(
      'div',
      { class: 'size-row', role: 'radiogroup', 'aria-label': 'Stroke width' },
      STROKE_SIZES.map((size) =>
        el(
          'button',
          {
            class: 'size-btn',
            type: 'button',
            role: 'radio',
            'aria-label': `Stroke ${size}`,
            'aria-checked': String(size === this.size),
            'data-size': size,
            onMousedown: prevent,
            onClick: () => this.setSize(size),
          },
          el('span', { style: `height: ${size}px` }),
        ),
      ),
    );
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
    const source = el(
      'button',
      {
        class: 'source-btn',
        type: 'button',
        'data-source': '',
        'aria-pressed': String(Boolean(this.prefs.source)),
        title: 'Source mode: show the Markdown markup',
        onMousedown: prevent,
        onClick: () => this.setPref({ source: !this.prefs.source }),
      },
      'Source',
    );
    this.dom.toolbox.replaceChildren(tools, sizes, format, source);
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
          { label: 'Open entry…', shortcut: 'Ctrl+O', action: () => this.showEntries() },
          { label: 'Delete entry…', disabled: !this.entry, action: () => this.entry && this.deleteEntry(this.entry.id) },
          'sep',
          { label: 'Save now', shortcut: 'Ctrl+S', action: () => this.persist() },
          { label: 'Export as Markdown…', shortcut: 'Ctrl+E', disabled: !this.entry, action: () => this.exportMarkdown() },
          { label: 'Export drawing as PNG…', disabled: !this.entry || this.drawing.isEmpty, action: () => this.exportDrawing() },
          { label: 'Print or save as PDF…', shortcut: 'Ctrl+P', disabled: !this.entry, action: () => this.printPdf() },
          'sep',
          { label: 'Back up all entries…', action: () => this.backup() },
          { label: 'Restore from backup…', action: () => this.restore() },
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
          { label: 'Clear drawing', disabled: this.drawing.isEmpty, action: () => this.clearInk() },
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
          { label: 'Divider', action: () => this.applyFormat('divider') },
          'sep',
          { label: 'Bold', shortcut: 'Ctrl+B', action: () => this.applyFormat('bold') },
          { label: 'Italic', shortcut: 'Ctrl+I', action: () => this.applyFormat('italic') },
        ],
      },
      {
        label: 'Insert',
        items: () => [
          { label: 'Today’s date', action: () => this.insertText(formatLongDate(localISODate())) },
          { label: 'Current time', action: () => this.insertText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) },
        ],
      },
      {
        label: 'View',
        items: () => [
          { label: 'Source mode', check: true, checked: Boolean(this.prefs.source), action: () => this.setPref({ source: !this.prefs.source }) },
          'sep',
          ...Object.keys(FONT_STACKS).map((id) => ({
            label: `${FONT_LABELS[id]} writing font`,
            check: true,
            checked: this.prefs.font === id,
            action: () => this.setPref({ font: id }),
          })),
          'sep',
          { label: 'Dark chrome', check: true, checked: this.prefs.dark, action: () => this.setPref({ dark: !this.prefs.dark }) },
          'sep',
          { label: 'Show grid', check: true, checked: Boolean(this.prefs.showGrid), action: () => this.setPref({ showGrid: !this.prefs.showGrid }) },
          { label: 'Snap to grid', check: true, checked: Boolean(this.prefs.snapGrid), action: () => this.setPref({ snapGrid: !this.prefs.snapGrid }) },
          { label: 'Snap lines to 15° angles', check: true, checked: Boolean(this.prefs.snapAngles), action: () => this.setPref({ snapAngles: !this.prefs.snapAngles }) },
          'sep',
          { label: 'Minimize ribbon', check: true, checked: Boolean(this.prefs.ribbonHidden), action: () => this.setPref({ ribbonHidden: !this.prefs.ribbonHidden }) },
          { label: 'Aero wallpaper', check: true, checked: Boolean(this.prefs.wallpaper), action: () => this.setPref({ wallpaper: !this.prefs.wallpaper }) },
          { label: 'Startup splash', check: true, checked: Boolean(this.prefs.splash), action: () => this.setPref({ splash: !this.prefs.splash }) },
          {
            label: 'Sound effects',
            check: true,
            checked: Boolean(this.prefs.sound),
            action: () => {
              this.setPref({ sound: !this.prefs.sound });
              playSound('startup');
            },
          },
        ],
      },
      {
        label: 'Colors',
        items: () => [
          { label: 'Swap ink and page color', action: () => this.swapInkAndPage() },
          { label: 'Reset page color', action: () => this.setPageColor(DEFAULT_PAGE_COLOR) },
          { label: 'Reset ink color', action: () => this.setInk(PALETTE[0]) },
        ],
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
    const { editor, editorEl, title, date, kind, tags, ink, sheet } = this.dom;
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
    tags.addEventListener('input', () => this.onFieldChanged());

    ink.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    ink.addEventListener('pointermove', (event) => this.onPointerMove(event));
    ink.addEventListener('pointerup', (event) => this.onPointerUp(event));
    ink.addEventListener('pointercancel', (event) => this.onPointerUp(event));

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
    this.tool = id;
    this.dom.ink.dataset.tool = id;
    for (const button of this.dom.toolbox.querySelectorAll('[data-tool-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.toolId === id));
    }
    const tool = TOOLS.find((item) => item.id === id);
    this.dom.hint.textContent = tool?.hint ?? '';
    // Picking a drawing tool takes focus out of any text field, so tool keys work and letters are not typed.
    if (id === 'write') this.dom.editor.focus({ preventScroll: true });
    else if (isTextTarget(document.activeElement)) document.activeElement.blur();
  }

  setSize(size) {
    this.size = size;
    for (const button of this.dom.toolbox.querySelectorAll('[data-size]')) {
      button.setAttribute('aria-checked', String(Number(button.dataset.size) === size));
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

  /** Resize both canvases to the sheet. A size change rebuilds the base from the ops. */
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
    }
    this.scale = w / NORM_WIDTH;
    if (resized) paintOps(this.baseCtx, this.drawing.ops, this.scale);
    if (this.prefs.showGrid) paintGrid(this.gridCtx, this.scale);
    this.redraw();
  }

  redraw() {
    const ctx = this.inkCtx;
    ctx.clearRect(0, 0, this.dom.ink.width, this.dom.ink.height);
    ctx.drawImage(this.base, 0, 0);
    if (this.live) applyOp(ctx, this.live, this.scale);
  }

  requestRedraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.redraw();
    });
  }

  commit(op) {
    this.drawing.commit(op);
    this.lastSurface = 'ink';
    applyOp(this.baseCtx, op, this.scale);
    this.redraw();
    this.scheduleSave();
  }

  undoInk() {
    if (!this.drawing.undo()) return;
    paintOps(this.baseCtx, this.drawing.ops, this.scale);
    this.redraw();
    this.scheduleSave();
  }

  redoInk() {
    const op = this.drawing.redo();
    if (!op) return;
    applyOp(this.baseCtx, op, this.scale);
    this.redraw();
    this.scheduleSave();
  }

  clearInk() {
    if (this.drawing.clear()) {
      this.lastSurface = 'ink';
      paintOps(this.baseCtx, this.drawing.ops, this.scale);
      this.redraw();
      this.scheduleSave();
    }
  }

  /** Undo follows the surface you touched last: ink or text. */
  undo() {
    if (this.lastSurface === 'ink' && this.drawing.canUndo) {
      this.undoInk();
      return;
    }
    this.dom.editor.undo();
  }

  redo() {
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

  onPointerDown(event) {
    if (event.button !== 0 || !POINTER_TOOLS.has(this.tool)) return;
    const p = this.pointFromEvent(event);
    if (this.tool === 'pick') {
      const hex = sampleColor(this.baseCtx, p.x * this.scale, p.y * this.scale) ?? this.entry?.pageColor ?? DEFAULT_PAGE_COLOR;
      this.setInk(hex);
      return;
    }
    if (this.tool === 'fill') {
      this.commit({ t: 'fill', c: this.fg, at: [p.x, p.y] });
      return;
    }
    try {
      this.dom.ink.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; drawing still works without it.
    }
    this.pointerId = event.pointerId;
    this.shiftHeld = event.shiftKey;
    this.rawEnd = [p.x, p.y];
    const w = Math.round(strokeWidth(this.tool, this.size) * 100) / 100;
    // With snap to grid on, a drag starts on the nearest grid node.
    const start = this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
    // Only pen input records pressure, and the highlighter ignores it, so mouse and touch strokes stay as they were.
    this.livePen = event.pointerType === 'pen' && this.tool !== 'marker';
    this.live = SHAPE_TOOLS.has(this.tool)
      ? { t: this.tool, c: this.fg, w, a: start, b: start }
      : { t: 'stroke', tool: this.tool, c: this.fg, w, p: [this.livePen ? [...start, penPressure(event)] : start] };
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
    if (!this.live || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
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
    } else {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    this.requestRedraw();
  }

  onPointerUp(event) {
    if (!this.live || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
    if (SHAPE_TOOLS.has(this.live.t)) {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    const op = this.live;
    this.live = null;
    this.rawEnd = null;
    this.pointerId = null;
    try {
      if (this.dom.ink.hasPointerCapture(event.pointerId)) this.dom.ink.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore: the pointer was already released.
    }
    if (op.t !== 'stroke' && op.a[0] === op.b[0] && op.a[1] === op.b[1]) {
      this.redraw();
      return;
    }
    this.commit(op);
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
      ink: { ops: this.drawing.ops, h },
    });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.showStatus('Unsaved changes…');
    this.saveTimer = setTimeout(() => this.persist(), SAVE_DELAY_MS);
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.entry) return this.saveChain;
    const entry = this.snapshot();
    entry.updatedAt = new Date().toISOString();
    this.saveChain = this.saveChain
      .then(() => {
        this.showStatus('Saving…');
        return this.store.save(entry);
      })
      .then(() => this.showStatus(`Saved at ${formatTime(new Date())}`))
      .catch((error) => {
        console.error(error);
        this.showStatus(`Could not save: ${error.message}`, true);
      });
    return this.saveChain;
  }

  // ---------- entries ----------

  async openEntry(id, { history: mode = 'push' } = {}) {
    if (this.entry?.id === id && this.view === 'editor') return;
    await this.persist();
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
    this.dom.editor.value = next.body;
    this.dom.title.value = next.title;
    this.dom.date.value = next.date;
    this.dom.kind.value = next.kind;
    this.dom.tags.value = next.tags.join(', ');
    this.drawing = new Drawing(next.ink.ops);
    this.dom.sheet.style.backgroundColor = next.pageColor;
    this.lastSurface = 'text';
    this.setView('editor');
    this.writeRoute(entryRoute(id), mode);
    this.syncCanvas();
    this.renderInkChip();
    this.updateChrome();
    this.setPref({ lastEntryId: id });
    this.showStatus('');
    this.dom.editor.focus({ preventScroll: true });
  }

  async newEntry() {
    const entry = createEntry();
    await this.store.save(entry);
    await this.openEntry(entry.id);
    this.dom.title.focus();
    playSound('newEntry');
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

  async deleteEntry(id) {
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

  async backup() {
    await this.persist();
    const entries = await this.store.list();
    downloadBlob(makeBackup(entries), `quire-backup-${localISODate()}.json`);
    this.showStatus(`Backed up ${entries.length} entries`);
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
    const entries = parseBackup(await file.text());
    await this.persist();
    // Drop the in-memory entry first, so a stale copy cannot overwrite the restored one.
    this.entry = null;
    for (const entry of entries) await this.store.save(entry);
    await this.showHome();
    this.showStatus(`Restored ${entries.length} entries`);
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
    const toolId = TOOL_BY_KEY[key];
    if (toolId) {
      event.preventDefault();
      this.setTool(toolId);
    }
  }
}
