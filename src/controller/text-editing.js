/** Text editing for the Quire controller: edits to the Markdown source, formatting, inserting pictures and sketches, and editor key handling. Mixed into QuireApp. */

import { SKETCH_HEIGHT, prepareImage, readAsDataUrl } from '../media.js';
import { isISODate, newId, parseTags } from '../model.js';
import {
  blockInsertEdit,
  dividerEdit,
  enterEdit,
  insertEdit,
  toggleBlockEdit,
  wrapEdit,
} from '../textops.js';
import { VOICE_MAX_BYTES, VOICE_MAX_SECONDS, formatDuration, normalizeAudioDataUrl, pickVoiceType } from '../voice.js';

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

  /** Menu: starts a voice note at the caret, or stops the one in progress. */
  toggleVoiceNote() {
    if (this.voice) {
      this.voice.stop();
      return;
    }
    if (!this.entry) return;
    this.startVoiceNote();
  },

  /**
   * Records from the microphone until the user stops it or VOICE_MAX_SECONDS
   * passes. The clip is stored on the entry and a reference line is placed at
   * the caret the recording began at, the same way a picture is.
   */
  async startVoiceNote() {
    if (!navigator.mediaDevices?.getUserMedia || typeof globalThis.MediaRecorder !== 'function') {
      this.showStatus('This browser cannot record voice notes.', true);
      return;
    }
    this.prepareEditing();
    const entry = this.entry;
    const ta = this.dom.editor;
    const range = { start: ta.selectionStart, end: ta.selectionEnd };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.showStatus('Microphone access was blocked, so no voice note was recorded.', true);
      return;
    }
    const type = pickVoiceType();
    const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks = [];
    const started = Date.now();
    let timer = null;
    const release = () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      this.voice = null;
    };
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      release();
      const seconds = (Date.now() - started) / 1000;
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (!blob.size) {
        this.showStatus('Nothing was recorded.', true);
        return;
      }
      if (blob.size > VOICE_MAX_BYTES) {
        this.showStatus('That voice note is too long to keep. Try a shorter one.', true);
        return;
      }
      const src = normalizeAudioDataUrl(await readAsDataUrl(blob));
      if (!src) {
        this.showStatus('The voice note could not be saved.', true);
        return;
      }
      if (this.entry !== entry) {
        this.showStatus('The entry changed while recording, so the voice note was not saved.', true);
        return;
      }
      const id = newId();
      entry.audio[id] = src;
      const from = Math.min(range.start, ta.value.length);
      const to = Math.min(Math.max(from, range.end), ta.value.length);
      this.applyEdit(blockInsertEdit(ta.value, from, to, `![Voice note](quire-audio:${id})`));
      this.showStatus(`Voice note added (${formatDuration(seconds)})`);
    };
    this.voice = {
      stop: () => {
        if (recorder.state !== 'inactive') recorder.stop();
      },
    };
    recorder.start();
    const tick = () => {
      const seconds = (Date.now() - started) / 1000;
      if (seconds >= VOICE_MAX_SECONDS) {
        recorder.stop();
        return;
      }
      this.showStatus(`Recording ${formatDuration(seconds)}. Choose Insert > Stop voice note to finish.`);
    };
    timer = setInterval(tick, 1000);
    tick();
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
