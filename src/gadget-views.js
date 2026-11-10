/**
 * DOM for the dashboard's sidebar gadgets: the sidebar frame with its Add menu,
 * each gadget's title bar and body, pointer and keyboard reordering, and the
 * clock's ticker. The numbers come from gadgets.js. HomeView calls buildSidebar
 * and reports what the reader picks through the callbacks in `on`.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { displayTitle, formatLongDate, labelFor, MOODS } from './model.js';
import { monthGrid, monthOf, summarizeDays } from './journal.js';
import { NORM_WIDTH, paintInk } from './drawing.js';
import {
  GADGETS,
  clockAngles,
  inkEntries,
  missingGadgets,
  moodGauge,
  moveGadget,
  streakGoal,
  wordOfTheDay,
} from './gadgets.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SLIDE_MS = 6000;
const SLIDE_PX = 240; // canvas width. The page ratio matches the writing page.
const MOOD_COLORS = { rough: '#b8483f', low: '#d9823a', okay: '#d8b640', good: '#8cbb4f', great: '#3f9c63' };
const DAY_NAMES = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }),
);

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
}

function iconNode(name) {
  const span = el('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = icon(name);
  return span;
}

// ---------- clock ----------

/** The clock face: a rim, twelve ink dots (larger at the hours), and three hands that paintClock moves. */
function clockBody() {
  const marks = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const major = i % 3 === 0;
    return svgEl('circle', {
      cx: (50 + Math.sin(angle) * 38).toFixed(2),
      cy: (50 - Math.cos(angle) * 38).toFixed(2),
      r: major ? 3 : 1.3,
      class: major ? 'clock-mark is-major' : 'clock-mark',
    });
  });
  const face = svgEl(
    'svg',
    { viewBox: '0 0 100 100', class: 'clock-face', role: 'img', 'aria-label': 'Analog clock' },
    svgEl('circle', { cx: 50, cy: 50, r: 47, class: 'clock-rim' }),
    ...marks,
    svgEl('line', { x1: 50, y1: 55, x2: 50, y2: 27, class: 'clock-hand clock-hour' }),
    svgEl('line', { x1: 50, y1: 58, x2: 50, y2: 18, class: 'clock-hand clock-minute' }),
    svgEl('line', { x1: 50, y1: 64, x2: 50, y2: 13, class: 'clock-hand clock-second' }),
    svgEl('circle', { cx: 50, cy: 50, r: 3.2, class: 'clock-pin' }),
  );
  const node = el('div', { class: 'gadget-clock' }, face, el('p', { class: 'gadget-clock-time' }), el('p', { class: 'gadget-clock-date' }));
  paintClock(node, new Date());
  startClockTicker();
  return node;
}

