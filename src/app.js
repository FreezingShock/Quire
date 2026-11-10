/**
 * Quire application controller. It wires the UI to the entry store, the drawing
 * layer, and the text editor. Text lives in a textarea (Markdown source) and
 * ink lives in a canvas laid over the sheet. The canvas has two layers: a base
 * canvas with every committed op, and the display canvas, which adds the stroke
 * in progress.
 */

import { createLocalStore } from './storage.js';
import { unlockStore } from './lock.js';
import {
  MOODS,
  WEATHERS,
  createEntry,
  localISODate,
} from './model.js';
import { LiveEditor } from './livetext.js';
import { BASE_LAYER, Drawing } from './drawing.js';
import { PALETTE } from './tools.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { startPwa, startReminders, REMINDER_DEFAULTS } from './pwa.js';
import { HomeView } from './home.js';
import { sampleEntry } from './onboarding.js';
import { $, fillSelect } from './controller/helpers.js';
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
import { versionActionMethods } from './controller/version-actions.js';
import { exportMethods } from './controller/export-actions.js';
import { keyboardMethods } from './controller/keyboard.js';
import { focusMethods } from './controller/focus-mode.js';
import { navigationMethods } from './controller/navigation.js';



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
      focusHud: $('#focus-hud'),
      focusCount: $('#focus-count'),
      focusProgress: $('#focus-progress'),
      focusFill: $('#focus-fill'),
      focusSave: $('#focus-save'),
      entryPath: $('#entry-path'),
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
    this.menuDefs = []; // the menu bar's definitions, which the command palette reads
    this.view = 'home'; // 'home' or 'editor'; the landing page is the entries list
    this.home = null;
    this.focusMode = false; // F11 focus writing mode; a session setting, not saved
    this.session = null; // { id, base }: the open entry and its word count when this session began
    this.goalCelebrated = false; // the goal chime has played for this session
    this.typeFrame = 0; // the pending animation frame for typewriter scrolling
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
      showGadgets: this.prefs.showGadgets !== false,
      gadgets: this.prefs.gadgets,
      onGadgetsChange: (gadgets) => this.setPref({ gadgets }),
      onSaveNote: (text) => this.saveSidebarNote(text),
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
    this.bindFocusEvents();
    this.setTool('write');
    this.store = await createLocalStore();
    if (this.store.kind === 'memory') {
      this.showStatus('Browser storage is unavailable. Entries will not survive a reload.', true);
    }
    // Nothing is read until the passcode, if there is one, is typed.
    this.passcodeOn = await unlockStore(this.store);
    this.home.setNote((await this.store.getNote()) ?? '');
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

Object.assign(QuireApp.prototype, versionActionMethods);

Object.assign(QuireApp.prototype, exportMethods);

Object.assign(QuireApp.prototype, keyboardMethods);

Object.assign(QuireApp.prototype, focusMethods);
Object.assign(QuireApp.prototype, navigationMethods);
