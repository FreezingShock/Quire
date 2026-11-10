/**
 * Live-preview editor. The entry text is kept as plain Markdown in `source`, and
 * the contenteditable shows it as styled lines. Typing never lets the browser
 * change the DOM: `beforeinput` is cancelled and the edit is applied to the
 * source, which is then rendered again with the caret put back where it was. The
 * browser's own undo stack would break under that, so undo and redo are kept here.
 *
 * The API matches the parts of textarea the app uses (value, selectionStart,
 * selectionEnd, setSelectionRange, setRangeText, focus, select), so the editing
 * code that works on offsets into the text stays the same.
 *
 * Markers (**, #, >, `, [ ] and color tags) are hidden on lines that do not
 * hold the caret. In Source mode, which is a class on the root, they always show.
 *
 * Pictures and inline sketches live on the entry (see media.js). A picture line
 * shows its image under the raw reference. A sketch line gets a live SketchPad,
 * which is cached per id and moved into place after each render. Clicking a
 * checklist box toggles it in the source, and pasted or dropped image files go
 * to `onFiles` instead of the text.
 */

import { parseLiveLines, documentHtml } from './livemarkup.js';
import { SketchPad } from './sketch.js';
import { dataUrlToBlob, imageFiles } from './media.js';

const GROUP_MS = 1200;
const HISTORY_LIMIT = 300;
const graphemes =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code) => code >= 0xdc00 && code <= 0xdfff;

/** Start of the grapheme before index i, so Backspace removes a whole emoji or accent. */
function prevBoundary(text, i) {
  if (i <= 0) return 0;
  if (graphemes) {
    let last = 1;
    for (const { segment } of graphemes.segment(text.slice(Math.max(0, i - 40), i))) last = segment.length;
    return i - last;
  }
  return i - (i >= 2 && isLow(text.charCodeAt(i - 1)) && isHigh(text.charCodeAt(i - 2)) ? 2 : 1);
}

/** End of the grapheme after index i. */
function nextBoundary(text, i) {
  if (i >= text.length) return text.length;
  if (graphemes) {
    for (const { segment } of graphemes.segment(text.slice(i, i + 40))) return i + segment.length;
  }
  return i + (isHigh(text.charCodeAt(i)) && isLow(text.charCodeAt(i + 1)) ? 2 : 1);
}

/** Index of the line that holds offset `abs`, given each line's start offset. */
function lineIndexAt(starts, abs) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= abs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The text node and offset that sit `offset` characters into one rendered line. */
function pointInLine(line, offset) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last = null;
  let node;
  while ((node = walker.nextNode())) {
    last = node;
    if (remaining <= node.length) return [node, remaining];
    remaining -= node.length;
  }
  return last ? [last, last.length] : [line, 0];
}

/** True when a drag carries files, so the browser must not open them. */
function hasFiles(dataTransfer) {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

/** Files from a clipboard, whether the browser lists them as items or as files. */
function clipboardFiles(clipboard) {
  if (!clipboard) return [];
  const items = Array.from(clipboard.items ?? []);
  const fromItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile());
  return fromItems.length ? fromItems : Array.from(clipboard.files ?? []);
}

