/**
 * The font picker: one dialog for every place a font is chosen. It lists the
 * built-in faces, recent choices, and the fonts on this computer. Each name is
 * drawn in its own face, and a sample line shows the font under the pointer or
 * focus. Searching narrows every section at once.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import {
  BUILT_IN_FONTS,
  familyName,
  filterFamilies,
  fontLabel,
  fontStackFor,
  listSystemFonts,
  normalizeRecents,
  systemFontId,
} from './fonts.js';

const SAMPLE = 'The quick brown fox jumps over the lazy dog. Dear journal, today was good.';

/** Words for where the list came from, shown under the title. */
function describe(result) {
  const count = result.families.length;
  if (result.source === 'local' || result.source === 'app') return `${count} fonts on this computer.`;
  if (result.source === 'curated') {
    if (result.access === 'denied') return `Font access is blocked for this site, so Quire found ${count} common fonts. Allow fonts in the site settings to see them all.`;
    if (result.access === 'prompt') return `Quire found ${count} common fonts. Allow font access to see every font on this computer.`;
    return `Quire found ${count} common fonts. This browser does not list every installed font.`;
  }
  return 'This browser cannot look up installed fonts, so only the built-in fonts are here.';
}

/** True when every word of the query appears in the label, ignoring case. */
function matches(label, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = label.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/**
 * Opens the picker. `onPick(id)` gets the chosen id: a built-in key, a
 * `family:` id, or null when the `matchLabel` row is chosen. `current` marks
 * the choice in use. `matchLabel` adds a first row that means "follow another
 * font", such as the writing font for text boxes.
 */
export function showFontPicker({ title = 'Choose a font', current = null, recents = [], matchLabel = null, onPick }) {
  let families = [];
  let query = '';
  let access = 'unsupported';

  const status = el('p', { class: 'dialog-text font-status', role: 'status' });
  const loadRow = el('div', { class: 'font-load' });
  const sample = el('p', { class: 'font-sample', 'aria-hidden': 'true' }, SAMPLE);
  sample.style.fontFamily = fontStackFor(current ?? 'serif');
  const lists = el('div', { class: 'font-lists' });

  const search = el('input', {
    class: 'input font-search',
    type: 'search',
    placeholder: 'Search fonts',
    'aria-label': 'Search fonts',
    autocomplete: 'off',
    spellcheck: 'false',
    onInput: () => {
      query = search.value;
      renderLists();
    },
    // Enter picks the first font shown, so a search takes one key.
    onKeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      lists.querySelector('.font-item')?.click();
    },
  });

  const dialog = el(
    'dialog',
    { class: 'dialog font-dialog' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, title),
      status,
      loadRow,
      search,
      sample,
      lists,
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn', type: 'submit', value: 'close' }, 'Close')),
    ),
  );

  function choose(id) {
    onPick?.(id);
    dialog.close();
  }

  function preview(id) {
    sample.style.fontFamily = fontStackFor(id ?? current ?? 'serif');
  }

  function item({ id, label }) {
    const selected = id === current;
    const button = el('button', {
      class: 'font-item',
      type: 'button',
      'aria-pressed': String(selected),
      title: label,
      onMouseenter: () => preview(id),
      onFocus: () => preview(id),
      onClick: () => choose(id),
    }, label);
    // Each name is drawn in its own face. The match row uses the face it follows.
    button.style.fontFamily = fontStackFor(id ?? current ?? 'serif');
    return button;
  }

  function section(title, items) {
    return el('section', { class: 'font-section' }, el('h3', { class: 'font-section-title' }, title), el('div', { class: 'font-grid' }, items));
  }

  function renderLists() {
    const q = query;
    const sections = [];

    const basics = [
      ...(matchLabel ? [{ id: null, label: matchLabel }] : []),
      ...BUILT_IN_FONTS.map((id) => ({ id, label: fontLabel(id) })),
    ].filter((entry) => !q.trim() || matches(entry.label, q));
    if (basics.length) sections.push(section('Quire fonts', basics.map((entry) => item(entry))));

    const recent = normalizeRecents(recents)
      .map((id) => ({ id, label: familyName(id) }))
      .filter((entry) => !q.trim() || matches(entry.label, q));
    if (recent.length) sections.push(section('Recently used', recent.map((entry) => item(entry))));

    const named = filterFamilies(families, q);
    if (named.length) {
      sections.push(section('On this computer', named.map((label) => item({ id: systemFontId(label), label }))));
    }

    if (!sections.length) {
      sections.push(el('p', { class: 'font-empty' }, q.trim() ? `No font matches “${q.trim()}”.` : 'No fonts to show.'));
    }
    lists.replaceChildren(...sections);
  }

  function renderLoad(result) {
    const canAllow = result.source === 'curated' && result.access === 'prompt';
    loadRow.replaceChildren(
      canAllow
        ? el('button', { class: 'btn btn-primary', type: 'button', onClick: () => load(true) }, 'Allow font access…')
        : null,
    );
  }

  async function load(allowPrompt) {
    status.textContent = 'Looking for fonts on this computer…';
    const result = await listSystemFonts({ allowPrompt });
    families = result.families;
    access = result.access ?? access;
    status.textContent = describe(result);
    renderLoad(result);
    renderLists();
  }

  renderLists();
  showDialog(dialog);
  load(false);
  return dialog;
}
