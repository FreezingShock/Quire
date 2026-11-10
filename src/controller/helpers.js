/** Small DOM and entry helpers used across the Quire controller. */
import { DEFAULT_PAGE_COLOR } from '../model.js';

import { el } from '../dom.js';
import { normalizeLayers } from '../drawing.js';

export const $ = (selector) => document.querySelector(selector);
export const prevent = (event) => event.preventDefault();

/** Pen pressure rounded to two places. Pens without a reading fall back to a typical press. */
export const penPressure = (event) => (event.pressure > 0 ? Math.round(event.pressure * 100) / 100 : 0.5);

/** Fills a select with an empty "not set" option followed by each { id, label }. */
export function fillSelect(select, options, emptyLabel) {
  select.replaceChildren(
    el('option', { value: '' }, emptyLabel),
    ...options.map((option) => el('option', { value: option.id }, option.label)),
  );
}

export function isTextTarget(node) {
  return Boolean(node) && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
}

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The parts of an entry that count as an edit. Timestamps and the sheet height are left out. */
export function contentKey(entry) {
  return JSON.stringify([
    entry.title,
    entry.date,
    entry.kind,
    entry.tags,
    entry.body,
    entry.pageColor,
    entry.ink.ops,
    normalizeLayers(entry.ink.layers),
    // Pictures are never edited once added, so their ids are enough to notice a new one.
    Object.keys(entry.images ?? {}).sort(),
    entry.sketches ?? {},
    // Sealing and unsealing are edits too, so the change gets written.
    entry.capsule ?? null,
    // Songs change by their link and title, so a reorder or a new title counts as an edit.
    entry.mixtape ?? [],
  ]);
}

/**
 * Keeps the menu items for one view. An item with `scope` shows only in that
 * view ('editor' or 'home'); items without one show in both. Separators that
 * would lead, trail or double up are dropped.
 */
export function scopeItems(items, view) {
  const out = [];
  for (const item of items) {
    if (item !== 'sep' && item.scope && item.scope !== view) continue;
    if (item === 'sep') {
      if (out.length && out[out.length - 1] !== 'sep') out.push(item);
    } else {
      out.push(item);
    }
  }
  while (out.length && out[out.length - 1] === 'sep') out.pop();
  return out;
}

/**
 * Paints the sheet's page color. The stored default cream follows the theme through the
 * `--page-default` token, so it turns dark in dark skins. A custom color is used as is.
 */
export function paintSheet(sheet, hex) {
  const isDefault = hex === DEFAULT_PAGE_COLOR;
  sheet.style.backgroundColor = isDefault ? 'var(--page-default)' : hex;
  sheet.dataset.page = isDefault ? 'default' : 'custom';
}