export class LiveEditor {
  /**
   * @param {HTMLElement} root contenteditable element
   * @param {{
   *   onChange?: () => void,
   *   onHistory?: (redo: boolean) => void,
   *   onFiles?: (files: File[], range: { start: number, end: number }) => void,
   *   inkStyle?: () => { color: string, size: number },
   * }} [options]
   */
  constructor(root, { onChange = () => {}, onHistory = () => {}, onFiles = () => {}, inkStyle = () => ({ color: '#1d1b19', size: 3 }) } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.onHistory = onHistory;
    this.onFiles = onFiles;
    this.inkStyle = inkStyle;
    this.images = {}; // id -> data URL, from the open entry
    this.sketches = {}; // id -> { h, ops }, from the open entry
    this.urls = new Map(); // image id -> object URL for display
    this.pads = new Map(); // sketch id -> SketchPad
    this.source = '';
    this.sel = { start: 0, end: 0 };
    this.focused = false;
    this.composing = false;
    this.undoStack = [];
    this.redoStack = [];
    this.groupKind = null;
    this.groupAt = 0;

    root.addEventListener('beforeinput', (event) => this.onBeforeInput(event));
    root.addEventListener('keydown', (event) => this.onKeydown(event));
    root.addEventListener('input', () => this.onInput());
    root.addEventListener('mousedown', (event) => {
      if (event.target.closest?.('.lv-check')) event.preventDefault();
    });
    root.addEventListener('click', (event) => this.onClick(event));
    root.addEventListener('paste', (event) => this.onPaste(event));
    root.addEventListener('dragover', (event) => {
      if (hasFiles(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    // While files are dragged over the page, the page shows where a picture will land.
    root.addEventListener('dragenter', (event) => {
      if (hasFiles(event.dataTransfer)) root.classList.add('is-drop-target');
    });
    root.addEventListener('dragleave', (event) => {
      if (!root.contains(event.relatedTarget)) root.classList.remove('is-drop-target');
    });
    root.addEventListener('drop', (event) => this.onDrop(event));
    root.addEventListener('focus', () => {
      this.focused = true;
      this.getSelection();
      this.updateActive();
    });
    root.addEventListener('blur', () => {
      this.focused = false;
      this.updateActive();
    });
    root.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    root.addEventListener('compositionend', () => {
      this.composing = false;
      this.syncFromDom();
    });
    document.addEventListener('selectionchange', () => {
      if (this.focused) {
        this.getSelection();
        this.updateActive();
      }
    });
  }

  // ---------- textarea-like API ----------

  get value() {
    return this.source;
  }

  set value(text) {
    this.source = String(text ?? '');
    this.undoStack = [];
    this.redoStack = [];
    this.groupKind = null;
    const end = this.source.length;
    this.render({ start: end, end });
  }

  /**
   * Points the editor at an entry's pictures and sketches. Call it before setting
   * `value`, because the value setter renders. The objects are shared with the
   * entry, so a sketch edit lands in the entry without a copy.
   */
  setMedia(entry) {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls = new Map();
    this.pads = new Map();
    this.images = entry?.images ?? {};
    this.sketches = entry?.sketches ?? {};
  }

  get selectionStart() {
    return this.getSelection().start;
  }

  get selectionEnd() {
    return this.getSelection().end;
  }

  setSelectionRange(start, end = start) {
    const a = this.clamp(start);
    const b = this.clamp(Math.max(a, end));
    this.sel = { start: a, end: b };
    if (this.focused) this.applySelection(a, b);
    this.updateActive();
  }

  /** Replaces text[from:to] with `text` as one undoable edit. */
  setRangeText(text, from, to) {
    this.replace(this.clamp(from), this.clamp(to), text, 'edit');
  }

  select() {
    this.setSelectionRange(0, this.source.length);
  }

  focus(options) {
    // A selection already inside the editor (for example from Select all) is newer than the saved one.
    const current = document.getSelection();
    const inside = Boolean(current && current.rangeCount && this.root.contains(current.anchorNode));
    this.root.focus(options);
    if (inside) this.getSelection();
    else this.applySelection(this.sel.start, this.sel.end);
    this.updateActive();
  }

  // ---------- history ----------

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  snapshot() {
    const { start, end } = this.getSelection();
    return { value: this.source, start, end };
  }

  restore(snap) {
    this.groupKind = null;
    this.source = snap.value;
    this.render({ start: snap.start, end: snap.end });
    this.onChange();
  }

  /** Typing and deleting in a row share one undo step. Formatting and paste always start a new one. */
  record(before, kind) {
    const now = Date.now();
    const grouped = (kind === 'type' || kind === 'delete') && kind === this.groupKind && now - this.groupAt < GROUP_MS;
    if (!grouped) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.groupKind = kind;
    this.groupAt = now;
  }

  // ---------- edits ----------

  onBeforeInput(event) {
    if (event.isComposing || this.composing) return;
    event.preventDefault();
    const { start, end } = this.getSelection();
    const type = event.inputType;

    if (type === 'insertText' || type === 'insertReplacementText') {
      const text = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
      if (text) this.replace(start, end, text, start === end && type === 'insertText' ? 'type' : 'edit');
    } else if (type === 'insertLineBreak' || type === 'insertParagraph') {
      this.replace(start, end, '\n', 'edit');
    } else if (type === 'insertFromPaste' || type === 'insertFromDrop') {
      const raw = event.dataTransfer?.getData('text/plain') || event.data || '';
      const text = raw.replace(/\r\n?/g, '\n');
      if (text) this.replace(start, end, text, 'edit');
    } else if (type.startsWith('delete')) {
      const [from, to] = this.deletionRange(type, start, end);
      if (to > from) this.replace(from, to, '', 'delete');
    } else if (type === 'historyUndo') {
      this.onHistory(false);
    } else if (type === 'historyRedo') {
      this.onHistory(true);
    }
    // Formatting and other input types are ignored. Formatting goes through the toolbar.
  }

  /** Pasted pictures become entry pictures. Pasted text is left to beforeinput. */
  onPaste(event) {
    const files = imageFiles(clipboardFiles(event.clipboardData));
    if (!files.length) return;
    event.preventDefault();
    const { start, end } = this.getSelection();
    this.onFiles(files, { start, end });
  }

  /** Dropped pictures go where the pointer is. Other drops are left alone. */
  onDrop(event) {
    this.root.classList.remove('is-drop-target');
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const files = imageFiles(event.dataTransfer.files);
    if (!files.length) return;
    // A drop lands after the line under the pointer, so a picture never splits a sentence.
    const under = this.offsetAtPoint(event.clientX, event.clientY) ?? this.getSelection().start;
    const newline = this.source.indexOf('\n', under);
    const at = newline === -1 ? this.source.length : newline;
    this.onFiles(files, { start: at, end: at });
  }

  /** Source offset under a screen point, or null when the point is outside the text. */
  offsetAtPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) [node, offset] = [position.offsetNode, position.offset];
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) [node, offset] = [range.startContainer, range.startOffset];
    }
    if (!node || !this.root.contains(node)) return null;
    return this.offsetOf(node, offset);
  }

