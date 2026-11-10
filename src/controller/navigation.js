/**
 * Finding and moving around: the command palette (Ctrl+K), the right-click
 * menus for the writing surface and the drawing layer, and the breadcrumb that
 * shows where the open entry sits. Mixed into QuireApp.
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { menuPointFor, openContextMenu } from '../contextmenu.js';
import { displayTitle, formatLongDate, formatShortDate, localISODate } from '../model.js';
import { kindLabel } from '../library.js';
import { showCommandPalette } from '../palette.js';
import { TOOLS } from '../tools.js';

const PALETTE_LABEL = 'Command palette…';

/** Tools offered on the drawing layer's menu. Everything else is one key away. */
const CANVAS_TOOLS = ['pencil', 'brush', 'eraser', 'fill', 'select', 'text', 'magnifier', 'pick'];

export const navigationMethods = {
  // ---------- command palette ----------

  /** Every menu command that can run now, plus every entry. Commands come first, as the menus list them. */
  async paletteItems() {
    await this.persist();
    const commands = this.menuDefs.filter((menu) => !menu.hidden?.()).flatMap((menu) =>
      menu.items()
        .filter((item) => item !== 'sep' && item.action && !item.disabled && item.label !== PALETTE_LABEL)
        .map((item) => ({
          label: item.label,
          group: menu.label,
          shortcut: item.shortcut ?? (item.check ? (item.checked ? 'On' : 'Off') : ''),
          run: item.action,
        })),
    );
    const entries = (await this.store.list())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((entry) => ({
        label: displayTitle(entry),
        group: 'Entry',
        meta: [formatShortDate(entry.date), kindLabel(entry.kind), entry.notebook].filter(Boolean).join(' · '),
        keywords: [entry.notebook, kindLabel(entry.kind), ...entry.tags].filter(Boolean).join(' '),
        run: () => this.openEntry(entry.id),
      }));
    return [...commands, ...entries];
  },

  async openPalette() {
    if (document.querySelector('dialog[open]')) return;
    showCommandPalette({ items: await this.paletteItems() });
  },

  // ---------- right-click menus ----------

  onContextMenu(event) {
    // Shift+right-click keeps the browser's own menu, for spell check and the like.
    if (event.shiftKey || this.view !== 'editor' || !this.entry) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#ink')) {
      event.preventDefault();
      openContextMenu({ ...menuPointFor(event), label: 'Drawing', items: this.canvasMenuItems() });
    } else if (target.closest('#editor, #sheet')) {
      // Blank page under the text counts as the text: the caret goes to the end, as a click there does.
      event.preventDefault();
      if (!target.closest('#editor')) {
        const end = this.dom.editor.value.length;
        this.dom.editor.setSelectionRange(end, end);
        this.dom.editor.focus({ preventScroll: true });
      }
      openContextMenu({ ...menuPointFor(event), label: 'Text', items: this.textMenuItems() });
    }
  },

  textMenuItems() {
    const ta = this.dom.editor;
    const hasSelection = ta.selectionStart !== ta.selectionEnd;
    return [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => this.redo() },
      'sep',
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSelection, action: () => this.cutText() },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSelection, action: () => this.copyText() },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => this.pasteText() },
      { label: 'Select all', shortcut: 'Ctrl+A', action: () => this.selectAllText() },
      'sep',
      { label: 'Bold', shortcut: 'Ctrl+B', disabled: !hasSelection, action: () => this.applyFormat('bold') },
      { label: 'Italic', shortcut: 'Ctrl+I', disabled: !hasSelection, action: () => this.applyFormat('italic') },
      { label: 'Quote', action: () => this.applyFormat('quote') },
      { label: 'Checklist', action: () => this.applyFormat('task') },
      'sep',
      { label: 'Image…', action: () => this.pickImages() },
      { label: 'Sketch between paragraphs', action: () => this.insertSketch() },
      { label: 'Today’s date', action: () => this.insertText(formatLongDate(localISODate())) },
    ];
  },

  canvasMenuItems() {
    const hasSelection = this.selection.size > 0;
    const hasInk = !this.drawing.isEmpty;
    const toolItems = CANVAS_TOOLS.map((id) => TOOLS.find((tool) => tool.id === id)).map((tool) => ({
      label: tool.label,
      shortcut: tool.key,
      check: true,
      checked: this.tool === tool.id,
      action: () => this.setTool(tool.id),
    }));
    return [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => this.undo() },
      { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: () => this.redo() },
      'sep',
      ...toolItems,
      'sep',
      { label: 'Select all drawings', disabled: !hasInk, action: () => this.selectAllInk() },
      ...(hasSelection
        ? [
            { label: 'Delete selection', shortcut: 'Del', action: () => this.deleteSelection() },
            { label: 'Flip horizontally', action: () => this.transformSelection('flip-h') },
            { label: 'Flip vertically', action: () => this.transformSelection('flip-v') },
            { label: 'Rotate clockwise', action: () => this.transformSelection('rotate-cw') },
            { label: 'Rotate counterclockwise', action: () => this.transformSelection('rotate-ccw') },
            { label: 'Resize…', action: () => this.resizeSelection() },
          ]
        : []),
      'sep',
      { label: 'Show grid', check: true, checked: Boolean(this.prefs.showGrid), action: () => this.setPref({ showGrid: !this.prefs.showGrid }) },
      { label: 'Snap to grid', check: true, checked: Boolean(this.prefs.snapGrid), action: () => this.setPref({ snapGrid: !this.prefs.snapGrid }) },
    ];
  },

  selectAllInk() {
    this.setTool('select');
    this.selection = new Set(this.visibleOps().map((op) => op.id));
    this.requestRedraw();
  },

  selectAllText() {
    this.prepareEditing();
    this.dom.editor.select();
  },

  /** Copies the Markdown source for the selection, the same text the editor keeps. */
  async copyText() {
    const ta = this.dom.editor;
    const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      this.showStatus('The browser blocked copying here. Try Ctrl+C.', true);
      return false;
    }
  },

  async cutText() {
    if (await this.copyText()) {
      const ta = this.dom.editor;
      this.applyEdit({ from: ta.selectionStart, to: ta.selectionEnd, insert: '', selStart: ta.selectionStart, selEnd: ta.selectionStart });
    }
  },

  async pasteText() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      this.showStatus('The browser blocked paste from the menu. Try Ctrl+V.', true);
      return;
    }
    if (text) this.insertText(text);
  },

  // ---------- breadcrumb ----------

  /**
   * The path above the entry: All entries, then the notebook or kind the entry
   * sits in (each one goes back to the list, filtered to it), then the title.
   */
  renderEntryPath() {
    const path = this.dom.entryPath;
    if (!path) return;
    const entry = this.entry;
    if (!entry) {
      path.replaceChildren();
      return;
    }
    const group = entry.notebook
      ? { label: entry.notebook, filter: { type: 'notebook', value: entry.notebook } }
      : { label: kindLabel(entry.kind), filter: { type: 'kind', value: entry.kind } };
    const link = (label, onClick, title) => el('button', { class: 'entry-path-link', type: 'button', title, onClick }, label);
    const chevron = () => el('span', { class: 'home-chevron', 'aria-hidden': 'true' }, '›');
    const back = el('button', { class: 'entry-back', type: 'button', title: 'Back to all entries (Ctrl+Shift+H)', 'aria-label': 'Back to all entries', onClick: () => this.showHome() });
    back.innerHTML = icon('chevronLeft');
    const folder = el('span', { class: 'entry-path-icon', 'aria-hidden': 'true' });
    folder.innerHTML = icon('folder');
    path.replaceChildren(
      back,
      el(
        'div',
        { class: 'home-path entry-path-box' },
        folder,
        link('All entries', () => this.showHome(), 'Show all entries'),
        chevron(),
        link(group.label, () => this.showHomeFiltered(group.filter), `Show ${group.label} in the entries list`),
        chevron(),
        el('span', { class: 'home-crumb-current', 'aria-current': 'page' }, displayTitle({ title: this.dom.title.value.trim(), body: this.dom.editor.value })),
      ),
    );
  },

  /** Opens the entries list with a filter already set, such as one notebook. */
  async showHomeFiltered(filter) {
    await this.showHome();
    this.home.setFilter(filter);
  },
};
