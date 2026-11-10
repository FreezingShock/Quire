/**
 * Floating context menu, drawn with the same menu classes as the menu bar so
 * every skin styles it. An item is 'sep' or { label, shortcut, action, disabled,
 * check, checked }, the same shape createMenuBar takes.
 *
 * One menu is open at a time. It closes on a press outside it, a scroll, a
 * resize, Escape, Tab, or after an item runs. Arrow keys, Home and End move
 * between items. Focus goes back to whatever had it before the menu opened.
 */

import { el } from './dom.js';

const MARGIN = 6; // keep the menu this far inside the window

let open = null; // { panel, returnTo }

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

export function isContextMenuOpen() {
  return Boolean(open);
}

export function closeContextMenu({ restoreFocus = true } = {}) {
  if (!open) return;
  const { panel, returnTo } = open;
  const hadFocus = panel.contains(document.activeElement);
  panel.remove();
  open = null;
  if (hadFocus && restoreFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

function place(panel, x, y) {
  panel.style.left = '0px';
  panel.style.top = '0px';
  const { width, height } = panel.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
  const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function itemsOf(panel) {
  return [...panel.querySelectorAll('.menu-item:not(:disabled)')];
}

/**
 * Opens a menu at viewport coordinates (x, y). `keyboard` focuses the first
 * item, for menus opened with the Menu key or Shift+F10.
 */
export function openContextMenu({ x, y, items, label, keyboard = false }) {
  closeContextMenu({ restoreFocus: false });
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panel = el('div', { class: 'menu-panel context-menu', role: 'menu', 'aria-label': label });
  for (const item of items) {
    if (item === 'sep') {
      panel.append(el('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    const checkable = Boolean(item.check);
    panel.append(
      el(
        'button',
        {
          class: `menu-item${checkable && item.checked ? ' is-checked' : ''}`,
          type: 'button',
          role: checkable ? 'menuitemcheckbox' : 'menuitem',
          'aria-checked': checkable ? String(Boolean(item.checked)) : null,
          disabled: Boolean(item.disabled),
          onClick: () => {
            closeContextMenu({ restoreFocus: false });
            item.action?.();
          },
        },
        el('span', {}, item.label),
        el('span', { class: 'menu-shortcut' }, item.shortcut ?? ''),
      ),
    );
  }
  document.body.append(panel);
  place(panel, x, y);
  open = { panel, returnTo };
  if (keyboard) itemsOf(panel)[0]?.focus({ preventScroll: true });
  return panel;
}

// ---------- dismissal and keys, wired once ----------

function onKeydown(event) {
  if (!open) return;
  const { panel } = open;
  const inPanel = panel.contains(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
  } else if (event.key === 'Tab') {
    closeContextMenu();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    event.stopPropagation();
    const items = itemsOf(panel);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (!inPanel || at === -1) next = event.key === 'ArrowDown' ? 0 : items.length - 1;
    else next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  } else if (!inPanel && !MODIFIER_KEYS.has(event.key)) {
    // Typing or Enter with the menu open by mouse: the text takes over, so the menu goes.
    closeContextMenu({ restoreFocus: false });
  }
}

function onPointerdown(event) {
  if (open && !open.panel.contains(event.target)) closeContextMenu({ restoreFocus: false });
}

function onScroll(event) {
  if (!open) return;
  // Scrolling inside the menu itself is fine; anything else moves the page away from it.
  if (event.target instanceof Node && open.panel.contains(event.target)) return;
  closeContextMenu({ restoreFocus: false });
}

/**
 * Where a context menu should open for a contextmenu event. A mouse right-click
 * opens at the pointer. The Menu key and Shift+F10 send no pointer position,
 * so the menu opens under the focused element instead.
 */
export function menuPointFor(event) {
  // Mouse right-clicks report button 2. A contextmenu from the keyboard reports button 0.
  if (event.button === 2) return { x: event.clientX, y: event.clientY, keyboard: false };
  const rect = event.target instanceof Element ? event.target.getBoundingClientRect() : { left: 0, bottom: 0 };
  return { x: rect.left + 16, y: rect.bottom - 4, keyboard: true };
}

let wired = false;
export function wireContextMenus() {
  if (wired) return;
  wired = true;
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerdown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', () => closeContextMenu({ restoreFocus: false }));
  window.addEventListener('blur', () => closeContextMenu({ restoreFocus: false }));
}
