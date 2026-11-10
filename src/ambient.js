/**
 * Ambient sounds for focus mode, synthesized with Web Audio (no audio files).
 * Each sound is noise shaped by filters, plus a few random events: raindrops,
 * cup clinks, or nothing at all for the CRT's steady hum. Only one sound plays
 * at a time. The controller decides when it may play (focus mode on, sound
 * effects on); this module only plays and stops.
 */

import { audioContext } from './sound.js';
import { normalizeAmbient } from './focus.js';

const FADE_SECONDS = 0.6;

/** The track in play, or null. `stopped` ends its scheduled events. */
let track = null;

function noiseBuffer(ctx, shape = 'white') {
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (shape === 'brown') {
      // Brown noise is a random walk: low and soft, like a room full of voices.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/** Calls `fn` at random gaps between `minMs` and `maxMs`, until the track stops. */
function randomly(t, minMs, maxMs, fn) {
  const next = () => minMs + Math.random() * (maxMs - minMs);
  const schedule = (ms) => {
    const id = setTimeout(() => {
      t.pending.delete(id);
      if (t.stopped) return;
      try {
        fn();
      } catch {
        // A failed event is skipped. The bed keeps playing.
      }
      schedule(next());
    }, ms);
    t.pending.add(id);
  };
  schedule(next());
}

/** A short sine tone with an exponential decay, played through `dest`. */
function blip(ctx, dest, { freq, dur, gain, at = ctx.currentTime, type = 'sine' }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Looping noise: a source buffer, started now, with its own nodes kept for stopping. */
function loopNoise(ctx, dest, shape, filters, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, shape);
  src.loop = true;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  let node = src;
  for (const make of filters) {
    const f = make(ctx);
    node.connect(f);
    node = f;
  }
  node.connect(amp).connect(dest);
  src.start();
  return { nodes: [src, amp] };
}

/** A slow LFO that wobbles a gain node's level by `depth`. */
function wobble(ctx, param, rate, depth) {
  const lfo = ctx.createOscillator();
  const scale = ctx.createGain();
  lfo.frequency.value = rate;
  scale.gain.value = depth;
  lfo.connect(scale).connect(param);
  lfo.start();
  return lfo;
}

function filter(type, frequency, Q = 0.7) {
  return (ctx) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  };
}

const BUILDERS = {
  // Steady rain: filtered white noise with a slow swell, and random drops that tick off the glass.
  rain(ctx, dest, t) {
    const bed = loopNoise(ctx, dest, 'white', [filter('bandpass', 2400, 0.5)], 0.32);
    t.nodes.push(...bed.nodes);
    t.nodes.push(wobble(ctx, bed.nodes[1].gain, 0.13, 0.08));
    randomly(t, 90, 420, () => {
      const at = ctx.currentTime;
      blip(ctx, dest, { freq: 1400 + Math.random() * 2600, dur: 0.05 + Math.random() * 0.05, gain: 0.035, at });
    });
  },

  // A café: a low brown-noise murmur that swells in and out like talk, and the odd cup clink.
  cafe(ctx, dest, t) {
    const murmur = loopNoise(ctx, dest, 'brown', [filter('bandpass', 520, 0.8)], 0.55);
    t.nodes.push(...murmur.nodes);
    t.nodes.push(wobble(ctx, murmur.nodes[1].gain, 2.9, 0.22));
    t.nodes.push(wobble(ctx, murmur.nodes[1].gain, 0.31, 0.12));
    randomly(t, 2500, 7000, () => {
      const at = ctx.currentTime;
      blip(ctx, dest, { freq: 2900, dur: 0.55, gain: 0.05, at });
      blip(ctx, dest, { freq: 4650, dur: 0.35, gain: 0.025, at });
    });
  },

  // A CRT: the mains hum (60 Hz with its 120 Hz harmonic), a faint hiss, and a slow flicker.
  crt(ctx, dest, t) {
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.type = 'triangle';
    hum.frequency.value = 60;
    humGain.gain.value = 0.16;
    const harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    harmonic.type = 'sine';
    harmonic.frequency.value = 120;
    harmonicGain.gain.value = 0.07;
    hum.connect(humGain).connect(dest);
    harmonic.connect(harmonicGain).connect(dest);
    hum.start();
    harmonic.start();
    t.nodes.push(hum, humGain, harmonic, harmonicGain);
    t.nodes.push(wobble(ctx, humGain.gain, 0.8, 0.03));
    const hiss = loopNoise(ctx, dest, 'white', [filter('highpass', 6500, 0.6)], 0.05);
    t.nodes.push(...hiss.nodes);
  },
};

/** Starts `kind` (rain, cafe, crt) at `volume` (0 to 1). Any sound already playing is stopped first. */
export function startAmbient(kind, volume = 0.5) {
  stopAmbient();
  const id = normalizeAmbient(kind);
  if (id === 'off') return false;
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    const out = ctx.createGain();
    const level = Math.min(1, Math.max(0, Number(volume)));
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.6), ctx.currentTime + FADE_SECONDS);
    out.connect(ctx.destination);
    // Register the track before building it, so a build that fails midway can still be stopped.
    track = { id, out, nodes: [], pending: new Set(), stopped: false };
    BUILDERS[id](ctx, out, track);
    return true;
  } catch {
    // Audio can be blocked or missing. The page works without sound.
    stopAmbient();
    return false;
  }
}

/** Changes the level of the sound in play without restarting it. */
export function setAmbientVolume(volume) {
  const t = track;
  const ctx = audioContext();
  if (!t || !ctx) return;
  const level = Math.min(1, Math.max(0, Number(volume)));
  try {
    const now = ctx.currentTime;
    t.out.gain.cancelScheduledValues(now);
    t.out.gain.setValueAtTime(Math.max(0.0001, t.out.gain.value), now);
    t.out.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.6), now + 0.2);
  } catch {
    // The level stays where it was.
  }
}

/** Fades out the sound in play and frees its nodes. Safe to call when nothing plays. */
export function stopAmbient() {
  const t = track;
  if (!t) return;
  track = null;
  t.stopped = true;
  for (const id of t.pending) clearTimeout(id);
  t.pending.clear();
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    t.out.gain.cancelScheduledValues(now);
    t.out.gain.setValueAtTime(t.out.gain.value, now);
    t.out.gain.exponentialRampToValueAtTime(0.0001, now + FADE_SECONDS);
    const end = now + FADE_SECONDS + 0.05;
    for (const node of t.nodes) {
      try {
        node.stop?.(end);
      } catch {
        // Already stopped.
      }
    }
    setTimeout(() => t.out.disconnect(), (FADE_SECONDS + 0.1) * 1000);
  } catch {
    // Nothing else to free.
  }
}

/** The sound id in play, or 'off'. */
export function playingAmbient() {
  return track?.id ?? 'off';
}
