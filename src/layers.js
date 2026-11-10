/**
 * Layer panel for the toolbox. It lists layers top first, the way a Paint-style
 * stack reads, and has the eye, rename, reorder, add and delete controls. It
 * only builds DOM and reports what the user asked for; the app owns the state.
 */

import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * `layers` is bottom first, as stored. `handlers` holds onSelect, onToggle,
 * onRename, onMove, onAdd and onDelete, each receiving a layer id.
 */
export function renderLayerPanel(container, { layers, activeId, enabled }, handlers) {
  // The panel is rebuilt on every change, so remember which control had focus and put it back.
  const focused = focusKey(container);
  const rows = [...layers].reverse().map((layer, row) => layerRow(layer, row, layers.length, layer.id === activeId, enabled, handlers));
  const add = iconButton('plus', 'Add layer', 'add', () => handlers.onAdd(), !enabled || layers.length >= 12);
  const up = iconButton('up', 'Move layer up', 'up', () => handlers.onMove(activeId, 1), !enabled || !canMove(layers, activeId, 1));
  const down = iconButton('down', 'Move layer down', 'down', () => handlers.onMove(activeId, -1), !enabled || !canMove(layers, activeId, -1));
  const remove = iconButton('trash', 'Delete layer', 'remove', () => handlers.onDelete(activeId), !enabled || layers.length < 2);
  container.replaceChildren(
    el('div', { class: 'layer-head' }, 'Layers'),
    el('div', { class: 'layer-list', role: 'group', 'aria-label': 'Layers, top first' }, rows),
    el('div', { class: 'layer-actions', role: 'group', 'aria-label': 'Layer actions' }, [add, up, down, remove]),
  );
  restoreFocus(container, focused);
}

/** Names the focused control in a form that survives a rebuild: an action, or a layer's eye or name. */
function focusKey(container) {
  const node = document.activeElement;
  if (!node || !container.contains(node)) return null;
  if (node.dataset.action) return { action: node.dataset.action };
  const row = node.closest('.layer-row');
  if (!row) return null;
  return { layer: row.dataset.layerId, part: node.classList.contains('layer-eye') ? '.layer-eye' : '.layer-name' };
}

function restoreFocus(container, key) {
  if (!key) return;
  const target = key.action
    ? container.querySelector(`[data-action="${key.action}"]`)
    : container.querySelector(`.layer-row[data-layer-id="${CSS.escape(key.layer)}"] ${key.part}`);
  target?.focus();
}

function canMove(layers, id, dir) {
  const index = layers.findIndex((layer) => layer.id === id);
  const target = index + dir;
  return index >= 0 && target >= 0 && target < layers.length;
}

function iconButton(name, label, action, onClick, disabled) {
  const button = el('button', {
    class: 'layer-btn',
    type: 'button',
    title: label,
    'aria-label': label,
    'data-action': action,
    disabled,
    onMousedown: (event) => event.preventDefault(),
    onClick,
  });
  button.innerHTML = icon(name);
  return button;
}

function layerRow(layer, row, count, active, enabled, handlers) {
  const eye = el('button', {
    class: 'layer-eye',
    type: 'button',
    title: layer.visible ? 'Hide layer' : 'Show layer',
    'aria-label': `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`,
    'aria-pressed': String(layer.visible),
    disabled: !enabled,
    onMousedown: (event) => event.preventDefault(),
    onClick: (event) => {
      event.stopPropagation();
      handlers.onToggle(layer.id);
    },
  });
  eye.innerHTML = icon(layer.visible ? 'eye' : 'eyeOff');

  // The name is a button so keyboard users can pick a layer. F2 renames it, as a double-click does.
  const name = el('button', {
    class: 'layer-name',
    type: 'button',
    'aria-current': active ? 'true' : null,
    onMousedown: (event) => event.preventDefault(),
    onClick: () => handlers.onSelect(layer.id),
    onDblclick: () => beginRename(name, layer, handlers),
    onKeydown: (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        beginRename(name, layer, handlers);
      }
    },
  }, layer.name);

  return el(
    'div',
    {
      class: `layer-row${active ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}`,
      'data-layer-id': layer.id,
      title: `${layer.name}${row === 0 ? ' (top)' : ''}. Double-click to rename.`,
    },
    [eye, name],
  );
}

/** Swaps the name for a field. Enter or leaving the field keeps the change, Escape drops it. */
function beginRename(nameEl, layer, handlers) {
  if (!nameEl.isConnected) return;
  const input = el('input', {
    class: 'layer-input',
    type: 'text',
    value: layer.name,
    maxlength: '40',
    'aria-label': 'Layer name',
  });
  let done = false;
  // `refocus` is set for keys, so focus goes back to the layer name instead of being lost.
  const finish = (keep, refocus = false) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (keep && value && value !== layer.name) handlers.onRename(layer.id, value);
    else input.replaceWith(nameEl);
    if (refocus) nameEl.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true, true);
    else if (event.key === 'Escape') finish(false, true);
    event.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}
