/**
 * Quire application controller. It wires the UI to the entry store, the drawing
 * layer, and the text editor. Text lives in a textarea (Markdown source) and
 * ink lives in a canvas laid over the sheet. The canvas has two layers: a base
 * canvas with every committed op, and the display canvas, which adds the stroke
 * in progress.
 */

import { createLocalStore } from './storage.js';
import { openPasscodeSettings, unlockStore } from './lock.js';
import {
  MOODS,
  WEATHERS,
  createEntry,
  displayTitle,
  isBlankEntry,
  localISODate,
} from './model.js';
import { todaysJournal } from './journal.js';
import { countByNotebook } from './library.js';
import { mediaResolver } from './media.js';
import { LiveEditor } from './livetext.js';
import {
  BASE_LAYER,
  Drawing,
  NORM_WIDTH,
  inkExtent,
  normalizeLayers,
} from './drawing.js';
import { PALETTE, TOOL_BY_KEY } from './tools.js';
import { el } from './dom.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { playSound } from './sound.js';
import {
  downloadBlob,
  exportDrawingPng,
  exportMarkdown,
  makeBackup,
  parseBackup,
  printEntry,
} from './export.js';
import {
  confirmDialog,
  entriesDialog,
  notebookDialog,
  showShortcuts,
} from './dialogs.js';
import { installState, promptInstall, showInstallHelp, startPwa, startReminders, REMINDER_DEFAULTS } from './pwa.js';
import { HomeView } from './home.js';
import { sampleEntry } from './onboarding.js';
import { MAX_VERSIONS, makeVersion, shouldKeepVersion } from './versions.js';
import { formatVersionTime, historyDialog } from './history.js';
import {
  FONT_STACKS,
  NUDGE,
  NUDGE_FAST,
  SAVE_DELAY_MS,
  ZOOM_STEPS,
} from './controller/constants.js';
import {
  $,
  contentKey,
  fillSelect,
  formatTime,
  isTextTarget,
} from './controller/helpers.js';
import { entryRoute, routeEntryId } from './controller/routes.js';
import { chromeMethods } from './controller/chrome.js';
import { routingMethods } from './controller/routing.js';
import { buildUiMethods } from './controller/build-ui.js';
import { toolModeMethods } from './controller/tool-modes.js';
import { textEditingMethods } from './controller/text-editing.js';
import { inkCanvasMethods } from './controller/ink-canvas.js';
import { sprayShapeMethods } from './controller/shapes-spray.js';
import { magnifierMethods } from './controller/magnifier.js';
import { transformMethods } from './controller/transforms.js';
import { toolboxRowMethods } from './controller/toolbox-rows.js';
import { selectionMethods } from './controller/selection.js';
import { textBoxMethods } from './controller/text-boxes.js';
import { layerActionMethods } from './controller/layer-actions.js';



