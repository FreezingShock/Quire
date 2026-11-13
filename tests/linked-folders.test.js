import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_EVERY_MS,
  FOLDER_LIMIT,
  backupFileName,
  backupFolderOf,
  contentsLine,
  folderAccessSupported,
  hasAccess,
  isBackupDue,
  isPictureName,
  isTextName,
  normalizeFolderList,
  pickFolder,
  requestAccess,
  scanFolder,
  writeFileTo,
} from '../src/folders.js';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';

/** A fake directory handle with the File System Access shape: values(), queryPermission(), requestPermission(). */
function fakeDir(name, children = [], { permission = 'granted', prompt = 'granted' } = {}) {
  const writes = [];
  return {
    kind: 'directory',
    name,
    writes,
    async *values() {
      for (const child of children) yield child;
    },
    async queryPermission({ mode }) {
      return permission === 'granted' || (mode === 'read' && permission === 'read-only') ? 'granted' : 'prompt';
    },
    async requestPermission() {
      return prompt;
    },
    async getFileHandle(fileName) {
      return {
        async createWritable() {
          return {
            async write(blob) {
              writes.push({ name: fileName, blob });
            },
            async close() {},
          };
        },
      };
    },
  };
}

const file = (name) => ({ kind: 'file', name });

test('picture and text names are recognized by extension, whatever the case', () => {
  assert.equal(isPictureName('Beach.JPG'), true);
  assert.equal(isPictureName('sketch.webp'), true);
  assert.equal(isPictureName('notes.md'), false);
  assert.equal(isTextName('Day one.markdown'), true);
  assert.equal(isTextName('todo.TXT'), true);
  assert.equal(isTextName('photo.png'), false);
  assert.equal(isTextName(undefined), false);
});

test('folder access is reported only where the picker exists', () => {
  assert.equal(folderAccessSupported({}), false);
  assert.equal(folderAccessSupported({ showDirectoryPicker() {} }), true);
});

test('scanFolder sorts pictures and text files and skips subfolders', async () => {
  const dir = fakeDir('Archive', [
    file('10 beach.png'),
    file('2 beach.png'),
    { kind: 'directory', name: 'Old' },
    file('Trip.md'),
    file('readme.pdf'),
    file('a.txt'),
  ]);
  const { pictures, texts } = await scanFolder(dir);
  assert.deepEqual(pictures.map((item) => item.name), ['2 beach.png', '10 beach.png']);
  assert.deepEqual(texts.map((item) => item.name), ['a.txt', 'Trip.md']);
});

test('normalizeFolderList keeps well-formed folders and drops the rest', () => {
  const list = normalizeFolderList([
    null,
    { name: 'No id' },
    { id: 'a', name: '  Pictures  ' },
    { id: 'a', name: 'Duplicate id' },
    { id: 'b', name: '', backup: true },
    { id: 'c', name: 'Second backup', backup: true },
  ]);
  assert.deepEqual(list, [
    { id: 'a', name: 'Pictures', backup: false },
    { id: 'b', name: 'Folder', backup: true },
    { id: 'c', name: 'Second backup', backup: false },
  ]);
});

test('only one folder can take the backups, and the last backup time is kept only for it', () => {
  const when = '2026-11-01T08:00:00.000Z';
  const list = normalizeFolderList([
    { id: 'a', name: 'A', backup: true, lastBackupAt: when },
    { id: 'b', name: 'B', backup: false, lastBackupAt: when },
  ]);
  assert.equal(backupFolderOf(list).id, 'a');
  assert.equal(list[0].lastBackupAt, when);
  assert.equal('lastBackupAt' in list[1], false);
  assert.equal(normalizeFolderList([{ id: 'x', name: 'X', backup: true, lastBackupAt: 'not a date' }])[0].lastBackupAt, undefined);
});

