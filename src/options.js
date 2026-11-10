/**
 * Options: one tabbed dialog for the settings that used to sit in the View and
 * Skin menus. Each control writes through `set` as it changes, so the page
 * updates while the dialog stays open. The controls read the saved prefs
 * again after every change, so two controls never disagree.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { SKINS, normalizeAccent, skinOf } from './skins.js';
import { playSound } from './sound.js';
import { reminderRow } from './pwa.js';

/** The prefs this dialog reads or writes. Each one must have a default in prefs.js. */
export const OPTION_PREFS = Object.freeze([
  'splash',
  'sound',
  'skin',
  'accent',
  'motion',
  'wallpaper',
  'font',
  'source',
  'showGrid',
  'snapGrid',
  'snapAngles',
  'showPrompts',
  'showOnThisDay',
  'reminder',
]);

const TABS = Object.freeze([
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'writing', label: 'Writing' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'home', label: 'Home' },
]);

const FONTS = Object.freeze([
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' },
  { id: 'mono', label: 'Monospace' },
]);

// The tab that opens first. The last tab used stays open for the rest of the session.
let lastTab = 'appearance';

/**
 * `get()` returns the current prefs. `set(patch)` saves them and applies them.
 * `pickAccent(onChange)` opens the color chooser and calls `onChange` after each pick.
 */