export class QuireApp {
  constructor() {
    this.dom = {
      windowTitle: $('#window-title'),
      titleWrap: $('#titlebar-entry'),
      saveStatus: $('#save-status'),
      menubar: $('#menubar'),
      ribbonToggle: $('#ribbon-toggle'),
      title: $('#entry-title'),
      date: $('#entry-date'),
      kind: $('#entry-kind'),
      mood: $('#entry-mood'),
      weather: $('#entry-weather'),
      tags: $('#entry-tags'),
      sheet: $('#sheet'),
      editorEl: $('#editor'),
      ink: $('#ink'),
      grid: $('#grid'),
      toolbox: $('#toolbox'),
      layers: null,
      swatches: $('#swatches'),
      inkChip: $('#ink-chip'),
      hint: $('#hint'),
      words: $('#status-words'),
      mode: $('#status-mode'),
      statusDate: $('#status-date'),
      app: $('.app'),
      home: $('#home'),
    };
    this.dom.editor = new LiveEditor(this.dom.editorEl, {
      onChange: () => this.onEditorChanged(),
      onHistory: (redo) => (redo ? this.redo() : this.undo()),
      onFiles: (files, range) => this.insertImages(files, range),
      inkStyle: () => ({ color: this.fg, size: this.size }),
    });
    this.prefs = loadPrefs();
    this.store = null;
    this.passcodeOn = false; // whether the passcode lock is on; the File menu reads it
    this.entry = null;
    this.drawing = new Drawing();
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.inkCtx = this.dom.ink.getContext('2d');
    this.gridCtx = this.dom.grid.getContext('2d');
    this.shiftHeld = false;
    this.rawEnd = null;
    this.scale = 1;
    this.tool = 'write';
    this.size = 3;
    this.fg = PALETTE[0];
    this.live = null;
    this.livePen = false;
    this.pointerId = null;
    this.stack = null; // per-layer canvases, rebuilt when the sheet size changes
    this.layers = [];
    this.activeLayer = BASE_LAYER;
    this.selection = new Set();
    this.selDrag = null; // { mode: 'marquee' | 'move', start, end } while a select drag runs
    this.draft = null; // a curve being bent, or a polygon still getting sides; see commitDraft()
    this.gesture = null; // { kind: 'bend' | 'polygon', ... } while the pointer works on the draft
    this.sprayTimer = 0;
    this.stampKind = 'star';
    this.zoom = 1; // magnifier level from ZOOM_STEPS; a view setting, not saved with the entry
    this.xformReady = null; // whether the selection row's buttons are enabled
    this.lifted = null; // { ids, ops, dx, dy }: ops left off the base canvas while they are moved or edited
    this.textDraft = null; // { node, id, a, b, c, f, s, text } for the text box being typed
    this.index = null; // resolved ops and their bounds, rebuilt when the drawing changes
    this.lastSurface = 'text';
    this.saveTimer = 0;
    this.savedKey = null; // contentKey of the open entry as last written
    this.saveChain = Promise.resolve();
    this.frame = 0;
    this.syncFrame = 0;
    this.menubar = null;
    this.view = 'home'; // 'home' or 'editor'; the landing page is the entries list
    this.home = null;
  }

  async start() {
    fillSelect(this.dom.mood, MOODS, 'Not set');
    fillSelect(this.dom.weather, WEATHERS, 'Not set');
    this.applyPrefs();
    this.buildToolbox();
    this.buildSwatches();
    this.buildMenus();
    this.home = new HomeView(this.dom.home, {
      view: this.prefs.homeView,
      // applyPrefs runs before the view exists, so the saved card choices go in here too.
      showPrompts: Boolean(this.prefs.showPrompts),
      showOnThisDay: Boolean(this.prefs.showOnThisDay),
      showTips: !this.prefs.tipsDismissed,
      onOpen: (id) => this.openEntry(id),
      onNew: (options) => this.newEntry(options),
      onToday: () => this.openToday(),
      onWritePrompt: (prompt) => this.openToday({ prompt }),
      onHidePrompts: () => this.setPref({ showPrompts: false }),
      onDismissTips: () => this.setPref({ tipsDismissed: true }),
      onDelete: (id) => this.deleteEntry(id),
      onPatch: (id, fields) => this.patchEntry(id, fields),
      onViewChange: (view) => this.setPref({ homeView: view }),
    });
    this.bindEvents();
    this.setTool('write');
    this.store = await createLocalStore();
    if (this.store.kind === 'memory') {
      this.showStatus('Browser storage is unavailable. Entries will not survive a reload.', true);
    }
    // Nothing is read until the passcode, if there is one, is typed.
    this.passcodeOn = await unlockStore(this.store);
    startPwa({ onReady: () => this.showStatus('Quire is ready to work offline', false, 'saved') });
    startReminders({
      getReminder: () => this.prefs.reminder ?? REMINDER_DEFAULTS,
      saveReminder: (reminder) => this.setPref({ reminder }),
      hasEntryOn: async (day) => (await this.store.list()).some((entry) => entry.date === day),
    });
    await this.seedSampleEntry();
    // The site opens on the dashboard. A reload on an entry keeps that entry.
    const routed = routeEntryId(location.hash);
    const entries = await this.store.list();
    if (routed && entries.some((entry) => entry.id === routed)) {
      await this.openEntry(routed, { history: 'replace' });
    } else {
      await this.showHome({ history: 'replace' });
    }
  }

