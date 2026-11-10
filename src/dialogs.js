/** Modal dialogs built on the native <dialog> element. */

import { el } from './dom.js';
import { KINDS, displayTitle, formatShortDate } from './model.js';
import { wordCount } from './markdown.js';
import { resolveNotebookName, resolvePlaceName } from './library.js';

/*
 * Every shortcut the app answers to, grouped the way the menus are. Keep this
 * in step with the key handlers in app.js, livetext.js, home.js and dialogs.js.
 */
const SHORTCUT_GROUPS = [
  {
    title: 'Files and entries',
    rows: [
      ['All entries', 'Ctrl+Shift+H'],
      ['New entry', 'Ctrl+N'],
      ["Today's journal entry", 'Alt+T'],
      ['Open entry', 'Ctrl+O'],
      ['Search entries (All entries page)', 'Ctrl+F'],
      ['Save now', 'Ctrl+S'],
      ['Export as Markdown', 'Ctrl+E'],
      ['Print, or save as PDF', 'Ctrl+P'],
    ],
  },
  {
    title: 'Writing',
    rows: [
      ['Undo (last surface you edited)', 'Ctrl+Z'],
      ['Redo', 'Ctrl+Shift+Z, Ctrl+Y'],
      ['Select all text', 'Ctrl+A'],
      ['Bold', 'Ctrl+B'],
      ['Italic', 'Ctrl+I'],
      ['Continue a list', 'Enter'],
      ['Finish a text box', 'Escape or Ctrl+Enter'],
      ['Finish renaming the entry (Escape cancels)', 'Enter'],
      ['Focus mode: hide everything but the page', 'F11'],
      ['Leave focus mode', 'Escape or F11'],
    ],
  },
  {
    title: 'Drawing tools (when not typing)',
    rows: [
      ['Write', 'T'],
      ['Pick color', 'I'],
      ['Fill', 'G'],
      ['Pencil', 'P'],
      ['Brush', 'B'],
      ['Highlighter', 'H'],
      ['Eraser', 'E'],
      ['Spray can', 'K'],
      ['Line', 'L'],
      ['Curve', 'C'],
      ['Rectangle', 'R'],
      ['Ellipse', 'O'],
      ['Polygon', 'N'],
      ['Stamps', 'J'],
      ['Select', 'S'],
      ['Text box', 'A'],
      ['Magnifier', 'M'],
    ],
  },
  {
    title: 'Drawing and selection',
    rows: [
      ['Keep a line or shape straight, square, or round', 'Shift + drag'],
      ['Finish a curve or polygon', 'Enter or Escape'],
      ['Close a polygon', 'Click its first point'],
      ['Zoom in or out (Magnifier)', 'Click or Shift + click'],
      ['Nudge the selection (Shift for bigger steps)', 'Arrow keys'],
      ['Delete the selection', 'Delete'],
      ['Clear the selection', 'Escape'],
    ],
  },
  {
    title: 'Lists and calendar',
    rows: [
      ['Move between entries', 'Arrow keys'],
      ['Open the selected entry', 'Enter'],
      ['Delete the selected entry', 'Delete'],
      ['Move between days (calendar)', 'Arrow keys'],
    ],
  },
  {
    title: 'Menus and help',
    rows: [
      ['Open the next or previous menu', 'Left or Right arrow'],
      ['Close a menu or dialog', 'Escape'],
      ['Command palette: find a command or an entry', 'Ctrl+K'],
      ['Options', 'Ctrl+,'],
      ['Keyboard shortcuts', 'F1'],
      ['Context menu for entries, text and drawings', 'Right-click, or Shift+F10'],
    ],
  },
];

export function showDialog(dialog) {
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

/** Resolves true only when the user presses the confirm button. */
export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el(
      'dialog',
      { class: 'dialog' },
      el(
        'form',
        { method: 'dialog', class: 'dialog-form' },
        el('h2', { class: 'dialog-title' }, title),
        el('p', { class: 'dialog-text' }, message),
        el(
          'div',
          { class: 'dialog-actions' },
          el('button', { class: 'btn', type: 'submit', value: 'cancel' }, 'Cancel'),
          el('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'submit', value: 'ok' }, confirmLabel),
        ),
      ),
    );
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    showDialog(dialog);
    dialog.querySelector('[value="cancel"]').focus();
  });
}

