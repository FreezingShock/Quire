/**
 * Synthesized sound effects. Nothing is loaded from disk: each sound is a few
 * oscillator notes with a short envelope, so the app stays one folder of files.
 * Sound is off by default. View > Sound effects turns it on.
 */

import { loadPrefs } from './prefs.js';

// Each note starts `at` seconds into the sound. `to` glides the pitch to that frequency.
const SOUNDS = {
  // Rising chime, played when Quire opens.
  startup: [
    { at: 0, freq: 523.25, dur: 0.9, gain: 0.16 },
    { at: 0.14, freq: 783.99, dur: 0.9, gain: 0.14 },
    { at: 0.28, freq: 1046.5, dur: 1.2, gain: 0.14 },
    { at: 0.28, freq: 1567.98, dur: 1.2, gain: 0.05, type: 'triangle' },
  ],
  // Two quick rising blips for a new page.
  newEntry: [
    { at: 0, freq: 880, dur: 0.12, gain: 0.14, type: 'triangle' },
    { at: 0.08, freq: 1320, dur: 0.18, gain: 0.14, type: 'triangle' },
  ],
  // A falling sweep for a deleted entry.
  delete: [{ at: 0, freq: 660, to: 180, dur: 0.28, gain: 0.12, type: 'triangle' }],
  // A faint tick as the mouse reaches a button or entry tile. Off unless sound effects are on.
  hover: [{ at: 0, freq: 1760, to: 2100, dur: 0.045, gain: 0.02, type: 'sine' }],
  // One soft bell for a finished export.
  export: [
    { at: 0, freq: 1174.66, dur: 0.7, gain: 0.14 },
    { at: 0, freq: 2349.32, dur: 0.35, gain: 0.03 },
  ],
  // Three rising notes when a focus-mode word goal is reached.
  goal: [
    { at: 0, freq: 659.25, dur: 0.22, gain: 0.14, type: 'triangle' },
    { at: 0.12, freq: 880, dur: 0.22, gain: 0.14, type: 'triangle' },
    { at: 0.24, freq: 1318.51, dur: 0.7, gain: 0.14, type: 'triangle' },
  ],
};

let context = null;

/** The shared AudioContext, created on first use. Null when the browser has no Web Audio. */
export function audioContext() {
  if (!context) {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  if (context.state === 'suspended') context.resume?.().catch(() => {});
  return context;
}

/** Plays a named sound when sound effects are on. Unknown names and blocked audio are ignored. */
export function playSound(name) {
  const notes = SOUNDS[name];
  if (!notes || !loadPrefs().sound) return;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    for (const note of notes) {
      const t = start + note.at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, t);
      if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, t + note.dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(note.gain, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + note.dur + 0.02);
    }
  } catch {
    // Audio can be blocked or missing. Sound is optional, so stay silent.
  }
}
