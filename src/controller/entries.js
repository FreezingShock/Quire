/** Entry actions for the Quire controller: opening, creating, patching, moving, and deleting entries. Mixed into QuireApp. */

import { el } from '../dom.js';
import { contentKey, paintSheet } from './helpers.js';
import { entryRoute } from './routes.js';
import { confirmDialog, entriesDialog, infoDialog, notebookDialog, placeDialog, recapList } from '../dialogs.js';
import { Drawing, normalizeLayers } from '../drawing.js';
import { todaysJournal } from '../journal.js';
import { countByNotebook, countByPlace, sortEntries } from '../library.js';
import { neighbourId } from '../gestures.js';
import {
  createEntry,
  displayTitle,
  formatShortDate,
  isBlankEntry,
  localISODate,
} from '../model.js';
import { isHidden, redactSealed, capsuleStatus, unsealedEntry } from '../capsule.js';
import { unsealAnimation } from '../capsule-ui.js';
import { playSound } from '../sound.js';
import { pickRandomMemory } from '../memories.js';
import { findLinkTarget, linkedFrom } from '../wikilinks.js';
import { recapLines, yearRecap } from '../recap.js';

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
    paintSheet(this.dom.sheet, next.pageColor);
    this.lastSurface = 'text';
    this.setView('editor');
    this.writeRoute(entryRoute(id), mode);
    this.renderLayers();
    this.syncCanvas();
    this.rebuildInk();
    this.renderInkChip();
    this.updateChrome();
    this.renderBacklinks(next);
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

  /** Ctrl+click on [[Title]]: opens the entry with that title, or starts a new entry with it. */
  async followWikiLink(title) {
    await this.persist();
    const today = localISODate();
    const target = findLinkTarget(await this.store.list(), title, today);
    if (target) {
      await this.openEntry(target.id);
      return;
    }
    await this.newEntry({ title, date: today, kind: 'journal' });
    this.showStatus(`Started “${title}”. Entries that link to it will show under it.`);
  },

  /** The Linked from panel under the page: entries whose text links to this one. Refreshed each time an entry opens. */
  async renderBacklinks(entry) {
    const panel = this.dom.backlinks;
    if (!panel) return;
    const sources = linkedFrom(await this.store.list(), entry, localISODate());
    panel.hidden = sources.length === 0;
    panel.replaceChildren(
      el('h3', { class: 'backlinks-title' }, `Linked from (${sources.length})`),
      el(
        'ul',
        { class: 'backlinks-list' },
        sources.map((source) =>
          el(
            'li',
            {},
            el(
              'button',
              { class: 'backlink', type: 'button', onClick: () => this.openEntry(source.id) },
              el('span', { class: 'backlink-title' }, displayTitle(source)),
              el('span', { class: 'backlink-date' }, formatShortDate(source.date)),
            ),
          ),
        ),
      ),
    );
  },

  /** View > Year in review: a recap of this calendar year, counting only days so far. */
  async showYearRecap() {
    await this.persist();
    const today = localISODate();
    const recap = yearRecap(await this.store.list(), Number(today.slice(0, 4)), today);
    infoDialog(`Year in review, ${recap.year}`, recapList(recapLines(recap)));
  },

  /** Opens one past entry at random. Sealed capsules, the sample and blank entries are never picked. */
  async randomMemory() {
    await this.persist();
    const pick = pickRandomMemory(await this.store.list(), localISODate());
    if (!pick) {
      this.showStatus('Write a few entries first. Random memory picks from them.');
      return;
    }
    await this.openEntry(pick.id);
  },

  /**
   * Opens the next or previous entry in the All entries order. `step` is +1 for
   * the next (older) entry and -1 for the previous (newer). Used by the swipe
   * gesture. Sealed time capsules are skipped, as on the lists.
   */
  async openNeighbourEntry(step) {
    await this.persist();
    const today = localISODate();
    const visible = (await this.store.list()).filter((entry) => !isHidden(entry, today));
    const ids = sortEntries(visible).map((entry) => entry.id);
    const id = neighbourId(ids, this.entry?.id, step);
    if (!id) {
      this.showStatus(step > 0 ? 'This is the oldest entry.' : 'This is the newest entry.');
      return;
    }
    await this.openEntry(id);
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
   * Changes pin, favorite, notebook, or place on a stored entry. Any unsaved text of
   * the open entry is written first, so this never drops an edit. The open
   * entry's copy is updated to match.
   */
  async patchEntry(id, fields) {
    await this.persist();
    const current = await this.store.get(id);
    if (!current) return;
    const saved = await this.store.save({ ...current, ...fields });
    if (this.entry?.id === id) {
      this.entry = {
        ...this.entry,
        notebook: saved.notebook,
        place: saved.place,
        pinned: saved.pinned,
        favorite: saved.favorite,
      };
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

  async setEntryPlace(id) {
    await this.persist();
    const entries = await this.store.list();
    const current = entries.find((entry) => entry.id === id);
    if (!current) return;
    placeDialog({
      entryName: displayTitle(current),
      places: countByPlace(entries).map((place) => place.name),
      current: current.place,
      onSave: (place) => {
        if (place !== current.place) this.patchEntry(id, { place });
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
