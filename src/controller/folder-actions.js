/** Linked folders for the Quire controller: linking and unlinking folders, inserting pictures from them, importing their text files, and writing backups to the backup folder. Mixed into QuireApp. */

import { makeBackup } from '../export.js';
import { folderAccessSupported, FOLDER_LIMIT, backupFileName, backupFolderOf, hasAccess, isBackupDue, newFolderId, normalizeFolderList, pickFolder, requestAccess, scanFolder, writeFileTo } from '../folders.js';
import { folderPicturesDialog, linkedFoldersDialog, vaultConflictDialog } from '../folders-dialog.js';
import { normalizeEntry, localISODate } from '../model.js';
import { forgetNativeFolder, nativeFoldersAvailable, nativeRecord, pickNativeFolder, reviveHandle } from '../folders-native.js';
import { entryFromVaultFile, planVaultSync, recordFor, vaultMarkdown } from '../vault-sync.js';

export const folderMethods = {
  // ---------- linked folders ----------

  /** Linked folders work with the browser's folder picker, or with the desktop shell's native one. */
  folderSupported() {
    return folderAccessSupported(globalThis) || nativeFoldersAvailable(globalThis);
  },

  /** The linked folders, normalized, with their handles. Throws while the store is locked. */
  async linkedState() {
    const { list, handles } = await this.store.getLinkedFolders();
    const revived = Object.fromEntries(Object.entries(handles ?? {}).map(([id, handle]) => [id, reviveHandle(handle)]));
    return { list: normalizeFolderList(list), handles: revived };
  },

  /** Saves the list and handles. Native folders are stored as plain records, not as the objects that act on them. */
  async saveLinkedState(list, handles) {
    const stored = Object.fromEntries(Object.entries(handles).map(([id, handle]) => [id, handle?.native ? nativeRecord(handle) : handle]));
    await this.store.setLinkedFolders({ list, handles: stored });
  },

  /** Menu: File > Linked folders. The dialog lists each folder with what Quire found in it. */
  linkedFolders() {
    linkedFoldersDialog({
      supported: this.folderSupported(),
      load: () => this.folderRows(),
      act: (action, id, value) => this.folderAction(action, id, value),
    });
  },

  /** One row per linked folder: its name, whether Quire can read it now, and what it holds. */
  async folderRows() {
    const { list, handles } = await this.linkedState();
    return Promise.all(
      list.map(async (folder) => {
        const handle = handles[folder.id];
        const base = { id: folder.id, name: folder.name, backup: folder.backup, vault: folder.vault === true, lastBackupAt: folder.lastBackupAt ?? null };
        if (!(await hasAccess(handle, folder.backup ? 'readwrite' : 'read'))) return { ...base, accessible: false, pictures: 0, texts: 0 };
        try {
          const { pictures, texts } = await scanFolder(handle);
          return { ...base, accessible: true, pictures: pictures.length, texts: texts.length };
        } catch {
          // The folder was moved or deleted. Quire shows it as unreadable, so it can be unlinked.
          return { ...base, accessible: false, pictures: 0, texts: 0 };
        }
      }),
    );
  },

  /**
   * Runs one row action from the dialog. `link` opens the browser's picker, so
   * it must run before any await. Errors are thrown back to the dialog, except
   * for the actions that close it, which report them in the status line.
   */
  async folderAction(action, id = null, value = undefined) {
    if (action === 'link') return this.linkFolder();
    if (action === 'pictures') return this.pictureFromFolder(id);
    if (action === 'import') return this.importFromFolder(id);
    if (action === 'vault') return this.setVault(id, value);
    if (action === 'sync') return (await this.syncVaults({ only: id, interactive: true })).summary;

    const { list, handles } = await this.linkedState();
    const folder = list.find((item) => item.id === id);
    const handle = folder ? handles[folder.id] : null;
    if (!folder || !handle) throw new Error('That folder is no longer linked.');

    if (action === 'allow') {
      if (!(await requestAccess(handle, folder.backup ? 'readwrite' : 'read'))) {
        throw new Error(`Quire needs permission to read ${folder.name}. Choose Allow access again.`);
      }
      return undefined;
    }
    if (action === 'unlink') {
      const rest = { ...handles };
      delete rest[folder.id];
      if (handle.native) await forgetNativeFolder(handle).catch(() => {});
      await this.saveLinkedState(list.filter((item) => item.id !== folder.id), rest);
      this.showStatus(`Unlinked ${folder.name}`);
      return undefined;
    }
    if (action === 'backup') {
      if (value) {
        if (!(await requestAccess(handle, 'readwrite'))) throw new Error(`Quire needs permission to write to ${folder.name} to use it for backups.`);
        // Only one folder takes the backups, so the others are switched off.
        const next = list.map((item) => ({ id: item.id, name: item.name, backup: item.id === folder.id }));
        await this.saveLinkedState(next, handles);
        const written = await this.writeBackupTo({ ...folder, handle });
        this.showStatus(`Backed up ${written.entries} entries to ${folder.name}`);
        return undefined;
      }
      await this.saveLinkedState(list.map((item) => ({ id: item.id, name: item.name, backup: false })), handles);
      this.showStatus(`${folder.name} is no longer the backup folder`);
      return undefined;
    }
    throw new Error('That action is not known.');
  },

  /** Opens the browser's picker and links the folder it returns. */
  async linkFolder() {
    const picker = folderAccessSupported(globalThis) ? (options) => globalThis.showDirectoryPicker(options) : () => pickNativeFolder();
    const handle = await pickFolder(picker);
    if (!handle) return;
    const { list, handles } = await this.linkedState();
    for (const folder of list) {
      if (handles[folder.id] && (await handle.isSameEntry?.(handles[folder.id]))) {
        throw new Error(`${folder.name} is already linked.`);
      }
    }
    if (list.length >= FOLDER_LIMIT) throw new Error(`Quire links up to ${FOLDER_LIMIT} folders. Unlink one first.`);
    const id = newFolderId();
    await this.saveLinkedState([...list, { id, name: handle.name, backup: false }], { ...handles, [id]: handle });
    this.showStatus(`Linked ${handle.name}`);
  },

  /** Menu: Edit > Picture from linked folder. Picks a picture from a linked folder and inserts it at the caret. */
  async pictureFromFolder(startId = null) {
    try {
      if (!this.folderSupported()) throw new Error('Linked folders need Chrome or Edge on a computer.');
      if (!this.entry) return;
      const { list, handles } = await this.linkedState();
      if (!list.length) {
        this.linkedFolders();
        return;
      }
      // The folder the person came from opens first; the others follow in the list.
      const ordered = [...list].sort((a, b) => (a.id === startId ? -1 : b.id === startId ? 1 : 0));
      const entry = this.entry;
      folderPicturesDialog({
        folders: ordered.map((folder) => ({ id: folder.id, name: folder.name })),
        load: async (folderId) => {
          const handle = handles[folderId];
          if (!(await requestAccess(handle, 'read'))) throw new Error('Allow access to this folder in Linked folders first.');
          return (await scanFolder(handle)).pictures;
        },
        onPick: async (picture) => {
          if (this.entry !== entry) return;
          await this.insertImages([await picture.getFile()]);
        },
      });
    } catch (error) {
      this.showStatus(error.message, true);
    }
  },

  /** Imports every Markdown and text file in a linked folder as entries. The files are only read. */
  async importFromFolder(id) {
    try {
      const { list, handles } = await this.linkedState();
      const folder = list.find((item) => item.id === id);
      const handle = folder ? handles[folder.id] : null;
      if (!folder || !handle) throw new Error('That folder is no longer linked.');
      if (!(await requestAccess(handle, 'read'))) throw new Error(`Allow access to ${folder.name} first.`);
      const { texts } = await scanFolder(handle);
      if (!texts.length) {
        this.showStatus(`No Markdown or text files in ${folder.name}`);
        return;
      }
      await this.importFiles(await Promise.all(texts.map((text) => text.getFile())));
    } catch (error) {
      this.showStatus(error.message, true);
    }
  },

  /** The folder that takes backups, with its handle, or null when none is set. */
  async backupFolder() {
    const { list, handles } = await this.linkedState();
    const folder = backupFolderOf(list);
    return folder && handles[folder.id] ? { ...folder, handle: handles[folder.id] } : null;
  },

  /** Writes the whole library to the backup folder, in the same format as Back up all entries. */
  async writeBackupTo(folder) {
    const entries = await this.store.listFull();
    const versions = await this.store.listAllVersions();
    const habits = await this.store.getHabits();
    await writeFileTo(folder.handle, backupFileName(), makeBackup(entries, versions, habits));
    const { list, handles } = await this.linkedState();
    await this.saveLinkedState(
      list.map((item) => (item.id === folder.id ? { ...item, lastBackupAt: new Date().toISOString() } : item)),
      handles,
    );
    return { entries: entries.length, versions: versions.length };
  },

  /**
   * Quire has been hidden or closed. If a backup folder is set, it is still
   * readable and writable without asking, and its last backup is a day old or
   * more, a new backup is written. Otherwise nothing happens, so it never asks
   * for a permission on its own.
   */
  startFolderBackups() {
    if (!this.folderSupported()) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      this.autoBackup();
      this.syncVaults().catch(() => {});
    });
  },

  async autoBackup() {
    try {
      const folder = await this.backupFolder();
      if (!folder || !isBackupDue(folder.lastBackupAt)) return;
      if (!(await hasAccess(folder.handle, 'readwrite'))) return;
      await this.persist();
      await this.writeBackupTo(folder);
    } catch (error) {
      // Locked, or the folder has gone. The next time Quire is hidden tries again.
      if (error?.name !== 'LockedError') console.warn('Quire: the automatic backup did not run.', error);
    }
  },

  /**
   * Turns two-way sync on or off. Turning it on needs write access, and then the
   * folder is read in at once. Turning it off keeps the entries in Quire, and
   * stops the sync records.
   */
  async setVault(id, on) {
    const { list, handles } = await this.linkedState();
    const folder = list.find((item) => item.id === id);
    const handle = folder ? handles[folder.id] : null;
    if (!folder || !handle) throw new Error('That folder is no longer linked.');
    if (!on) {
      await this.saveLinkedState(
        list.map((item) => {
          if (item.id !== id) return item;
          const { vault, files, ...rest } = item;
          return rest;
        }),
        handles,
      );
      return `${folder.name} is no longer a vault. Its entries stay in Quire.`;
    }
    if (!(await requestAccess(handle, 'readwrite'))) throw new Error(`Quire needs permission to write to ${folder.name} to keep it in sync.`);
    await this.saveLinkedState(list.map((item) => (item.id === id ? { ...item, vault: true, files: {} } : item)), handles);
    return (await this.syncVaults({ only: id, interactive: true })).summary;
  },

  /**
   * Syncs the vault folders Quire can write to right now (`only` limits it to one).
   * Interactive runs ask about files changed on both sides. Background runs leave
   * those alone for next time.
   */
  async syncVaults({ only = null, interactive = false } = {}) {
    const { list, handles } = await this.linkedState();
    const vaults = list.filter((folder) => folder.vault && (!only || folder.id === only));
    if (!vaults.length) return { summary: '', ids: [] };
    await this.persist();
    const results = new Map();
    const summaries = [];
    const ids = [];
    for (const folder of vaults) {
      const handle = handles[folder.id];
      if (!handle || !(await hasAccess(handle, 'readwrite'))) {
        if (interactive) summaries.push(`Allow write access to ${folder.name} to keep it in sync.`);
        continue;
      }
      const result = await this.syncOneVault(folder, handle, interactive);
      results.set(folder.id, result.folder);
      ids.push(...result.ids);
      summaries.push(vaultSummary(folder.name, result.counts));
    }
    if (results.size) {
      const fresh = await this.linkedState();
      await this.saveLinkedState(fresh.list.map((item) => results.get(item.id) ?? item), fresh.handles);
    }
    if (ids.length) {
      await this.refreshHome();
      if (this.entry && ids.includes(this.entry.id)) await this.openEntry(this.entry.id, { history: 'none' });
    }
    const summary = summaries.join(' ');
    if (interactive && summary) this.showStatus(summary);
    return { summary: summary || 'Nothing to sync.', ids };
  },

  /** One vault folder: plans the sync from the disk, the store and the last records, then does it. */
  async syncOneVault(folder, handle, interactive) {
    const { texts } = await scanFolder(handle);
    const disk = new Map();
    const files = new Map();
    for (const text of texts) {
      const file = await text.getFile();
      disk.set(text.name, { modified: file.lastModified, size: file.size });
      files.set(text.name, file);
    }
    const index = folder.files ?? {};
    const entries = new Map();
    for (const record of Object.values(index)) {
      if (record.removed) continue;
      const entry = await this.store.get(record.entryId);
      if (entry && !entry.deletedAt) entries.set(record.entryId, entry);
    }
    let actions = planVaultSync({ disk, index, entries });
    const counts = { imported: 0, exported: 0, mediaSkipped: 0, unresolved: 0, retired: 0, forgotten: 0 };

    const conflicts = actions.filter((action) => action.type === 'conflict');
    if (conflicts.length) {
      const choices = interactive
        ? await vaultConflictDialog(
            conflicts.map((action) => ({
              name: action.name,
              quireUpdated: entries.get(index[action.name].entryId)?.updatedAt ?? '',
              fileModified: disk.get(action.name).modified,
            })),
          )
        : new Map();
      actions = actions.flatMap((action) => {
        if (action.type !== 'conflict') return [action];
        const pick = choices.get(action.name);
        if (pick === 'quire') return [{ type: 'export', name: action.name }];
        if (pick === 'file') return [{ type: 'import', name: action.name, why: 'chosen' }];
        counts.unresolved += 1;
        return [];
      });
    }

    const next = { ...index };
    const ids = [];
    for (const action of actions) {
      if (action.type === 'import') {
        const file = files.get(action.name);
        const parsed = entryFromVaultFile(folder.id, action.name, await file.text(), localISODate());
        const existing = await this.store.get(parsed.id);
        const merged = normalizeEntry({
          ...parsed,
          images: existing?.images ?? {},
          audio: existing?.audio ?? {},
          sketches: existing?.sketches ?? {},
          createdAt: existing?.createdAt ?? parsed.createdAt,
          updatedAt: new Date().toISOString(),
        });
        await this.store.save(merged);
        next[action.name] = recordFor({ entryId: merged.id, modified: file.lastModified, size: file.size, entryUpdatedAt: merged.updatedAt });
        ids.push(merged.id);
        counts.imported += 1;
      } else if (action.type === 'export') {
        const entry = entries.get(index[action.name].entryId);
        await writeFileTo(handle, action.name, new Blob([vaultMarkdown(entry)], { type: 'text/markdown' }));
        const written = await (await handle.getFileHandle(action.name)).getFile();
        next[action.name] = recordFor({ entryId: entry.id, modified: written.lastModified, size: written.size, entryUpdatedAt: entry.updatedAt });
        counts.exported += 1;
      } else if (action.type === 'skip') {
        counts.mediaSkipped += 1;
      } else if (action.type === 'retire') {
        next[action.name] = { ...next[action.name], removed: true };
        counts.retired += 1;
      } else if (action.type === 'forget') {
        delete next[action.name];
        counts.forgotten += 1;
      }
    }
    const { files: _old, ...rest } = folder;
    return { folder: { ...rest, vault: true, files: next }, counts, ids };
  },
};

/** One line for a vault's sync, such as "Notes: 2 read from the folder, 1 written back." */
function vaultSummary(name, counts) {
  const parts = [];
  if (counts.imported) parts.push(`${counts.imported} read from the folder`);
  if (counts.exported) parts.push(`${counts.exported} written back`);
  if (counts.unresolved) parts.push(`${counts.unresolved} left for later`);
  if (counts.mediaSkipped) parts.push(`${counts.mediaSkipped} kept in Quire only (they have pictures or sketches)`);
  if (counts.retired) parts.push(`${counts.retired} whose entries were removed`);
  if (counts.forgotten) parts.push(`${counts.forgotten} no longer in the folder`);
  return parts.length ? `${name}: ${parts.join(', ')}.` : `${name} is up to date.`;
}