/** A recap as label and value pairs, two columns. Used by Year in review. */
export function recapList(lines) {
  return el(
    'dl',
    { class: 'recap-list' },
    lines.flatMap(([label, value]) => [el('dt', { class: 'recap-label' }, label), el('dd', { class: 'recap-value' }, value)]),
  );
}

export function infoDialog(title, content) {
  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, title),
      content,
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Close')),
    ),
  );
  showDialog(dialog);
}

const NEW_NOTEBOOK = '__new__';

/**
 * Picks a notebook for an entry: none, an existing one, or a new name typed in.
 * `onSave(name)` gets the trimmed name, or null for no notebook.
 */
export function notebookDialog({ title = 'Move to notebook', entryName, notebooks, current = null, onSave }) {
  const select = el(
    'select',
    { class: 'dialog-select', 'aria-label': 'Notebook' },
    el('option', { value: '' }, 'No notebook'),
    notebooks.map((name) => el('option', { value: name }, name)),
    el('option', { value: NEW_NOTEBOOK }, 'New notebook…'),
  );
  const nameInput = el('input', {
    class: 'dialog-input',
    type: 'text',
    maxlength: 40,
    placeholder: 'Notebook name',
    'aria-label': 'New notebook name',
    autocomplete: 'off',
    hidden: true,
  });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const syncInput = () => {
    nameInput.hidden = select.value !== NEW_NOTEBOOK;
    error.textContent = '';
    if (!nameInput.hidden) nameInput.focus();
  };
  select.addEventListener('change', syncInput);
  select.value = current && notebooks.includes(current) ? current : '';

  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          let name = select.value;
          if (name === NEW_NOTEBOOK) {
            name = resolveNotebookName(nameInput.value, notebooks);
            if (!name) {
              error.textContent = 'Give the new notebook a name.';
              nameInput.focus();
              return;
            }
          }
          onSave(name || null);
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, title),
      el('p', { class: 'dialog-text' }, entryName ? `Choose a notebook for “${entryName}”.` : 'Choose a notebook.'),
      select,
      nameInput,
      error,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Move'),
      ),
    ),
  );
  select.addEventListener('keydown', (event) => event.stopPropagation());
  showDialog(dialog);
  select.focus();
  return dialog;
}

/**
 * Sets where an entry was written: a name typed by hand, with the places already
 * in use offered as suggestions. An empty name clears the place. `onSave(name)`
 * gets the trimmed name, or null for no place.
 */
export function placeDialog({ entryName, places = [], current = null, onSave }) {
  const input = el('input', {
    class: 'dialog-input',
    type: 'text',
    maxlength: 60,
    placeholder: 'Place name',
    'aria-label': 'Place name',
    autocomplete: 'off',
    list: 'place-options',
  });
  input.value = current ?? '';
  const suggestions = el(
    'datalist',
    { id: 'place-options' },
    places.map((name) => el('option', { value: name })),
  );
  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          onSave(resolvePlaceName(input.value, places) || null);
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, 'Set place'),
      el(
        'p',
        { class: 'dialog-text' },
        entryName ? `Where was “${entryName}” written? Leave it empty to clear the place.` : 'Where was this written? Leave it empty to clear the place.',
      ),
      input,
      suggestions,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      ),
    ),
  );
  input.addEventListener('keydown', (event) => event.stopPropagation());
  showDialog(dialog);
  input.focus();
  input.select();
  return dialog;
}

/**
 * Names the current search or filter so it can be saved. `check(name)` returns
 * a problem to show, or null. `onSave(name)` gets the trimmed name.
 */
