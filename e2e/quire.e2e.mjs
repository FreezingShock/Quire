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
    await page.click('.menu-title:has-text("View")');
    await page.click('.menu-item:has-text("Source mode")');
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

/** Pastes a small generated picture into the open entry, the same way a copied picture arrives. */
async function pasteTestPicture(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3b7dd8';
    ctx.fillRect(0, 0, 240, 160);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'blue.png', { type: 'image/png' }));
    document.querySelector('#editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.lv-media img');
}

test('a picture set to wrap sits beside the text that follows it, and can be picked again', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('#editor');
    await page.keyboard.type('Before the picture.');
    await page.keyboard.press('Enter');
    await pasteTestPicture(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Text that should run beside the picture when it wraps.');
    await page.click('.lv-media img');
    await page.click('.media-bar-btn[data-mode="square"]');
    await page.click('.media-bar-btn[data-side="right"]');
    const classes = await page.getAttribute('.lv-media', 'class');
    assert.match(classes, /is-square/);
    assert.match(classes, /is-wrap-right/);
    // The wrapped picture is above the line boxes beside it, so a click on it still selects it.
    const hit = await page.evaluate(() => {
      const box = document.querySelector('.lv-media').getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.lv-media')?.dataset.mediaId ?? null;
    });
    assert.equal(hit, await page.getAttribute('.lv-media', 'data-media-id'));
    await waitForSaved(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor');
    assert.match(await page.getAttribute('.lv-media', 'class'), /is-wrap-right/, 'the placement is saved with the entry');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a stroke that starts in the page margin is kept on a Margins layer', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.click('button[aria-label="Pencil"]');
    const sheet = await page.locator('#sheet').boundingBox();
    const y = sheet.y + 140;
    await page.mouse.move(sheet.x + 24, y);
    await page.mouse.down();
    await page.mouse.move(sheet.x + 44, y + 80, { steps: 10 });
    await page.mouse.up();
    const names = await page.locator('.layer-name').allTextContents();
    assert.equal(names.includes('Margins'), true, 'the margin stroke makes a Margins layer');
    assert.equal(await inkHasPixels(page), true, 'the margin stroke is drawn');
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
    await page.click('.menu-title:has-text("File")');
    await page.click('.menu-item:has-text("Save version now")');
    await page.click('.menu-title:has-text("File")');
    await page.click('.menu-item:has-text("Version history")');
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
    await page.click('.menu-title:has-text("File")');
    await page.click('.menu-item:has-text("Postcard")');
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
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.menu-item:has-text("Back up all entries")'),
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

/** Picks an option from a drop-down by the mouse: open it, then click the option's name. */
async function pickFromDropdown(page, label, option) {
  await page.locator(`.dd-trigger[aria-label="${label}"]`).click();
  // An empty value is the "No notebook" choice, which is named for what it means.
  await page.getByRole('option', { name: option === '' ? 'No notebook' : option, exact: true }).click();
}

/** Moves the open entry into a notebook through File > Move to notebook. */
async function moveOpenEntryTo(page, { existing = null, typed = null }) {
  await page.click('.menu-title:has-text("File")');
  await page.click('.menu-item:has-text("Move to notebook")');
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  if (typed !== null) {
    await pickFromDropdown(page, 'Notebook', 'New notebook…');
    await dialog.locator('input').fill(typed);
  } else {
    await pickFromDropdown(page, 'Notebook', existing);
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

/** Sends one touch gesture as pointer events: a press at `from`, a move through `to`, and a lift. */
async function touchGesture(page, from, to, { holdMs = 0, steps = 6 } = {}) {
  await page.evaluate(
    async ({ from, to, holdMs, steps }) => {
      const send = (type, x, y) => {
        const target = document.elementFromPoint(x, y) ?? document.body;
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      send('pointerdown', from.x, from.y);
      if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
      for (let i = 1; i <= steps; i++) {
        send('pointermove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      send('pointerup', to.x, to.y);
    },
    { from, to, holdMs, steps },
  );
}

test('F10 moves focus to the menu bar and ArrowDown opens the first menu', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.locator('.dash-hero').first().waitFor();
    await page.keyboard.press('F10');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'File');
    await page.keyboard.press('ArrowDown');
    assert.ok(await page.$('.menu-panel[role="menu"]'), 'the File menu opened');
    await page.keyboard.press('Escape');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a long-press on a list row opens its context menu, and the click after it does nothing', async () => {
  const page = await freshPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await openQuire(page);
    const row = page.locator('.dash-recent-item').first();
    await row.waitFor();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touchGesture(page, point, point, { holdMs: 650, steps: 1 });
    assert.ok(await page.$('.context-menu'), 'the long-press opened the context menu');
    assert.equal(await page.getAttribute('.app', 'data-view'), 'home', 'the lift did not open the entry');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a quick sideways swipe in the editor opens the next older entry', async () => {
  const page = await freshPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await openQuire(page);
    await newEntry(page);
    await renameEntry(page, 'Older one');
    await page.fill('#entry-date', '2026-10-02');
    await page.dispatchEvent('#entry-date', 'change');
    await waitForSaved(page);
    // The home button is hidden while an entry is open, so start the second entry with Ctrl+N.
    await page.keyboard.press('Control+n');
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.view === 'editor' && document.querySelector('#window-title')?.textContent.trim() === 'Untitled');
    await renameEntry(page, 'Newer one');
    // Dated after 'Older one' but before the sample entry, which is dated today, so the order is fixed.
    await page.fill('#entry-date', '2026-10-05');
    await page.dispatchEvent('#entry-date', 'change');
    await waitForSaved(page);
    // Start on the mixtape strip: a swipe that begins in a field is left to the field.
    const box = await page.locator('#mixtape').boundingBox();
    const y = box.y + box.height / 2;
    await touchGesture(page, { x: 320, y }, { x: 90, y: y + 4 });
    await page.waitForFunction(() => /Older one/.test(document.querySelector('#window-title')?.textContent ?? ''));
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a downward swipe on a dialog title closes the dialog', async () => {
  const page = await freshPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await openQuire(page);
    await page.keyboard.press('F1');
    await page.waitForSelector('dialog[open] .dialog-title');
    const box = await page.locator('dialog[open] .dialog-title').boundingBox();
    const from = { x: box.x + 20, y: box.y + box.height / 2 };
    await touchGesture(page, from, { x: from.x, y: from.y + 160 });
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the mood drop-down works from the keyboard and keeps the choice after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    const mood = page.locator('#entry-mood');
    await page.locator('#entry-mood .dd-trigger').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getAttribute('#entry-mood .dd-trigger', 'aria-expanded'), 'true', 'the list opens');
    await page.keyboard.press('ArrowDown');
    // Wait for the save this choice starts, so the "Saved" status we wait for is the one it produces.
    const unsaved = page.waitForFunction(() => /Unsaved/.test(document.querySelector('#save-status')?.textContent ?? ''));
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('#entry-mood .dd-trigger', 'aria-expanded'), 'false', 'the list closes on a choice');
    assert.equal(await mood.evaluate((node) => node.value), 'great');
    assert.equal((await page.innerText('#entry-mood .dd-value')).trim(), 'Great');
    await unsaved;
    await waitForSaved(page);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#splash', { state: 'detached', timeout: 15000 });
    assert.equal(await page.locator('#entry-mood').evaluate((node) => node.value), 'great');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('Escape closes a drop-down without choosing, and the dialog around it stays open', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await newEntry(page);
    await page.locator('#entry-weather .dd-trigger').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('#entry-weather .dd-trigger', 'aria-expanded'), 'false');
    assert.equal(await page.locator('#entry-weather').evaluate((node) => node.value), '', 'nothing was chosen');
    // Typing a letter with the list shut picks the first option that starts with it.
    await page.keyboard.press('r');
    assert.equal(await page.locator('#entry-weather').evaluate((node) => node.value), 'rain');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the library sidebar folds its sections, and the folds are remembered after a reload', async () => {
  const page = await freshPage();
  try {
    await openQuire(page);
    await page.waitForSelector('.home-nav');
    const tags = page.locator('.nav-group-toggle', { hasText: 'Tags' });
    assert.equal(await tags.getAttribute('aria-expanded'), 'false', 'Tags starts folded');
    await tags.click();
    assert.equal(await tags.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#nav-tags').isVisible(), true);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.home-nav');
    assert.equal(await page.locator('.nav-group-toggle', { hasText: 'Tags' }).getAttribute('aria-expanded'), 'true', 'still open after a reload');
    await page.locator('.nav-group-toggle', { hasText: 'Library' }).click();
    assert.equal(await page.locator('#nav-library').isHidden(), true, 'the Library list folds away');
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

test('the entry header drop-downs fit a phone and their lists stay on screen', async () => {
  const page = await freshPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await openQuire(page);
    await newEntry(page);
    await page.locator('#entry-kind .dd-trigger').tap();
    const list = page.locator('#entry-kind .dd-list');
    await list.waitFor({ state: 'visible' });
    const box = await list.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'the list fits the width of the phone');
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no horizontal page scroll (overflow ${overflow}px)`);
    expectNoErrors(page);
  } finally {
    await page.close();
  }
});

