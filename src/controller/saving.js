/** Saving for the Quire controller: snapshots, the debounced save, and keeping version history. Mixed into QuireApp. */

import { SAVE_DELAY_MS } from './constants.js';
import { contentKey, formatTime } from './helpers.js';
import { NORM_WIDTH, inkExtent } from '../drawing.js';
import { MAX_VERSIONS, makeVersion, shouldKeepVersion } from '../versions.js';

export const savingMethods = {
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
  },

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.showStatus('Unsaved changes…', false, 'pending');
    this.saveTimer = setTimeout(() => this.persist(), SAVE_DELAY_MS);
  },

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
  },

  /** Stores a version of `entry` if the rules call for one. Returns true when one was kept. */
  async keepVersion(entry, reason) {
    const latest = await this.store.latestVersion(entry.id);
    if (!shouldKeepVersion({ entry, latest, reason })) return false;
    await this.store.saveVersion(makeVersion(entry, reason), MAX_VERSIONS);
    return true;
  },
};
