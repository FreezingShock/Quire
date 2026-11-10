import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import {
  buildPrintJob,
  cssString,
  kindById,
  notebooksIn,
  pageSetup,
  printKinds,
  registerPrintKind,
  selectEntries,
  statsFor,
} from '../src/print-docs.js';

const CSS_HREF = 'styles/reader.css';
const inkUrl = () => 'data:image/png;base64,AAAA';

function entry(date, fields = {}) {
  const made = createEntry({ date, title: fields.title ?? `Entry ${date}`, body: fields.body ?? 'Some words here.', ...fields });
  made.createdAt = fields.createdAt ?? `${date}T08:00:00.000Z`;
  made.updatedAt = made.createdAt;
  return made;
}

function withInk(item) {
  item.ink.ops = [{ id: 'op1' }];
  return item;
}

test('letter portrait is 8.5 by 11 inches in CSS pixels, and landscape swaps the sides', () => {
  const portrait = pageSetup({ paper: 'letter', orientation: 'portrait', margin: 'normal' });
  assert.ok(Math.abs(portrait.widthPx - 816) < 1);
  assert.ok(Math.abs(portrait.heightPx - 1056) < 1);
  const landscape = pageSetup({ paper: 'letter', orientation: 'landscape', margin: 'normal' });
  assert.ok(Math.abs(landscape.widthPx - 1056) < 1);
  assert.ok(Math.abs(landscape.heightPx - 816) < 1);
  assert.ok(portrait.contentWidth < portrait.widthPx);
  assert.equal(portrait.marginMm, 16);
});

test('wider margins leave less printable width', () => {
  const narrow = pageSetup({ paper: 'a4', orientation: 'portrait', margin: 'narrow' });
  const wide = pageSetup({ paper: 'a4', orientation: 'portrait', margin: 'wide' });
  assert.ok(narrow.contentWidth > wide.contentWidth);
});

test('cssString makes a safe literal for page header text', () => {
  assert.equal(cssString('Plain'), '"Plain"');
  assert.equal(cssString('say "hi"'), '"say \\22 hi\\22 "');
  assert.ok(!cssString('</style><script>').includes('<'));
  assert.equal(cssString('line one\nline two'), '"line one line two"');
});

test('selectEntries drops the sample and applies notebook and inclusive date limits', () => {
  const sample = entry('2026-01-05', { sample: true });
  const travel = entry('2026-02-01', { notebook: 'Travel' });
  const home = entry('2026-03-01');
  const late = entry('2026-04-10', { notebook: 'Travel' });
  const all = [sample, travel, home, late];

  assert.deepEqual(selectEntries(all).map((e) => e.id), [travel.id, home.id, late.id]);
  assert.deepEqual(selectEntries(all, { notebook: 'Travel' }).map((e) => e.id), [travel.id, late.id]);
  assert.deepEqual(selectEntries(all, { from: '2026-02-01', to: '2026-03-01' }).map((e) => e.id), [travel.id, home.id]);
  assert.deepEqual(selectEntries(all, { notebook: 'Travel', from: '2026-03-01' }).map((e) => e.id), [late.id]);
});

test('notebooksIn lists each name once, sorted, without blanks', () => {
  const list = [entry('2026-01-01', { notebook: 'Work' }), entry('2026-01-02', { notebook: 'Garden' }), entry('2026-01-03', { notebook: 'Work' }), entry('2026-01-04')];
  assert.deepEqual(notebooksIn(list), ['Garden', 'Work']);
});

test('statsFor counts entries, words, streaks and months across the range', () => {
  const days = [
    entry('2026-01-30', { mood: 'great', body: 'one two three' }),
    entry('2026-01-31', { mood: 'good', body: 'four five' }),
    entry('2026-02-01', { body: 'six' }),
    entry('2026-02-04', { body: '' }),
  ];
  const stats = statsFor(days, { today: '2026-02-10' });
  assert.equal(stats.start, '2026-01-30');
  assert.equal(stats.end, '2026-02-04');
  assert.equal(stats.days, 6);
  assert.equal(stats.entryCount, 4);
  assert.equal(stats.wordTotal, 6);
  assert.equal(stats.daysWithEntries, 4);
  assert.equal(stats.streak.longest, 3);
  assert.equal(stats.streak.current, 0);
  assert.equal(stats.months.length, 2);
  assert.equal(stats.plotSize, 1);
  assert.equal(stats.plotted.length, 6);
  const great = stats.counts.find((c) => c.id === 'great');
  assert.equal(great.count, 1);
  // Great (5) and Good (4) average to 4.5, which rounds up to Great.
  assert.equal(stats.average, 4.5);
  assert.equal(stats.averageMood.id, 'great');
});

test('statsFor uses the chosen range, not just the entry dates, and returns null when empty', () => {
  const stats = statsFor([entry('2026-03-02')], { today: '2026-03-10', from: '2026-03-01', to: '2026-03-31' });
  assert.equal(stats.start, '2026-03-01');
  assert.equal(stats.end, '2026-03-31');
  assert.equal(stats.days, 31);
  assert.equal(statsFor([], { today: '2026-03-10' }), null);
  assert.equal(statsFor([entry('2026-03-02')], { from: '2026-04-01', to: '2026-03-01' }), null);
});

