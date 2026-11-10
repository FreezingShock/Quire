/** Modal dialogs built on the native <dialog> element. */

import { el } from './dom.js';
import { KINDS, displayTitle, formatShortDate } from './model.js';
import { wordCount } from './markdown.js';

const SHORTCUTS = [
  ['New entry', 'Ctrl+N'],
  ['Open entry', 'Ctrl+O'],
  ['Save now', 'Ctrl+S'],
  ['Export Markdown', 'Ctrl+E'],
  ['Print or save as PDF', 'Ctrl+P'],
  ['Undo / redo (last edited surface)', 'Ctrl+Z / Ctrl+Shift+Z'],
  ['Bold / italic', 'Ctrl+B / Ctrl+I'],
  ['Continue a list', 'Enter'],
  ['Tools', 'T I G P B H E L R O'],
  ['Keyboard shortcuts', 'F1'],
];

function showDialog(dialog) {
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

export function showShortcuts() {
  infoDialog(
    'Keyboard shortcuts',
    el(
      'dl',
      { class: 'shortcut-list' },
      SHORTCUTS.map(([label, keys]) => [el('dt', {}, label), el('dd', {}, el('kbd', {}, keys))]),
    ),
  );
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
