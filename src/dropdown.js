/**
 * A themed drop-down that stands in for <select>. It follows the WAI-ARIA
 * select-only combobox pattern: the trigger is a focusable combobox, the list
 * is a listbox that opens in the top layer (so it shows above open dialogs),
 * and the keys a native select answers work here too.
 *
 * The root element keeps the parts of the select API the app uses: `value`
 * (read and set) and a bubbling `change` event. So a call site can swap a
 * select for a drop-down without changing how it reads the choice.
 */

import { el } from './dom.js';

let nextKey = 0;

/** Options as { value, label, disabled }, or { id, label } as the model lists have them. Plain strings stand for themselves. */
export function normalizeOptions(options = []) {
  return options.map((option) => {
    if (typeof option === 'string') return { value: option, label: option, disabled: false };
    // Model lists such as KINDS and MOODS name their values `id`.
    const value = String(option.value ?? option.id ?? '');
    return { value, label: String(option.label ?? value), disabled: Boolean(option.disabled) };
  });
}

/** The index of the option with this value, or -1. A value that matches nothing selects nothing, as a select does. */
export function selectedIndex(items, value) {
  return items.findIndex((item) => item.value === value);
}

/**
 * The index `delta` steps from `index` (one step is 1 or -1), skipping disabled
 * options. Stays put when nothing lies that way.
 */
export function moveIndex(items, index, delta) {
  let at = index;
  for (;;) {
    const next = at + delta;
    if (next < 0 || next >= items.length) return index;
    if (!items[next].disabled) return next;
    at = next;
  }
}

/** The first enabled option (`last` false) or the last one (`last` true), or -1 when none is enabled. */
export function edgeIndex(items, last = false) {
  const order = items.map((_, i) => i);
  if (last) order.reverse();
  return order.find((i) => !items[i].disabled) ?? -1;
}

/**
 * The option that a typed string jumps to. A single letter starts after the
 * current option, so pressing the same letter again cycles through the matches.
 * A longer string (typed quickly) searches from the current option on.
 */
export function typeaheadIndex(items, query, from) {
  const needle = query.trim().toLowerCase();
  if (!needle || !items.length) return -1;
  const start = needle.length === 1 ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < items.length; step++) {
    const at = (((start + step) % items.length) + items.length) % items.length;
    const item = items[at];
    if (!item.disabled && item.label.toLowerCase().startsWith(needle)) return at;
  }
  return -1;
}

/** Pages of this many options for PageUp and PageDown. */
const PAGE = 5;
/** A pause longer than this starts a new typed string. */
const TYPE_PAUSE_MS = 800;
/** Keys that open a closed list. */
const OPEN_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'F4'];

/**
 * Builds a drop-down. Options: `label` (the accessible name), `options`,
 * `value`, `id` (on the root), `className` (extra classes on the root), and
 * `onChange(value)`, which runs after the `change` event fires.
 */
