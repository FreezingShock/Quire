/** Entry actions for the Quire controller: opening, creating, patching, moving, and deleting entries. Mixed into QuireApp. */

import { contentKey } from './helpers.js';
import { entryRoute } from './routes.js';
import { confirmDialog, entriesDialog, notebookDialog } from '../dialogs.js';
import { Drawing, normalizeLayers } from '../drawing.js';
import { todaysJournal } from '../journal.js';
import { countByNotebook } from '../library.js';
import {
  createEntry,
  displayTitle,
  isBlankEntry,
  localISODate,
} from '../model.js';
import { isHidden, redactSealed, capsuleStatus, unsealedEntry } from '../capsule.js';
import { unsealAnimation } from '../capsule-ui.js';
import { playSound } from '../sound.js';
import { TRASH_DAYS, splitExpired } from '../trash.js';

export const entryMethods = {
  // ---------- entries ----------

  async openEntry(id, { history: mode = 'push' } = {}) {
    if (this.entry?.id === id && this.view === 'editor') return;
    // A closed time capsule is never loaded into the editor. Its text is not read until it is unsealed.
    const peek = await this.store.get(id);
    const status = capsuleStatus(peek);
    if (status === 'sealed') {
      await this.showHome({ history: 'replace' });
      this.showSealedNotice(peek);
      return;
    }
    if (status === 'ready') {
      const opened = await unsealAnimation({ entry: peek, animate: this.prefs.motion !== false });
      if (!opened) return;
      await this.store.save(unsealedEntry(peek));
    }
    this.commitTextDraft();
    this.commitDraft();
    await this.persist('leave');
    if (this.entry && isBlankEntry(this.snapshot())) {
      await this.store.remove(this.entry.id);
    }
    const next = await this.store.get(id);
    if (!next || next.deletedAt) {
      await this.showHome({ history: 'replace' });
      this.showStatus(next ? 'That entry is in the desk drawer. Restore it to open it.' : 'That entry no longer exists.', true);
      return;
    }
    this.entry = next;
    this.dom.editor.setMedia(next);
    this.dom.editor.value = next.body;
    this.dom.title.value = next.title;
    this.dom.date.value = next.date;
    this.dom.kind.value = next.kind;
    this.dom.mood.value = next.mood ?? '';
    this.dom.weather.value = next.weather ?? '';
    this.dom.tags.value = next.tags.join(', ');
    this.mixtape.setEntry(next.id, next.mixtape);
    this.drawing = new Drawing(next.ink.ops);
    this.layers = normalizeLayers(next.ink.layers);
    this.savedKey = contentKey(next);
    this.activeLayer = this.layers[this.layers.length - 1].id;
    this.selection = new Set();
    this.lifted = null;
    this.index = null;
    this.dom.sheet.style.backgroundColor = next.pageColor;
    this.lastSurface = 'text';
    this.setView('editor');
    this.writeRoute(entryRoute(id), mode);
    this.renderLayers();
    this.syncCanvas();
    this.rebuildInk();
    this.renderInkChip();
    this.updateChrome();
    this.setPref({ lastEntryId: id });
    this.showStatus('');
    this.dom.editor.focus({ preventScroll: true });
  },

  /** Starts a blank entry. `fields` can set the date, e.g. when a calendar day is picked. */
  async newEntry(fields = {}) {
    const entry = createEntry(fields);
    await this.store.save(entry);
    await this.openEntry(entry.id);
    this.dom.title.focus();
    playSound('newEntry');
  },

  /**
   * Opens today's most recently edited journal entry, or starts a new journal for today.
   * A new journal can start from a writing prompt, set as a quote so the first line is ready to answer.
   */
  async openToday({ prompt } = {}) {
    await this.persist();
    const today = localISODate();
    // A closed capsule is never today's journal, so a new page starts instead of opening it.
    const open = (await this.store.list()).filter((entry) => !isHidden(entry, today));
    const existing = todaysJournal(open, today);
    if (existing) await this.openEntry(existing.id);
    else await this.newEntry({ date: today, kind: 'journal', body: prompt ? `> ${prompt}\n\n` : '' });
  },

  /**
   * The library for the list and the desk drawer. Entries that have waited in
   * the drawer for TRASH_DAYS are removed for good first, so auto-empty runs
   * every time the list is loaded.
   */
  async loadLibrary() {
    const { kept, expired } = splitExpired(await this.store.listTrash());
    for (const entry of expired) await this.store.remove(entry.id);
    return { entries: await this.store.list(), trashed: kept };
  },

  showEntries() {
    entriesDialog({
      load: async () => {
        await this.persist();
        return redactSealed(await this.store.list());
      },
      currentId: this.entry?.id,
      onOpen: (id) => this.openEntry(id),
      onNew: () => this.newEntry(),
      onDelete: (id) => this.deleteEntry(id),
    });
  },

  /**
   * Changes pin, favorite, or notebook on a stored entry. Any unsaved text of
   * the open entry is written first, so this never drops an edit. The open
   * entry's copy is updated to match.
   */
  async patchEntry(id, fields) {
    await this.persist();
    const current = await this.store.get(id);
    if (!current) return;
    const saved = await this.store.save({ ...current, ...fields });
    if (this.entry?.id === id) {
      this.entry = { ...this.entry, notebook: saved.notebook, pinned: saved.pinned, favorite: saved.favorite };
      this.renderEntryPath();
    }
    await this.refreshHome();
  },

  async moveEntryToNotebook(id) {
    await this.persist();
    const entries = await this.store.list();
    const current = entries.find((entry) => entry.id === id);
    if (!current) return;
    notebookDialog({
      entryName: displayTitle(current),
      notebooks: countByNotebook(entries).map((notebook) => notebook.name),
      current: current.notebook,
      onSave: (notebook) => {
        if (notebook !== current.notebook) this.patchEntry(id, { notebook });
      },
    });
  },

  /**
   * Moves an entry to the desk drawer, like the Recycle Bin: no prompt, because
   * Restore brings it back. It is removed for good after TRASH_DAYS. Edits in
   * the open entry are saved first, so the drawer copy is the latest one.
   */
  async deleteEntry(id) {
    this.commitTextDraft();
    const isCurrent = this.entry?.id === id;
    if (isCurrent) await this.persist('leave');
    await this.saveChain;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const target = await this.store.get(id);
    if (!target || target.deletedAt) return;
    if (isCurrent) this.entry = null;
    await this.store.setTrashed(id, new Date().toISOString());
    if (isCurrent) await this.showHome({ history: 'replace' });
    else await this.refreshHome();
    this.showStatus(`“${displayTitle(target)}” moved to the desk drawer`);
    playSound('delete');
  },

  /** Takes an entry out of the desk drawer and back into the library. */
  async restoreEntry(id) {
    const target = await this.store.get(id);
    if (!target?.deletedAt) return;
    await this.store.setTrashed(id, null);
    await this.refreshHome();
    this.showStatus(`“${displayTitle(target)}” restored`);
  },

  /** Removes a drawer entry for good, with its drawing, pictures and versions. */
  async purgeEntry(id) {
    const target = await this.store.get(id);
    if (!target?.deletedAt) return;
    const ok = await confirmDialog({
      title: 'Delete this entry for good?',
      message: `“${displayTitle(target)}” and its drawing, pictures and versions are removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    await this.store.remove(id);
    await this.refreshHome();
    this.showStatus('Entry deleted for good');
    playSound('delete');
  },

  /** Removes every entry in the desk drawer for good. */
  async emptyDeskDrawer() {
    const trashed = await this.store.listTrash();
    if (!trashed.length) return;
    const count = trashed.length;
    const ok = await confirmDialog({
      title: 'Empty the desk drawer?',
      message: `${count} ${count === 1 ? 'entry' : 'entries'} will be removed for good, with ${count === 1 ? 'its' : 'their'} drawings, pictures and versions. This cannot be undone.`,
      confirmLabel: 'Empty drawer',
      danger: true,
    });
    if (!ok) return;
    for (const entry of trashed) await this.store.remove(entry.id);
    await this.refreshHome();
    this.showStatus('The desk drawer is empty');
    playSound('delete');
  },
};
