/**
 * End-to-end checks for the main flows in a real Chromium. Run with `npm run test:e2e`.
 *
 * Each test gets a fresh browser context, so IndexedDB and localStorage start empty.
 * The suite starts its own static server on a free port, so a dev server on 4173
 * does not interfere. Set QUIRE_CHROMIUM to use a browser binary that is already
 * installed; otherwise Playwright's bundled Chromium is used.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}/`;

let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running at')) resolve();
    });
    server.once('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
  browser = await chromium.launch({ executablePath: process.env.QUIRE_CHROMIUM || undefined });
});

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit').catch(() => {});
  }
});

/** A fresh page with error collection. Call `expectNoErrors()` at the end of the test. */
async function freshPage(options = { viewport: { width: 1280, height: 800 } }) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.errors = errors;
  page.close = () => context.close();
  return page;
}

function expectNoErrors(page) {
  assert.deepEqual(page.errors, [], 'the page logged errors');
}

/** Opens Quire and waits for the splash to clear. */
async function openQuire(page, path = '') {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
}

async function newEntry(page) {
  await page.getByRole('button', { name: 'New entry', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
}

/** Renames the open entry through the title bar. */
async function renameEntry(page, title) {
  await page.click('#window-title');
  await page.fill('#entry-title', title);
  await page.keyboard.press('Enter');
}

/** Waits until the save indicator says the latest edit is stored. */
async function waitForSaved(page) {
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#save-status')?.textContent ?? ''), null, { timeout: 8000 });
}

async function inkHasPixels(page) {
  return page.$eval('#ink', (canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
    return false;
  });
}

async function drawStroke(page) {
  const box = await page.locator('#ink').boundingBox();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 200, { steps: 12 });
  await page.mouse.up();
}

test('first run shows the sample entry and the dashboard without errors', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.waitForSelector('.dash-hero');
    assert.match(await page.textContent('.dash-hero'), /Welcome to Quire/);
    assert.equal(await page.getAttribute('.app', 'data-view'), 'home');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a new entry keeps its title and text after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Morning pages');
    await page.click('#editor');
    await page.keyboard.type('First line of the day');
    await waitForSaved(page);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    assert.equal(await page.getAttribute('.app', 'data-view'), 'editor');
    assert.equal((await page.textContent('#window-title')).trim(), 'Morning pages');
    assert.match(await page.innerText('#editor'), /First line of the day/);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Markdown headings render in the live preview', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('#editor');
    await page.keyboard.type('# Big heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('plain text below');
    await page.waitForSelector('#editor .ln-h1');
    // Markers on inactive lines are hidden by CSS, so check the visible text.
    assert.equal((await page.innerText('#editor .ln-h1')).trim(), 'Big heading');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Source mode shows the Markdown markers and the status bar says so', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('#editor');
    await page.keyboard.type('# Source check');
    await page.keyboard.press('Enter');
    await menuPick(page, 'View', 'Source mode', 'Page');
    assert.equal((await page.textContent('#status-mode')).trim(), 'Source');
    assert.match(await page.innerText('#editor'), /# Source check/);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a checklist box checks off on click and stays checked after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('#editor');
    await page.keyboard.type('- [ ] buy milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('walk the dog');
    await page.waitForSelector('#editor .lv-check');
    await page.click('#editor .lv-check');
    await page.waitForSelector('#editor .ln-task-done');
    await waitForSaved(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await page.waitForSelector('#editor .ln-task-done');
    assert.equal(await page.locator('#editor .ln-task-done').count(), 1);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('undo removes a pencil stroke and redo brings it back', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('button[aria-label="Pencil"]');
    await drawStroke(page);
    assert.equal(await inkHasPixels(page), true, 'the stroke paints the drawing layer');
    await page.keyboard.press('Control+z');
    assert.equal(await inkHasPixels(page), false, 'undo clears the stroke');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await inkHasPixels(page), true, 'redo restores the stroke');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a drawing stays on the entry after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('button[aria-label="Pencil"]');
    await drawStroke(page);
    await waitForSaved(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    assert.equal(await inkHasPixels(page), true);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the calendar starts an entry on the selected day', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.getByRole('button', { name: 'Calendar view', exact: true }).click();
    await page.locator('.cal-days button.is-today, .cal-days button[aria-label*="Today"]').first().click();
    await page.getByRole('button', { name: 'New entry for this day' }).click();
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    const todayIso = await page.evaluate(() => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
    assert.equal(await page.inputValue('#entry-date'), todayIso);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Save version now adds a version that Version history lists', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('#editor');
    await page.keyboard.type('Version one text');
    await waitForSaved(page);
    await menuPick(page, 'File', 'Save version now', 'This entry');
    await menuPick(page, 'File', 'Version history', 'This entry');
    await page.waitForSelector('.version-list li');
    const count = await page.locator('.version-list li:not(.version-empty)').count();
    assert.ok(count >= 1, 'at least one saved version is listed');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Year in pixels shows one square per day and saves a poster PNG', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Mood day');
    await page.click('#editor');
    await page.keyboard.type('A good one.');
    await waitForSaved(page);
    await page.keyboard.press('Control+Shift+h');
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'home');
    await page.getByRole('button', { name: 'Year in pixels view', exact: true }).click();
    await page.waitForSelector('.year-grid');
    const squares = await page.locator('.year-cell:not(.year-none)').count();
    // A calendar year has 365 days, or 366 in a leap year. The legend adds seven swatches.
    assert.ok([365, 366].includes(squares - 7), `one square per day, got ${squares} including the legend`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save poster PNG', exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /-in-pixels\.png$/);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Postcard dialog previews a template and saves it as a PNG', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Postcard me');
    await page.click('#editor');
    await page.keyboard.type('Wish you were here.');
    await waitForSaved(page);
    await menuPick(page, 'File', 'Postcard', 'Export and print');
    await page.waitForSelector('.postcard-preview');
    await page.click('.postcard-thumb[data-template="airmail"]');
    assert.equal(await page.getAttribute('.postcard-thumb[data-template="airmail"]', 'aria-pressed'), 'true');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save PNG', exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /-postcard\.png$/);
    await page.click('.postcard-dialog button[value="close"]');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Back up all entries downloads a JSON file that includes the entry', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Backup me');
    await waitForSaved(page);
    await page.click('.menu-title:has-text("File")');
    await page.click('.menu-panel:not(.menu-sub) .menu-item.has-sub:has-text("Backup and restore")');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.menu-sub .menu-item:has-text("Back up all entries")'),
    ]);
    assert.match(download.suggestedFilename(), /\.json$/);
    const path = await download.path();
    const { readFile } = await import('node:fs/promises');
    const backup = JSON.parse(await readFile(path, 'utf8'));
    const titles = (backup.entries ?? []).map((entry) => entry.title);
    assert.ok(titles.includes('Backup me'), `backup lists the entry, got ${JSON.stringify(titles)}`);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the home view and an open entry fit a phone width without sideways scrolling', async () => {
  const page = await freshPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await openQuire(page);
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(await scrollWidth(), 390, 'home fits the phone width');
    await newEntry(page);
    assert.equal(await scrollWidth(), 390, 'the editor fits the phone width');
    // The last menu titles sit near the right edge, so their drop-downs must be pulled back on screen.
    for (const title of ['View', 'Help']) {
      await page.click(`.menu-title:has-text("${title}")`);
      await page.waitForSelector('.menu-panel');
      const right = await page.$eval('.menu-panel', (panel) => panel.getBoundingClientRect().right);
      assert.ok(right <= 390, `the ${title} menu ends inside the screen (right edge ${right})`);
      assert.equal(await scrollWidth(), 390, `opening ${title} does not widen the page`);
      await page.keyboard.press('Escape');
    }
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the chosen skin is kept after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.click('.menu-title:has-text("Skin")');
    await page.click('.menu-item:has-text("XP Luna")');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'luna');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

// ---------- second pass: notebooks, command palette, focus mode, sidebar gadgets ----------

/** Goes back to the entries list from the editor, through the brand link. */
async function goHome(page) {
  await page.click('.brand');
  await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'home');
}

/** Opens a menu, then clicks an item. When the item sits in a flyout, the flyout is opened first. */
async function menuPick(page, menu, item, flyout = null) {
  await page.click(`.menu-title:has-text("${menu}")`);
  if (flyout) await page.click(`.menu-panel:not(.menu-sub) .menu-item.has-sub:has-text("${flyout}")`);
  await page.click(`${flyout ? ".menu-sub" : ".menu-panel"} .menu-item:has-text("${item}")`);
}

/** Moves the open entry into a notebook through File > Move to notebook. */
async function moveOpenEntryTo(page, { existing = null, typed = null }) {
  await menuPick(page, 'File', 'Move to notebook', 'This entry');
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  if (typed !== null) {
    await dialog.locator('select').selectOption('__new__');
    await dialog.locator('input').fill(typed);
  } else {
    await dialog.locator('select').selectOption(existing);
  }
  await dialog.locator('button[type="submit"]').click();
  await page.waitForSelector('dialog[open]', { state: 'detached' });
}

/** The sidebar row for a notebook, found by its name. */
function notebookRow(page, name) {
  return page.locator('.home-nav .nav-item', { hasText: name });
}

test('a notebook typed in the Move dialog lists once, even when the case differs', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Quarterly plan');
    await waitForSaved(page);
    await moveOpenEntryTo(page, { typed: 'Work' });
    await goHome(page);
    assert.equal(await notebookRow(page, 'Work').count(), 1);

    await newEntry(page);
    await renameEntry(page, 'Standup notes');
    await waitForSaved(page);
    await moveOpenEntryTo(page, { typed: 'work' });
    await goHome(page);
    assert.equal(await page.locator('.home-nav .nav-item', { hasText: /work/i }).count(), 1, 'one notebook, not two');
    assert.match(await notebookRow(page, 'Work').innerText(), /2/, 'the notebook holds both entries');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the command palette opens an entry by its title', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Harbor notes');
    await waitForSaved(page);
    await goHome(page);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-option');
    await page.keyboard.type('harbor');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    assert.equal((await page.textContent('#window-title')).trim(), 'Harbor notes');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the command palette runs a command on Enter, and Escape closes it without running anything', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    const before = await page.locator('.home-nav .nav-item', { hasText: /^All entries/ }).innerText();
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-option');
    await page.keyboard.type('new entry');
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('.app', 'data-view'), 'home', 'Escape leaves the list alone');
    assert.equal(await page.locator('dialog[open]').count(), 0);

    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-option');
    await page.keyboard.type('new entry');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    assert.notEqual(await page.locator('.home-nav .nav-item', { hasText: /^All entries/ }).innerText(), before);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the command palette says when nothing matches', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-option');
    await page.keyboard.type('zzqxvj');
    assert.equal(await page.locator('.palette-option').count(), 0);
    assert.equal(await page.locator('.palette-empty').isHidden(), false);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('focus mode hides the chrome, reaches the word goal, and exits on Escape', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('quire:prefs') ?? '{}');
      localStorage.setItem('quire:prefs', JSON.stringify({ ...prefs, wordGoal: 3 }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await newEntry(page);
    await page.keyboard.press('F11');
    assert.equal(await page.getAttribute('html', 'data-focus'), 'on');
    assert.equal(await page.isVisible('#menubar'), false, 'the menus are hidden');

    await page.click('#editor');
    await page.keyboard.type('one two three');
    await page.waitForFunction(() => /Goal reached/.test(document.querySelector('#focus-count')?.textContent ?? ''));

    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('html', 'data-focus'), 'off');
    assert.equal(await page.isVisible('#menubar'), true, 'the menus come back');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a sticky note keeps its text after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.getByRole('button', { name: 'Dashboard view', exact: true }).click();
    await page.fill('textarea[aria-label="Sticky note"]', 'Pick up the dry cleaning');
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await page.getByRole('button', { name: 'Dashboard view', exact: true }).click();
    assert.equal(await page.inputValue('textarea[aria-label="Sticky note"]'), 'Pick up the dry cleaning');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a removed sidebar gadget stays off after a reload and comes back from Add gadget', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.getByRole('button', { name: 'Dashboard view', exact: true }).click();
    await page.click('button[aria-label="Remove Sticky note"]');
    assert.equal(await page.locator('[data-gadget-id="note"]').count(), 0);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await page.getByRole('button', { name: 'Dashboard view', exact: true }).click();
    assert.equal(await page.locator('[data-gadget-id="note"]').count(), 0, 'still removed after a reload');

    await page.getByRole('button', { name: /Add gadget/ }).first().click();
    await page.click('.gadget-add-item:has-text("Sticky note")');
    assert.equal(await page.locator('[data-gadget-id="note"]').count(), 1, 'back on the sidebar');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('moving the last entry out of a notebook returns the list to All entries', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Lone entry');
    await waitForSaved(page);
    await moveOpenEntryTo(page, { typed: 'Lab' });
    await goHome(page);
    await notebookRow(page, 'Lab').click();
    assert.equal((await page.textContent('.home-crumb-current')).trim(), 'Lab');

    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette-option');
    await page.keyboard.type('lone entry');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    await moveOpenEntryTo(page, { existing: '' });
    await goHome(page);

    assert.equal((await page.textContent('.home-crumb-current')).trim(), 'All entries', 'the filter does not stay on an empty notebook');
    assert.equal(await notebookRow(page, 'Lab').count(), 0);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});
