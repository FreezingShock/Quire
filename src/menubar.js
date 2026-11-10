/**
 * Application menu bar. `menus` is [{ label, items: () => Item[] }], where items
 * are rebuilt on every open so check marks and disabled states stay current.
 * An Item is either 'sep' or { label, shortcut, action, check, checked, disabled }.
 */

import { el } from './dom.js';

export function createMenuBar(root, menus) {
  let open = null;

  const titles = menus.map((menu, index) => {
    const button = el('button', { class: 'menu-title', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, menu.label);
    button.addEventListener('click', () => (open?.index === index ? close() : show(index)));
    button.addEventListener('pointerenter', () => {
      if (open && open.index !== index) show(index);
    });
    return button;
  });
  root.replaceChildren(...titles);

  function show(index) {
    close();
    const button = titles[index];
    const panel = el('div', { class: 'menu-panel', role: 'menu', 'aria-label': menus[index].label });
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
    button.classList.add('is-open');
    root.append(panel);
    panel.style.left = `${button.offsetLeft}px`;
    open = { index, button, panel };
  }

  function close() {
    if (!open) return;
    open.button.setAttribute('aria-expanded', 'false');
    open.button.classList.remove('is-open');
    open.panel.remove();
    open = null;
  }

  document.addEventListener('pointerdown', (event) => {
    if (open && !root.contains(event.target)) close();
  });

  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      const { index } = open;
      close();
      titles[index].focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = (open.index + step + menus.length) % menus.length;
      show(next);
      titles[next].focus();
    }
  });

  return { close };
}
