/**
 * The sticker sheet: a dialog with two tabs. Preset holds the art that ships
 * with Quire. My stickers holds the library: pictures added from disk, and ink
 * saved from the page. Picking a sticker closes the sheet and hands the choice
 * back, so the controller can take the next click as the place to stamp it.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { PRESET_STICKERS, paintPresetPreview } from './stickers.js';

const PICTURE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * Opens the sheet. `library` is the list of saved stickers. Handlers:
 * onPreset(id), onCustom(sticker), onAddPicture(file), onRemove(sticker),
 * onMakeFromInk(). Returns { refresh(library) } so the controller can update
 * My stickers after it saves or removes one.
 */
export function openStickerSheet({ library, hasInk, onPreset, onCustom, onAddPicture, onRemove, onMakeFromInk }) {
  let stickers = library;
  let tab = 'preset';

  const presetPanel = el('div', { class: 'sticker-grid', role: 'tabpanel', id: 'sticker-panel-preset', 'aria-labelledby': 'sticker-tab-preset' });
  const ownPanel = el('div', { class: 'sticker-grid', role: 'tabpanel', id: 'sticker-panel-own', 'aria-labelledby': 'sticker-tab-own', hidden: true });
  const emptyNote = el(
    'p',
    { class: 'sticker-empty', hidden: true },
    'No stickers of your own yet. Add a picture, or make one from ink you have selected on the page.',
  );

  const presetTab = el('button', { class: 'sticker-tab', type: 'button', role: 'tab', id: 'sticker-tab-preset', 'aria-controls': 'sticker-panel-preset', 'aria-selected': 'true' }, 'Preset');
  const ownTab = el('button', { class: 'sticker-tab', type: 'button', role: 'tab', id: 'sticker-tab-own', 'aria-controls': 'sticker-panel-own', 'aria-selected': 'false', tabindex: '-1' }, '');
  const tabs = { preset: presetTab, own: ownTab };

  const choose = (action) => {
    dialog.close();
    action();
  };

  const showTab = (id, { focus = false } = {}) => {
    tab = id;
    for (const [key, button] of Object.entries(tabs)) {
      const selected = key === id;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    presetPanel.hidden = id !== 'preset';
    ownPanel.hidden = id !== 'own';
    if (focus) tabs[id].focus();
  };

  const onTabKey = (event) => {
    const order = ['preset', 'own'];
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -order.length, End: order.length }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = order.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : (index + step + order.length) % order.length;
    showTab(order[next], { focus: true });
  };
  presetTab.addEventListener('click', () => showTab('preset'));
  ownTab.addEventListener('click', () => showTab('own'));
  presetTab.addEventListener('keydown', onTabKey);
  ownTab.addEventListener('keydown', onTabKey);

  for (const item of PRESET_STICKERS) {
    const canvas = el('canvas', { width: 96, height: 96, class: 'sticker-art', 'aria-hidden': 'true' });
    paintPresetPreview(canvas, item.id);
    presetPanel.append(
      el(
        'button',
        { class: 'sticker-tile', type: 'button', title: item.label, 'aria-label': item.label, onClick: () => choose(() => onPreset(item.id)) },
        canvas,
        el('span', { class: 'sticker-name' }, item.label),
      ),
    );
  }

  const renderOwn = () => {
    const tiles = stickers.map((sticker) =>
      el(
        'div',
        { class: 'sticker-own' },
        el(
          'button',
          { class: 'sticker-tile', type: 'button', title: sticker.name, 'aria-label': `Stamp ${sticker.name}`, onClick: () => choose(() => onCustom(sticker)) },
          el('img', { class: 'sticker-thumb', src: sticker.src, alt: '' }),
          el('span', { class: 'sticker-name' }, sticker.name),
        ),
        el(
          'button',
          { class: 'sticker-remove', type: 'button', title: 'Remove from My stickers', 'aria-label': `Remove ${sticker.name} from My stickers`, onClick: () => onRemove(sticker) },
          '×',
        ),
      ),
    );
    ownPanel.replaceChildren(...tiles);
    emptyNote.hidden = stickers.length > 0;
    ownTab.textContent = `My stickers (${stickers.length})`;
  };

  const addInput = el('input', { type: 'file', accept: PICTURE_TYPES, hidden: true, 'aria-hidden': 'true' });
  addInput.addEventListener('change', () => {
    const file = addInput.files?.[0];
    addInput.value = '';
    if (file) onAddPicture(file);
  });
  const makeButton = el('button', { class: 'btn', type: 'button', disabled: !hasInk, onClick: () => onMakeFromInk() }, 'Make from selected ink');

  const dialog = el(
    'dialog',
    { class: 'dialog sticker-dialog' },
    el(
      'form',
      { class: 'dialog-form', method: 'dialog' },
      el('h2', { class: 'dialog-title' }, 'Stickers'),
      el('p', { class: 'dialog-text' }, 'Pick a sticker, then click the page to stamp it. Drag it to move it, the corner handles to resize, and the round handle to turn it.'),
      el('div', { class: 'sticker-tabs', role: 'tablist', 'aria-label': 'Sticker sources' }, presetTab, ownTab),
      presetPanel,
      ownPanel,
      emptyNote,
      addInput,
      el(
        'div',
        { class: 'dialog-actions sticker-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => addInput.click() }, 'Add picture…'),
        makeButton,
        el('button', { class: 'btn btn-primary', type: 'button', onClick: () => dialog.close() }, 'Close'),
      ),
    ),
  );

  renderOwn();
  showDialog(dialog);
  presetPanel.querySelector('.sticker-tile')?.focus();

  return {
    refresh(next) {
      stickers = next;
      renderOwn();
    },
  };
}
