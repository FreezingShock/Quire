/**
 * Import: reads a Day One JSON export (Journal.json) or Markdown files into
 * entries. Pure, no DOM. Quire's own backups are restored with Restore from
 * backup, so they are refused here.
 *
 * Imports get stable ids (from the Day One uuid, or a hash of the file), so
 * importing the same file twice does not duplicate entries.
 */
import { isISODate, localISODate, normalizeEntry } from './model.js';

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// A picture line that points at a file next to the export (a Quire export's drawing, say). Those files are not imported, so the line goes.
const LOCAL_PICTURE_LINE = /^[ \t]*!\[[^\]\n]*\]\((?![a-z][a-z0-9+.-]*:|\/|#)[^)\n]+\)[ \t]*(?:\r?\n|$)/gim;

/** Day One JSON: { entries: [{ uuid, creationDate, modifiedDate, text, tags, starred, timeZone }] }. */
export function parseDayOneJson(text) {
  const data = JSON.parse(text);
  if (data?.app === 'quire') {
    throw new Error('This is a Quire backup. Use Restore from backup instead.');
  }
  if (!data || !Array.isArray(data.entries)) {
    throw new Error('This JSON file is not a Day One export. Choose Journal.json from the export.');
  }
  const entries = [];
  let skipped = 0;
  for (const raw of data.entries) {
    const created = raw?.creationDate ? new Date(raw.creationDate) : null;
    if (!created || Number.isNaN(created.getTime())) {
      skipped += 1;
      continue;
    }
    const uuid = String(raw.uuid ?? '').replace(/[^A-Za-z0-9_-]/g, '') || `${created.getTime()}`;
    entries.push(
      normalizeEntry({
        id: `d1-${uuid}`,
        date: dayInZone(created, raw.timeZone),
        title: '',
        kind: 'journal',
        tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string') : [],
        favorite: raw.starred === true,
        pinned: raw.isPinned === true || raw.pinned === true,
        body: typeof raw.text === 'string' ? raw.text : '',
        createdAt: created.toISOString(),
        updatedAt: raw.modifiedDate ? new Date(raw.modifiedDate).toISOString() : created.toISOString(),
      }),
    );
  }
  return { entries, skipped, format: 'day-one' };
}

/** The calendar day of an instant in the entry's own time zone, or the browser's when the zone is missing or unknown. */
export function dayInZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return isISODate(parts) ? parts : localISODate(date);
  } catch {
    return localISODate(date);
  }
}

/** Splits a Quire-style front matter block into its fields and the body that follows. */
export function splitFrontMatter(source) {
  const match = FRONT_MATTER.exec(source);
  if (!match) return { fields: {}, body: source };
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim());
    if (pair) fields[pair[1].toLowerCase()] = pair[2].trim();
  }
  return { fields, body: source.slice(match[0].length) };
}

/** Reads a tags value written as a JSON list ["a", "b"] or a plain list a, b. */
function parseTagList(value = '') {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '');
  try {
    const parsed = JSON.parse(`[${inner}]`);
    if (Array.isArray(parsed)) return parsed.map(String).map((tag) => tag.trim()).filter(Boolean);
  } catch {
    // Not JSON, so fall through to a plain comma list.
  }
  return inner.split(',').map((tag) => tag.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

/** A title written as a JSON string ("My day") or as plain text. */
function parseTitle(value = '') {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // Plain text.
  }
  return value.replace(/^["']|["']$/g, '');
}

/** 32-bit FNV-1a hash as hex, so a Markdown file always gets the same id. */
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * One Markdown file as an entry. Quire's exported front matter (title, date,
 * kind, mood, weather, tags) is read back. A file without it becomes a
 * journal entry for today, titled by its file name.
 */
export function markdownEntry(name, source, today = localISODate()) {
  const { fields, body } = splitFrontMatter(source);
  const stem = name.replace(/\.(md|markdown|txt)$/i, '');
  const title = 'title' in fields ? parseTitle(fields.title) : '';
  return normalizeEntry({
    id: `md-${hashText(`${name}\n${source}`)}`,
    title: title || (Object.keys(fields).length ? '' : stem),
    date: isISODate(fields.date) ? fields.date : today,
    kind: fields.kind,
    mood: fields.mood,
    weather: fields.weather,
    tags: 'tags' in fields ? parseTagList(fields.tags) : [],
    body: body.replace(LOCAL_PICTURE_LINE, '').replace(/\r?\n{3,}/g, '\n\n').replace(/^\r?\n+/, '').trimEnd(),
  });
}

/** Reads one picked file. Returns { entries, skipped, format } or throws with a message for the user. */
export function parseImportFile(name, text, today = localISODate()) {
  if (/\.json$/i.test(name) || text.trimStart().startsWith('{')) {
    return parseDayOneJson(text);
  }
  return { entries: [markdownEntry(name, text, today)], skipped: 0, format: 'markdown' };
}