  /**
   * First run: a library with no entries gets one sample entry, once. The flag
   * is set on the first start whatever happens, so a deleted sample stays
   * deleted and a library that already has entries never gets one.
   */
  async seedSampleEntry() {
    if (this.prefs.sampleSeeded) return;
    this.prefs = savePrefs({ sampleSeeded: true });
    if ((await this.store.list()).length) return;
    await this.store.save(createEntry(sampleEntry(localISODate())));
  }

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
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.showStatus('Unsaved changes…', false, 'pending');
    this.saveTimer = setTimeout(() => this.persist(), SAVE_DELAY_MS);
  }

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
  }

  /** Stores a version of `entry` if the rules call for one. Returns true when one was kept. */
  async keepVersion(entry, reason) {
    const latest = await this.store.latestVersion(entry.id);
    if (!shouldKeepVersion({ entry, latest, reason })) return false;
    await this.store.saveVersion(makeVersion(entry, reason), MAX_VERSIONS);
    return true;
  }

  // ---------- entries ----------

  async openEntry(id, { history: mode = 'push' } = {}) {
    if (this.entry?.id === id && this.view === 'editor') return;
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
  }

  /** Starts a blank entry. `fields` can set the date, e.g. when a calendar day is picked. */
  async newEntry(fields = {}) {
    const entry = createEntry(fields);
    await this.store.save(entry);
    await this.openEntry(entry.id);
    this.dom.title.focus();
    playSound('newEntry');
  }

  /**
   * Opens today's most recently edited journal entry, or starts a new journal for today.
   * A new journal can start from a writing prompt, set as a quote so the first line is ready to answer.
   */
  async openToday({ prompt } = {}) {
    await this.persist();
    const today = localISODate();
    const existing = todaysJournal(await this.store.list(), today);
    if (existing) await this.openEntry(existing.id);
    else await this.newEntry({ date: today, kind: 'journal', body: prompt ? `> ${prompt}\n\n` : '' });
  }

  showEntries() {
    entriesDialog({
      load: async () => {
        await this.persist();
        return this.store.list();
      },
      currentId: this.entry?.id,
      onOpen: (id) => this.openEntry(id),
      onNew: () => this.newEntry(),
      onDelete: (id) => this.deleteEntry(id),
    });
  }

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
    }
    await this.refreshHome();
  }

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
  }

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
  }

  // ---------- version history ----------

  /** Keeps a version now, even inside the autosave interval. Returns the message to show. */
  async saveVersionNow() {
    if (!this.entry) return '';
    if (isBlankEntry(this.snapshot())) return 'Nothing to save as a version yet.';
    const kept = await this.persist('manual');
    const message = kept ? 'Version saved.' : 'No changes since the last version.';
    this.showStatus(message, false, 'saved');
    return message;
  }

  async showVersions() {
    if (!this.entry) return;
    await this.persist();
    const entry = this.entry;
    historyDialog({
      load: () => this.store.listVersions(entry.id),
      onRestore: (version) => this.restoreVersion(version),
      onSaveNow: () => this.saveVersionNow(),
      onDelete: (version) => this.deleteVersion(version),
      // Pictures are kept with the entry. Sketches come from the version's own strokes, falling back to the current ones.
      mediaFor: (version) =>
        mediaResolver({
          images: entry.images,
          sketches: { ...entry.sketches, ...(version.content.sketches ?? {}) },
          pageColor: version.content.pageColor,
        }),
    });
  }

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
    this.dom.editor.value = c.body;
    this.dom.title.value = c.title;
    this.dom.date.value = c.date;
    this.dom.kind.value = c.kind;
    this.dom.tags.value = c.tags.join(', ');
    this.drawing = new Drawing(c.ink.ops);
    this.dom.sheet.style.backgroundColor = c.pageColor;
    this.lastSurface = 'text';
    this.renderInkChip();
    this.syncCanvas();
    this.updateChrome();
    await this.persist();
    this.showStatus(`Restored the version from ${formatVersionTime(version.savedAt)}`, false, 'saved');
  }

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
  }

  // ---------- export, backup, restore ----------

  async exportMarkdown() {
    if (!this.entry) return;
    await exportMarkdown(this.snapshot());
    this.showStatus('Exported Markdown');
    playSound('export');
  }

  async exportDrawing() {
    if (!this.entry) return;
    if (this.drawing.isEmpty) {
      this.showStatus('Nothing drawn yet');
      return;
    }
    await exportDrawingPng(this.snapshot());
    this.showStatus('Exported drawing');
    playSound('export');
  }

  printPdf() {
    if (!this.entry) return;
    printEntry(this.snapshot(), { fontStack: FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif });
  }

  /** Uses the browser's install prompt when it offered one. Otherwise it explains the browser's own steps. */
  async installQuire() {
    if (installState() !== 'available') {
      showInstallHelp();
      return;
    }
    if ((await promptInstall()) === 'accepted') this.showStatus('Quire is installing…', false, 'saved');
  }

  async passcodeSettings() {
    await openPasscodeSettings({
      store: this.store,
      flush: () => this.persist(),
      status: (text) => this.showStatus(text),
      setOn: (on) => {
        this.passcodeOn = on;
      },
    });
  }

  async backup() {
    await this.persist();
    const entries = await this.store.listFull();
    const versions = await this.store.listAllVersions();
    downloadBlob(makeBackup(entries, versions), `quire-backup-${localISODate()}.json`);
    this.showStatus(`Backed up ${entries.length} entries and ${versions.length} versions`);
  }

  restore() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) await this.restoreFrom(file);
    });
    document.body.append(input);
    input.click();
  }

  async restoreFrom(file) {
    const { entries, versions } = parseBackup(await file.text());
    await this.persist();
    // Drop the in-memory entry first, so a stale copy cannot overwrite the restored one.
    this.entry = null;
    for (const entry of entries) await this.store.save(entry);
    // Only versions whose entry is in this backup are restored. Same ids overwrite, so restoring twice adds nothing.
    const restored = new Set(entries.map((entry) => entry.id));
    const usable = versions.filter((version) => restored.has(version.entryId));
    for (const version of usable) await this.store.saveVersion(version, MAX_VERSIONS);
    await this.showHome();
    this.showStatus(`Restored ${entries.length} entries and ${usable.length} versions`);
  }

  // ---------- keyboard ----------

  onGlobalKeydown(event) {
    if (document.querySelector('dialog[open]')) return;
    const typing = isTextTarget(event.target);
    const key = event.key.toLowerCase();

    if (event.key === 'F1') {
      event.preventDefault();
      showShortcuts();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && key === 't') {
      event.preventDefault();
      this.openToday();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (this.view === 'home' && key === 'f') {
        event.preventDefault();
        this.home.focusSearch();
        return;
      }
      switch (key) {
        case 'h':
          if (event.shiftKey) {
            event.preventDefault();
            this.showHome();
          }
          break;
        case 'n':
          event.preventDefault();
          this.newEntry();
          break;
        case 'o':
          event.preventDefault();
          this.showEntries();
          break;
        case 's':
          event.preventDefault();
          this.persist();
          break;
        case 'e':
          event.preventDefault();
          this.exportMarkdown();
          break;
        case 'p':
          event.preventDefault();
          this.printPdf();
          break;
        case ',':
          event.preventDefault();
          this.openOptions();
          break;
        case 'z':
        case 'y': {
          if (typing && this.lastSurface === 'text') break; // native text undo
          event.preventDefault();
          if (key === 'y' || event.shiftKey) this.redo();
          else this.undo();
          break;
        }
        default:
          break;
      }
      return;
    }
    if (typing || event.altKey || this.view === 'home') return;
    if (this.draft && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if (this.selection.size) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.deleteSelection();
        return;
      }
      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (nudge) {
        event.preventDefault();
        this.nudgeSelection(...nudge);
        return;
      }
    }
    if (event.key === 'Escape' && this.selection.size) {
      this.selection = new Set();
      this.requestRedraw();
      return;
    }
    const toolId = TOOL_BY_KEY[key];
    if (toolId) {
      event.preventDefault();
      this.setTool(toolId);
    }
  }
}

Object.assign(QuireApp.prototype, chromeMethods);

Object.assign(QuireApp.prototype, routingMethods);

Object.assign(QuireApp.prototype, buildUiMethods);

Object.assign(QuireApp.prototype, toolModeMethods);

Object.assign(QuireApp.prototype, textEditingMethods);

Object.assign(QuireApp.prototype, inkCanvasMethods);

Object.assign(QuireApp.prototype, sprayShapeMethods);

Object.assign(QuireApp.prototype, magnifierMethods);

Object.assign(QuireApp.prototype, transformMethods);

Object.assign(QuireApp.prototype, toolboxRowMethods);

Object.assign(QuireApp.prototype, selectionMethods);

Object.assign(QuireApp.prototype, textBoxMethods);

Object.assign(QuireApp.prototype, layerActionMethods);
