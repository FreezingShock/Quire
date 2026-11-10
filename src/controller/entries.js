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
    if (!next) {
      await this.showHome({ history: 'replace' });
      this.showStatus('That entry no longer exists.', true);
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

  async deleteEntry(id) {
    this.commitTextDraft();
    const target = await this.store.get(id);
    if (!target) return;
    const ok = await confirmDialog({
      title: 'Delete this entry?',
      message: `“${displayTitle(target)}” and its drawing will be removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await this.saveChain;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const isCurrent = this.entry?.id === id;
    if (isCurrent) this.entry = null;
    await this.store.remove(id);
    if (isCurrent) await this.showHome({ history: 'replace' });
    else await this.refreshHome();
    this.showStatus('Entry deleted');
    playSound('delete');
  },
};
