/**
 * Home view: the landing page with every entry. It is laid out like an
 * Explorer window: an address bar, a command bar, a navigation pane with kinds,
 * tags, moods and weather, and one of three views: a details list, a row of
 * page tiles, or a month calendar. HomeView renders and reports what the user
 * asks for through callbacks. The app owns storage and routing.
 */

import { el } from './dom.js';
import { KINDS, MOODS, WEATHERS, displayTitle, formatLongDate, formatShortDate, labelFor, localISODate } from './model.js';
import { wordCount } from './markdown.js';
import { NORM_WIDTH, paintInk } from './drawing.js';
import { icon } from './icons.js';
import { notebookDialog } from './dialogs.js';
import {
  SORTS,
  countByKind,
  countByMood,
  countByNotebook,
  countByTag,
  countByWeather,
  countFlags,
  excerptOf,
  filterEntries,
  highlightParts,
  kindLabel,
  parseQuery,
  snippetOf,
  sortEntries,
} from './library.js';
import {
  dayStreaks,
  daysBetween,
  monthGrid,
  monthOf,
  bucketSeries,
  moodAverage,
  moodCounts,
  moodForScore,
  moodSeries,
  onThisDay,
  shiftISODate,
  summarizeDays,
} from './journal.js';
import { promptFor } from './prompts.js';

const PAGE_RATIO = 1.25; // sheet height relative to its width, as on the writing page
const THUMB_PX = 352; // 2x the tile page width, so ink stays sharp on high-DPI screens
const VIEWS = ['details', 'tiles', 'calendar', 'moods'];
const MOOD_RANGES = [
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 365, label: '1 year' },
  { id: 'all', label: 'All time' },
];
const LONG_RANGE_DAYS = 120; // longer ranges plot weekly averages, so the line stays readable
const CHART = { width: 720, height: 260, padLeft: 92, padRight: 16, padTop: 14, padBottom: 30 };

const COLUMNS = [
  { label: 'Title', key: 'title', cls: 'col-title' },
  { label: 'Date', key: 'date', cls: 'col-date' },
  { label: 'Kind', key: 'kind', cls: 'col-kind' },
  { label: 'Notebook', key: null, cls: 'col-notebook' },
  { label: 'Tags', key: null, cls: 'col-tags' },
  { label: 'Mood', key: null, cls: 'col-feel' },
  { label: 'Words', key: 'words', cls: 'col-words num' },
  { label: 'Modified', key: 'updatedAt', cls: 'col-modified' },
];

/** Column headers for the calendar, starting on Sunday to match monthGrid. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
);

/** Step for each arrow key on the calendar: a day left or right, a week up or down. */
const DAY_STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

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

/** Text with search hits wrapped in <mark>. Plain text when there is no query. */
function marked(text, terms) {
  return highlightParts(text, terms).map((part) => (part.hit ? el('mark', { class: 'hit' }, part.text) : part.text));
}

/** Pin and star markers after a title. Empty when the entry has neither. */
function flagIcons(entry) {
  const flags = [];
  if (entry.pinned) flags.push(iconNode('pin', 'flag flag-pin'));
  if (entry.favorite) flags.push(iconNode('star', 'flag flag-star'));
  if (!flags.length) return null;
  const label = [entry.pinned && 'Pinned', entry.favorite && 'Favorite'].filter(Boolean).join(', ');
  return el('span', { class: 'flags', title: label, 'aria-label': label }, flags);
}

function setLabel(button, text) {
  button.querySelector('.cmd-label').textContent = text;
}

function modifiedLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Good · Rain", or an empty string when neither is set. */
function feelText(entry) {
  return [labelFor(MOODS, entry.mood), labelFor(WEATHERS, entry.weather)].filter(Boolean).join(' · ');
}

function monthTitle({ year, month }) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function streakText({ current, longest, todayDone }) {
  if (current > 0 && todayDone) return `${current}-day streak`;
  if (current > 0) return `${current}-day streak · write today to keep it`;
  return longest ? `Best streak: ${longest} ${longest === 1 ? 'day' : 'days'}` : 'No streak yet';
}

function statTile(label, value) {
  return el('div', { class: 'mood-stat' }, el('span', { class: 'mood-stat-label' }, label), el('span', { class: 'mood-stat-value' }, value));
}

