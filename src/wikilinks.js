/**
 * Entry links: [[Entry title]] in an entry's text. Pure, no DOM.
 *
 * A link is found by title, ignoring case and extra spaces. An entry's link
 * title is its displayed title, so a link keeps working as long as the title
 * does. Sealed time capsules never count as targets or as sources.
 */
import { displayTitle, firstHeading, localISODate, compareEntries } from './model.js';
import { isHidden } from './capsule.js';

/** The text between [[ and ]]: one line, up to 120 characters, no brackets inside. */
export const WIKILINK = /\[\[([^[\]\n]{1,120})\]\]/g;

/** Lowercased, single-spaced form used to compare titles. */
export function linkKey(title) {
  return String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The distinct link titles written in a body, in the order they first appear. */
export function wikiLinkTitles(body = '') {
  const seen = new Set();
  const titles = [];
  for (const match of String(body).matchAll(WIKILINK)) {
    const title = match[1].trim().replace(/\s+/g, ' ');
    const key = linkKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

/**
 * The title other entries link to. An untitled entry with no heading has no
 * usable title, so it returns an empty string and nothing can link to it.
 */
export function linkTitleOf(entry) {
  const explicit = (entry.title ?? '').trim() || firstHeading(entry.body);
  return explicit ? displayTitle(entry) : '';
}

/** The entry a link points at: the most recently edited match, or null. Sealed entries are never targets. */
export function findLinkTarget(entries, title, today = localISODate()) {
  const key = linkKey(title);
  if (!key) return null;
  const matches = entries.filter((entry) => !isHidden(entry, today) && linkKey(linkTitleOf(entry)) === key);
  matches.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return matches[0] ?? null;
}

/** Entries (other than `entry`) whose text links to it, newest first. Sealed entries are left out. */
export function linkedFrom(entries, entry, today = localISODate()) {
  const key = linkKey(linkTitleOf(entry));
  if (!key) return [];
  return entries
    .filter(
      (other) =>
        other.id !== entry.id &&
        !isHidden(other, today) &&
        wikiLinkTitles(other.body).some((title) => linkKey(title) === key),
    )
    .sort(compareEntries);
}
