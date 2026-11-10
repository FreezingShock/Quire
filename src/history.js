/**
 * Version history dialog. It lists the saved versions of one entry, previews the
 * text and drawing of the selected one, and restores, deletes, or saves a new
 * one. The app supplies the store calls and the actions. This file builds the UI.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { describeReason } from './versions.js';
import { displayTitle } from './model.js';
import { renderMarkdown, wordCount } from './markdown.js';
import { inkExtent, renderInkCanvas } from './drawing.js';

export function formatVersionTime(iso) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function inkPreview(content) {
  const canvas = renderInkCanvas(content.ink.ops, {
    pageColor: content.pageColor,
    pixelWidth: 900,
    normHeight: Math.max(600, inkExtent(content.ink.ops) + 20),
  });
  return el('img', { class: 'version-ink', alt: 'Drawing from this version', src: canvas.toDataURL('image/png') });
}

/**
 * `load()` returns the versions, newest first. `onRestore(version)` runs after
 * the dialog closes. `onDelete(version)` resolves true when a version was removed.
 * `onSaveNow()` resolves with a message to show under the list.
 */
export function historyDialog({ load, onRestore, onSaveNow, onDelete, media = null }) {
  let versions = [];
  let selectedId = null;

  const list = el('ul', { class: 'version-list', 'aria-label': 'Saved versions' });
  const preview = el('div', { class: 'version-preview', 'aria-live': 'polite' });
  const note = el('p', { class: 'dialog-note', 'aria-live': 'polite' });
  const saveBtn = el('button', { class: 'btn', type: 'button' }, 'Save version now');
  const deleteBtn = el('button', { class: 'btn btn-quiet-danger', type: 'button', disabled: true }, 'Delete');
  const restoreBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Restore this version');
  const closeBtn = el('button', { class: 'btn', type: 'button' }, 'Close');

  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide history-dialog', 'aria-labelledby': 'history-heading' },
    el(
      'div',
      { class: 'dialog-form' },
      el('h2', { id: 'history-heading', class: 'dialog-title' }, 'Version history'),
      el(
        'p',
        { class: 'dialog-note' },
        'A version is kept every five minutes while you edit, when you leave the entry, and before a restore. The newest 30 are kept.',
      ),
      el('div', { class: 'history-body' }, list, preview),
      note,
      el(
        'div',
        { class: 'dialog-actions split' },
        el('div', { class: 'dialog-actions' }, deleteBtn),
        el('div', { class: 'dialog-actions' }, saveBtn, closeBtn, restoreBtn),
      ),
    ),
  );

  const selected = () => versions.find((version) => version.id === selectedId) ?? null;

  const renderList = () => {
    if (!versions.length) {
      list.replaceChildren(el('li', { class: 'version-empty' }, 'No versions yet.'));
      return;
    }
    list.replaceChildren(
      ...versions.map((version) => {
        const on = version.id === selectedId;
        return el(
          'li',
          {},
          el(
            'button',
            {
              type: 'button',
              class: `version-item${on ? ' is-selected' : ''}`,
              'aria-pressed': String(on),
              onClick: () => select(version.id),
            },
            el('span', { class: 'version-time' }, formatVersionTime(version.savedAt)),
            el('span', { class: 'version-name' }, displayTitle(version.content)),
            el('span', { class: 'version-meta' }, `${describeReason(version.reason)} · ${wordCount(version.content.body)} words`),
          ),
        );
      }),
    );
  };

  const renderPreview = () => {
    const version = selected();
    if (!version) {
      preview.replaceChildren(el('p', { class: 'dialog-text' }, 'Pick a version to see its text and drawing.'));
      return;
    }
    const { content } = version;
    const text = el('div', { class: 'sheet-text version-body' });
    text.innerHTML = content.body.trim() ? renderMarkdown(content.body, { media }) : '<p class="version-blank">This version has no text.</p>';
    preview.replaceChildren(
      el(
        'header',
        { class: 'version-head' },
        el('h3', {}, displayTitle(content)),
        el('p', {}, `${describeReason(version.reason)} · ${formatVersionTime(version.savedAt)}`),
      ),
      text,
      ...(content.ink.ops.length ? [inkPreview(content)] : []),
    );
  };

  const updateButtons = () => {
    const on = Boolean(selected());
    deleteBtn.disabled = !on;
    restoreBtn.disabled = !on;
  };

  const select = (id) => {
    selectedId = id;
    renderList();
    renderPreview();
    updateButtons();
  };

  const reload = async () => {
    versions = await load();
    if (!selected()) selectedId = versions[0]?.id ?? null;
    renderList();
    renderPreview();
    updateButtons();
  };

  restoreBtn.addEventListener('click', () => {
    const version = selected();
    if (!version) return;
    dialog.close();
    onRestore(version);
  });

  deleteBtn.addEventListener('click', async () => {
    const version = selected();
    if (!version) return;
    const deleted = await onDelete(version);
    if (deleted) await reload();
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      note.textContent = await onSaveNow();
      await reload();
    } finally {
      saveBtn.disabled = false;
    }
  });

  closeBtn.addEventListener('click', () => dialog.close());

  showDialog(dialog);
  reload().then(() => list.querySelector('.is-selected, .version-item')?.focus({ preventScroll: true }));
}