export function saveSearchDialog({ suggested = '', check, onSave }) {
  const nameInput = el('input', {
    class: 'dialog-input',
    type: 'text',
    maxlength: 40,
    value: suggested,
    placeholder: 'Name for this search',
    'aria-label': 'Saved search name',
    autocomplete: 'off',
  });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          const name = nameInput.value.trim();
          const problem = check(name);
          if (problem) {
            error.textContent = problem;
            nameInput.focus();
            return;
          }
          onSave(name);
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, 'Save this search'),
      el('p', { class: 'dialog-text' }, 'Saved searches stay in this browser and show in the sidebar.'),
      nameInput,
      error,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
      ),
    ),
  );
  nameInput.addEventListener('keydown', (event) => event.stopPropagation());
  nameInput.addEventListener('input', () => {
    error.textContent = '';
  });
  showDialog(dialog);
  nameInput.focus();
  nameInput.select();
  return dialog;
}

/**
 * Asks for the size of the selection as a percent of its current size. Keeping
 * proportions ties the two fields together. `onSave(kx, ky)` gets the factors,
 * where 1 means no change.
 */
export function resizeDialog({ onSave }) {
  const width = el('input', { class: 'dialog-input', type: 'number', min: 1, max: 1000, step: 'any', value: 100, 'aria-label': 'Horizontal percent' });
  const height = el('input', { class: 'dialog-input', type: 'number', min: 1, max: 1000, step: 'any', value: 100, 'aria-label': 'Vertical percent' });
  const keep = el('input', { type: 'checkbox', checked: true });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  width.addEventListener('input', () => {
    if (keep.checked) height.value = width.value;
  });
  keep.addEventListener('change', () => {
    if (keep.checked) height.value = width.value;
  });

  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          const kx = Number(width.value) / 100;
          const ky = Number(height.value) / 100;
          if (!(kx >= 0.01 && kx <= 10 && ky >= 0.01 && ky <= 10)) {
            error.textContent = 'Use a percent from 1 to 1000.';
            return;
          }
          onSave(kx, ky);
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, 'Resize selection'),
      el('p', { class: 'dialog-text' }, 'Scale the selected ink. 100% keeps its size.'),
      el('label', { class: 'field' }, 'Horizontal (%)', width),
      el('label', { class: 'field' }, 'Vertical (%)', height),
      el('label', { class: 'dialog-check' }, keep, ' Keep proportions'),
      error,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, 'Resize'),
      ),
    ),
  );
  showDialog(dialog);
  width.focus();
  width.select();
  return dialog;
}

function shortcutGroup({ title, rows }) {
  return el(
    'section',
    { class: 'shortcut-group' },
    el('h3', { class: 'shortcut-heading' }, title),
    el(
      'dl',
      { class: 'shortcut-list' },
      rows.flatMap(([label, keys]) => [el('dt', {}, label), el('dd', {}, el('kbd', {}, keys))]),
    ),
  );
}

export function showShortcuts() {
  const heading = 'shortcuts-heading';
  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide shortcut-dialog', 'aria-labelledby': heading },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { id: heading, class: 'dialog-title' }, 'Keyboard shortcuts'),
      // The list scrolls, so it has to be reachable by keyboard.
      el('div', { class: 'shortcut-groups', tabindex: '0', role: 'region', 'aria-label': 'Keyboard shortcut list' }, SHORTCUT_GROUPS.map(shortcutGroup)),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Close')),
    ),
  );
  showDialog(dialog);
}

export function showAbout() {
  infoDialog(
    'About Quire',
    el(
      'div',
      { class: 'dialog-text' },
      el('p', {}, 'Quire is a journal and drawing page that lives in your browser.'),
      el('p', {}, 'Entries and drawings are stored in IndexedDB on this device. Nothing is uploaded. Use Back up to keep a copy.'),
    ),
  );
}

/**
 * The "Open entry" list. `load` returns the current entries, and the callbacks
 * are the app's actions. The dialog reloads after a delete.
 */