function paintClock(node, now) {
  const angles = clockAngles(now);
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  for (const [cls, deg] of [['clock-hour', angles.hour], ['clock-minute', angles.minute], ['clock-second', angles.second]]) {
    node.querySelector(`.${cls}`)?.setAttribute('transform', `rotate(${deg.toFixed(2)} 50 50)`);
  }
  node.querySelector('.clock-face')?.setAttribute('aria-label', `Analog clock, ${time}`);
  node.querySelector('.gadget-clock-time').textContent = time;
  node.querySelector('.gadget-clock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

let tickerId = null;

/** One timer moves every clock on the page. It stops itself once no clock is left in the document. */
function startClockTicker() {
  if (tickerId !== null) return;
  tickerId = setInterval(() => {
    const clocks = document.querySelectorAll('.gadget-clock');
    if (!clocks.length) {
      clearInterval(tickerId);
      tickerId = null;
      return;
    }
    const now = new Date();
    for (const clock of clocks) paintClock(clock, now);
  }, 1000);
}

// ---------- calendar ----------

/** A month with entry counts. Paging stays inside the gadget; a day opens on the calendar view. */
function calendarBody(entries, today, onPickDay) {
  let month = monthOf(today);
  const body = el('div', { class: 'gadget-cal' });
  const draw = () => {
    const summary = summarizeDays(entries);
    const grid = monthGrid(month.year, month.month);
    const title = new Date(Date.UTC(month.year, month.month, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    body.replaceChildren(
      el(
        'div',
        { class: 'gadget-cal-head' },
        el('button', { type: 'button', class: 'cmd-btn cal-step', 'aria-label': 'Previous month', onClick: () => step(-1) }, '‹'),
        el('span', { class: 'gadget-cal-title', 'aria-live': 'polite' }, title),
        el('button', { type: 'button', class: 'cmd-btn cal-step', 'aria-label': 'Next month', onClick: () => step(1) }, '›'),
      ),
      el(
        'div',
        { class: 'gadget-cal-grid' },
        DAY_NAMES.map((name) => el('span', { class: 'gadget-cal-dow', 'aria-hidden': 'true' }, name)),
        grid.weeks.flat().map((cell) => {
          const info = summary[cell.date];
          const classes = ['gadget-cal-day'];
          if (!cell.inMonth) classes.push('is-outside');
          if (cell.date === today) classes.push('is-today');
          if (info?.count) classes.push('has-entries');
          const label = `${formatLongDate(cell.date)}${info?.count ? `, ${info.count} ${info.count === 1 ? 'entry' : 'entries'}` : ''}`;
          return el('button', { type: 'button', class: classes.join(' '), title: label, 'aria-label': label, onClick: () => onPickDay(cell.date) }, String(cell.day));
        }),
      ),
    );
  };
  const step = (delta) => {
    const index = month.month + delta;
    month = { year: month.year + Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
    draw();
  };
  draw();
  return body;
}

// ---------- streak ----------

/** Seven cells for a week of days in a row. They fill as the streak grows and stay full once the goal is met. */
function streakBody(streak) {
  const goal = streakGoal(streak);
  const note = goal.met
    ? `Week goal met. Best: ${goal.longest} ${goal.longest === 1 ? 'day' : 'days'}`
    : goal.current
      ? `${goal.goal - goal.current} more ${goal.goal - goal.current === 1 ? 'day' : 'days'} to a week`
      : goal.longest
        ? `Best: ${goal.longest} ${goal.longest === 1 ? 'day' : 'days'}. Write today to begin again`
        : 'Write today to start a streak';
  return el(
    'div',
    { class: 'gadget-streak' },
    el(
      'p',
      { class: 'gadget-big' },
      el('span', { class: 'gadget-big-num' }, String(goal.current)),
      el('span', { class: 'gadget-big-unit' }, goal.current === 1 ? 'day in a row' : 'days in a row'),
    ),
    el(
      'div',
      { class: 'streak-meter', role: 'img', 'aria-label': `${goal.filled} of ${goal.goal} days toward a week` },
      Array.from({ length: goal.goal }, (_, i) => el('span', { class: i < goal.filled ? 'streak-cell is-filled' : 'streak-cell' })),
    ),
    el('p', { class: 'gadget-caption' }, note),
  );
}

// ---------- mood gauge ----------

const POLAR = (angle, radius) => {
  const rad = (angle * Math.PI) / 180;
  return [100 + radius * Math.cos(rad), 100 - radius * Math.sin(rad)];
};

/** A half-dial with five colored bands from Rough (left) to Great (right), and a needle at the average. */
function moodBody(entries, today) {
  const gauge = moodGauge(entries, today);
  const radius = 72;
  const bands = MOODS.slice().reverse().map((mood, i) => {
    // MOODS runs Great to Rough, so reversing puts Rough at the left.
    const from = POLAR(180 - i * 36, radius);
    const to = POLAR(180 - (i + 1) * 36, radius);
    return svgEl('path', {
      d: `M ${from[0].toFixed(2)} ${from[1].toFixed(2)} A ${radius} ${radius} 0 0 1 ${to[0].toFixed(2)} ${to[1].toFixed(2)}`,
      class: 'gauge-band',
      stroke: MOOD_COLORS[mood.id],
    });
  });
  const children = [svgEl('g', {}, ...bands)];
  if (gauge.needle !== null) {
    const tip = POLAR(90 - gauge.needle, 60); // gauge.needle runs -90 (left) to 90 (right)
    children.push(svgEl('line', { x1: 100, y1: 100, x2: tip[0].toFixed(2), y2: tip[1].toFixed(2), class: 'gauge-needle' }));
  }
  children.push(svgEl('circle', { cx: 100, cy: 100, r: 6, class: 'gauge-hub' }));
  const dial = svgEl('svg', { viewBox: '0 0 200 112', class: 'gauge-dial', role: 'img', 'aria-label': gauge.mood ? `Mood gauge: ${labelFor(MOODS, gauge.mood.id)} on average` : 'Mood gauge: no moods yet' }, ...children);
  const caption = gauge.mood
    ? `${labelFor(MOODS, gauge.mood.id)} on average, from ${gauge.logged} ${gauge.logged === 1 ? 'day' : 'days'} in the last 2 weeks`
    : 'Pick a mood on an entry to see the gauge move';
  return el(
    'div',
    { class: 'gadget-mood' },
    dial,
    el('p', { class: 'gadget-big gadget-mood-label' }, gauge.mood ? labelFor(MOODS, gauge.mood.id) : 'No mood yet'),
    el('p', { class: 'gadget-caption' }, caption),
  );
}

// ---------- word of the day ----------

function wordBody(today, onWrite) {
  const { word, meaning } = wordOfTheDay(today);
  return el(
    'div',
    { class: 'gadget-word' },
    el('p', { class: 'gadget-word-term' }, word),
    el('p', { class: 'gadget-caption gadget-word-meaning' }, meaning),
    el(
      'button',
      { type: 'button', class: 'cmd-btn gadget-word-write', onClick: () => onWrite(`${word}: ${meaning}`) },
      iconNode('pencil'),
      el('span', { class: 'cmd-label' }, 'Write with it'),
    ),
  );
}

// ---------- sticky note ----------

/** The text is kept by HomeView between renders, so a re-render never clears what was typed. */
function noteBody(note, onChange) {
  const area = el('textarea', {
    class: 'gadget-note-text',
    rows: 6,
    maxlength: 2000,
    placeholder: 'Jot something down. It stays on this device.',
    'aria-label': 'Sticky note',
    onInput: (event) => onChange(event.target.value),
  });
  area.value = note;
  return el('div', { class: 'gadget-note' }, area);
}

// ---------- drawing slideshow ----------

/** Ink from recent entries, one at a time. Advances every few seconds, pauses under the pointer, and opens the entry on click. */
function slidesBody(entries, onOpen) {
  const pages = inkEntries(entries);
  if (!pages.length) {
    return el('p', { class: 'gadget-caption' }, 'Drawings you make on entries show up here.');
  }
  const canvas = el('canvas', { class: 'gadget-slide-canvas', width: SLIDE_PX, height: Math.round(SLIDE_PX * 1.25), 'aria-hidden': 'true' });
  const caption = el('p', { class: 'gadget-caption gadget-slide-caption' });
  const count = el('span', { class: 'gadget-slide-count', 'aria-live': 'polite' });
  const dots = pages.map((_, i) => el('span', { class: 'gadget-slide-dot', 'aria-hidden': 'true' }));
  let index = 0;
  let paused = false;

  const show = (next) => {
    index = ((next % pages.length) + pages.length) % pages.length;
    const entry = pages[index];
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paintInk(ctx, entry.ink.ops, entry.ink.layers, SLIDE_PX / NORM_WIDTH);
    caption.textContent = `${displayTitle(entry)} · ${formatLongDate(entry.date)}`;
    count.textContent = `${index + 1} / ${pages.length}`;
    dots.forEach((dot, i) => dot.classList.toggle('is-current', i === index));
    openButton.setAttribute('aria-label', `Open ${displayTitle(entry)}`);
  };

  const openButton = el('button', { type: 'button', class: 'gadget-slide-open', title: 'Open this entry', onClick: () => onOpen(pages[index].id) }, canvas);
  const step = (delta) => {
    show(index + delta);
  };
  const root = el(
    'div',
    {
      class: 'gadget-slides',
      onMouseenter: () => {
        paused = true;
      },
      onMouseleave: () => {
        paused = false;
      },
    },
    openButton,
    caption,
    el(
      'div',
      { class: 'gadget-slide-nav' },
      el('button', { type: 'button', class: 'cmd-btn cal-step', 'aria-label': 'Previous drawing', onClick: () => step(-1) }, '‹'),
      count,
      el('span', { class: 'gadget-slide-dots', 'aria-hidden': 'true' }, dots),
      el('button', { type: 'button', class: 'cmd-btn cal-step', 'aria-label': 'Next drawing', onClick: () => step(1) }, '›'),
    ),
  );
  show(0);

  // The timer stops by itself once this gadget has left the page.
  const timer = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      return;
    }
    if (!paused && pages.length > 1) step(1);
  }, SLIDE_MS);
  return root;
}

// ---------- frame and sidebar ----------

const TITLES = Object.fromEntries(GADGETS.map((gadget) => [gadget.id, gadget.label]));

function gadgetBody(id, ctx) {
  const { entries, today, streak, note, on } = ctx;
  switch (id) {
    case 'clock':
      return clockBody();
    case 'calendar':
      return calendarBody(entries, today, on.onPickDay);
    case 'streak':
      return streakBody(streak);
    case 'mood':
      return moodBody(entries, today);
    case 'word':
      return wordBody(today, on.onWriteWord);
    case 'note':
      return noteBody(note, on.onNoteChange);
    case 'slides':
      return slidesBody(entries, on.onOpen);
    default:
      return el('p', { class: 'gadget-caption' }, 'Unknown gadget');
  }
}

/** One gadget: a title bar you can drag (or move with Alt and the arrow keys), a remove button, and the body. */
function gadgetFrame(id, ctx) {
  const label = TITLES[id];
  const head = el(
    'div',
    {
      class: 'gadget-head',
      tabindex: '0',
      title: 'Drag to move. Alt with the up or down arrow also moves it.',
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    },
    el('span', { class: 'gadget-title' }, label),
    el(
      'button',
      {
        type: 'button',
        class: 'gadget-close',
        title: `Remove ${label}`,
        'aria-label': `Remove ${label}`,
        onClick: () => ctx.on.onRemove(id),
      },
      '×',
    ),
  );
  return el('section', { class: 'gadget', 'data-gadget-id': id, 'aria-label': label }, head, el('div', { class: 'gadget-body' }, gadgetBody(id, ctx)));
}

/**
 * Pointer drag to reorder the gadgets. A move of a few pixels starts the drag,
 * the gadget follows the pointer by swapping places, and the new order goes to
 * onReorder on release. The list keeps the pointer captured, so the drag holds
 * even when the gadget is moved in the DOM.
 */
function enableReorder(list, onReorder) {
  let drag = null;
  const orderOf = () => [...list.querySelectorAll(':scope > .gadget')].map((gadget) => gadget.dataset.gadgetId);

  list.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const head = event.target.closest('.gadget-head');
    if (!head) return;
    drag = { gadget: head.parentElement, startY: event.clientY, pointerId: event.pointerId, active: false, before: orderOf() };
  });

  list.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < 5) return;
      drag.active = true;
      drag.gadget.classList.add('is-dragging');
      list.setPointerCapture?.(event.pointerId);
    }
    const others = [...list.querySelectorAll(':scope > .gadget')].filter((gadget) => gadget !== drag.gadget);
    const before = others.find((gadget) => {
      const box = gadget.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (before) {
      if (drag.gadget.nextElementSibling !== before) list.insertBefore(drag.gadget, before);
    } else if (list.lastElementChild !== drag.gadget) {
      list.appendChild(drag.gadget);
    }
  });

  const finish = () => {
    if (!drag) return;
    const { active, before } = drag;
    drag = null;
    if (!active) return;
    list.querySelectorAll('.is-dragging').forEach((gadget) => gadget.classList.remove('is-dragging'));
    const after = orderOf();
    if (after.join() !== before.join()) onReorder(after);
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);

  // Keyboard: Alt with the up or down arrow moves the focused gadget one place.
  list.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const head = event.target.closest('.gadget-head');
    if (!head) return;
    event.preventDefault();
    const id = head.parentElement.dataset.gadgetId;
    const next = moveGadget(orderOf(), id, event.key === 'ArrowUp' ? -1 : 1);
    if (next.join() !== orderOf().join()) onReorder(next, id);
  });
}

