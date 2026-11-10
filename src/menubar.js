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

  function enabledItems() {
    return open ? [...open.panel.querySelectorAll('.menu-item:not(:disabled)')] : [];
  }

  function focusItem(which) {
    const items = enabledItems();
    if (!items.length) return;
    if (which === 'first') items[0].focus();
    else if (which === 'last') items[items.length - 1].focus();
    else items[(items.indexOf(document.activeElement) + which + items.length) % items.length].focus();
  }

  function show(index, { focusFirst = false } = {}) {
    close();
    const button = titles[index];
    const panel = el('div', { class: 'menu-panel', role: 'menu', id: `menu-panel-${index}`, 'aria-label': menus[index].label });
    for (const item of menus[index].items()) {
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
              close();
              item.action?.();
            },
          },
          el('span', {}, item.label),
          el('span', { class: 'menu-shortcut' }, item.shortcut ?? ''),
        ),
      );
    }
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', panel.id);
    button.classList.add('is-open');
    root.append(panel);
    panel.style.left = `${button.offsetLeft}px`;
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
    if (event.key === 'Escape') {
      event.preventDefault();
      const { index } = open;
      close();
      titles[index].focus();
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
