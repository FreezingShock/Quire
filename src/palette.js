/**
 * Command palette (Ctrl+K): one search box over every menu command and every
 * entry. The list is ranked by palette-search.js as you type. Enter, or a click,
 * runs the chosen item after the palette closes, so focus lands where the
 * command expects it.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { rankItems } from './palette-search.js';

const MAX_RESULTS = 60;

/**
 * `items` are { id, label, group, meta, shortcut, keywords, run }. `group` and
 * `meta` are shown on the right, `shortcut` in the key style, and `run` is called
 * once the palette has closed.
 */
export function showCommandPalette({ items }) {
  let results = [];
  let active = 0;
  let chosen = null;

  const input = el('input', {
    class: 'dialog-input palette-input',
    type: 'text',
    role: 'combobox',
    'aria-label': 'Command or entry title',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-autocomplete': 'list',
    placeholder: 'Type a command or an entry title',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const list = el('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Commands and entries' });
  const empty = el('p', { class: 'palette-empty', hidden: true }, 'Nothing matches. Try fewer or shorter words.');

  const setActive = (index, { scroll = true } = {}) => {
    const options = [...list.children];
    if (!options.length) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    active = (index + options.length) % options.length;
    options.forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', options[active].id);
    if (scroll) options[active].scrollIntoView({ block: 'nearest' });
  };

  const choose = (index) => {
    const item = results[index];
    if (!item) return;
    chosen = item;
    dialog.close();
  };

  const optionNode = (item, index) =>
    el(
      'li',
      {
        class: 'palette-option',
        role: 'option',
        id: `palette-option-${index}`,
        'aria-selected': 'false',
        onPointermove: () => {
          if (active !== index) setActive(index, { scroll: false });
        },
        onClick: () => choose(index),
      },
      el('span', { class: 'palette-label' }, item.label),
      el('span', { class: 'palette-meta' }, item.meta ?? item.group ?? ''),
      item.shortcut ? el('span', { class: 'menu-shortcut' }, item.shortcut) : null,
    );

  const render = () => {
    results = rankItems(items, input.value, { limit: MAX_RESULTS });
    list.replaceChildren(...results.map(optionNode));
    empty.hidden = results.length > 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
    setActive(0, { scroll: false });
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    // Once the palette has closed, focus can linger on its input for a moment. Its keys then belong to the page.
    if (!dialog.open) return;
    // The app's own shortcuts wait while the palette is open. This also keeps Ctrl+K from reopening it.
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      setActive(active + (event.key === 'PageDown' ? 8 : -8));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      // Ctrl+K again closes the palette, the same key that opened it.
      event.preventDefault();
      dialog.close();
    }
  });

  const dialog = el(
    'dialog',
    { class: 'dialog dialog-wide palette-dialog', 'aria-label': 'Command palette' },
    el(
      'div',
      { class: 'palette-form' },
      input,
      el('div', { class: 'palette-scroll' }, list, empty),
      el('p', { class: 'palette-hint' }, 'Up and Down to choose · Enter to run · Escape to close'),
    ),
  );
  // Runs the chosen item after the dialog has closed and given focus back.
  dialog.addEventListener(
    'close',
    () => {
      const item = chosen;
      chosen = null;
      item?.run?.();
    },
    { once: true },
  );

  render();
  showDialog(dialog);
  input.focus();
  return dialog;
}