/** Hover text for a chart point: one day, or a week range for weekly averages. */
function dotTitle(point) {
  const when = point.endDate ? `${formatShortDate(point.date)} to ${formatShortDate(point.endDate)}` : formatShortDate(point.date);
  const mood = point.endDate ? `${labelFor(MOODS, point.mood)}, average ${point.score.toFixed(1)}` : labelFor(MOODS, point.mood);
  return `${when}: ${mood}`;
}

function yearsAgoText(years) {
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export class HomeView {
  /**
   * `view` is 'details', 'tiles', 'calendar', or 'moods'. `showPrompts` and
   * `showOnThisDay` control the strip above the list. Callbacks: onOpen(id),
   * onNew(options), onToday(), onWritePrompt(prompt), onHidePrompts(),
   * onDelete(id), onViewChange(view).
   */
  constructor(
    root,
    {
      view = 'details',
      showPrompts = true,
      showOnThisDay = true,
      onOpen,
      onNew,
      onToday,
      onWritePrompt,
      onHidePrompts,
      onDelete,
      onViewChange,
      onPatch,
    } = {},
  ) {
    this.root = root;
    this.callbacks = { onOpen, onNew, onToday, onWritePrompt, onHidePrompts, onDelete, onViewChange, onPatch };
    this.entries = [];
    this.terms = []; // search terms for the current query, used for highlighting
    this.stripOptions = { showPrompts, showOnThisDay };
    const today = localISODate();
    this.state = {
      filter: { type: 'all', value: null },
      query: '',
      sort: { key: 'date', dir: 'desc' },
      view: VIEWS.includes(view) ? view : 'details',
      selectedId: null,
      // Calendar: the month on screen and the day whose entries are listed below it.
      month: monthOf(today),
      day: today,
      // Prompts: how many steps past today's prompt the "Another" button has gone. Mood chart: the range in days, or 'all'.
      promptSkip: 0,
      moodRange: 30,
    };
    this.buildShell();
    this.render();
  }

  /** Replaces the list with the latest entries from storage. */
  setEntries(entries) {
    this.entries = entries;
    this.render();
  }

  /** Shows or hides the prompt card and the On this day card. */
  setStripOptions(options) {
    this.stripOptions = { ...this.stripOptions, ...options };
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
    // A new entry made while a notebook is open starts in that notebook.
    this.newBtn = this.commandButton(
      'New entry',
      'plus',
      () => this.callbacks.onNew?.(this.state.filter.type === 'notebook' ? { notebook: this.state.filter.value } : undefined),
      'cmd-primary',
    );
    this.todayBtn = this.commandButton('Today', 'calendar', () => this.callbacks.onToday?.());
    this.todayBtn.title = "Open today's journal, or start one (Alt+T)";
    this.openBtn = this.commandButton('Open', 'open', () => this.openSelected());
    this.pinBtn = this.commandButton('Pin', 'pin', () => this.togglePinned());
    this.pinBtn.title = 'Pin to the top of the list';
    this.favBtn = this.commandButton('Favorite', 'star', () => this.toggleFavorite());
    this.favBtn.title = 'Mark as a favorite';
    this.moveBtn = this.commandButton('Notebook', 'notebook', () => this.moveSelected());
    this.moveBtn.title = 'Move to a notebook';
    this.deleteBtn = this.commandButton('Delete', 'trash', () => this.deleteSelected());
    this.streak = el('span', { class: 'streak-chip' });
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
    this.calendarBtn = el(
      'button',
      { class: 'cmd-btn cmd-icon-only', type: 'button', title: 'Calendar', 'aria-label': 'Calendar view', onClick: () => this.setViewMode('calendar') },
      iconNode('calendar'),
    );
    this.moodsBtn = el(
      'button',
      { class: 'cmd-btn cmd-icon-only', type: 'button', title: 'Mood chart', 'aria-label': 'Mood chart view', onClick: () => this.setViewMode('moods') },
      iconNode('chart'),
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
        this.todayBtn,
        this.openBtn,
        this.pinBtn,
        this.favBtn,
        this.moveBtn,
        this.deleteBtn,
        el('span', { class: 'cmd-sep', 'aria-hidden': 'true' }),
        el('span', { class: 'cmd-spacer' }),
        this.streak,
        el('div', { class: 'view-toggle', role: 'group', 'aria-label': 'View' }, this.detailsBtn, this.tilesBtn, this.calendarBtn, this.moodsBtn),
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
    this.terms = parseQuery(state.query);
    const matches = sortEntries(filterEntries(this.entries, state), state.sort);
    if (!matches.some((entry) => entry.id === state.selectedId)) state.selectedId = null;
    this.renderNav();
    this.renderCrumb();
    this.renderStreak();
    this.renderMain(matches);
  }

  renderNav() {
    const { filter } = this.state;
    const kinds = countByKind(this.entries);
    const flags = countFlags(this.entries);
    const notebooks = countByNotebook(this.entries);
    const tags = countByTag(this.entries);
    const moods = countByMood(this.entries);
    const weathers = countByWeather(this.entries);
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
      navItem({
        label: 'Pinned',
        count: flags.pinned,
        icon: 'pin',
        active: filter.type === 'pinned',
        onSelect: () => this.setFilter({ type: 'pinned', value: null }),
      }),
      navItem({
        label: 'Favorites',
        count: flags.favorite,
        icon: 'star',
        active: filter.type === 'favorite',
        onSelect: () => this.setFilter({ type: 'favorite', value: null }),
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
      el('h3', {}, 'Notebooks'),
      ...(notebooks.length
        ? notebooks.map(({ name, count }) =>
            navItem({
              label: name,
              count,
              icon: 'notebook',
              active: filter.type === 'notebook' && filter.value === name,
              onSelect: () => this.setFilter({ type: 'notebook', value: name }),
            }),
          )
        : [el('p', { class: 'nav-empty' }, 'Move an entry into a notebook to start one.')]),
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
      el('h3', {}, 'Mood'),
      ...(moods.length
        ? moods.map(({ id, label, count }) =>
            navItem({
              label,
              count,
              icon: 'smile',
              active: filter.type === 'mood' && filter.value === id,
              onSelect: () => this.setFilter({ type: 'mood', value: id }),
            }),
          )
        : [el('p', { class: 'nav-empty' }, 'Moods you pick show up here.')]),
      el('h3', {}, 'Weather'),
      ...(weathers.length
        ? weathers.map(({ id, label, count }) =>
            navItem({
              label,
              count,
              icon: 'cloud',
              active: filter.type === 'weather' && filter.value === id,
              onSelect: () => this.setFilter({ type: 'weather', value: id }),
            }),
          )
        : [el('p', { class: 'nav-empty' }, 'Weather you pick show up here.')]),
    );
  }

  renderCrumb() {
    const { filter } = this.state;
    if (filter.type === 'kind') this.crumb.textContent = kindLabel(filter.value);
    else if (filter.type === 'tag') this.crumb.textContent = `#${filter.value}`;
    else if (filter.type === 'mood') this.crumb.textContent = labelFor(MOODS, filter.value);
    else if (filter.type === 'weather') this.crumb.textContent = labelFor(WEATHERS, filter.value);
    else if (filter.type === 'notebook') this.crumb.textContent = filter.value;
    else if (filter.type === 'pinned') this.crumb.textContent = 'Pinned';
    else if (filter.type === 'favorite') this.crumb.textContent = 'Favorites';
    else this.crumb.textContent = 'All entries';
  }

  renderStreak() {
    const streak = dayStreaks(this.entries);
    this.streak.replaceChildren(iconNode('flame'), el('span', {}, streakText(streak)));
    this.streak.dataset.active = String(streak.current > 0);
    this.streak.title = `Days with at least one entry in a row. Longest: ${streak.longest} ${streak.longest === 1 ? 'day' : 'days'}.`;
  }

  renderMain(matches) {
    const { view } = this.state;
    this.main.dataset.view = view;
    let content;
    if (view === 'calendar') content = this.calendar(matches);
    else if (view === 'moods') content = this.moodView();
    else if (!this.entries.length) content = this.emptyLibrary();
    else if (!matches.length) content = this.emptyMatches();
    else if (view === 'tiles') content = this.tileGrid(matches);
    else content = this.table(matches);
    // The strip is for the whole journal, so it hides while a filter or search narrows the list.
    const strip = view !== 'calendar' && this.isUnfiltered() ? this.stripSection() : null;
    this.main.replaceChildren(...[strip, content].filter(Boolean));
    this.drawMoodChart();
    this.markSelection();
  }

  /** The chart goes in after the view is built, since it is markup rather than DOM nodes. */
  drawMoodChart() {
    const card = this.main.querySelector('.mood-chart-card');
    if (!card) return;
    const today = localISODate();
    const { moodRange } = this.state;
    const days = moodRange === 'all' ? this.daysSinceFirstEntry(today) : moodRange;
    card.innerHTML = this.moodChartSvg(this.chartPoints(today, days));
  }

  /** One point per day for short ranges, one per week for long ones. */
  chartPoints(today, days) {
    const daily = moodSeries(this.entries, today, days);
    return days > LONG_RANGE_DAYS ? bucketSeries(daily, 7) : daily;
  }

  isUnfiltered() {
    return this.state.filter.type === 'all' && !this.state.query.trim();
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
    const selected = this.selectedEntry();
    this.openBtn.disabled = !hasSelection;
    this.deleteBtn.disabled = !hasSelection;
    this.pinBtn.disabled = !hasSelection;
    this.favBtn.disabled = !hasSelection;
    this.moveBtn.disabled = !hasSelection;
    setLabel(this.pinBtn, selected?.pinned ? 'Unpin' : 'Pin');
    setLabel(this.favBtn, selected?.favorite ? 'Unfavorite' : 'Favorite');
    this.pinBtn.setAttribute('aria-pressed', String(Boolean(selected?.pinned)));
    this.favBtn.setAttribute('aria-pressed', String(Boolean(selected?.favorite)));
    this.detailsBtn.setAttribute('aria-pressed', String(this.state.view === 'details'));
    this.tilesBtn.setAttribute('aria-pressed', String(this.state.view === 'tiles'));
    this.calendarBtn.setAttribute('aria-pressed', String(this.state.view === 'calendar'));
    this.moodsBtn.setAttribute('aria-pressed', String(this.state.view === 'moods'));
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
          el(
            'span',
            { class: 'cell-title' },
            iconNode('page'),
            el('span', { class: 'cell-name' }, marked(displayTitle(entry), this.terms)),
            flagIcons(entry),
          ),
          this.terms.length ? el('span', { class: 'cell-snippet' }, marked(snippetOf(entry, this.terms), this.terms)) : null,
        ),
        el('td', { class: 'col-date' }, formatShortDate(entry.date)),
        el('td', { class: 'col-kind' }, kindLabel(entry.kind)),
        el('td', { class: 'col-notebook' }, entry.notebook ?? ''),
        el('td', { class: 'col-tags' }, entry.tags.join(', ')),
        el('td', { class: 'col-feel' }, feelText(entry)),
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
    const text = this.terms.length ? snippetOf(entry, this.terms, 240) : excerptOf(entry, 240);
    const hasInk = entry.ink.ops.length > 0;
    const fallback = text ? marked(text, this.terms) : hasInk ? '' : 'Blank page';
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
        el(
          'span',
          { class: 'tile-title' },
          el('span', { class: 'tile-name' }, marked(displayTitle(entry), this.terms)),
          flagIcons(entry),
        ),
        el('span', { class: 'tile-sub' }, `${formatShortDate(entry.date)} · ${kindLabel(entry.kind)}`),
      ),
    );
  }

  // ---------- calendar ----------

  /**
   * A month grid with a count and the day's mood on every day that has
   * entries, and the selected day's entries listed underneath. Entries are
   * counted from `matches`, so the search and nav filters apply here too.
   */
  calendar(matches) {
    const { month, day } = this.state;
    const today = localISODate();
    const grid = monthGrid(month.year, month.month);
    const summary = summarizeDays(matches);

    const head = el(
      'div',
      { class: 'cal-head' },
      el(
        'button',
        { class: 'cmd-btn cal-step', type: 'button', title: 'Previous month', 'aria-label': 'Previous month', onClick: () => this.shiftMonth(-1) },
        '‹',
      ),
      el('h2', { class: 'cal-title', 'aria-live': 'polite' }, monthTitle(month)),
      el(
        'button',
        { class: 'cmd-btn cal-step', type: 'button', title: 'Next month', 'aria-label': 'Next month', onClick: () => this.shiftMonth(1) },
        '›',
      ),
      el('span', { class: 'cmd-spacer' }),
      el('button', { class: 'cmd-btn', type: 'button', onClick: () => this.goToday() }, 'Today'),
    );

    const cells = grid.weeks.flat().map((cell) => this.dayCell(cell, summary[cell.date], today));

    return el(
      'div',
      { class: 'cal' },
      head,
      el(
        'div',
        { class: 'cal-grid' },
        WEEKDAYS.map((name) => el('div', { class: 'cal-dow', 'aria-hidden': 'true' }, name)),
        el('div', { class: 'cal-days', role: 'group', 'aria-label': monthTitle(month) }, cells),
      ),
      this.dayPanel(matches, day),
    );
  }

  dayCell(cell, info, today) {
    const count = info?.count ?? 0;
    const selected = cell.date === this.state.day;
    const classes = ['cal-day'];
    if (!cell.inMonth) classes.push('is-outside');
    if (cell.date === today) classes.push('is-today');
    if (count) classes.push('has-entries');
    if (selected) classes.push('is-selected');
    const label = `${formatLongDate(cell.date)}${count ? `, ${count} ${count === 1 ? 'entry' : 'entries'}` : ''}`;
    return el(
      'button',
      {
        type: 'button',
        class: classes.join(' '),
        'data-date': cell.date,
        'aria-label': label,
        'aria-pressed': String(selected),
        'aria-current': cell.date === today ? 'date' : null,
        tabIndex: selected ? 0 : -1,
        onClick: () => this.selectDay(cell.date),
        onKeydown: (event) => this.onDayKeydown(event),
      },
      el('span', { class: 'cal-num' }, String(cell.day)),
      count ? el('span', { class: 'cal-count' }, String(count)) : null,
      info?.mood ? el('span', { class: 'cal-mood' }, labelFor(MOODS, info.mood)) : null,
    );
  }

  dayPanel(matches, date) {
    const entries = matches.filter((entry) => entry.date === date);
    const list = entries.length
      ? el(
          'ul',
          { class: 'cal-list' },
          entries.map((entry) =>
            el(
              'li',
              {},
              el(
                'button',
                { class: 'cal-entry', type: 'button', onClick: () => this.open(entry.id) },
                iconNode('page'),
                el('span', { class: 'cal-entry-title' }, marked(displayTitle(entry), this.terms), flagIcons(entry)),
                el('span', { class: 'cal-entry-sub' }, [kindLabel(entry.kind), feelText(entry)].filter(Boolean).join(' · ')),
              ),
            ),
          ),
        )
      : el('p', { class: 'cal-empty' }, this.entries.length ? 'Nothing written on this day.' : 'Nothing written yet.');

    return el(
      'section',
      { class: 'cal-panel', 'aria-label': `Entries for ${formatLongDate(date)}` },
      el(
        'div',
        { class: 'cal-panel-head' },
        el('h3', {}, formatLongDate(date)),
        el(
          'button',
          { class: 'cmd-btn', type: 'button', onClick: () => this.callbacks.onNew?.({ date }) },
          iconNode('plus'),
          el('span', { class: 'cmd-label' }, 'New entry for this day'),
        ),
      ),
      list,
    );
  }

  // ---------- strip: today's prompt and On this day ----------

  stripSection() {
    const today = localISODate();
    const { showPrompts, showOnThisDay } = this.stripOptions;
    const memories = showOnThisDay ? onThisDay(this.entries, today) : [];
    const cards = [showPrompts ? this.promptCard(today) : null, memories.length ? this.onThisDayCard(memories) : null].filter(Boolean);
    if (!cards.length) return null;
    return el('section', { class: 'home-strip', 'aria-label': 'Today in Quire' }, cards);
  }

  promptCard(today) {
    const prompt = promptFor(today, this.state.promptSkip);
    const hasJournal = this.entries.some((entry) => entry.kind === 'journal' && entry.date === today);
    return el(
      'section',
      { class: 'strip-card prompt-card', 'aria-label': 'Writing prompt' },
      el(
        'div',
        { class: 'strip-head' },
        iconNode('pencil'),
        el('h3', {}, `Writing prompt · ${formatShortDate(today)}`),
        el(
          'button',
          {
            class: 'cmd-btn cmd-icon-only strip-dismiss',
            type: 'button',
            title: 'Hide writing prompts (View menu brings them back)',
            'aria-label': 'Hide writing prompts',
            onClick: () => this.callbacks.onHidePrompts?.(),
          },
          iconNode('close'),
        ),
      ),
      el('p', { class: 'prompt-text' }, prompt),
      el(
        'div',
        { class: 'strip-actions' },
        el(
          'button',
          { class: 'cmd-btn cmd-primary', type: 'button', onClick: () => this.callbacks.onWritePrompt?.(prompt) },
          iconNode('plus'),
          el('span', { class: 'cmd-label' }, hasJournal ? "Open today's journal" : 'Write to this'),
        ),
        el(
          'button',
          {
            class: 'cmd-btn',
            type: 'button',
            onClick: () => {
              this.state.promptSkip += 1;
              this.render();
            },
          },
          iconNode('shuffle'),
          el('span', { class: 'cmd-label' }, 'Another'),
        ),
      ),
    );
  }

  onThisDayCard(groups) {
    return el(
      'section',
      { class: 'strip-card otd-card', 'aria-label': 'On this day in earlier years' },
      el('div', { class: 'strip-head' }, iconNode('calendar'), el('h3', {}, 'On this day')),
      groups.map((group) =>
        el(
          'div',
          { class: 'otd-group' },
          el('h4', { class: 'otd-when' }, `${group.year} · ${yearsAgoText(group.yearsAgo)}`),
          el(
            'ul',
            { class: 'otd-list' },
            group.entries.map((entry) =>
              el(
                'li',
                {},
                el(
                  'button',
                  { class: 'otd-entry', type: 'button', onClick: () => this.open(entry.id) },
                  iconNode('page'),
                  el('span', { class: 'otd-title' }, displayTitle(entry)),
                  el('span', { class: 'otd-sub' }, [kindLabel(entry.kind), feelText(entry)].filter(Boolean).join(' · ')),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- mood chart ----------

  /** Days from the first entry to today, so "All time" starts on the first day anyone wrote. */
  daysSinceFirstEntry(today) {
    if (!this.entries.length) return 30;
    const first = this.entries.reduce((min, entry) => (entry.date < min ? entry.date : min), this.entries[0].date);
    return Math.max(1, daysBetween(first, today) + 1);
  }

  moodView() {
    const today = localISODate();
    const { moodRange } = this.state;
    const days = moodRange === 'all' ? this.daysSinceFirstEntry(today) : moodRange;
    const series = moodSeries(this.entries, today, days);
    const logged = series.filter((point) => point.score !== null).length;
    const average = moodAverage(series);
    const counts = moodCounts(series);
    const top = counts.reduce((best, item) => (item.count > best.count ? item : best), counts[0]);
    const averageMood = moodForScore(average);

    return el(
      'div',
      { class: 'mood-view' },
      el(
        'div',
        { class: 'mood-range' },
        el('h2', { class: 'mood-title' }, 'Mood'),
        el(
          'div',
          { class: 'view-toggle', role: 'group', 'aria-label': 'Mood range' },
          MOOD_RANGES.map((range) =>
            el(
              'button',
              {
                class: 'cmd-btn range-btn',
                type: 'button',
                'aria-pressed': String(moodRange === range.id),
                onClick: () => this.setMoodRange(range.id),
              },
              range.label,
            ),
          ),
        ),
      ),
      el(
        'div',
        { class: 'mood-stats' },
        statTile('Days with a mood', `${logged} of ${days}`),
        statTile('Average', averageMood ? `${averageMood.label} · ${average.toFixed(1)} of 5` : 'Nothing yet'),
        statTile('Most common', top.count ? top.label : '—'),
      ),
      logged
        ? el('div', { class: 'mood-chart-card' })
        : el('p', { class: 'mood-empty' }, 'Pick a mood in the entry bar and that day shows up here.'),
      logged ? el('div', { class: 'mood-bars' }, counts.map((item) => this.moodBar(item, logged))) : null,
    );
  }

  moodBar(item, logged) {
    const share = logged ? Math.round((item.count / logged) * 100) : 0;
    return el(
      'div',
      { class: 'mood-bar-row' },
      el('span', { class: 'mood-bar-label' }, item.label),
      el('div', { class: 'mood-bar-track' }, el('div', { class: 'mood-bar-fill', 'data-mood': item.id, style: `width: ${share}%` })),
      el('span', { class: 'mood-bar-count' }, `${item.count} · ${share}%`),
    );
  }

  /** The line chart as SVG. Only numbers, fixed mood labels and formatted dates go into the markup. */
  moodChartSvg(series) {
    const { width: W, height: H, padLeft, padRight, padTop, padBottom } = CHART;
    const innerW = W - padLeft - padRight;
    const innerH = H - padTop - padBottom;
    const n = series.length;
    const top = MOODS.length;
    const x = (i) => padLeft + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (score) => padTop + ((top - score) / (top - 1)) * innerH;

    const grid = MOODS.map((mood, index) => {
      const gy = y(top - index).toFixed(1);
      return `<line class="gridline" x1="${padLeft}" x2="${W - padRight}" y1="${gy}" y2="${gy}"/>`
        + `<text class="axis-label" x="${padLeft - 10}" y="${gy}" dy="0.35em" text-anchor="end">${mood.label}</text>`;
    }).join('');

    // The line breaks at days with no mood, so a gap reads as a gap.
    let path = '';
    let pen = false;
    series.forEach((point, i) => {
      if (point.score === null) {
        pen = false;
        return;
      }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(point.score).toFixed(1)} `;
      pen = true;
    });

    const radius = n > 180 ? 1.6 : n > 60 ? 2.8 : 4.5;
    const dots = series
      .map((point, i) =>
        point.score === null
          ? ''
          : `<circle class="mood-dot" data-mood="${point.mood}" cx="${x(i).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="${radius}">`
            + `<title>${dotTitle(point)}</title></circle>`,
      )
      .join('');

    const mid = Math.floor((n - 1) / 2);
    const xLabels = [0, mid, n - 1]
      .filter((i, pos, all) => all.indexOf(i) === pos)
      .map((i) => {
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        return `<text class="axis-label" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${formatShortDate(series[i].date)}</text>`;
      })
      .join('');

    const svg = `<svg class="mood-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood for the last ${n} days">`
      + `${grid}<path class="mood-trend" d="${path.trim()}"/>${dots}${xLabels}</svg>`;
    return svg;
  }

  setMoodRange(range) {
    this.state.moodRange = range;
    this.render();
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

  shiftMonth(delta) {
    const { year, month } = this.state.month;
    const next = new Date(Date.UTC(year, month + delta, 1));
    this.state.month = { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    this.render();
  }

  goToday() {
    const today = localISODate();
    this.state.day = today;
    this.state.month = monthOf(today);
    this.render();
  }

  /** Selects a day, moves the calendar to its month, and optionally moves focus onto it. */
  selectDay(date, { focus = false } = {}) {
    this.state.day = date;
    this.state.month = monthOf(date);
    this.render();
    if (focus) this.main.querySelector(`[data-date="${date}"]`)?.focus();
  }

  onDayKeydown(event) {
    const step = DAY_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    this.selectDay(shiftISODate(this.state.day, step), { focus: true });
  }

  select(id) {
    this.state.selectedId = id;
    this.markSelection({ focus: true });
  }

  selectedEntry() {
    return this.entries.find((entry) => entry.id === this.state.selectedId) ?? null;
  }

  /** Changes pin, favorite, or notebook for one entry. The app saves it and reloads the list. */
  patch(id, fields) {
    this.callbacks.onPatch?.(id, fields);
  }

  togglePinned() {
    const entry = this.selectedEntry();
    if (entry) this.patch(entry.id, { pinned: !entry.pinned });
  }

  toggleFavorite() {
    const entry = this.selectedEntry();
    if (entry) this.patch(entry.id, { favorite: !entry.favorite });
  }

  moveSelected() {
    const entry = this.selectedEntry();
    if (!entry) return;
    notebookDialog({
      entryName: displayTitle(entry),
      notebooks: countByNotebook(this.entries).map((notebook) => notebook.name),
      current: entry.notebook,
      onSave: (notebook) => {
        if (notebook !== entry.notebook) this.patch(entry.id, { notebook });
      },
    });
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
