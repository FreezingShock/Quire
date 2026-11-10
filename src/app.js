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
  isBlankEntry,
  localISODate,
} from './model.js';
import { mediaResolver } from './media.js';
import { LiveEditor } from './livetext.js';
import { BASE_LAYER, Drawing } from './drawing.js';
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
import { confirmDialog, showShortcuts } from './dialogs.js';
import { installState, promptInstall, showInstallHelp, startPwa, startReminders, REMINDER_DEFAULTS } from './pwa.js';
import { HomeView } from './home.js';
import { sampleEntry } from './onboarding.js';
import { MAX_VERSIONS } from './versions.js';
import { formatVersionTime, historyDialog } from './history.js';
import {
  FONT_STACKS,
  NUDGE,
  NUDGE_FAST,
  ZOOM_STEPS,
} from './controller/constants.js';
import {
  $,
  contentKey,
  fillSelect,
  isTextTarget,
} from './controller/helpers.js';
import { routeEntryId } from './controller/routes.js';
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
import { savingMethods } from './controller/saving.js';
import { entryMethods } from './controller/entries.js';



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

Object.assign(QuireApp.prototype, savingMethods);

Object.assign(QuireApp.prototype, entryMethods);
