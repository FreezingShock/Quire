/**
 * Linked folders in the desktop app, for the webviews that have no folder
 * picker (macOS and Linux). Each call goes to the `folders` plugin in
 * src-tauri/src/folders.rs. The objects here have the same shape as the
 * File System Access handles that src/folders.js reads, so the rest of the
 * folder code does not change.
 *
 * A linked native folder is stored as a plain record { native, name, path }.
 * It is revived into a NativeDirectory when it is read, because a stored value
 * cannot keep its methods.
 */

import { desktopInvoke, isDesktop } from './desktop.js';

const PLUGIN = 'plugin:folders|';
const encoder = new TextEncoder();

/** True when the shell is there and the browser's own folder picker is missing (macOS and Linux). */
export function nativeFoldersAvailable(scope = globalThis) {
  return isDesktop(scope) && typeof scope.showDirectoryPicker !== 'function';
}

/** Turns a stored record back into a handle. Browser handles pass through unchanged. */
export function reviveHandle(stored) {
  if (stored && stored.native === true && typeof stored.path === 'string') return new NativeDirectory(stored);
  return stored;
}

/** The record to store for a native handle, which is plain data. */
export function nativeRecord(handle) {
  return { native: true, name: handle.name, path: handle.path };
}

/** Asks the shell to show the folder picker. Resolves to a NativeDirectory, or null when the person cancels. */
export async function pickNativeFolder() {
  const path = await desktopInvoke(`${PLUGIN}pick_folder`, {});
  if (!path) return null;
  return new NativeDirectory({ name: basename(path), path });
}

/** Tells the shell a folder is no longer linked, so it stops allowing access to it. */
export function forgetNativeFolder(handle) {
  return desktopInvoke(`${PLUGIN}forget_folder`, { dir: handle.path });
}

function basename(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || 'Folder';
}

/** A folder on disk. Its permission is held by the shell, so it reads as granted. */
class NativeDirectory {
  constructor({ name, path }) {
    this.kind = 'directory';
    this.native = true;
    this.name = name;
    this.path = path;
  }

  async queryPermission() {
    return 'granted';
  }

  async requestPermission() {
    return 'granted';
  }

  async isSameEntry(other) {
    return other?.path === this.path;
  }

  /** The files directly inside the folder, as handles. Folders inside it are not listed. */
  async *values() {
    const files = await desktopInvoke(`${PLUGIN}list_folder`, { dir: this.path });
    for (const [name] of files) yield new NativeFile(this.path, name);
  }

  async getFileHandle(name, { create = false } = {}) {
    const file = new NativeFile(this.path, name);
    if (!create) await desktopInvoke(`${PLUGIN}stat_file`, { dir: this.path, name });
    return file;
  }
}

/** One file in a native folder. Reads and writes go through the shell. */
class NativeFile {
  constructor(dir, name) {
    this.kind = 'file';
    this.dir = dir;
    this.name = name;
  }

  async getFile() {
    const [size, modified] = await desktopInvoke(`${PLUGIN}stat_file`, { dir: this.dir, name: this.name });
    const bytes = new Uint8Array(await desktopInvoke(`${PLUGIN}read_file`, { dir: this.dir, name: this.name }));
    return new File([bytes], this.name, { lastModified: modified, type: mimeFor(this.name) });
  }

  /** Collects the written chunks and sends them to the shell when closed. */
  async createWritable() {
    const chunks = [];
    const dir = this.dir;
    const name = this.name;
    return {
      async write(data) {
        if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()));
        else if (typeof data === 'string') chunks.push(encoder.encode(data));
        else chunks.push(new Uint8Array(data));
      },
      async close() {
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        await desktopInvoke(`${PLUGIN}write_file`, { dir, name, data: Array.from(bytes) });
      },
    };
  }
}

function mimeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return {
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
  }[ext] ?? '';
}
