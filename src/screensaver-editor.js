/**
 * The custom screensaver editor: one dialog where a person names a screensaver,
 * picks what it shows (drawings, photos, writing), the notebooks and tags to
 * draw from, a 3D text message, the speed, the transition, and the background.
 * It saves nothing itself. The app passes what to do with the result.
 */

import { el } from './dom.js';
import { confirmDialog, showDialog } from './dialogs.js';
import { parseTags } from './model.js';
import {
  BACKGROUNDS,
  DEFAULT_CUSTOM,
  MESSAGE_MAX,
  NAME_MAX,
  SPEEDS,
  TRANSITIONS,
  newCustomId,
  normalizeCustom,
} from './screensaver-custom.js';

const SHOW_ITEMS = Object.freeze([
  { key: 'drawings', label: 'Drawings' },
  { key: 'photos', label: 'Photos' },
  { key: 'text', label: 'Writing' },
]);

/**
 * Opens the editor. `config` is the screensaver being edited, or null for a new
 * one. `getEntries()` loads the entries, to offer their notebooks. Callbacks:
 * `onSave(config)`, `onDelete(id)`, `onCancel()`, and `onPreview(draft, reopen)`,
 * where `reopen()` opens this editor again with the same draft.
 */
export function openCustomEditor({ config = null, getEntries, onSave, onDelete, onCancel, onPreview }) {
  const start = config ? normalizeCustom(config) : normalizeCustom({ ...DEFAULT_CUSTOM, id: newCustomId(), name: DEFAULT_CUSTOM.name });
  const isNew = !config;
  let settled = false;

  const name = el('input', { class: 'input', type: 'text', maxlength: String(NAME_MAX), value: start.name, required: true, 'aria-label': 'Name', autocomplete: 'off' });
  const shows = SHOW_ITEMS.map((item) => {
    const input = el('input', { type: 'checkbox', checked: start.items[item.key] });
    return { key: item.key, input, node: el('label', { class: 'options-check' }, input, el('span', {}, item.label)) };
  });

  // Notebooks come from the entries themselves. Checked ones are the only notebooks drawn from.
  const notebookBox = el('div', { class: 'editor-notebooks' }, el('p', { class: 'options-note' }, 'Loading notebooks…'));
  const notebookInputs = new Map();
  getEntries()
    .then((entries) => {
      const names = [...new Set([...entries.map((entry) => entry.notebook).filter(Boolean), ...start.notebooks])].sort();
      notebookBox.replaceChildren();
      if (!names.length) {
        notebookBox.append(el('p', { class: 'options-note' }, 'No notebooks yet. The screensaver draws from every entry.'));
        return;
      }
      for (const label of names) {
        const input = el('input', { type: 'checkbox', checked: start.notebooks.includes(label) });
        notebookInputs.set(label, input);
        notebookBox.append(el('label', { class: 'options-check' }, input, el('span', {}, label)));
      }
    })
    .catch(() => {
      notebookBox.replaceChildren(el('p', { class: 'options-note' }, 'Notebooks could not be read.'));
    });

  const tags = el('input', { class: 'input', type: 'text', value: start.tags.join(', '), placeholder: 'travel, winter', 'aria-label': 'Tags, comma separated', autocomplete: 'off' });
  const message = el('input', { class: 'input', type: 'text', maxlength: String(MESSAGE_MAX), value: start.message, placeholder: 'Leave empty for no message', 'aria-label': 'Message' });

  const radios = (name_, options, current) => options.map((option) => {
    const input = el('input', { type: 'radio', name: name_, value: option.id, checked: option.id === current });
    return { id: option.id, input, node: el('label', { class: 'options-radio' }, input, el('span', {}, option.label)) };
  });
  const speedRadios = radios('editor-speed', SPEEDS, start.speed);
  const transitionRadios = radios('editor-transition', TRANSITIONS, start.transition);
  const backgroundRadios = radios('editor-background', BACKGROUNDS, start.background);
  const color = el('input', { type: 'color', value: start.color, 'aria-label': 'Background color' });
  const colorRow = el('div', { class: 'editor-color' }, el('span', {}, 'Color'), color);
  const syncColor = () => {
    const solid = backgroundRadios.find((item) => item.id === 'solid')?.input.checked;
    colorRow.hidden = !solid;
  };
  for (const item of backgroundRadios) item.input.addEventListener('change', syncColor);

  /** What the form says right now, as a screensaver config. */
  const readDraft = () =>
    normalizeCustom({
      id: start.id,
      name: name.value,
      items: Object.fromEntries(shows.map((item) => [item.key, item.input.checked])),
      notebooks: [...notebookInputs].filter(([, input]) => input.checked).map(([label]) => label),
      tags: parseTags(tags.value),
      message: message.value,
      speed: speedRadios.find((item) => item.input.checked)?.id,
      transition: transitionRadios.find((item) => item.input.checked)?.id,
      background: backgroundRadios.find((item) => item.input.checked)?.id,
      color: color.value,
    });

  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const finish = (fn) => {
    settled = true;
    dialog.close();
    fn?.();
  };

  const deleteButton = isNew
    ? null
    : el('button', {
      class: 'btn btn-quiet-danger',
      type: 'button',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'Delete this screensaver?',
          message: `“${start.name}” will be removed. Your entries are not affected.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) finish(() => onDelete?.(start.id));
      },
    }, 'Delete…');

  const dialog = el(
    'dialog',
    { class: 'dialog editor-dialog', 'aria-labelledby': 'editor-heading' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          const draft = readDraft();
          if (!draft.items.drawings && !draft.items.photos && !draft.items.text && !draft.message) {
            error.textContent = 'Pick something to show, or type a message.';
            return;
          }
          finish(() => onSave?.(draft));
        },
      },
      el('h2', { id: 'editor-heading', class: 'dialog-title' }, isNew ? 'New custom screensaver' : 'Edit screensaver'),
      el(
        'div',
        { class: 'editor-body' },
        el('label', { class: 'options-field' }, el('span', {}, 'Name'), name),
        el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Show'), shows.map((item) => item.node)),
        el(
          'fieldset',
          { class: 'options-group' },
          el('legend', { class: 'options-legend' }, 'Notebooks'),
          el('p', { class: 'options-note options-note-first' }, 'Check the notebooks to draw from. Leave them all unchecked to use every notebook.'),
          notebookBox,
        ),
        el(
          'fieldset',
          { class: 'options-group' },
          el('legend', { class: 'options-legend' }, 'Tags'),
          el('p', { class: 'options-note options-note-first' }, 'Only entries with one of these tags. Leave empty to use every tag.'),
          tags,
        ),
        el(
          'fieldset',
          { class: 'options-group' },
          el('legend', { class: 'options-legend' }, 'Message'),
          el('p', { class: 'options-note options-note-first' }, 'Scrolls across the screen as raised 3D text.'),
          message,
        ),
        el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Speed'), speedRadios.map((item) => item.node)),
        el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Transition'), el('p', { class: 'options-note options-note-first' }, 'How each new picture arrives.'), transitionRadios.map((item) => item.node)),
        el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Background'), backgroundRadios.map((item) => item.node), colorRow),
      ),
      error,
      el(
        'div',
        { class: 'dialog-actions split' },
        deleteButton ?? el('span'),
        el(
          'div',
          { class: 'editor-buttons' },
          el('button', {
            class: 'btn',
            type: 'button',
            onClick: () => {
              const draft = readDraft();
              if (!draft.items.drawings && !draft.items.photos && !draft.items.text && !draft.message) {
                error.textContent = 'Pick something to show, or type a message, to preview it.';
                return;
              }
              settled = true;
              dialog.close();
              onPreview?.(draft, () => openCustomEditor({ config: draft, getEntries, onSave, onDelete, onCancel, onPreview }));
            },
          }, 'Preview'),
          el('button', { class: 'btn', type: 'button', onClick: () => finish(() => onCancel?.()) }, 'Cancel'),
          el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save'),
        ),
      ),
    ),
  );

  // Escape or the dialog closing by any other route counts as cancel.
  dialog.addEventListener('close', () => {
    if (settled) return;
    settled = true;
    onCancel?.();
  });

  syncColor();
  showDialog(dialog);
  name.focus();
  return dialog;
}
