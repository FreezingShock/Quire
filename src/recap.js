/**
 * Year in review: a short recap of one calendar year. Pure, no DOM.
 * Sealed time capsules, the first-run sample and future days are left out, so
 * a recap of this year counts only what has happened so far.
 */
import { KINDS, MOODS, displayTitle, formatShortDate } from './model.js';
import { isHidden } from './capsule.js';
import { wordCount } from './markdown.js';
import { dayStreaks } from './journal.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Recap numbers for one year. `today` caps the year at the present day. */
export function yearRecap(entries, year, today) {
  const inYear = entries.filter(
    (entry) => !entry.sample && !isHidden(entry, today) && entry.date.startsWith(`${year}-`) && entry.date <= today,
  );
  const days = new Set(inYear.map((entry) => entry.date));
  const words = inYear.reduce((sum, entry) => sum + wordCount(entry.body), 0);
  const withWords = inYear.map((entry) => ({ entry, words: wordCount(entry.body) }));
  const longest = withWords.reduce((best, item) => (!best || item.words > best.words ? item : best), null);

  const perMonth = Array.from({ length: 12 }, () => 0);
  for (const entry of inYear) perMonth[Number(entry.date.slice(5, 7)) - 1] += 1;
  const busiestIndex = perMonth.indexOf(Math.max(...perMonth));

  const moods = Object.fromEntries(MOODS.map((mood) => [mood.id, 0]));
  for (const entry of inYear) if (entry.mood) moods[entry.mood] += 1;
  const topMood = MOODS.reduce((best, mood) => (moods[mood.id] > (best ? moods[best.id] : 0) ? mood : best), null);

  const tags = new Map();
  for (const entry of inYear) for (const tag of entry.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  const topTags = [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([tag, count]) => ({ tag, count }));

  const kinds = Object.fromEntries(KINDS.map((kind) => [kind.id, 0]));
  for (const entry of inYear) kinds[entry.kind] += 1;
  const topKind = KINDS.reduce((best, kind) => (kinds[kind.id] > (best ? kinds[best.id] : 0) ? kind : best), null);

  const first = [...inYear].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))[0] ?? null;
  const longestStreak = longestRun([...days].sort());

  return {
    year,
    entries: inYear.length,
    days: days.size,
    words,
    longest: longest && longest.words > 0 ? { title: displayTitle(longest.entry), date: longest.entry.date, words: longest.words } : null,
    busiestMonth: inYear.length ? { name: MONTHS[busiestIndex], entries: perMonth[busiestIndex] } : null,
    topMood: topMood && moods[topMood.id] ? { label: topMood.label, count: moods[topMood.id] } : null,
    topKind: topKind && kinds[topKind.id] ? { label: topKind.label, count: kinds[topKind.id] } : null,
    topTags,
    favorites: inYear.filter((entry) => entry.favorite).length,
    first: first ? { title: displayTitle(first), date: first.date } : null,
    longestStreak,
    currentStreak: year === Number(today.slice(0, 4)) ? dayStreaks(inYear, today).current : null,
  };
}

/** The longest run of consecutive dates in a sorted list of YYYY-MM-DD strings. */
export function longestRun(sortedDays) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of sortedDays) {
    const consecutive = previous && dayAfter(previous) === day;
    run = consecutive ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

function dayAfter(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Plain-language lines for the recap dialog. Each line is a label and a value. */
export function recapLines(recap) {
  const lines = [
    ['Entries', `${recap.entries}`],
    ['Days written', `${recap.days}`],
    ['Words', recap.words.toLocaleString()],
    ['Longest run of days in a row', recap.longestStreak ? `${recap.longestStreak} days` : 'None yet'],
  ];
  if (recap.currentStreak !== null) lines.push(['Current streak', recap.currentStreak ? `${recap.currentStreak} days` : 'None right now']);
  if (recap.busiestMonth) lines.push(['Busiest month', `${recap.busiestMonth.name} (${recap.busiestMonth.entries} entries)`]);
  if (recap.longest) lines.push(['Longest entry', `${recap.longest.title}, ${recap.longest.words.toLocaleString()} words, ${formatShortDate(recap.longest.date)}`]);
  if (recap.first) lines.push(['First entry of the year', `${recap.first.title}, ${formatShortDate(recap.first.date)}`]);
  if (recap.topMood) lines.push(['Most common mood', `${recap.topMood.label} (${recap.topMood.count} days)`]);
  if (recap.topKind) lines.push(['Most common kind', `${recap.topKind.label} (${recap.topKind.count})`]);
  if (recap.topTags.length) lines.push(['Top tags', recap.topTags.map((item) => `#${item.tag} ${item.count}`).join(', ')]);
  if (recap.favorites) lines.push(['Favorites', `${recap.favorites}`]);
  return lines;
}