/**
 * The whole sidebar: a heading with the Add menu, the gadgets in their saved
 * order, and an empty note when none are showing. `ctx` carries the data the
 * gadgets need; `ctx.on` carries the callbacks.
 */
export function buildSidebar(ctx) {
  const { gadgets, on } = ctx;
  const cards = gadgets.map((id) => gadgetFrame(id, ctx));
  const list = el(
    'div',
    { class: 'gadget-list' },
    cards.length ? cards : el('p', { class: 'gadget-empty' }, 'No gadgets are showing. Use Add gadget to bring one back.'),
  );

  const missing = missingGadgets(gadgets);
  const addMenu = el(
    'div',
    { class: 'gadget-add-menu', hidden: true },
    missing.map((gadget) => el('button', { type: 'button', class: 'gadget-add-item', onClick: () => on.onAdd(gadget.id) }, gadget.label)),
  );
  const toggle = el(
    'button',
    {
      type: 'button',
      class: 'cmd-btn gadget-add-toggle',
      'aria-expanded': 'false',
      disabled: missing.length === 0,
      title: missing.length ? 'Add a gadget to the sidebar' : 'Every gadget is on the sidebar',
      onClick: () => {
        addMenu.hidden = !addMenu.hidden;
        toggle.setAttribute('aria-expanded', String(!addMenu.hidden));
      },
    },
    iconNode('plus'),
    el('span', { class: 'cmd-label' }, 'Add gadget'),
  );

  enableReorder(list, (order, focusId) => on.onReorder(order, focusId));
  return el(
    'aside',
    { class: 'dash-sidebar', 'aria-label': 'Sidebar gadgets' },
    el('div', { class: 'dash-sidebar-head' }, el('h3', {}, 'Gadgets'), toggle),
    addMenu,
    list,
  );
}

