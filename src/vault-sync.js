/**
 * Two-way vault sync, kept pure so the node tests can drive it. A vault is a
 * linked folder whose Markdown and text files are entries. Each file is matched
 * to an entry by a stable id, and the sync remembers, per file, what the file
 * and the entry looked like after the last sync.
 *
 * planVaultSync compares three things for every file: the file on disk
 * (modified time and size), the entry in the store (updatedAt), and the record
 * kept at the last sync. From those it decides, per file, whether to import the
 * file, write the entry back, ask about a conflict, or do nothing.
 *
 * Entries that hold pictures, sketches or voice notes are not written back.
 * The Markdown file cannot carry them yet, so writing it would lose them.
 * Those entries stay in Quire, and the status line says how many were left out.
 */

import { entryToMarkdown } from './export.js';
import { hashText, markdownEntry } from './import.js';
import { mediaRefsIn } from './media.js';

/** The entry id for a vault file. It stays the same every time the file is read, so an entry is never duplicated. */
export const vaultEntryId = (folderId, name) => `vault-${folderId}-${hashText(name)}`;

/** Whether an entry holds anything the Markdown file cannot carry. */
export function hasMedia(entry) {
  const count = (map) => Object.keys(map ?? {}).length;
  return count(entry.images) + count(entry.audio) + count(entry.sketches) > 0 || mediaRefsIn(entry.body).length > 0;
}

/** The text written to the vault file. Quire's own export format, so it reads back the same. */
export function vaultMarkdown(entry) {
  return entryToMarkdown(entry);
}

/** The entry a vault file describes, with the id the file already has. Pure: the caller saves it. */
export function entryFromVaultFile(folderId, name, source, today) {
  return { ...markdownEntry(name, source, today), id: vaultEntryId(folderId, name) };
}

/**
 * The sync plan. `disk` maps file name to { modified, size }. `index` maps file
 * name to the record from the last sync: { entryId, diskModified, diskSize,
 * entryUpdatedAt, removed? }. `entries` maps entry id to the live entry, and a
 * missing id means the entry is gone or in the desk drawer.
 *
 * Actions:
 *   import   read the file into its entry (new file, or changed on disk)
 *   export   write the entry back to the file (changed in Quire)
 *   conflict changed on both sides: the person chooses
 *   skip     changed in Quire, but the entry has media and cannot be written back
 *   retire   the entry is gone, so the file is left alone from now on
 *   forget   the file is gone from disk, so the record is dropped
 */
export function planVaultSync({ disk, index = {}, entries = new Map() }) {
  const actions = [];
  for (const [name, file] of disk) {
    const record = index[name];
    if (!record) {
      actions.push({ type: 'import', name, why: 'new' });
      continue;
    }
    if (record.removed) continue;
    const entry = entries.get(record.entryId);
    if (!entry) {
      actions.push({ type: 'retire', name });
      continue;
    }
    const diskChanged = file.modified !== record.diskModified || file.size !== record.diskSize;
    const quireChanged = entry.updatedAt !== record.entryUpdatedAt;
    if (diskChanged && quireChanged) actions.push({ type: 'conflict', name });
    else if (diskChanged) actions.push({ type: 'import', name, why: 'changed' });
    else if (quireChanged) actions.push(hasMedia(entry) ? { type: 'skip', name, why: 'media' } : { type: 'export', name });
  }
  for (const name of Object.keys(index)) {
    if (!disk.has(name) && !index[name].removed) actions.push({ type: 'forget', name });
  }
  return actions;
}

/** The record to keep for a file after it was read or written: what it looks like now, and what its entry looked like. */
export function recordFor({ entryId, modified, size, entryUpdatedAt }) {
  return { entryId, diskModified: modified, diskSize: size, entryUpdatedAt };
}

/** Keeps a stored file record only when it is well formed. Anything else is dropped. */
export function normalizeVaultIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [name, record] of Object.entries(value)) {
    if (!record || typeof record !== 'object' || typeof name !== 'string' || !name) continue;
    if (typeof record.entryId !== 'string' || !record.entryId) continue;
    out[name] = {
      entryId: record.entryId,
      diskModified: Number.isFinite(record.diskModified) ? record.diskModified : 0,
      diskSize: Number.isFinite(record.diskSize) ? record.diskSize : 0,
      entryUpdatedAt: typeof record.entryUpdatedAt === 'string' ? record.entryUpdatedAt : '',
      ...(record.removed === true ? { removed: true } : {}),
    };
  }
  return out;
}
