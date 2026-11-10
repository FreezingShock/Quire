/**
 * Performance checks on a library with a thousand-plus entries, generated here.
 * They guard the things that made Quire slow: the list built every row, the
 * library was read several times at startup, and every tile painted its ink up
 * front. Budgets are generous on purpose, so a slow CI machine does not fail them.
 *
 * Run with `npm run test:e2e`. Set QUIRE_CHROMIUM to use a preinstalled browser.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4800 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}/`;
const COUNT = 1500;

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

/** A fresh browser context whose library holds COUNT generated entries. The first entry with ink is `ink-0`. */
async function seededPage(t, viewport = { width: 1280, height: 800 }, { splash = false } = {}) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  await context.addInitScript((showSplash) => {
    localStorage.setItem('quire:prefs', JSON.stringify({ sampleSeeded: true, homeView: 'details', splash: showSplash }));
  }, splash);
  // The seeding page is a stylesheet, not HTML, so Chrome asks for /favicon.ico. Quire links its own icon; answer with none.
  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()} ${response.url()}`);
  });
  page.errors = errors;

  // Seed through the app's own store, so the rows are exactly what the app writes.
  await page.goto(`${BASE}styles/app.css`);
  await page.evaluate(async (count) => {
    const storage = await import('/src/storage.js');
    const model = await import('/src/model.js');
    const store = await storage.createLocalStore();
    store.setCipher(null);
    for (let i = 0; i < count; i++) {
      const day = new Date(Date.UTC(2022, 0, 1) + (i % 900) * 86400000).toISOString().slice(0, 10);
      const ops = i % 25 === 0
        ? [{ t: 'stroke', id: `o${i}`, l: 'base', tool: 'pen', c: '#222222', w: 3, p: [[100, 100], [400, 300], [700, 200]] }]
        : [];
      await store.save(model.createEntry({
        id: i % 25 === 0 ? `ink-${i}` : `seed-${i}`,
        title: `Entry ${i}`,
        date: day,
        body: `A short note for entry ${i}. ${'Some words to fill the line. '.repeat(3)}`,
        ink: { ops, h: 1200 },
      }));
    }
  }, COUNT);
  return page;
}

async function openHome(page) {
  const started = Date.now();
  await page.goto(`${BASE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => performance.getEntriesByName('quire:ready').length > 0, null, { timeout: 30000 });
  await page.waitForSelector('#home tr[data-id]');
  return Date.now() - started;
}

test('startup reads the library once and is ready within budget', async (t) => {
  const page = await seededPage(t);
  const ready = await page.evaluate(() => performance.getEntriesByName('quire:ready')[0]?.startTime ?? null);
  assert.equal(ready, null, 'the page should not be ready before it loads');
  await openHome(page);
  const marks = await page.evaluate(() =>
    Object.fromEntries(['quire:store-open', 'quire:home-ready', 'quire:ready'].map((name) => [name, performance.getEntriesByName(name)[0].startTime])),
  );
  t.diagnostic(`store open ${Math.round(marks['quire:store-open'])} ms, list on screen ${Math.round(marks['quire:home-ready'])} ms`);
  // Generous: a CI runner is slower than a laptop. The point is to catch a regression to several seconds.
  assert.ok(marks['quire:ready'] < 4000, `startup took ${Math.round(marks['quire:ready'])} ms`);
  assert.deepEqual(page.errors, [], 'the page logged errors');
});

test('the startup splash clears as soon as the library is ready', async (t) => {
  const page = await seededPage(t, undefined, { splash: true });
  await openHome(page);
  // The splash has no minimum time on screen. It should go within a moment of the library being ready (a short fade).
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 5000 });
  const lag = await page.evaluate(() => performance.now() - performance.getEntriesByName('quire:ready')[0].startTime);
  t.diagnostic(`splash cleared ${Math.round(lag)} ms after the library was ready`);
  assert.ok(lag < 1000, `the splash stayed ${Math.round(lag)} ms after the library was ready`);
  assert.deepEqual(page.errors, [], 'the page logged errors');
});

