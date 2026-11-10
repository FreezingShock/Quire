/** Tool selection, size, ink and page colors, and rename for the Quire controller. Mixed into QuireApp. */

import { SIZE_LETTER_PX } from './constants.js';
import { isTextTarget } from './helpers.js';
import { colorEdit } from '../textops.js';
import { STROKE_SIZES, TOOLS } from '../tools.js';

export const toolModeMethods = {
  // ---------- tools and modes ----------

  setTool(id) {
    this.commitTextDraft();
    this.commitDraft();
    this.stopSpray();
    this.cancelStickerPlacement();
    this.tool = id;
    this.dom.ink.dataset.tool = id;
    for (const button of this.dom.toolbox.querySelectorAll('[data-tool-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.toolId === id));
    }
    this.keyPen?.refresh();
    const tool = TOOLS.find((item) => item.id === id);
    this.dom.hint.textContent = tool?.hint ?? '';
    if (this.dom.stampRow) this.dom.stampRow.hidden = id !== 'stamp';
    if (this.dom.xformRow) this.dom.xformRow.hidden = id !== 'select';
    if (id !== 'select' && this.selection.size) {
      this.selection = new Set();
      this.requestRedraw();
    }
    this.renderSizeRow();
    // Picking a drawing tool takes focus out of any text field, so tool keys work and letters are not typed.
    if (id === 'write') this.dom.editor.focus({ preventScroll: true });
    else if (isTextTarget(document.activeElement)) document.activeElement.blur();
  },

  setSize(size) {
    this.size = size;
    for (const button of this.dom.toolbox.querySelectorAll('[data-size]')) {
      const selected = Number(button.dataset.size) === size;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  },

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
  },

  /** The size row means stroke width for drawing tools, font size for the text box, and size for stamps. */
  renderSizeRow() {
    const mode = this.tool === 'text' ? 'text' : this.tool === 'stamp' ? 'stamp' : '';
    const row = this.dom.toolbox.querySelector('.size-row');
    if (!row) return;
    row.classList.toggle('is-text', mode !== '');
    for (const button of row.querySelectorAll('[data-size]')) {
      const size = Number(button.dataset.size);
      const bar = button.querySelector('span');
      if (mode) {
        const name = mode === 'text' ? 'Text' : 'Stamp';
        button.setAttribute('aria-label', `${name} size ${size}`);
        button.title = `${name} size`;
        bar.className = 'size-letter';
        bar.style.height = '';
        bar.style.fontSize = `${SIZE_LETTER_PX[size] ?? 14}px`;
        bar.textContent = mode === 'text' ? 'A' : '★';
      } else {
        button.setAttribute('aria-label', `Stroke ${size}`);
        button.title = 'Stroke width';
        bar.className = '';
        bar.style.height = `${size}px`;
        bar.style.fontSize = '';
        bar.textContent = '';
      }
    }
  },

  /** Clicking the entry name in the title bar swaps it for the rename field. */
  startRename() {
    if (!this.entry) return;
    // The field is hidden until the class is set, so set it before focusing.
    this.dom.titleWrap.classList.add('is-renaming');
    this.dom.title.focus();
    this.dom.title.select();
  },

  /** Switches to the Write tool so the text can take input. */
  prepareEditing() {
    this.setTool('write');
  },

  setInk(hex) {
    this.fg = hex;
    this.renderInkChip();
  },

  setPageColor(hex) {
    if (!this.entry) return;
    this.entry.pageColor = hex;
    this.dom.sheet.style.backgroundColor = hex;
    this.renderInkChip();
    this.scheduleSave();
  },

  swapInkAndPage() {
    if (!this.entry) return;
    const oldPage = this.entry.pageColor;
    this.setPageColor(this.fg);
    this.setInk(oldPage);
  },

  /** Swatch click: colors the selected text if there is any, and sets the ink. */
  pickColor(hex) {
    const ta = this.dom.editor;
    if (this.tool === 'write' && ta.selectionStart !== ta.selectionEnd) {
      const edit = colorEdit(ta.value, ta.selectionStart, ta.selectionEnd, hex);
      if (edit) this.applyEdit(edit);
    }
    this.setInk(hex);
  },
};
