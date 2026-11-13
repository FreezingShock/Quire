/** Text boxes on the ink canvas for the Quire controller: placing, drafting, and committing a text box. Mixed into QuireApp. */

import { el } from '../dom.js';
import {
  DEFAULT_TEXT_WIDTH,
  TEXT_SIZES,
  hitOp,
} from '../drawing.js';
import { fontStackFor, isKnownFont, normalizeFontId } from '../fonts.js';
import { snapToGrid } from '../snap.js';

export const textBoxMethods = {
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
  },

  finishTextBox() {
    const { a, b } = this.live;
    this.live = null;
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const width = x1 - x0 < 40 ? DEFAULT_TEXT_WIDTH : x1 - x0;
    // A new box uses the font picked for text boxes, or the writing font when none is picked.
    const font = normalizeFontId(isKnownFont(this.prefs.textFont) ? this.prefs.textFont : this.prefs.font);
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
  },

  startTextEdit(op) {
    this.lifted = { ids: new Set([op.id]), ops: [], dx: 0, dy: 0 };
    this.openTextDraft({ id: op.id, a: op.a, b: op.b, c: op.c, f: op.f ?? 'serif', s: op.s, text: op.text ?? '' });
    this.rebuildInk();
  },

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
  },

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
    node.style.fontFamily = fontStackFor(draft.f);
    node.style.color = draft.c;
    this.sizeTextDraft();
  },

  sizeTextDraft() {
    const node = this.textDraft?.node;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  },

  onTextDraftKeydown(event) {
    // The field keeps every key, including Ctrl+Z, so typing never reaches the shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) {
      event.preventDefault();
      this.commitTextDraft();
    }
  },

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
  },
};
