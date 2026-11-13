/**
 * Folders linked from this computer. Quire asks the browser for a folder
 * (the File System Access API), keeps the permission handle, and reads what is
 * in it: pictures to insert into an entry, and Markdown or text files to import
 * as entries. One linked folder can also take the backups.
 *
 * The list of folders (names and roles) is stored through the store, so the
 * passcode lock seals it. The handles are kept beside it, unsealed, and the
 * store reads them only while unlocked. Browsers grant folder access again
 * after a reload, so a folder shows "Allow access" until the person clicks it.
 *
 * Most of this module is pure, so the node tests drive it with fake handles.
 * The functions that call the browser take the handle or the picker as an
 * argument, so nothing here reaches for the page on its own.
 */

import { localISODate } from './model.js';
import { normalizeVaultIndex } from './vault-sync.js';

/** Quire reads at most this many linked folders. Enough for a few archives and a backup folder. */
export const FOLDER_LIMIT = 8;
/** A backup folder gets a new backup this often, the next time Quire is hidden. */
export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
/** Pictures the browser can show in the picker. Other image types are left out. */
const PICTURE_NAME = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
/** Text files that become entries. */
const TEXT_NAME = /\.(md|markdown|txt)$/i;

export const isPictureName = (name) => PICTURE_NAME.test(name ?? '');
export const isTextName = (name) => TEXT_NAME.test(name ?? '');

/** The picker needs a secure page and a browser that has it: Chrome and Edge on a computer, not Firefox or Safari. */
export function folderAccessSupported(scope = globalThis) {
  return typeof scope?.showDirectoryPicker === 'function';
}

export function newFolderId(random = Math.random) {
  return `f${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`;
}

/**
 * Keeps the folder records that are well formed: an id, a name, and at most
 * one backup folder (the first one marked). Anything else is dropped, so a
 * damaged record never breaks the dialog.
 */
export function normalizeFolderList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  let backupTaken = false;
  for (const raw of value) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const backup = raw.backup === true && !backupTaken;
    if (backup) backupTaken = true;
    const folder = {
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Folder',
      backup,
    };
    if (backup && typeof raw.lastBackupAt === 'string' && !Number.isNaN(Date.parse(raw.lastBackupAt))) {
      folder.lastBackupAt = raw.lastBackupAt;
    }
    // A vault keeps its files' sync records beside it. Only a vault has any.
    if (raw.vault === true) {
      folder.vault = true;
      folder.files = normalizeVaultIndex(raw.files);
    }
    out.push(folder);
    if (out.length >= FOLDER_LIMIT) break;
  }
  return out;
}

export const backupFolderOf = (list) => list.find((folder) => folder.backup) ?? null;

/** Whether a backup is due. Never backed up counts as due. */
export function isBackupDue(lastBackupAt, now = Date.now(), everyMs = BACKUP_EVERY_MS) {
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  return Number.isNaN(last) || now - last >= everyMs;
}

/** The backup file's name. The date keeps one file per day, and a second backup the same day replaces the first. */
export function backupFileName(date = new Date()) {
  return `quire-backup-${localISODate(date)}.json`;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * What a folder holds: its pictures and its text files, each sorted by name.
 * Subfolders are not read. `handle.values()` is the File System Access
 * iterator; a fake with the same shape works in tests.
 */
export async function scanFolder(handle) {
  const pictures = [];
  const texts = [];
  for await (const child of handle.values()) {
    if (child.kind !== 'file') continue;
    if (isPictureName(child.name)) pictures.push(child);
    else if (isTextName(child.name)) texts.push(child);
  }
  return { pictures: pictures.sort(byName), texts: texts.sort(byName) };
}

/** Whether the page can use the folder now, without asking. Asking needs a click. */
export async function hasAccess(handle, mode = 'read') {
  if (!handle) return false;
  try {
    return (await handle.queryPermission?.({ mode })) === 'granted';
  } catch {
    return false;
  }
}

/** Asks for access when it is missing. Call it from a click, or the browser refuses. */
export async function requestAccess(handle, mode = 'read') {
  if (await hasAccess(handle, mode)) return true;
  try {
    return (await handle.requestPermission?.({ mode })) === 'granted';
  } catch {
    return false;
  }
}

/** Opens the browser's folder picker. Returns null when the person cancels. */
export async function pickFolder(picker, { write = false } = {}) {
  try {
    return await picker({ id: 'quire-folders', mode: write ? 'readwrite' : 'read', startIn: 'documents' });
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

/** Writes one file into a folder, replacing a file with the same name. */
export async function writeFileTo(dirHandle, name, blob) {
  const file = await dirHandle.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** A short line for a folder's contents, such as "12 pictures · 3 text files". */
export function contentsLine({ pictures = 0, texts = 0 } = {}) {
  const part = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return [part(pictures, 'picture', 'pictures'), part(texts, 'text file', 'text files')].join(' · ');
}