export function entriesDialog({ load, currentId, onOpen, onNew, onDelete }) {
  let entries = [];
  let selectedId = currentId ?? null;

  const search = el('input', {
    type: 'search',
    class: 'input grow',
    placeholder: 'Search titles and text',
    'aria-label': 'Search entries',
    autocomplete: 'off',
  });
  const kind = el(
    'select',
    { class: 'input', 'aria-label': 'Filter by kind' },
    el('option', { value: '' }, 'All kinds'),
    KINDS.map((k) => el('option', { value: k.id }, k.label)),
  );
  const tbody = el('tbody');
  const count = el('p', { class: 'dialog-note', 'aria-live': 'polite' });
  const openBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Open');
  const deleteBtn = el('button', { class: 'btn btn-quiet-danger', type: 'button', disabled: true }, 'Delete');
  const newBtn = el('button', { class: 'btn', type: 'button' }, 'New entry');
  const closeBtn = el('button', { class: 'btn', type: 'button' }, 'Close');

  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide', 'aria-labelledby': 'entries-heading' },
    el(
      'div',
      { class: 'dialog-form' },
      el('h2', { id: 'entries-heading', class: 'dialog-title' }, 'Open entry'),
      el('div', { class: 'filter-row' }, search, kind),
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          { class: 'entries-table' },
          el(
            'thead',
            {},
            el('tr', {}, el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Title'), el('th', { scope: 'col' }, 'Kind'), el('th', { scope: 'col', class: 'num' }, 'Words')),
          ),
          tbody,
        ),
      ),
      count,
      el(
        'div',
        { class: 'dialog-actions split' },
        el('div', { class: 'dialog-actions' }, deleteBtn),
        el('div', { class: 'dialog-actions' }, closeBtn, newBtn, openBtn),
      ),
    ),
  );

  const visible = () => {
    const q = search.value.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (!kind.value || entry.kind === kind.value) &&
        (!q || `${displayTitle(entry)} ${entry.body}`.toLowerCase().includes(q)),
    );
  };

  const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label ?? id;

  const markSelected = () => {
    for (const row of tbody.querySelectorAll('tr')) {
      const on = row.dataset.id === selectedId;
      row.classList.toggle('is-selected', on);
    }
    openBtn.disabled = !selectedId;
    deleteBtn.disabled = !selectedId;
  };

  const select = (id) => {
    selectedId = id;
    markSelected();
    tbody.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };

  const moveSelection = (delta) => {
    const rows = [...tbody.querySelectorAll('tr')];
    const index = rows.findIndex((row) => row.dataset.id === selectedId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) select(next.dataset.id);
  };

  const render = () => {
    const rows = visible();
    if (!rows.some((entry) => entry.id === selectedId)) selectedId = rows[0]?.id ?? null;
    tbody.replaceChildren(
      ...rows.map((entry) =>
        el(
          'tr',
          {
            tabindex: '0',
            'data-id': entry.id,
            onClick: () => select(entry.id),
            onDblclick: () => {
              selectedId = entry.id;
              openBtn.click();
            },
            onKeydown: (event) => {
              if (event.key === 'Enter') openBtn.click();
              else if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1); }
              else if (event.key === 'Delete') deleteBtn.click();
            },
          },
          el('td', {}, formatShortDate(entry.date)),
          el('td', { class: 'cell-title' }, displayTitle(entry)),
          el('td', {}, kindLabel(entry.kind)),
          el('td', { class: 'num' }, String(wordCount(entry.body))),
        ),
      ),
    );
    count.textContent = `${rows.length} of ${entries.length} entries`;
    markSelected();
  };

  const reload = async () => {
    entries = await load();
    render();
  };

  search.addEventListener('input', render);
  kind.addEventListener('change', render);
  openBtn.addEventListener('click', () => {
    if (!selectedId) return;
    const id = selectedId;
    dialog.close();
    onOpen(id);
  });
  newBtn.addEventListener('click', () => {
    dialog.close();
    onNew();
  });
  closeBtn.addEventListener('click', () => dialog.close());
  deleteBtn.addEventListener('click', async () => {
    if (!selectedId) return;
    await onDelete(selectedId); // the app confirms and performs the delete
    selectedId = null;
    await reload();
  });

  showDialog(dialog);
  reload().then(() => search.focus());
}