test('the folder list is capped', () => {
  const many = Array.from({ length: FOLDER_LIMIT + 4 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
  assert.equal(normalizeFolderList(many).length, FOLDER_LIMIT);
});

test('a backup is due when none was written or the last one is a day old', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z');
  assert.equal(isBackupDue(undefined, now), true);
  assert.equal(isBackupDue('2026-11-13T11:00:00.000Z', now), false);
  assert.equal(isBackupDue(new Date(now - BACKUP_EVERY_MS).toISOString(), now), true);
  assert.equal(isBackupDue('garbage', now), true);
});

test('the backup file is named by its day', () => {
  assert.equal(backupFileName(new Date(2026, 10, 3, 9, 30)), 'quire-backup-2026-11-03.json');
});

test('access is checked without asking, and requested only when missing', async () => {
  const readOnly = fakeDir('Photos', [], { permission: 'read-only', prompt: 'granted' });
  assert.equal(await hasAccess(readOnly, 'read'), true);
  assert.equal(await hasAccess(readOnly, 'readwrite'), false);
  assert.equal(await requestAccess(readOnly, 'readwrite'), true);
  const refused = fakeDir('Locked', [], { permission: 'prompt', prompt: 'denied' });
  assert.equal(await requestAccess(refused, 'read'), false);
  assert.equal(await hasAccess(undefined), false);
});

test('pickFolder returns the picked handle, and null when the person cancels', async () => {
  const handle = fakeDir('Picked');
  let seen = null;
  assert.equal(await pickFolder(async (options) => ((seen = options), handle), { write: true }), handle);
  assert.equal(seen.mode, 'readwrite');
  const cancelled = await pickFolder(async () => {
    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  });
  assert.equal(cancelled, null);
  await assert.rejects(pickFolder(async () => {
    throw new Error('blocked');
  }));
});

test('writeFileTo writes the file into the folder', async () => {
  const dir = fakeDir('Backups');
  await writeFileTo(dir, 'quire-backup-2026-11-13.json', new Blob(['{}']));
  assert.equal(dir.writes.length, 1);
  assert.equal(dir.writes[0].name, 'quire-backup-2026-11-13.json');
});

test('contentsLine reads plainly for one and for many', () => {
  assert.equal(contentsLine({ pictures: 1, texts: 0 }), '1 picture · 0 text files');
  assert.equal(contentsLine({ pictures: 12, texts: 3 }), '12 pictures · 3 text files');
});

test('the memory store starts with no linked folders', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  assert.deepEqual(await store.getLinkedFolders(), { list: [], handles: {} });
});

test('linked folders keep their handles and list while the lock is off', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  const handle = { name: 'Photos' };
  await store.setLinkedFolders({ list: [{ id: 'a', name: 'Photos', backup: false }], handles: { a: handle } });
  const back = await store.getLinkedFolders();
  assert.deepEqual(back.list, [{ id: 'a', name: 'Photos', backup: false }]);
  assert.deepEqual(back.handles, { a: { name: 'Photos' } });
});

test('the folder list is sealed while the lock is on, and needs the vault to read', async () => {
  const store = createMemoryStore();
  const vault = createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
  store.setCipher(vault);
  await store.setLinkedFolders({ list: [{ id: 'a', name: 'Secret archive', backup: true }], handles: {} });
  assert.deepEqual((await store.getLinkedFolders()).list, [{ id: 'a', name: 'Secret archive', backup: true }]);
  store.setCipher(null);
  await assert.rejects(store.getLinkedFolders());
});

test('turning the lock on keeps linked folders, and the list is sealed afterwards', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.setLinkedFolders({ list: [{ id: 'a', name: 'Notes', backup: false }], handles: { a: { name: 'Notes' } } });
  const vault = createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
  await store.reseal(vault);
  store.setCipher(vault);
  const back = await store.getLinkedFolders();
  assert.deepEqual(back.list, [{ id: 'a', name: 'Notes', backup: false }]);
  assert.deepEqual(back.handles, { a: { name: 'Notes' } });
});
