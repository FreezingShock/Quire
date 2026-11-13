/** Linked folders for the Quire controller: linking and unlinking folders, inserting pictures from them, importing their text files, and writing backups to the backup folder. Mixed into QuireApp. */

import { makeBackup } from '../export.js';
import { folderAccessSupported, FOLDER_LIMIT, backupFileName, backupFolderOf, hasAccess, isBackupDue, newFolderId, normalizeFolderList, pickFolder, requestAccess, scanFolder, writeFileTo } from '../folders.js';
import { folderPicturesDialog, linkedFoldersDialog } from '../folders-dialog.js';

export const folderMethods = {
  // ---------- linked folders ----------

  folderSupported() {
    return folderAccessSupported(globalThis);
  },

  /** The linked folders, normalized, with their handles. Throws while the store is locked. */
  async linkedState() {
    const { list, handles } = await this.store.getLinkedFolders();
    return { list: normalizeFolderList(list), handles: handles ?? {} };
  },

  async saveLinkedState(list, handles) {
    await this.store.setLinkedFolders({ list, handles });
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
        const base = { id: folder.id, name: folder.name, backup: folder.backup, lastBackupAt: folder.lastBackupAt ?? null };
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
    const handle = await pickFolder((options) => globalThis.showDirectoryPicker(options));
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
      if (document.visibilityState === 'hidden') this.autoBackup();
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
};