export function showOptions({ get, set, pickAccent }) {
  const refreshers = [];
  const sync = () => {
    const prefs = get();
    for (const refresh of refreshers) refresh(prefs);
  };
  const change = (patch, after) => {
    set(patch);
    after?.();
    sync();
  };

  function toggle({ label, note, read, write, after }) {
    const input = el('input', { type: 'checkbox', onChange: () => change(write(input.checked), after ? () => after(input.checked) : undefined) });
    refreshers.push((prefs) => {
      input.checked = read(prefs);
    });
    return el(
      'div',
      { class: 'options-item' },
      el('label', { class: 'options-check' }, input, el('span', {}, label)),
      note ? el('p', { class: 'options-note' }, note) : null,
    );
  }

  function choices({ legend, name, options, read, write }) {
    const inputs = options.map(({ id, label }) => {
      const input = el('input', { type: 'radio', name, value: id, onChange: () => change(write(id)) });
      refreshers.push((prefs) => {
        input.checked = read(prefs) === id;
      });
      return el('label', { class: 'options-radio' }, input, el('span', {}, label));
    });
    return el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, legend), inputs);
  }

  function accentRow() {
    const value = el('span', { class: 'accent-value' });
    const reset = el('button', { class: 'btn', type: 'button', onClick: () => change({ accent: null }) }, 'Use skin colors');
    const choose = el('button', { class: 'btn', type: 'button', onClick: () => pickAccent(sync) }, 'Choose color…');
    refreshers.push((prefs) => {
      const hex = normalizeAccent(prefs.accent);
      value.textContent = hex ? hex : 'Skin colors';
      reset.disabled = !hex;
    });
    return el(
      'fieldset',
      { class: 'options-group' },
      el('legend', { class: 'options-legend' }, 'Accent color'),
      el('p', { class: 'options-note options-note-first' }, 'Recolors the selection, buttons and title bar.'),
      el(
        'div',
        { class: 'accent-row' },
        el('span', { class: 'accent-swatch', 'aria-hidden': 'true' }),
        value,
        choose,
        reset,
      ),
    );
  }

  const panels = {
    general: [
      toggle({
        label: 'Show the startup splash',
        note: 'The Quire splash plays while the app loads.',
        read: (prefs) => Boolean(prefs.splash),
        write: (on) => ({ splash: on }),
      }),
      toggle({
        label: 'Sound effects',
        note: 'Short chimes when Quire opens, and when you make, delete or export an entry. Off by default.',
        read: (prefs) => Boolean(prefs.sound),
        write: (on) => ({ sound: on }),
        after: (on) => on && playSound('startup'),
      }),
    ],
    appearance: [
      choices({
        legend: 'Skin',
        name: 'skin',
        options: SKINS,
        read: (prefs) => skinOf(prefs),
        write: (id) => ({ skin: id }),
      }),
      accentRow(),
      toggle({
        label: 'Window animations',
        note: 'Windows open, close and menus slide in. Turn this off to keep the page still.',
        read: (prefs) => prefs.motion !== false,
        write: (on) => ({ motion: on }),
      }),
      toggle({
        label: 'Aero wallpaper',
        note: 'The desktop picture shows around the window in the Aero skins.',
        read: (prefs) => Boolean(prefs.wallpaper),
        write: (on) => ({ wallpaper: on }),
      }),
    ],
    writing: [
      choices({
        legend: 'Writing font',
        name: 'font',
        options: FONTS,
        read: (prefs) => prefs.font,
        write: (id) => ({ font: id }),
      }),
      toggle({
        label: 'Source mode',
        note: 'Show every Markdown marker as you type, instead of the live preview.',
        read: (prefs) => Boolean(prefs.source),
        write: (on) => ({ source: on }),
      }),
    ],
    drawing: [
      toggle({
        label: 'Show grid',
        note: 'Faint grid lines on the page, to line up drawings.',
        read: (prefs) => Boolean(prefs.showGrid),
        write: (on) => ({ showGrid: on }),
      }),
      toggle({
        label: 'Snap to grid',
        note: 'Strokes, shapes and text boxes start and end on grid points.',
        read: (prefs) => Boolean(prefs.snapGrid),
        write: (on) => ({ snapGrid: on }),
      }),
      toggle({
        label: 'Snap lines to 15° angles',
        note: 'Lines and shape edges lock to 15° steps.',
        read: (prefs) => Boolean(prefs.snapAngles),
        write: (on) => ({ snapAngles: on }),
      }),
    ],
    home: [
      toggle({
        label: 'Writing prompts',
        note: 'A prompt card at the top of All entries. Write to it, or skip to the next one.',
        read: (prefs) => Boolean(prefs.showPrompts),
        write: (on) => ({ showPrompts: on }),
      }),
      toggle({
        label: 'On this day',
        note: 'A card that lists your entries from this date in earlier years.',
        read: (prefs) => Boolean(prefs.showOnThisDay),
        write: (on) => ({ showOnThisDay: on }),
      }),
      reminderRow({ get, set, register: (refresh) => refreshers.push(() => refresh()) }),
    ],
  };

  const ids = TABS.map((tab) => tab.id);
  const tabButtons = {};
  const pageNodes = {};

  // Only the selected tab is in the tab order. Arrow keys, Home and End move between tabs.
  function select(id) {
    lastTab = id;
    for (const key of ids) {
      const on = key === id;
      tabButtons[key].setAttribute('aria-selected', String(on));
      tabButtons[key].classList.toggle('is-selected', on);
      tabButtons[key].tabIndex = on ? 0 : -1;
      pageNodes[key].hidden = !on;
    }
  }

  function onTabKey(event, id) {
    const at = ids.indexOf(id);
    const next = {
      ArrowRight: ids[(at + 1) % ids.length],
      ArrowLeft: ids[(at - 1 + ids.length) % ids.length],
      Home: ids[0],
      End: ids[ids.length - 1],
    }[event.key];
    if (!next) return;
    event.preventDefault();
    select(next);
    tabButtons[next].focus();
  }

  for (const tab of TABS) {
    tabButtons[tab.id] = el('button', {
      type: 'button',
      role: 'tab',
      id: `options-tab-${tab.id}`,
      class: 'options-tab',
      'aria-controls': `options-page-${tab.id}`,
      onClick: () => select(tab.id),
      onKeydown: (event) => onTabKey(event, tab.id),
    }, tab.label);
    pageNodes[tab.id] = el(
      'div',
      {
        class: 'options-page',
        role: 'tabpanel',
        id: `options-page-${tab.id}`,
        'aria-labelledby': `options-tab-${tab.id}`,
        tabindex: '0',
        hidden: true,
      },
      panels[tab.id],
    );
  }

  const dialog = el(
    'dialog',
    { class: 'dialog options-dialog', 'aria-labelledby': 'options-heading' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { id: 'options-heading', class: 'dialog-title' }, 'Options'),
      el('div', { class: 'options-tabs', role: 'tablist', 'aria-label': 'Option groups' }, TABS.map((tab) => tabButtons[tab.id])),
      el('div', { class: 'options-pages' }, TABS.map((tab) => pageNodes[tab.id])),
      el('p', { class: 'dialog-note' }, 'Changes apply as you make them.'),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Close')),
    ),
  );

  sync();
  select(ids.includes(lastTab) ? lastTab : ids[0]);
  showDialog(dialog);
  tabButtons[lastTab].focus();
  return dialog;
}