  /** A click on a checklist box flips it between [ ] and [x] in the source. */
  onClick(event) {
    const box = event.target.closest?.('.lv-check');
    if (!box || !box.firstChild) return;
    event.preventDefault();
    const at = this.offsetOf(box.firstChild, 0);
    const mark = this.source.slice(at, at + 3);
    if (mark !== '[ ]' && mark.toLowerCase() !== '[x]') return;
    const next = this.source.slice(0, at) + (mark === '[ ]' ? '[x]' : '[ ]') + this.source.slice(at + 3);
    this.commit(next, { ...this.sel }, 'edit');
  }

  /** Removes a sketch's line from the text. The sketch itself stays on the entry, so Undo brings it back. */
  removeSketch(id) {
    const at = this.source.indexOf(`(quire-sketch:${id})`);
    if (at < 0) return;
    const from = this.source.lastIndexOf('\n', at - 1) + 1;
    const end = this.source.indexOf('\n', at);
    const next = end === -1 ? this.source.slice(0, Math.max(0, from - 1)) : this.source.slice(0, from) + this.source.slice(end + 1);
    const caret = Math.min(from, next.length);
    this.commit(next, { start: caret, end: caret }, 'edit');
  }

  onKeydown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    // Undo and redo are handled here, and the app decides whether ink or text is the target.
    event.preventDefault();
    event.stopPropagation();
    this.onHistory(key === 'y' || event.shiftKey);
  }

  /** Fallback for changes the browser made without a beforeinput we could cancel. */
  onInput() {
    if (!this.composing) this.syncFromDom();
  }

  deletionRange(type, start, end) {
    if (start !== end) return [start, end];
    const s = this.source;
    switch (type) {
      case 'deleteContentBackward':
        return [prevBoundary(s, start), start];
      case 'deleteContentForward':
        return [start, nextBoundary(s, start)];
      case 'deleteWordBackward':
      case 'deleteEntireWordBackward': {
        const before = s.slice(0, start);
        const trimmed = before.replace(/\s+$/, '');
        const word = /\S*$/.exec(trimmed);
        return [word ? word.index : 0, start];
      }
      case 'deleteWordForward':
      case 'deleteEntireWordForward': {
        const after = /^\s*\S*/.exec(s.slice(start));
        return [start, start + (after ? after[0].length : 0)];
      }
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward': {
        const from = s.lastIndexOf('\n', start - 1) + 1;
        if (from < start) return [from, start];
        return [Math.max(0, start - 1), start];
      }
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward': {
        const newline = s.indexOf('\n', start);
        const to = newline === -1 ? s.length : newline;
        if (to > start) return [start, to];
        return [start, Math.min(s.length, start + 1)];
      }
      default:
        return [start, end];
    }
  }

  replace(from, to, text, kind) {
    const next = this.source.slice(0, from) + text + this.source.slice(to);
    const caret = from + text.length;
    this.commit(next, { start: caret, end: caret }, kind);
  }

  commit(next, sel, kind, prior = this.sel) {
    if (next === this.source) {
      this.render(sel);
      return;
    }
    this.record({ value: this.source, start: prior.start, end: prior.end }, kind);
    this.source = next;
    this.render(sel);
    this.onChange();
  }

  /** Reads the text the browser now shows, then keeps it as the source. */
  syncFromDom() {
    const prior = { ...this.sel };
    const next = this.readDom();
    const sel = this.getSelection();
    if (next !== this.source) this.commit(next, sel, 'edit', prior);
    else this.render(sel);
  }

  readDom() {
    return Array.from(this.root.childNodes, (node) => (node.nodeName === 'BR' ? '' : node.textContent)).join('\n');
  }

  // ---------- rendering ----------

  render(sel) {
    this.root.innerHTML = documentHtml(parseLiveLines(this.source), { resolve: (kind, id) => this.mediaFor(kind, id) });
    this.root.dataset.empty = this.source ? 'false' : 'true';
    this.mountSketches();
    if (sel) {
      this.sel = { start: this.clamp(sel.start), end: this.clamp(Math.max(this.clamp(sel.start), sel.end)) };
      if (this.focused) this.applySelection(this.sel.start, this.sel.end);
    }
    this.updateActive();
  }

  /** What a picture or sketch id resolves to while drawing a line. */
  mediaFor(kind, id) {
    if (kind === 'image') return this.imageUrl(id);
    return Object.hasOwn(this.sketches, id) ? true : null;
  }

  /** Display URL for a stored picture, made once per picture from its data URL. */
  imageUrl(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    if (!Object.hasOwn(this.images, id)) return null;
    const blob = dataUrlToBlob(this.images[id]);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }

  /** Moves each sketch's pad into its slot, creating the pad the first time. */
  mountSketches() {
    for (const slot of this.root.querySelectorAll('.lv-sketch[data-sketch-id]')) {
      const id = slot.dataset.sketchId;
      if (!Object.hasOwn(this.sketches, id)) continue;
      let pad = this.pads.get(id);
      if (!pad) {
        pad = new SketchPad(this.sketches[id], {
          ink: this.inkStyle,
          onChange: () => this.onChange(),
          onRemove: () => this.removeSketch(id),
        });
        this.pads.set(id, pad);
      }
      slot.replaceChildren(pad.el);
      pad.sync();
    }
  }

  /** Puts the `is-active` class on lines that the selection touches. Only those show their markers. */
  updateActive() {
    const lines = this.root.children;
    let first = -1;
    let last = -2;
    if (this.focused && lines.length) {
      const starts = this.lineStarts();
      first = lineIndexAt(starts, this.sel.start);
      last = lineIndexAt(starts, this.sel.end);
    }
    for (let i = 0; i < lines.length; i += 1) {
      lines[i].classList.toggle('is-active', i >= first && i <= last);
    }
  }

  /** Start offset of each rendered line, measured from the DOM so it stays right during a browser edit. */
  lineStarts() {
    const starts = [];
    let pos = 0;
    for (const line of this.root.children) {
      starts.push(pos);
      pos += line.textContent.length + 1;
    }
    return starts;
  }

  clamp(value) {
    return Math.max(0, Math.min(value, this.source.length));
  }

  /** Offset in the source text for a DOM point. */
  offsetOf(node, offset) {
    const lines = this.root.children;
    if (!lines.length) return 0;
    const starts = this.lineStarts();
    if (node === this.root) {
      if (offset >= lines.length) {
        const last = lines.length - 1;
        return starts[last] + lines[last].textContent.length;
      }
      return starts[offset];
    }
    let line = node;
    while (line.parentNode && line.parentNode !== this.root) line = line.parentNode;
    const index = Array.prototype.indexOf.call(lines, line);
    if (index < 0) return 0;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(node, offset);
    return starts[index] + Math.min(range.toString().length, line.textContent.length);
  }

  /** DOM point for an offset in the source text. */
  pointAt(abs) {
    const lines = this.root.children;
    const starts = this.lineStarts();
    const index = lineIndexAt(starts, abs);
    const line = lines[index];
    return pointInLine(line, Math.min(abs - starts[index], line.textContent.length));
  }

  getSelection() {
    const selection = document.getSelection();
    if (
      selection &&
      selection.rangeCount &&
      this.root.contains(selection.anchorNode) &&
      this.root.contains(selection.focusNode)
    ) {
      const range = selection.getRangeAt(0);
      this.sel = {
        start: this.offsetOf(range.startContainer, range.startOffset),
        end: this.offsetOf(range.endContainer, range.endOffset),
      };
    }
    return this.sel;
  }

  applySelection(start, end) {
    if (!this.root.children.length) return;
    const [startNode, startOffset] = this.pointAt(start);
    const [endNode, endOffset] = this.pointAt(end);
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
