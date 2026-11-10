/**
 * Home view: the landing page with every entry. It is laid out like an
 * Explorer window: an address bar, a command bar, a navigation pane with kinds
 * and tags, and either a details list or a row of page tiles. HomeView renders
 * and reports what the user asks for through callbacks. The app owns storage
 * and routing.
 */

import { el } from './dom.js';
import { KINDS, displayTitle, formatShortDate } from './model.js';
import { wordCount } from './markdown.js';
import { NORM_WIDTH, paintInk } from './drawing.js';
import { icon } from './icons.js';
import {
  SORTS,
  countByKind,
  countByTag,
  excerptOf,
  filterEntries,
  kindLabel,
  sortEntries,
} from './library.js';

const PAGE_RATIO = 1.25; // sheet height relative to its width, as on the writing page
const THUMB_PX = 352; // 2x the tile page width, so ink stays sharp on high-DPI screens

const COLUMNS = [
  { label: 'Title', key: 'title', cls: 'col-title' },
  { label: 'Date', key: 'date', cls: 'col-date' },
  { label: 'Kind', key: 'kind', cls: 'col-kind' },
  { label: 'Tags', key: null, cls: 'col-tags' },
  { label: 'Words', key: 'words', cls: 'col-words num' },
  { label: 'Modified', key: 'updatedAt', cls: 'col-modified' },
];

function iconNode(name, cls = '') {
  const span = el('span', { class: `icon ${cls}`.trim(), 'aria-hidden': 'true' });
  span.innerHTML = icon(name);
  return span;
}

/** Ink only, painted the same way the writing page paints it, over the page color. */
function inkThumbnail(entry) {
  const canvas = el('canvas', {
    class: 'tile-ink',
    width: THUMB_PX,
    height: Math.round(THUMB_PX * PAGE_RATIO),
    'aria-hidden': 'true',
  });
  paintInk(canvas.getContext('2d'), entry.ink.ops, entry.ink.layers, THUMB_PX / NORM_WIDTH);
  return canvas;
}

function modifiedLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export class HomeView {
  /**
   * `view` is 'details' or 'tiles'. Callbacks: onOpen(id), onNew(), onDelete(id),
   * onViewChange(view).
   */
  constructor(root, { view = 'details', onOpen, onNew, onDelete, onViewChange } = {}) {
    this.root = root;
    this.callbacks = { onOpen, onNew, onDelete, onViewChange };
    this.entries = [];
    this.state = {
      filter: { type: 'all', value: null },
      query: '',
      sort: { key: 'date', dir: 'desc' },
      view: view === 'tiles' ? 'tiles' : 'details',
      selectedId: null,
    };
    this.buildShell();
    this.render();
  }

  /** Replaces the list with the latest entries from storage. */
  setEntries(entries) {
    this.entries = entries;
    this.render();
  }

  focusSearch() {
    this.searchInput.focus();
    this.searchInput.select();
  }

  // ---------- shell ----------

  buildShell() {
    this.crumb = el('span', { class: 'home-crumb-current' }, 'All entries');
    this.searchInput = el('input', {
      type: 'search',
      placeholder: 'Search entries',
      'aria-label': 'Search entries',
      autocomplete: 'off',
      onInput: (event) => {
        this.state.query = event.target.value;
        this.render();
      },
      onKeydown: (event) => {
        if (event.key !== 'Escape') return;
        event.target.value = '';
        this.state.query = '';
        this.render();
      },
    });
    this.newBtn = this.commandButton('New entry', 'plus', () => this.callbacks.onNew?.(), 'cmd-primary');
    this.openBtn = this.commandButton('Open', 'open', () => this.openSelected());
    this.deleteBtn = this.commandButton('Delete', 'trash', () => this.deleteSelected());
    this.detailsBtn = el(
      'button',
      { class: 'cmd-btn cmd-icon-only', type: 'button', title: 'Details', 'aria-label': 'Details view', onClick: () => this.setViewMode('details') },
      iconNode('details'),
    );
    this.tilesBtn = el(
      'button',
      { class: 'cmd-btn cmd-icon-only', type: 'button', title: 'Tiles', 'aria-label': 'Tiles view', onClick: () => this.setViewMode('tiles') },
      iconNode('tiles'),
    );
    this.nav = el('nav', { class: 'home-nav', 'aria-label': 'Filter entries' });
    this.main = el('div', { class: 'home-main' });

    this.root.replaceChildren(
      el(
        'div',
        { class: 'home-address' },
        el(
          'div',
          { class: 'home-path' },
          el('span', { class: 'home-crumb' }, iconNode('folder'), 'Quire'),
          el('span', { class: 'home-chevron', 'aria-hidden': 'true' }, '›'),
          this.crumb,
        ),
        el('div', { class: 'home-search' }, iconNode('search', 'search-icon'), this.searchInput),
      ),
      el(
        'div',
        { class: 'home-command', role: 'toolbar', 'aria-label': 'Entry actions' },
        this.newBtn,
        this.openBtn,
        this.deleteBtn,
        el('span', { class: 'cmd-sep', 'aria-hidden': 'true' }),
        el('span', { class: 'cmd-spacer' }),
        el('div', { class: 'view-toggle', role: 'group', 'aria-label': 'View' }, this.detailsBtn, this.tilesBtn),
      ),
      el('div', { class: 'home-body' }, this.nav, this.main),
    );
  }

  commandButton(label, iconName, onClick, extra = '') {
    return el(
      'button',
      { class: `cmd-btn ${extra}`.trim(), type: 'button', onClick },
      iconNode(iconName),
      el('span', { class: 'cmd-label' }, label),
    );
  }

  // ---------- rendering ----------

  render() {
    const { state } = this;
    const matches = sortEntries(filterEntries(this.entries, state), state.sort);
    if (!matches.some((entry) => entry.id === state.selectedId)) state.selectedId = null;
    this.renderNav();
    this.renderCrumb();
    this.renderMain(matches);
  }

  renderNav() {
    const { filter } = this.state;
    const kinds = countByKind(this.entries);
    const tags = countByTag(this.entries);
    const navItem = ({ label, count, icon: iconName, active, onSelect }) =>
      el(
        'button',
        { class: 'nav-item', type: 'button', 'aria-current': active ? 'true' : null, onClick: onSelect },
        iconNode(iconName),
        el('span', { class: 'nav-label' }, label),
        el('span', { class: 'nav-count' }, String(count)),
      );

    this.nav.replaceChildren(
      el('h3', {}, 'Library'),
      navItem({
        label: 'All entries',
        count: this.entries.length,
        icon: 'page',
        active: filter.type === 'all',
        onSelect: () => this.setFilter({ type: 'all', value: null }),
      }),
      ...KINDS.map((kind) =>
        navItem({
          label: kind.label,
          count: kinds[kind.id] ?? 0,
          icon: 'folder',
          active: filter.type === 'kind' && filter.value === kind.id,
          onSelect: () => this.setFilter({ type: 'kind', value: kind.id }),
        }),
      ),
      el('h3', {}, 'Tags'),
      ...(tags.length
        ? tags.map(({ tag, count }) =>
            navItem({
              label: tag,
              count,
              icon: 'tag',
              active: filter.type === 'tag' && filter.value === tag,
              onSelect: () => this.setFilter({ type: 'tag', value: tag }),
            }),
          )
        : [el('p', { class: 'nav-empty' }, 'Tags you add to entries show up here.')]),
    );
  }

  renderCrumb() {
    const { filter } = this.state;
    if (filter.type === 'kind') this.crumb.textContent = kindLabel(filter.value);
    else if (filter.type === 'tag') this.crumb.textContent = `#${filter.value}`;
    else this.crumb.textContent = 'All entries';
  }

  renderMain(matches) {
    this.main.dataset.view = this.state.view;
    if (!this.entries.length) this.main.replaceChildren(this.emptyLibrary());
    else if (!matches.length) this.main.replaceChildren(this.emptyMatches());
    else if (this.state.view === 'tiles') this.main.replaceChildren(this.tileGrid(matches));
    else this.main.replaceChildren(this.table(matches));
    this.markSelection();
  }

  /** Updates selection classes and the roving tab stop without rebuilding rows. */
  markSelection({ focus = false } = {}) {
    const { selectedId } = this.state;
    const rows = [...this.main.querySelectorAll('[data-id]')];
    const anchor = selectedId ?? rows[0]?.dataset.id ?? null;
    let target = null;
    for (const row of rows) {
      const selected = row.dataset.id === selectedId;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.tabIndex = row.dataset.id === anchor ? 0 : -1;
      if (selected) target = row;
    }
    if (focus && target) target.focus();
    this.renderCommands();
  }

  renderCommands() {
    const hasSelection = Boolean(this.state.selectedId);
    this.openBtn.disabled = !hasSelection;
    this.deleteBtn.disabled = !hasSelection;
    this.detailsBtn.setAttribute('aria-pressed', String(this.state.view === 'details'));
    this.tilesBtn.setAttribute('aria-pressed', String(this.state.view === 'tiles'));
  }

  // ---------- details list ----------

  table(matches) {
    const { sort } = this.state;
    const head = el(
      'tr',
      {},
      COLUMNS.map((column) => {
        const active = Boolean(column.key) && sort.key === column.key;
        const mark = active ? (sort.dir === 'asc' ? '▲' : '▼') : '';
        const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null;
        return el(
          'th',
          { scope: 'col', class: column.cls, 'aria-sort': ariaSort },
          column.key
            ? el(
                'button',
                { type: 'button', class: 'th-btn', onClick: () => this.toggleSort(column.key) },
                el('span', { class: 'th-label' }, column.label),
                el('span', { class: 'sort-mark', 'aria-hidden': 'true' }, mark),
              )
            : el('span', { class: 'th-btn th-static' }, el('span', { class: 'th-label' }, column.label)),
        );
      }),
    );

    const rows = matches.map((entry) =>
      el(
        'tr',
        {
          'data-id': entry.id,
          'aria-selected': 'false',
          onClick: () => this.select(entry.id),
          onDblclick: () => this.open(entry.id),
          onKeydown: (event) => this.onKeydown(event),
        },
        el(
          'td',
          { class: 'col-title' },
          el('span', { class: 'cell-title' }, iconNode('page'), el('span', { class: 'cell-name' }, displayTitle(entry))),
        ),
        el('td', { class: 'col-date' }, formatShortDate(entry.date)),
        el('td', { class: 'col-kind' }, kindLabel(entry.kind)),
        el('td', { class: 'col-tags' }, entry.tags.join(', ')),
        el('td', { class: 'col-words num' }, String(wordCount(entry.body))),
        el('td', { class: 'col-modified' }, modifiedLabel(entry.updatedAt)),
      ),
    );

    return el(
      'div',
      { class: 'home-table-wrap' },
      el(
        'table',
        { class: 'home-table', role: 'grid', 'aria-label': 'Entries' },
        el('thead', {}, head),
        el('tbody', {}, rows),
      ),
    );
  }

  // ---------- tiles ----------

  tileGrid(matches) {
    return el(
      'div',
      { class: 'home-tiles', role: 'listbox', 'aria-label': 'Entries' },
      matches.map((entry) => this.tile(entry)),
    );
  }

  tile(entry) {
    const text = excerptOf(entry, 240);
    const hasInk = entry.ink.ops.length > 0;
    const fallback = text || (hasInk ? '' : 'Blank page');
    const page = el(
      'div',
      { class: 'tile-page', style: `background-color: ${entry.pageColor}` },
      el('p', { class: `tile-text${text ? '' : ' is-empty'}` }, fallback),
      hasInk ? inkThumbnail(entry) : null,
    );
    return el(
      'div',
      {
        class: 'tile',
        role: 'option',
        'data-id': entry.id,
        'aria-selected': 'false',
        onClick: () => this.select(entry.id),
        onDblclick: () => this.open(entry.id),
        onKeydown: (event) => this.onKeydown(event),
      },
      page,
      el(
        'div',
        { class: 'tile-meta' },
        el('span', { class: 'tile-title' }, displayTitle(entry)),
        el('span', { class: 'tile-sub' }, `${formatShortDate(entry.date)} · ${kindLabel(entry.kind)}`),
      ),
    );
  }

  // ---------- empty states ----------

  emptyLibrary() {
    return el(
      'div',
      { class: 'home-empty' },
      iconNode('page', 'empty-icon'),
      el('h2', {}, 'No entries yet'),
      el('p', {}, 'Write a page or sketch one. Everything stays in this browser until you back it up.'),
      el('button', { class: 'cmd-btn cmd-primary', type: 'button', onClick: () => this.callbacks.onNew?.() }, iconNode('plus'), 'New entry'),
    );
  }

  emptyMatches() {
    const query = this.state.query.trim();
    return el(
      'div',
      { class: 'home-empty' },
      iconNode('search', 'empty-icon'),
      el('h2', {}, query ? 'Nothing matches' : 'Nothing in this view'),
      el('p', {}, query ? `No entry matches “${query}” here.` : 'No entries match this filter.'),
      el(
        'button',
        { class: 'cmd-btn', type: 'button', onClick: () => this.resetView() },
        'Show all entries',
      ),
    );
  }

  resetView() {
    this.state.query = '';
    this.state.filter = { type: 'all', value: null };
    this.searchInput.value = '';
    this.render();
  }

  // ---------- actions ----------

  setFilter(filter) {
    this.state.filter = filter;
    this.render();
  }

  setViewMode(view) {
    if (view === this.state.view) return;
    this.state.view = view;
    this.callbacks.onViewChange?.(view);
    this.render();
  }

  toggleSort(key) {
    const { sort } = this.state;
    this.state.sort = sort.key === key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: SORTS[key].dir };
    this.render();
  }

  select(id) {
    this.state.selectedId = id;
    this.markSelection({ focus: true });
  }

  open(id) {
    this.callbacks.onOpen?.(id);
  }

  openSelected() {
    if (this.state.selectedId) this.open(this.state.selectedId);
  }

  deleteSelected() {
    if (this.state.selectedId) this.callbacks.onDelete?.(this.state.selectedId);
  }

  onKeydown(event) {
    const ids = [...this.main.querySelectorAll('[data-id]')].map((node) => node.dataset.id);
    if (!ids.length) return;
    const index = ids.indexOf(this.state.selectedId);
    const moveTo = (next) => {
      event.preventDefault();
      this.select(ids[Math.min(ids.length - 1, Math.max(0, next))]);
    };
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        moveTo(index + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(ids.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        this.openSelected();
        break;
      case 'Delete':
        event.preventDefault();
        this.deleteSelected();
        break;
      default:
        break;
    }
  }
}