test('the details list builds only the rows near the screen, and keyboard moves reach the rest', async (t) => {
  const page = await seededPage(t);
  await openHome(page);
  const built = await page.locator('#home tbody tr[data-id]').count();
  assert.ok(built > 0 && built < 100, `${built} rows built out of ${COUNT}`);

  // End moves the selection to the last entry, scrolls it into view, and builds its row.
  await page.locator('#home tbody tr[data-id]').first().focus();
  await page.keyboard.press('End');
  const last = await page.evaluate(() => document.activeElement?.dataset.id ?? null);
  assert.ok(last, 'a row should have focus after End');
  const lastRow = page.locator(`#home tr[data-id="${last}"]`);
  await lastRow.waitFor();
  const visible = await lastRow.evaluate((row) => {
    const scroller = row.closest('.home-main');
    const box = row.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    return box.bottom <= frame.bottom + 1 && box.top >= frame.top;
  });
  assert.ok(visible, 'the last row should be scrolled into view');
  assert.equal(await lastRow.getAttribute('aria-selected'), 'true');

  // Scrolling away and back rebuilds the row, and it keeps its selection.
  await page.evaluate(() => {
    document.querySelector('.home-main').scrollTop = 0;
  });
  await page.evaluate(() => {
    document.querySelector('.home-main').scrollTop = 1e9;
  });
  await page.waitForFunction((id) => document.querySelector(`#home tr[data-id="${id}"]`)?.classList.contains('is-selected'), last);

  // Home brings the first entry back into view.
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.dataset.id === document.querySelector('#home tbody tr[data-id]')?.dataset.id);
  assert.deepEqual(page.errors, [], 'the page logged errors');
});

test('scrolling the details list keeps frames short', async (t) => {
  const page = await seededPage(t);
  await openHome(page);
  await page.evaluate(() => {
    window.__gaps = [];
    let last = performance.now();
    const tick = (now) => {
      window.__gaps.push(now - last);
      last = now;
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  const box = await page.locator('.home-main').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(16);
  }
  const gaps = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__gaps.slice(2);
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  t.diagnostic(`median frame ${median.toFixed(1)} ms over ${gaps.length} frames, worst ${sorted.at(-1).toFixed(1)} ms`);
  assert.ok(gaps.length > 20, 'the page should have drawn frames while scrolling');
  assert.ok(median < 50, `median frame took ${median.toFixed(1)} ms`);
});

test('tiles paint ink for the tiles on screen', async (t) => {
  const page = await seededPage(t);
  await openHome(page);
  await page.click('[aria-label="Tiles view"]');
  await page.waitForSelector('.home-tiles .tile');
  // A canvas counts as painted once any of its pixels has alpha.
  const PAINTED = `[...document.querySelectorAll('.home-tiles canvas.tile-ink')].filter((canvas) => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
    return false;
  }).length`;
  const total = await page.locator('.home-tiles canvas.tile-ink').count();
  assert.ok(total > 10, 'the library should have ink tiles');
  // Scrolling halfway brings ink tiles into view. Only those paint; the rest of the library stays blank until it scrolls in.
  await page.evaluate(() => {
    const main = document.querySelector('.home-main');
    main.scrollTop = main.scrollHeight / 2;
  });
  await page.waitForFunction(`${PAINTED} > 0`, null, { timeout: 5000 });
  const painted = await page.evaluate(PAINTED);
  t.diagnostic(`${painted} of ${total} ink tiles painted after scrolling halfway`);
  assert.ok(painted < total, `${painted} of ${total} ink tiles painted`);
  assert.deepEqual(page.errors, [], 'the page logged errors');
});

test('the details table fills a phone-width list and keeps its columns', async (t) => {
  const page = await seededPage(t, { width: 390, height: 844 });
  await openHome(page);
  // With the narrow columns hidden, the visible headers should still share out the whole table.
  const { table, headers } = await page.evaluate(() => {
    const table = document.querySelector('.home-table');
    const visible = [...table.tHead.rows[0].cells].filter((cell) => getComputedStyle(cell).display !== 'none');
    return { table: table.getBoundingClientRect().width, headers: visible.reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0) };
  });
  assert.ok(Math.abs(table - headers) < 2, `visible columns add up to ${Math.round(headers)} px in a ${Math.round(table)} px table`);
  // Scrolling to the bottom keeps the same column widths, so the spacer rows do not change the layout.
  await page.evaluate(() => {
    document.querySelector('.home-main').scrollTop = 1e9;
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => [...document.querySelector('.home-table thead tr').cells].filter((cell) => getComputedStyle(cell).display !== 'none').map((cell) => Math.round(cell.getBoundingClientRect().width)));
  assert.ok(after.reduce((a, b) => a + b, 0) >= table - 2, 'columns should still fill the table after scrolling');
  assert.deepEqual(page.errors, [], 'the page logged errors');
});