test('long ranges plot weekly or monthly averages so the chart stays readable', () => {
  const year = statsFor([entry('2025-01-01'), entry('2025-12-31')], { today: '2026-01-02' });
  assert.equal(year.plotSize, 7);
  assert.ok(year.plotted.length <= 53);
  const twoYears = statsFor([entry('2024-01-01'), entry('2026-01-01')], { today: '2026-01-02' });
  assert.equal(twoYears.plotSize, 30);
  assert.ok(twoYears.plotted.length < 40);
});

test('a log is in date order, newest first when asked, with metadata and drawings', () => {
  const later = withInk(entry('2026-05-02', { title: 'Later', mood: 'good', notebook: 'Work', tags: ['x'] }));
  const earlier = entry('2026-05-01', { title: 'Earlier' });
  const job = buildPrintJob({ kindId: 'log', entries: [later, earlier], options: { ink: true, meta: true }, fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.ok(job.html.indexOf('Earlier') < job.html.indexOf('Later'));
  assert.match(job.html, /Mood: Good/);
  assert.match(job.html, /Notebook: Work/);
  assert.match(job.html, /#x/);
  assert.equal((job.html.match(/class="log-ink"/g) ?? []).length, 1);

  const newest = buildPrintJob({ kindId: 'log', entries: [later, earlier], options: { newest: true }, fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.ok(newest.html.indexOf('Later') < newest.html.indexOf('Earlier'));
});

test('a log can start each entry on a new page and hide drawings', () => {
  const a = withInk(entry('2026-05-01'));
  const b = entry('2026-05-02');
  const job = buildPrintJob({ kindId: 'log', entries: [a, b], options: { ink: false, breaks: true }, fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.equal((job.html.match(/log-entry break/g) ?? []).length, 1);
  assert.equal(job.html.includes('<img class="log-ink"'), false);
});

test('drawings print one per page and say so when there are none', () => {
  const drawn = withInk(entry('2026-05-01'));
  const plain = entry('2026-05-02');
  const job = buildPrintJob({ kindId: 'drawings', entries: [drawn, plain], options: { caption: true }, fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.equal(job.empty, false);
  assert.equal((job.html.match(/class="fit-page/g) ?? []).length, 1);
  const none = buildPrintJob({ kindId: 'drawings', entries: [plain], fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.equal(none.empty, true);
  assert.match(none.html, /None of these entries has a drawing/);
});

test('an empty stats or log job is marked empty', () => {
  for (const kindId of ['log', 'stats']) {
    const job = buildPrintJob({ kindId, entries: [], fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
    assert.equal(job.empty, true);
  }
});

test('the page rule carries the paper, orientation, margins and header', () => {
  const job = buildPrintJob({
    kindId: 'stats',
    entries: [entry('2026-05-01')],
    page: { paper: 'a4', orientation: 'landscape', margin: 'wide', header: 'My "stats"', printDate: true, pageNumbers: true },
    fontStack: 'serif',
    stylesheet: CSS_HREF,
    inkUrl,
    today: '2026-05-03',
  });
  assert.match(job.html, /@page \{ size: A4 landscape; margin: 25mm;/);
  assert.match(job.html, /@top-center \{ content: "My \\22 stats\\22 "/);
  assert.match(job.html, /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\)/);
});

test('header text cannot break out of the style element', () => {
  const job = buildPrintJob({
    kindId: 'stats',
    entries: [entry('2026-05-01')],
    page: { header: '</style><b>x</b>', printDate: false, pageNumbers: false },
    fontStack: 'serif',
    stylesheet: CSS_HREF,
    inkUrl,
    today: '2026-05-03',
  });
  assert.equal(job.html.includes('</style><b>'), false);
});

test('entry text is escaped in the body and the title', () => {
  const sneaky = entry('2026-05-01', { title: 'A <img src=x>', body: 'Hello <script>alert(1)</script>' });
  const job = buildPrintJob({ kindId: 'log', entries: [sneaky], fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.equal(job.html.includes('<script>alert'), false);
  assert.equal(job.html.includes('<img src=x>'), false);
});

test('other modules can add a print kind, and it replaces one with the same id', () => {
  const before = printKinds().length;
  registerPrintKind({
    id: 'test-postcards',
    label: 'Test postcards',
    defaultHeader: '',
    scope: 'entries',
    options: [{ id: 'border', label: 'Border', default: true }],
    build: ({ entries, options }) => ({ body: `<p>${entries.length} cards ${options.border ? 'bordered' : ''}</p>`, title: 'Cards' }),
  });
  assert.equal(printKinds().length, before + 1);
  const job = buildPrintJob({ kindId: 'test-postcards', entries: [entry('2026-05-01')], fontStack: 'serif', stylesheet: CSS_HREF, inkUrl, today: '2026-05-03' });
  assert.match(job.html, /1 cards bordered/);
  registerPrintKind({ id: 'test-postcards', label: 'Replaced', build: () => ({ body: '<p>replaced</p>' }) });
  assert.equal(printKinds().length, before + 1);
  assert.equal(kindById('test-postcards').label, 'Replaced');
  assert.equal(kindById('missing'), null);
});
