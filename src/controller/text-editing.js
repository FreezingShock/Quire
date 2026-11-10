/** Text editing for the Quire controller: edits to the Markdown source, formatting, inserting pictures and sketches, and editor key handling. Mixed into QuireApp. */

import { SKETCH_HEIGHT, prepareImage } from '../media.js';
import { isISODate, newId, parseTags } from '../model.js';
import {
  blockInsertEdit,
  dividerEdit,
  enterEdit,
  insertEdit,
  toggleBlockEdit,
  wrapEdit,
} from '../textops.js';

export const textEditingMethods = {
  // ---------- text editing ----------

  /** Applies an edit description from textops.js. The editor keeps its own undo history. */
  applyEdit({ from, to, insert, selStart, selEnd }) {
    const ta = this.dom.editor;
    ta.focus({ preventScroll: true });
    ta.setRangeText(insert, from, to);
    ta.setSelectionRange(selStart, selEnd);
  },

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
  },

  insertText(text) {
    this.prepareEditing();
    const ta = this.dom.editor;
    this.applyEdit(insertEdit(ta.selectionStart, ta.selectionEnd, text));
  },

  /** Menu: opens the file picker, remembering where the text caret is. */
  pickImages() {
    if (!this.entry) return;
    this.prepareEditing();
    const ta = this.dom.editor;
    this.pendingRange = { start: ta.selectionStart, end: ta.selectionEnd };
    this.imageInput.click();
  },

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
  },

  /** Menu: a blank sketch on its own line between the paragraphs at the caret. */
  insertSketch() {
    if (!this.entry) return;
    this.prepareEditing();
    const id = newId();
    this.entry.sketches[id] = { h: SKETCH_HEIGHT, ops: [] };
    const ta = this.dom.editor;
    this.applyEdit(blockInsertEdit(ta.value, ta.selectionStart, ta.selectionEnd, `![Sketch](quire-sketch:${id})`));
  },

  onEditorChanged() {
    this.lastSurface = 'text';
    this.updateChrome();
    this.scheduleSave();
    this.scheduleTypewriter();
  },

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
  },

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
  },
};
