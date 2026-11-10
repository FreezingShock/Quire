/**
 * Sidebar gadgets on the dashboard: which gadgets show and in what order, and
 * the numbers behind a few of them. Pure (no DOM), so node:test covers the rules.
 * Days are local YYYY-MM-DD strings, as everywhere else.
 */

import { moodAverage, moodForScore, moodSeries } from './journal.js';

/** Every gadget Quire knows, in the order the Add menu lists them. */
export const GADGETS = Object.freeze([
  { id: 'clock', label: 'Clock' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'streak', label: 'Streak meter' },
  { id: 'mood', label: 'Mood gauge' },
  { id: 'word', label: 'Word of the day' },
  { id: 'note', label: 'Sticky note' },
  { id: 'slides', label: 'Drawing slideshow' },
]);

/** What a new library shows. The calendar is one click away in the Add menu, since the dashboard already has one. */
export const DEFAULT_GADGETS = Object.freeze(['clock', 'streak', 'mood', 'word', 'note', 'slides']);

const KNOWN = new Set(GADGETS.map((gadget) => gadget.id));

/**
 * A saved gadget list, cleaned up: unknown ids and repeats are dropped and the
 * order is kept. Anything that is not a list gives the defaults. An empty list
 * is valid, since the reader may remove every gadget.
 */
export function normalizeGadgetList(value) {
  if (!Array.isArray(value)) return [...DEFAULT_GADGETS];
  const seen = new Set();
  const list = [];
  for (const id of value) {
    if (!KNOWN.has(id) || seen.has(id)) continue;
    seen.add(id);
    list.push(id);
  }
  return list;
}

export function addGadget(list, id) {
  if (!KNOWN.has(id) || list.includes(id)) return list;
  return [...list, id];
}

export function removeGadget(list, id) {
  return list.filter((item) => item !== id);
}

/** Gadgets not on the sidebar yet, in catalog order. */
export function missingGadgets(list) {
  return GADGETS.filter((gadget) => !list.includes(gadget.id));
}

/** The list with `id` moved by `offset` places (negative is up). Stops at the ends. */
export function moveGadget(list, id, offset) {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const to = Math.min(list.length - 1, Math.max(0, from + offset));
  if (to === from) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Hand angles in degrees, clockwise from twelve. The hour hand moves through
 * the hour too, and the minute hand through the minute, so the clock never jumps.
 */
export function clockAngles(date) {
  const hours = date.getHours() % 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return {
    hour: (hours + minutes / 60) * 30,
    minute: (minutes + seconds / 60) * 6,
    second: seconds * 6,
  };
}

/** The streak against a goal of `goal` days in a row. `filled` drives the meter cells. */
export function streakGoal({ current, longest }, goal = 7) {
  return {
    current,
    longest,
    goal,
    filled: Math.min(current, goal),
    met: current >= goal,
  };
}

/**
 * The mood average over the last `days` days, for the gauge. `needle` is the
 * angle from the left end (Rough, -90) to the right end (Great, 90), or null
 * when no day in the range has a mood.
 */
export function moodGauge(entries, today, days = 14) {
  const series = moodSeries(entries, today, days);
  const average = moodAverage(series);
  const logged = series.filter((point) => point.score !== null).length;
  if (average === null) return { average: null, mood: null, logged, needle: null };
  const clamped = Math.min(5, Math.max(1, average));
  return {
    average,
    mood: moodForScore(average),
    logged,
    needle: -90 + ((clamped - 1) / 4) * 180,
  };
}

/** Entries with ink, newest edit first, for the drawing slideshow. Sample and blank pages are left out. */
export function inkEntries(entries, limit = 12) {
  return entries
    .filter((entry) => !entry.sample && entry.ink?.ops?.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** Words a writer can use. Each meaning is written for this app, not copied from a dictionary. */
export const WORDS = Object.freeze([
  { word: 'Petrichor', meaning: 'The smell of dry ground after the first rain.' },
  { word: 'Susurrus', meaning: 'A soft whispering or rustling, like leaves or distant talk.' },
  { word: 'Hiraeth', meaning: 'A homesickness for a place you cannot go back to, real or imagined.' },
  { word: 'Lagniappe', meaning: 'A small extra thing given for free, just because.' },
  { word: 'Sonder', meaning: 'The sudden sense that every stranger has a life as full as yours.' },
  { word: 'Halcyon', meaning: 'Calm and happy, often a time you look back on fondly.' },
  { word: 'Saudade', meaning: 'A longing for someone or something absent, with a little warmth in it.' },
  { word: 'Liminal', meaning: 'Sitting on a threshold, between one state and the next.' },
  { word: 'Fernweh', meaning: 'An ache to travel to places you have never seen.' },
  { word: 'Crepuscular', meaning: 'Of the twilight, or of things active at dusk and dawn.' },
  { word: 'Sillage', meaning: 'The trail of scent a person leaves behind them.' },
  { word: 'Murmuration', meaning: 'A flock of starlings turning together as one shape.' },
  { word: 'Lacuna', meaning: 'A gap or a missing piece, in a text or in a memory.' },
  { word: 'Eunoia', meaning: 'Beautiful thinking, or a mind that is kind and clear at once.' },
  { word: 'Quiescent', meaning: 'Quiet and still, resting but not gone.' },
  { word: 'Gossamer', meaning: 'Something very fine and light, like a spider thread.' },
  { word: 'Ephemeral', meaning: 'Lasting only a short while, and all the more precious for it.' },
  { word: 'Cairn', meaning: 'A small pile of stones left to mark the way.' },
  { word: 'Languor', meaning: 'A slow, heavy calm, the kind that comes on a warm afternoon.' },
  { word: 'Umbra', meaning: 'The darkest center of a shadow.' },
  { word: 'Ineffable', meaning: 'Too great or too subtle to put into words.' },
  { word: 'Verdant', meaning: 'Green with new growth, or fresh and full of life.' },
  { word: 'Solace', meaning: 'Comfort found in a hard moment.' },
  { word: 'Taciturn', meaning: 'Quiet by nature, and not inclined to say much.' },
  { word: 'Serendipity', meaning: 'Finding something good that you were not looking for.' },
  { word: 'Wabi-sabi', meaning: 'Finding beauty in things that are worn, unfinished, or temporary.' },
]);

/** The word for a day. Every day gets one, and the list repeats only after it has come all the way round. */
export function wordOfTheDay(iso) {
  const dayNumber = Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  const index = ((dayNumber % WORDS.length) + WORDS.length) % WORDS.length;
  return WORDS[index];
}
