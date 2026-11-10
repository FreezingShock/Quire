/** Version history actions for the Quire controller: saving a version, listing, restoring, and deleting versions. Mixed into QuireApp. */

import { confirmDialog } from '../dialogs.js';
import { Drawing } from '../drawing.js';
import { formatVersionTime, historyDialog } from '../history.js';
import { mediaResolver } from '../media.js';
import { isBlankEntry } from '../model.js';
import { paintSheet } from './helpers.js';

export const versionActionMethods = {
  // ---------- version history ----------

  /** Keeps a version now, even inside the autosave interval. Returns the message to show. */
  async saveVersionNow() {
    if (!this.entry) return '';
    if (isBlankEntry(this.snapshot())) return 'Nothing to save as a version yet.';
    const kept = await this.persist('manual');
    const message = kept ? 'Version saved.' : 'No changes since the last version.';
    this.showStatus(message, false, 'saved');
    return message;
  },

  async showVersions() {
    if (!this.entry) return;
    await this.persist();
    const entry = this.entry;
    historyDialog({
      load: () => this.store.listVersions(entry.id),
      onRestore: (version) => this.restoreVersion(version),
      onSaveNow: () => this.saveVersionNow(),
      onDelete: (version) => this.deleteVersion(version),
      // Pictures and voice notes are kept with the entry. Sketches come from the version's own strokes, falling back to the current ones.
      mediaFor: (version) =>
        mediaResolver({
          images: entry.images,
          audio: { ...entry.audio, ...(version.content.audio ?? {}) },
          sketches: { ...entry.sketches, ...(version.content.sketches ?? {}) },
          pageColor: version.content.pageColor,
        }),
    });
  },

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
    // Voice notes are restored where the entry has none. A clip the entry still has is kept as it is.
    for (const [id, src] of Object.entries(c.audio ?? {})) {
      if (!Object.hasOwn(this.entry.audio, id)) this.entry.audio[id] = src;
    }
    this.dom.editor.value = c.body;
    this.dom.title.value = c.title;
    this.dom.date.value = c.date;
    this.dom.kind.value = c.kind;
    this.dom.tags.value = c.tags.join(', ');
    this.drawing = new Drawing(c.ink.ops);
    paintSheet(this.dom.sheet, c.pageColor);
    this.lastSurface = 'text';
    this.renderInkChip();
    this.syncCanvas();
    this.updateChrome();
    await this.persist();
    this.showStatus(`Restored the version from ${formatVersionTime(version.savedAt)}`, false, 'saved');
  },

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
  },
};
