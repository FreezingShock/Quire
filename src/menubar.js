/**
 * Application menu bar. `menus` is [{ label, items: () => Item[], hidden?: () => boolean }],
 * where items are rebuilt on every open so check marks and disabled states stay
 * current. A menu whose `hidden()` is true is left out of the bar until
 * `refresh()` runs again, and the arrow keys skip it.
 * An Item is either 'sep' or { label, shortcut, action, check, checked, disabled }.
 *
 * Keyboard follows the menu button pattern: Enter, Space or Down opens a menu and
 * moves focus to its first item, Up and Down move between items, Home and End go
 * to the ends, Left and Right change menus, and Escape or Tab closes the menu and
 * returns focus to its title.
 */

import { el } from './dom.js';

export function createMenuBar(root, menus) {
  let open = null;

  const titles = menus.map((menu, index) => {
    const button = el('button', { class: 'menu-title', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, menu.label);
    button.addEventListener('click', (event) => {
      // A click with no pointer (detail 0) came from Enter or Space, so focus should go into the menu.
      if (open?.index === index) close();
      else show(index, { focusFirst: event.detail === 0 });
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation(); // the document handler below would otherwise also step through the items
      if (open?.index !== index) show(index, { focusFirst: true });
      focusItem(event.key === 'ArrowDown' ? 'first' : 'last');
    });
    button.addEventListener('pointerenter', () => {
      if (open && open.index !== index) show(index, { focusFirst: open.panel.contains(document.activeElement) });
    });
    return button;
  });
  root.replaceChildren(...titles);

  /** Shows or hides menu titles to match `hidden()`, closing a menu that just went away. */
  function refresh() {
    menus.forEach((menu, index) => {
      titles[index].hidden = Boolean(menu.hidden?.());
    });
    if (open && titles[open.index].hidden) close();
  }

  /** The next menu that is showing, moving `step` places from `from`. */
  function neighbour(from, step) {
    let next = from;
    do {
      next = (next + step + menus.length) % menus.length;
    } while (titles[next].hidden && next !== from);
    return next;
  }

  /** The items the arrow keys move through: the open submenu's if one is open, otherwise the menu's own. */
  function enabledItems() {
    if (!open) return [];
    const level = open.sub?.panel ?? open.panel;
    return [...level.querySelectorAll(':scope > .menu-item:not(:disabled)')];
  }

  function focusItem(which) {
    const items = enabledItems();
    if (!items.length) return;
    if (which === 'first') items[0].focus();
    else if (which === 'last') items[items.length - 1].focus();
    else items[(items.indexOf(document.activeElement) + which + items.length) % items.length].focus();
  }

  /** One row of a menu or submenu. An item with `submenu` opens a flyout instead of running an action. */
  function makeItem(item) {
    const checkable = Boolean(item.check);
    const hasSub = Array.isArray(item.submenu);
    const row = el(
      'button',
      {
        class: `menu-item${checkable && item.checked ? ' is-checked' : ''}${hasSub ? ' has-sub' : ''}`,
        type: 'button',
        role: checkable ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': checkable ? String(Boolean(item.checked)) : null,
        'aria-haspopup': hasSub ? 'menu' : null,
        'aria-expanded': hasSub ? 'false' : null,
        disabled: Boolean(item.disabled),
        onClick: () => {
          if (hasSub) openSub(row, item.submenu, { focusFirst: true });
          else {
            close();
            item.action?.();
          }
        },
      },
      el('span', {}, item.label),
      el('span', { class: 'menu-shortcut' }, hasSub ? '›' : (item.shortcut ?? '')),
    );
    row.submenuItems = hasSub ? item.submenu : null;
    row.addEventListener('pointerenter', () => {
      if (!open || row.disabled) return;
      if (hasSub) openSub(row, item.submenu);
      else if (open.sub && row.parentElement === open.panel) closeSub();
    });
    return row;
  }

  /** Opens a flyout beside `parent`, inside the open menu panel so the keys and clicks stay in one place. */
  function openSub(parent, items, { focusFirst = false } = {}) {
    if (!open) return;
    if (open.sub?.button === parent) {
      if (focusFirst) focusItem('first');
      return;
    }
    closeSub();
    const panel = el('div', { class: 'menu-panel menu-sub', role: 'menu', 'aria-label': parent.querySelector('span')?.textContent ?? '' });
    for (const item of items) {
      if (item === 'sep') panel.append(el('div', { class: 'menu-sep', role: 'separator' }));
      else panel.append(makeItem(item));
    }
    panel.style.top = `${parent.offsetTop - 4}px`;
    panel.style.left = `${open.panel.offsetWidth - 3}px`;
    open.panel.append(panel);
    parent.setAttribute('aria-expanded', 'true');
    open.sub = { button: parent, panel };
    if (focusFirst) focusItem('first');
  }

  /** Closes the open flyout. `refocus` moves focus back to the item that opened it. */
  function closeSub({ refocus = false } = {}) {
    if (!open?.sub) return;
    const { button, panel } = open.sub;
    const hadFocus = panel.contains(document.activeElement);
    panel.remove();
    button.setAttribute('aria-expanded', 'false');
    open.sub = null;
    if (hadFocus || refocus) button.focus();
  }

  function show(index, { focusFirst = false } = {}) {
    close();
    const button = titles[index];
    const panel = el('div', { class: 'menu-panel', role: 'menu', id: `menu-panel-${index}`, 'aria-label': menus[index].label });
    for (const item of menus[index].items()) {
      if (item === 'sep') panel.append(el('div', { class: 'menu-sep', role: 'separator' }));
      else panel.append(makeItem(item));
    }
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', panel.id);
    button.classList.add('is-open');
    root.append(panel);
    // Keep the drop-down inside the bar. On a narrow window a menu opened from
    // a title near the end (View, Skin, Help) would otherwise run off the screen.
    const latestLeft = Math.max(0, root.clientWidth - panel.offsetWidth);
    panel.style.left = `${Math.min(button.offsetLeft, latestLeft)}px`;
    open = { index, button, panel };
    if (focusFirst) focusItem('first');
  }

  function close() {
    if (!open) return;
    const { button, panel } = open;
    // Keep focus in the menu bar when the focused item is about to be removed.
    const hadFocus = panel.contains(document.activeElement);
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-controls');
    button.classList.remove('is-open');
    panel.remove();
    open = null;
    if (hadFocus) button.focus();
  }

  document.addEventListener('pointerdown', (event) => {
    if (open && !root.contains(event.target) && !open.panel.contains(event.target)) close();
  });

  document.addEventListener('keydown', (event) => {
    if (!open) return;
    const inPanel = open.panel.contains(document.activeElement);
    const inSub = Boolean(open.sub?.panel.contains(document.activeElement));
    const focused = document.activeElement;
    if (event.key === 'Escape' && open.sub) {
      // Escape first closes the flyout, leaving the menu open.
      event.preventDefault();
      closeSub({ refocus: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const { index } = open;
      close();
      titles[index].focus();
    } else if (event.key === 'ArrowRight' && inPanel && !inSub && focused?.submenuItems) {
      event.preventDefault();
      openSub(focused, focused.submenuItems, { focusFirst: true });
    } else if (event.key === 'ArrowLeft' && inSub) {
      event.preventDefault();
      closeSub({ refocus: true });
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = neighbour(open.index, step);
      if (inPanel) {
        show(next, { focusFirst: true });
      } else {
        show(next);
        titles[next].focus();
      }
    } else if (inPanel && event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(1);
    } else if (inPanel && event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(-1);
    } else if (inPanel && event.key === 'Home') {
      event.preventDefault();
      focusItem('first');
    } else if (inPanel && event.key === 'End') {
      event.preventDefault();
      focusItem('last');
    } else if (event.key === 'Tab') {
      // Tab leaves the menu, so the menu closes and focus stays on its title.
      const { index } = open;
      close();
      titles[index].focus();
    }
  });

  return { close, refresh };
}
