/** Building the toolbox, swatches, menus, and event bindings for the Quire controller. Mixed into QuireApp. */

import { HOVER_SOUND_TARGETS } from './constants.js';
import { prevent } from './helpers.js';
import { showAbout, showShortcuts } from '../dialogs.js';
import { el } from '../dom.js';
import { hasInkOn } from '../drawing.js';
import { lockNow } from '../lock.js';
import { icon } from '../icons.js';
import { attachKeyboardPen } from '../keypen.js';
import { renderLayerPanel } from '../layers.js';
import { createMenuBar } from '../menubar.js';
import { wireContextMenus } from '../contextmenu.js';
import { scopeItems } from './helpers.js';
import { DEFAULT_PAGE_COLOR, formatLongDate, localISODate } from '../model.js';
import { installState } from '../pwa.js';
import { SKINS, isDark, skinOf } from '../skins.js';
import { playSound } from '../sound.js';
import {
  FORMAT_BUTTONS,
  PALETTE,
  POINTER_TOOLS,
  SHAPE_TOOLS,
  STROKE_SIZES,
  TOOLS,
} from '../tools.js';

export const buildUiMethods = {
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
  },

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
    this.dom.stampRow = this.buildStampRow();
    this.dom.xformRow = this.buildXformRow();
    this.dom.layers = el('div', { class: 'layer-panel', 'aria-label': 'Layers' });
    this.dom.toolbox.replaceChildren(tools, sizes, this.dom.stampRow, this.dom.xformRow, format, this.dom.layers);
    this.renderLayers();
  },

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
  },

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
  },

  buildMenus() {
    // Entries-list views, offered in the View menu while the list is showing.
    const viewChoice = (id, label) => ({
      scope: 'home',
      label,
      check: true,
      checked: this.home?.state.view === id,
      action: () => this.home?.setViewMode(id),
    });
    const menus = [
      {
        label: 'File',
        items: () => [
          { label: 'All entries', shortcut: 'Ctrl+Shift+H', action: () => this.showHome() },
          'sep',
          { label: 'New entry', shortcut: 'Ctrl+N', action: () => this.newEntry() },
          { label: "Today's entry", shortcut: 'Alt+T', action: () => this.openToday() },
          { label: 'Open entry…', shortcut: 'Ctrl+O', action: () => this.showEntries() },
          { label: 'Random memory', action: () => this.randomMemory() },
          { scope: 'editor', label: 'Delete entry…', disabled: !this.entry, action: () => this.entry && this.deleteEntry(this.entry.id) },
          'sep',
          { scope: 'editor', label: 'Move to notebook…', disabled: !this.entry, action: () => this.entry && this.moveEntryToNotebook(this.entry.id) },
          {
            scope: 'editor',
            label: this.entry?.pinned ? 'Unpin from top' : 'Pin to top',
            disabled: !this.entry,
            action: () => this.entry && this.patchEntry(this.entry.id, { pinned: !this.entry.pinned }),
          },
          {
            scope: 'editor',
            label: this.entry?.favorite ? 'Remove from favorites' : 'Add to favorites',
            disabled: !this.entry,
            action: () => this.entry && this.patchEntry(this.entry.id, { favorite: !this.entry.favorite }),
          },
          'sep',
          { scope: 'editor', label: 'Save now', shortcut: 'Ctrl+S', action: () => this.persist() },
          { scope: 'editor', label: 'Save version now', disabled: !this.entry, action: () => this.saveVersionNow() },
          { scope: 'editor', label: 'Version history…', disabled: !this.entry, action: () => this.showVersions() },
          { scope: 'editor', label: 'Seal as time capsule…', disabled: !this.entry, action: () => this.sealEntry() },
          'sep',
          { scope: 'editor', label: 'Export as Markdown…', shortcut: 'Ctrl+E', disabled: !this.entry, action: () => this.exportMarkdown() },
          { scope: 'editor', label: 'Export drawing as PNG…', disabled: !this.entry || this.drawing.isEmpty, action: () => this.exportDrawing() },
          { scope: 'editor', label: 'Postcard…', disabled: !this.entry, action: () => this.postcard() },
          { label: 'Print…', shortcut: 'Ctrl+P', action: () => this.printPdf() },
          'sep',
          { label: 'Back up all entries…', action: () => this.backup() },
          { label: 'Restore from backup…', action: () => this.restore() },
          { label: 'Import entries…', action: () => this.importEntries() },
          ...(installState() === 'installed' ? [] : ['sep', { label: 'Install Quire…', action: () => this.installQuire() }]),
          'sep',
          { label: 'Passcode lock…', action: () => this.passcodeSettings() },
          { label: 'Lock Quire now', disabled: !this.passcodeOn, action: () => lockNow(() => this.persist()) },
        ],
      },
      {
        label: 'Edit',
        items: () => [
          { label: 'Find entries', shortcut: 'Ctrl+F', scope: 'home', action: () => this.home.focusSearch() },
          { label: 'Open selected entry', shortcut: 'Enter', scope: 'home', disabled: !this.home?.selectedEntry(), action: () => this.home.openSelected() },
          { label: 'Pin selected to top', scope: 'home', disabled: !this.home?.selectedEntry(), action: () => this.home.togglePinned() },
          { label: 'Favorite selected', scope: 'home', disabled: !this.home?.selectedEntry(), action: () => this.home.toggleFavorite() },
          { label: 'Move selected to notebook…', scope: 'home', disabled: !this.home?.selectedEntry(), action: () => this.home.moveSelected() },
          { label: 'Delete selected entry…', shortcut: 'Delete', scope: 'home', disabled: !this.home?.selectedEntry(), action: () => this.home.deleteSelected() },
          'sep',
          { scope: 'editor', label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.undo() },
          { scope: 'editor', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => this.redo() },
          'sep',
          {
            scope: 'editor',
            label: 'Select all text',
            shortcut: 'Ctrl+A',
            action: () => {
              this.prepareEditing();
              this.dom.editor.select();
            },
          },
          'sep',
          { scope: 'editor', label: 'Delete selection', shortcut: 'Del', disabled: !this.selection.size, action: () => this.deleteSelection() },
          'sep',
          { scope: 'editor', label: 'Flip selection horizontally', disabled: !this.selection.size, action: () => this.transformSelection('flip-h') },
          { scope: 'editor', label: 'Flip selection vertically', disabled: !this.selection.size, action: () => this.transformSelection('flip-v') },
          { scope: 'editor', label: 'Rotate selection clockwise', disabled: !this.selection.size, action: () => this.transformSelection('rotate-cw') },
          { scope: 'editor', label: 'Rotate selection counterclockwise', disabled: !this.selection.size, action: () => this.transformSelection('rotate-ccw') },
          { scope: 'editor', label: 'Resize selection…', disabled: !this.selection.size, action: () => this.resizeSelection() },
          'sep',
          { scope: 'editor', label: 'Clear current layer', disabled: !this.entry || !hasInkOn(this.drawing.ops, this.activeLayer), action: () => this.clearInk(this.activeLayer) },
          { scope: 'editor', label: 'Clear all layers', disabled: this.drawing.isEmpty, action: () => this.clearInk() },
          'sep',
          { scope: 'editor', label: 'Select all drawings', disabled: !this.entry || this.drawing.isEmpty, action: () => this.selectAllInk() },
        ],
      },
      {
        label: 'Format',
        scope: 'editor',
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
        scope: 'editor',
        items: () => [
          { label: 'Image…', disabled: !this.entry, action: () => this.pickImages() },
          { label: 'Sketch between paragraphs', disabled: !this.entry, action: () => this.insertSketch() },
          { label: 'Sticker…', disabled: !this.entry, action: () => this.openStickers() },
          { label: 'Song for the mixtape…', disabled: !this.entry, action: () => this.addSong() },
          'sep',
          { label: 'Today’s date', action: () => this.insertText(formatLongDate(localISODate())) },
          { label: 'Current time', action: () => this.insertText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) },
        ],
      },
      {
        label: 'View',
        items: () => [
          { label: 'Command palette…', shortcut: 'Ctrl+K', action: () => this.openPalette() },
          'sep',
          viewChoice('dashboard', 'Dashboard'),
          viewChoice('details', 'Details'),
          viewChoice('tiles', 'Tiles'),
          viewChoice('calendar', 'Calendar'),
          viewChoice('moods', 'Mood chart'),
          'sep',
          { scope: 'editor', label: 'Actual size', disabled: this.zoom === 1, action: () => this.setZoom(1) },
          'sep',
          { scope: 'editor', label: 'Source mode', check: true, checked: Boolean(this.prefs.source), action: () => this.setPref({ source: !this.prefs.source }) },
          'sep',
          { scope: 'editor', label: 'Show grid', check: true, checked: Boolean(this.prefs.showGrid), action: () => this.setPref({ showGrid: !this.prefs.showGrid }) },
          { scope: 'editor', label: 'Snap to grid', check: true, checked: Boolean(this.prefs.snapGrid), action: () => this.setPref({ snapGrid: !this.prefs.snapGrid }) },
          'sep',
          { label: 'Focus mode', shortcut: 'F11', check: true, checked: this.focusMode, disabled: !this.entry, action: () => this.toggleFocusMode() },
          'sep',
          { label: 'Options…', shortcut: 'Ctrl+,', action: () => this.openOptions() },
        ],
      },
      {
        label: 'Skin',
        items: () => {
          const current = skinOf(this.prefs);
          return [
            ...SKINS.map((skin) => ({
              label: skin.label,
              check: true,
              checked: current === skin.id,
              action: () => this.setPref({ skin: skin.id }),
            })),
            'sep',
            { label: 'Dark', check: true, checked: isDark(this.prefs), action: () => this.setPref({ dark: !isDark(this.prefs) }) },
          ];
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
    // Each menu shows only the items for the current view: the entries list, or a page.
    const scopedMenus = menus.map((menu) => ({
      label: menu.label,
      hidden: () => menu.scope === 'editor' && this.view !== 'editor',
      items: () => scopeItems(menu.items(), this.view === 'editor' ? 'editor' : 'home'),
    }));
    this.menuDefs = scopedMenus;
    this.menubar = createMenuBar(this.dom.menubar, scopedMenus);
  },

  bindEvents() {
    const { editor, editorEl, title, date, kind, mood, weather, tags, ink, sheet } = this.dom;
    this.dom.ribbonToggle.addEventListener('click', () => this.setPref({ ribbonHidden: !this.prefs.ribbonHidden }));
    editorEl.addEventListener('keydown', (event) => this.onEditorKeydown(event));
    this.dom.windowTitle.addEventListener('click', () => this.startRename());
    // Clicking the open title bar's blank space renames the entry too, not just the name itself.
    const titlebar = document.querySelector('.titlebar');
    titlebar.addEventListener('click', (event) => {
      if (this.view !== 'editor' || !this.entry || this.dom.titleWrap.classList.contains('is-renaming')) return;
      if (event.target === titlebar || event.target.closest('#titlebar-entry')) this.startRename();
    });
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
    document.addEventListener('contextmenu', (event) => this.onContextMenu(event));
    wireContextMenus();
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
      this.showStatus(`Something went wrong: ${event.reason?.message ?? event.reason}`, true);
    });
  },
};
