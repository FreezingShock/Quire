/** Keyboard shortcuts for the Quire controller: the global keydown handler that routes shortcuts to the open entry, tools, and menus. Mixed into QuireApp. */

import { NUDGE, NUDGE_FAST } from './constants.js';
import { isTextTarget } from './helpers.js';
import { showShortcuts } from '../dialogs.js';
import { TOOL_BY_KEY } from '../tools.js';

export const keyboardMethods = {
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
    if (event.key === 'F11') {
      event.preventDefault();
      this.toggleFocusMode();
      return;
    }
    // Esc leaves focus mode, unless it has a job of its own: a text box, a draft, or a selection.
    if (event.key === 'Escape' && this.focusMode && !this.draft && !this.textDraft && !this.selection.size) {
      event.preventDefault();
      this.exitFocusMode();
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
        case 'k':
          event.preventDefault();
          this.openPalette();
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
  },
};
