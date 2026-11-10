/**
 * Focus writing mode for the Quire controller (F11). It hides the window chrome
 * so only the page is left, keeps the caret line centered when typewriter
 * scrolling is on, counts the session's words against a goal, and plays the
 * ambient sound. Mixed into QuireApp.
 */

import { startAmbient, playingAmbient, setAmbientVolume, stopAmbient } from '../ambient.js';
import { goalProgress, normalizeAmbient, normalizeGoal, sessionWords, typewriterDelta } from '../focus.js';
import { wordCount } from '../markdown.js';
import { playSound } from '../sound.js';

/** Asks the browser for full screen. Browsers that refuse, or need a gesture they do not see, are fine without it. */
function requestFullScreen() {
  try {
    Promise.resolve(document.documentElement.requestFullscreen?.()).catch(() => {});
  } catch {
    // Not allowed here. Focus mode still hides the chrome.
  }
}

function leaveFullScreen() {
  try {
    Promise.resolve(document.exitFullscreen?.()).catch(() => {});
  } catch {
    // Nothing to leave.
  }
}

/** The client rect of the caret. A collapsed range can report no box, so the line it sits in is the fallback. */
function caretRect(range) {
  const box = Array.from(range.getClientRects()).find((rect) => rect.height > 0);
  if (box) return box;
  let node = range.startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const line = node?.closest?.('.ln') ?? node;
  return line?.getBoundingClientRect?.() ?? null;
}

export const focusMethods = {
  // ---------- focus writing mode ----------

  bindFocusEvents() {
    // Leaving the browser's full screen (Esc there) also leaves focus mode.
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.focusMode) this.exitFocusMode({ fromFullscreen: true });
    });
    // The ambient sound stops when the tab is hidden and starts again when it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAmbient();
      else this.syncAmbient();
    });
    document.addEventListener('selectionchange', () => {
      if (this.prefs.typewriter && this.view === 'editor') this.scheduleTypewriter();
    });
  },

  /** F11 and the View menu. Focus mode needs an open entry. */
  toggleFocusMode() {
    if (this.focusMode) this.exitFocusMode();
    else this.enterFocusMode();
  },

  enterFocusMode() {
    if (!this.entry || this.view !== 'editor') return;
    this.focusMode = true;
    this.session = null; // the session count starts over each time focus mode starts
    this.applyFocusMode();
    this.dom.editor.focus({ preventScroll: true });
    requestFullScreen();
  },

  exitFocusMode({ fromFullscreen = false } = {}) {
    if (!this.focusMode) return;
    // Clear the flag first, so the fullscreenchange this causes does not run this again.
    this.focusMode = false;
    this.applyFocusMode();
    if (!fromFullscreen && document.fullscreenElement) leaveFullScreen();
  },

  /** Puts the focus-mode classes on the page and refreshes everything that depends on them. */
  applyFocusMode() {
    const root = document.documentElement;
    root.classList.toggle('focus-mode', this.focusMode);
    root.dataset.focus = this.focusMode ? 'on' : 'off';
    this.syncAmbient();
    this.scheduleTypewriter();
    this.refreshWordStatus();
    this.requestSync();
  },

  /** Plays the ambient sound the settings ask for. It plays only in focus mode, and only with sound effects on. */
  syncAmbient() {
    const kind = this.focusMode && this.prefs.sound ? normalizeAmbient(this.prefs.ambient) : 'off';
    const volume = Math.min(1, Math.max(0, Number(this.prefs.ambientVolume) || 0));
    if (kind === 'off') stopAmbient();
    else if (playingAmbient() === kind) setAmbientVolume(volume);
    else startAmbient(kind, volume);
    document.documentElement.dataset.ambient = playingAmbient();
  },

  /** Typewriter scrolling: after the caret moves, scroll it to the middle of the page. At most once a frame. */
  scheduleTypewriter() {
    if (!this.prefs.typewriter || this.view !== 'editor' || this.typeFrame) return;
    this.typeFrame = requestAnimationFrame(() => {
      this.typeFrame = 0;
      this.keepCaretCentered();
    });
  },

  keepCaretCentered() {
    if (!this.prefs.typewriter || this.view !== 'editor') return;
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const editor = this.dom.editorEl;
    if (!editor.contains(range.startContainer)) return;
    const desk = editor.closest('.desk');
    const caret = desk && caretRect(range);
    if (!caret) return;
    const box = desk.getBoundingClientRect();
    const delta = typewriterDelta(caret.top + caret.height / 2, box.top + box.height / 2);
    if (delta) desk.scrollTop += delta;
  },

  /**
   * Words written this session in the open entry. The session starts at the
   * entry's count the first time it is seen, and again whenever another entry opens.
   */
  sessionWordCount(words) {
    const id = this.entry?.id ?? null;
    if (!this.session || this.session.id !== id) {
      this.session = { id, base: words };
      this.goalCelebrated = false;
    }
    return sessionWords(words, this.session.base);
  },

  /**
   * Updates the word count in the status bar and the bar at the bottom of the
   * page in focus mode. The goal chime plays once per session, when the goal is reached.
   */
  refreshWordStatus() {
    const text = this.dom.editor.value;
    const inEditor = this.view === 'editor' && Boolean(this.entry);
    const goal = inEditor ? normalizeGoal(this.prefs.wordGoal) : 0;
    const session = inEditor ? this.sessionWordCount(wordCount(text)) : 0;
    const progress = goalProgress(session, goal);

    let statusText = this.wordLabel(text);
    if (progress.active) statusText += ` · goal ${progress.label}`;
    this.dom.words.textContent = statusText;

    const hud = this.dom.focusHud;
    hud.dataset.goal = progress.active ? 'on' : 'off';
    const percent = Math.round(progress.fraction * 100);
    this.dom.focusFill.style.width = `${percent}%`;
    this.dom.focusProgress.setAttribute('aria-valuenow', String(percent));
    if (progress.active) {
      this.dom.focusCount.textContent = progress.reached ? `${progress.label}. Goal reached.` : progress.label;
    } else {
      this.dom.focusCount.textContent = `${session} ${session === 1 ? 'word' : 'words'} this session`;
    }
    this.dom.focusSave.textContent = this.dom.saveStatus.textContent;

    if (progress.reached && !this.goalCelebrated) {
      this.goalCelebrated = true;
      playSound('goal');
    }
  },
};
