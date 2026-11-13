/**
 * The dialogs for linked folders: the list of folders (link, allow, backup,
 * unlink) and the picture picker that inserts a picture from one of them.
 * They draw only; the controller does the reading, the writing and the store.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { contentsLine } from './folders.js';

/** Actions that leave the list, so the list closes before they run. */
const LEAVES_LIST = new Set(['pictures', 'import']);
/** Most pictures the picker draws at once. A folder with more shows the first of them. */
const PICTURE_LIMIT = 120;

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * `load()` returns the rows: { id, name, backup, accessible, pictures, texts, lastBackupAt }.
 * `act(action, id, value)` does one thing to a folder. It is awaited, then the list redraws.
 * A failed action shows its message in the dialog.
 */
export function linkedFoldersDialog({ supported, load, act }) {
  const list = el('ul', { class: 'folder-list', 'aria-label': 'Linked folders' });
  const status = el('p', { class: 'folder-status dialog-text', role: 'status', 'aria-live': 'polite' });
  const linkButton = el('button', { class: 'btn', type: 'button', disabled: !supported, onClick: () => run('link') }, 'Link a folder…');
  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide folder-dialog' },
    el(
      'div',
      { class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, 'Linked folders'),
      el(
        'p',
        { class: 'dialog-text' },
        supported
          ? 'Quire reads the folders you link. It can insert their pictures, import their text and Markdown files, and write backups to one of them. Quire never changes the files you import from.'
          : 'Linked folders need Chrome or Edge on a computer. This browser cannot open a folder.',
      ),
      list,
      status,
      el(
        'div',
        { class: 'dialog-actions' },
        linkButton,
        el('button', { class: 'btn btn-primary', type: 'button', onClick: () => dialog.close() }, 'Done'),
      ),
    ),
  );

  async function run(action, id = null, value = undefined) {
    status.textContent = '';
    if (LEAVES_LIST.has(action)) dialog.close();
    try {
      await act(action, id, value);
    } catch (error) {
      if (dialog.open) status.textContent = error.message || 'That did not work.';
      return;
    }
    if (dialog.open) await redraw();
  }

  function row(folder) {
    const buttons = [];
    if (!folder.accessible) {
      buttons.push(el('button', { class: 'btn', type: 'button', onClick: () => run('allow', folder.id) }, 'Allow access'));
    } else {
      buttons.push(el('button', { class: 'btn', type: 'button', onClick: () => run('pictures', folder.id) }, 'Insert picture…'));
      buttons.push(el('button', { class: 'btn', type: 'button', onClick: () => run('import', folder.id) }, 'Import text…'));
    }
    buttons.push(el('button', { class: 'btn', type: 'button', onClick: () => run('unlink', folder.id) }, 'Unlink'));

    const notes = [];
    if (!folder.accessible) notes.push('Quire cannot read this folder right now. Allow access again, or unlink it.');
    else notes.push(contentsLine(folder));
    if (folder.backup) {
      notes.push(folder.lastBackupAt ? `Last backup ${when(folder.lastBackupAt)}` : 'No backup written yet');
    }

    const backupBox = el('input', {
      type: 'checkbox',
      checked: folder.backup,
      onChange: (event) => run('backup', folder.id, event.target.checked),
    });

    return el(
      'li',
      { class: 'folder-row' },
      el(
        'div',
        { class: 'folder-head' },
        el('strong', { class: 'folder-name' }, folder.name),
        el('label', { class: 'folder-backup' }, backupBox, ' Use for backups'),
      ),
      el('p', { class: 'folder-note' }, notes.join(' · ')),
      el('div', { class: 'folder-actions' }, buttons),
    );
  }

  async function redraw() {
    const rows = await load();
    list.replaceChildren(
      ...(rows.length
        ? rows.map(row)
        : [el('li', { class: 'folder-empty dialog-text' }, 'No folders linked yet. Link one to bring its pictures and text files into Quire.')]),
    );
  }

  dialog.addEventListener('close', () => status.textContent = '');
  showDialog(dialog);
  redraw().catch((error) => {
    status.textContent = error.message || 'The linked folders could not be read.';
  });
  return dialog;
}

/**
 * The picture picker. `folders` is [{ id, name }]; `load(id)` returns the
 * picture handles in that folder. Picking one closes the picker and calls
 * `onPick(handle)`, which reads it and inserts it.
 */
export function folderPicturesDialog({ folders, load, onPick }) {
  const urls = [];
  let generation = 0;
  const body = el('div', { class: 'folder-grid', role: 'list', 'aria-label': 'Pictures in the folder' });
  const title = el('p', { class: 'folder-status dialog-text' });
  const select = el(
    'select',
    { class: 'dialog-select', 'aria-label': 'Folder', onChange: () => show(select.value) },
    folders.map((folder) => el('option', { value: folder.id }, folder.name)),
  );
  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide folder-dialog' },
    el(
      'div',
      { class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, 'Picture from a linked folder'),
      folders.length > 1 ? select : null,
      title,
      body,
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel')),
    ),
  );

  function forgetUrls() {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  }

  async function show(id) {
    const mine = ++generation;
    forgetUrls();
    body.replaceChildren();
    title.textContent = 'Reading the folder…';
    let pictures;
    try {
      pictures = await load(id);
    } catch (error) {
      if (mine === generation) title.textContent = error.message || 'That folder could not be read.';
      return;
    }
    if (mine !== generation) return;
    if (!pictures.length) {
      title.textContent = 'No pictures here. Quire shows PNG, JPEG, GIF, WebP, BMP and AVIF files.';
      return;
    }
    const shown = pictures.slice(0, PICTURE_LIMIT);
    title.textContent = pictures.length > shown.length
      ? `Showing ${shown.length} of ${pictures.length} pictures. Pick one to add it to the entry.`
      : `${pictures.length} ${pictures.length === 1 ? 'picture' : 'pictures'}. Pick one to add it to the entry.`;
    for (const handle of shown) {
      const img = el('img', { alt: handle.name, loading: 'lazy', decoding: 'async' });
      body.append(
        el(
          'button',
          { class: 'folder-thumb', type: 'button', role: 'listitem', title: handle.name, onClick: () => pick(handle) },
          img,
          el('span', { class: 'folder-thumb-name' }, handle.name),
        ),
      );
      handle.getFile().then((file) => {
        if (mine !== generation) return;
        const url = URL.createObjectURL(file);
        urls.push(url);
        img.src = url;
      }).catch(() => img.replaceWith(el('span', { class: 'folder-thumb-name' }, 'Unreadable')));
    }
  }

  function pick(handle) {
    dialog.close();
    onPick(handle);
  }

  dialog.addEventListener('close', () => {
    generation += 1;
    forgetUrls();
  }, { once: true });
  showDialog(dialog);
  if (folders.length) show(folders[0].id);
  return dialog;
}