export function createDropdown({ id, label = '', options = [], value = '', className = '', onChange } = {}) {
  const key = `dd${++nextKey}`;
  let items = normalizeOptions(options);
  let index = selectedIndex(items, value);
  let active = -1; // the option the keyboard or pointer is on, while the list is open
  let open = false;
  let typed = { text: '', at: 0 };

  const root = el('div', { class: ['dd', className].filter(Boolean).join(' '), id: id ?? null });
  const valueText = el('span', { class: 'dd-value' });
  const arrow = el('span', { class: 'dd-arrow', 'aria-hidden': 'true' });
  arrow.innerHTML = '<svg viewBox="0 0 10 10" focusable="false"><path d="M1.5 3.5h7L5 7.5z"/></svg>';
  const trigger = el('div', {
    class: 'dd-trigger',
    role: 'combobox',
    tabindex: '0',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': `${key}-list`,
    'aria-label': label || null,
  });
  trigger.append(valueText, arrow);
  const list = el('ul', { class: 'dd-list', id: `${key}-list`, role: 'listbox', tabindex: '-1', 'aria-label': label || null });
  // A manual popover shows in the top layer, above any open dialog, and stays
  // until we close it. Browsers without popovers get the list inline instead.
  const canPopover = typeof list.showPopover === 'function';
  if (canPopover) list.setAttribute('popover', 'manual');
  else {
    list.hidden = true;
    root.classList.add('dd-inline');
  }
  root.append(trigger, list);

  const repeatMove = (from, delta) => {
    let at = from;
    for (let n = 0; n < PAGE; n++) at = moveIndex(items, at, delta);
    return at;
  };
  // Where each navigation key takes the highlighted option.
  const moves = {
    ArrowDown: (at) => moveIndex(items, at, 1),
    ArrowUp: (at) => moveIndex(items, at, -1),
    PageDown: (at) => repeatMove(at, 1),
    PageUp: (at) => repeatMove(at, -1),
    Home: () => edgeIndex(items),
    End: () => edgeIndex(items, true),
  };

  // A drop-down inside a disabled fieldset (the print dialog does this) takes no input.
  const isDisabled = () => Boolean(root.closest('fieldset:disabled'));

  function paint() {
    valueText.textContent = index >= 0 ? items[index].label : '';
    [...list.children].forEach((node, i) => {
      node.setAttribute('aria-selected', String(i === index));
      node.classList.toggle('is-active', open && i === active);
    });
    if (open && active >= 0) trigger.setAttribute('aria-activedescendant', `${key}-opt-${active}`);
    else trigger.removeAttribute('aria-activedescendant');
  }

  function renderOptions() {
    list.replaceChildren(
      ...items.map((item, i) =>
        el(
          'li',
          {
            class: 'dd-option',
            role: 'option',
            id: `${key}-opt-${i}`,
            'aria-selected': 'false',
            'aria-disabled': item.disabled ? 'true' : null,
          },
          item.label,
        ),
      ),
    );
    paint();
  }

  function place() {
    const rect = trigger.getBoundingClientRect();
    const room = window.innerHeight - rect.bottom;
    const height = Math.min(list.scrollHeight, window.innerHeight * 0.6);
    list.style.minWidth = `${rect.width}px`;
    // Keep the list inside the window, even when the trigger sits at the right edge of a phone.
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - list.offsetWidth - 4));
    list.style.left = `${left}px`;
    // Open upward when the list would run off the bottom of the window.
    if (room < height && rect.top > room) {
      list.style.top = 'auto';
      list.style.bottom = `${window.innerHeight - rect.top}px`;
    } else {
      list.style.bottom = 'auto';
      list.style.top = `${rect.bottom}px`;
    }
  }

  function onPointerDown(event) {
    if (!root.contains(event.target)) closeList();
  }

  function onScroll(event) {
    // Scrolling the list itself is fine. Scrolling anything else moves the trigger, so the list follows it.
    if (!list.contains(event.target)) place();
  }

  function openList() {
    if (open || isDisabled() || !items.length) return;
    open = true;
    active = index >= 0 ? index : edgeIndex(items);
    if (canPopover) list.showPopover();
    else list.hidden = false;
    place();
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeList);
    paint();
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function closeList({ focus = false } = {}) {
    if (!open) return;
    open = false;
    active = -1;
    if (canPopover) {
      try {
        list.hidePopover();
      } catch {
        // Already closed by the browser.
      }
    } else list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', closeList);
    paint();
    if (focus) trigger.focus({ preventScroll: true });
  }

  function choose(i, { focus = false } = {}) {
    if (i < 0 || i >= items.length || items[i].disabled) return;
    const changed = i !== index;
    index = i;
    closeList({ focus });
    paint();
    if (!changed) return;
    onChange?.(items[index].value);
    root.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', () => {
    if (isDisabled()) return;
    if (open) closeList({ focus: true });
    else openList();
  });

  trigger.addEventListener('keydown', (event) => {
    // Let shortcuts with Ctrl, Alt or Meta through, as the app expects. Tab moves on.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') {
      closeList();
      return;
    }
    // Keys on the drop-down never reach the app's single-key shortcuts.
    event.stopPropagation();
    if (isDisabled()) return;

    if (!open) {
      if (OPEN_KEYS.includes(event.key)) {
        event.preventDefault();
        openList();
        return;
      }
      // Typing with the list closed changes the choice straight away, as a select does.
      if (event.key.length === 1) {
        const i = typeahead(event.key, index);
        if (i >= 0) choose(i);
      }
      return;
    }

    const key = event.key;
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active, { focus: true });
      return;
    }
    if (key === 'Escape') {
      // Closes the list only. The dialog around it stays open.
      event.preventDefault();
      closeList({ focus: true });
      return;
    }
    if (moves[key]) {
      event.preventDefault();
      active = moves[key](active);
    } else if (key.length === 1) {
      event.preventDefault();
      const i = typeahead(key, active);
      if (i >= 0) active = i;
    } else {
      return;
    }
    paint();
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  });

  /** Adds a typed character to the string being typed, and returns the option it jumps to from `from`. */
  function typeahead(char, from) {
    const now = Date.now();
    const text = (now - typed.at > TYPE_PAUSE_MS ? '' : typed.text) + char;
    typed = { text, at: now };
    // Repeating one letter cycles through the options that start with it.
    const needle = [...text].every((c) => c === char) ? char : text;
    return typeaheadIndex(items, needle, from);
  }

  list.addEventListener('click', (event) => {
    const node = event.target.closest('.dd-option');
    if (!node) return;
    choose([...list.children].indexOf(node), { focus: true });
  });

  list.addEventListener('pointermove', (event) => {
    const node = event.target.closest('.dd-option');
    if (!node) return;
    const i = [...list.children].indexOf(node);
    if (i !== active && !items[i].disabled) {
      active = i;
      paint();
    }
  });

  Object.defineProperty(root, 'value', {
    configurable: true,
    get: () => (index >= 0 ? items[index].value : ''),
    set: (next) => {
      index = selectedIndex(items, String(next ?? ''));
      paint();
    },
  });

  /** Replaces the choices. The current value stays if the new list still offers it. */
  root.setOptions = (next, nextValue = root.value) => {
    closeList();
    items = normalizeOptions(next);
    index = selectedIndex(items, nextValue);
    renderOptions();
  };

  renderOptions();
  return root;
}

/** Replaces a placeholder element with a drop-down that takes its id. Returns the drop-down. */
export function mountDropdown(slot, options) {
  const dropdown = createDropdown({ ...options, id: slot.id || undefined });
  slot.replaceWith(dropdown);
  return dropdown;
}
