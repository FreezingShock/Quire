/**
 * Desktop window chrome in a real Chromium: the browser tab keeps its layout, the
 * desktop shell (preview, bridge and Mac) draws Quire's own caption buttons, the
 * title bar maximizes on double-click, and saved bounds are handed back to the shell.
 * Run with `npm run test:e2e`.
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

/** A page with errors collected. `init` runs before the app, to set a bridge or saved bounds. */
async function openPage(url, { init, arg, width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (init) await context.addInitScript(init, arg);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('.splash:not(.is-leaving)') || document.querySelector('.splash.is-leaving'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  return {
    page,
    errors,
    close: () => context.close(),
  };
}

const visible = (page, selector) =>
  page.$eval(selector, (node) => getComputedStyle(node).display !== 'none').catch(() => false);

test('a plain browser tab shows no caption buttons and keeps its page margin', async () => {
  const { page, errors, close } = await openPage(BASE);
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.shell ?? null), null);
    assert.equal(await visible(page, '#window-controls'), false);
    assert.equal(await page.$eval('.resize-edge', (node) => getComputedStyle(node).display), 'none');
    assert.equal(await page.$eval('body', (node) => getComputedStyle(node).paddingTop), '14px');
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test('the desktop preview draws the caption buttons, and double-click on the title bar maximizes', async () => {
  const { page, errors, close } = await openPage(`${BASE}?shell=desktop`);
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), 'desktop');
    assert.equal(await visible(page, '#window-controls'), true);
    assert.equal(await page.$eval('body', (node) => getComputedStyle(node).paddingTop), '0px');
    assert.equal(await page.$eval('.wc-max', (node) => node.getAttribute('aria-label')), 'Maximize');

    const bar = await page.locator('.titlebar').boundingBox();
    // Double-click on empty title bar space, to the right of the entry name.
    await page.mouse.dblclick(bar.x + bar.width * 0.85, bar.y + bar.height / 2);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.window), 'maximized');
    assert.equal(await page.$eval('.wc-max', (node) => node.getAttribute('aria-label')), 'Restore');
    assert.equal(await page.$eval('.resize-edge[data-edge="se"]', (node) => getComputedStyle(node).display), 'none');

    await page.click('.wc-max');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.window), 'normal');
    assert.equal(await page.$eval('.resize-edge[data-edge="se"]', (node) => getComputedStyle(node).display), 'block');
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test('the title bar caption buttons follow the skin, live, in light and dark', async () => {
  const { page, errors, close } = await openPage(`${BASE}?shell=desktop`);
  try {
    const bg = () => page.$eval('.wc-close', (node) => getComputedStyle(node).backgroundImage);
    const before = await page.$eval('.wc-close', (node) => getComputedStyle(node).backgroundImage);
    await page.evaluate(() => {
      document.documentElement.dataset.skin = 'luna';
    });
    const luna = await bg();
    assert.notEqual(luna, before, 'Luna has its own caption buttons');
    await page.evaluate(() => {
      document.documentElement.dataset.skin = 'classic';
      document.documentElement.dataset.theme = 'dark';
    });
    assert.notEqual(await bg(), luna, 'Classic dark has its own caption buttons');
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test('on Mac the system draws the traffic lights, so Quire hides its own buttons and leaves room for them', async () => {
  const { page, errors, close } = await openPage(BASE, {
    init: () => {
      Object.defineProperty(globalThis, '__QUIRE_DESKTOP__', {
        value: Object.freeze({ shell: 'tauri', version: '0.1.0', platform: 'macos' }),
      });
      globalThis.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async () => null, transformCallback: () => 1 };
    },
  });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), 'desktop');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.platform), 'mac');
    assert.equal(await visible(page, '#window-controls'), false);
    assert.equal(await page.$eval('.titlebar', (node) => getComputedStyle(node).paddingLeft), '80px');
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test('the Tauri shell gets the caption clicks as window commands, and saved bounds are restored on start', async () => {
  const saved = { x: 60, y: 40, width: 1100, height: 720, maximized: false };
  const { page, errors, close } = await openPage(BASE, {
    arg: saved,
    init: (stored) => {
      localStorage.setItem('quire.window', JSON.stringify(stored));
      Object.defineProperty(globalThis, '__QUIRE_DESKTOP__', {
        value: Object.freeze({ shell: 'tauri', version: '0.1.0', platform: 'windows' }),
      });
      globalThis.__calls = [];
      const answers = {
        'plugin:window|is_maximized': false,
        'plugin:window|scale_factor': 1,
        'plugin:window|inner_size': { width: 1280, height: 800 },
        'plugin:window|outer_position': { x: 0, y: 0 },
      };
      globalThis.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' } },
        transformCallback: () => 1,
        invoke: async (command, args) => {
          globalThis.__calls.push([command, args]);
          return answers[command] ?? null;
        },
      };
    },
  });
  try {
    const calls = await page.evaluate(() => globalThis.__calls);
    const has = (command, args) => calls.some(([c, a]) => c === command && JSON.stringify(a) === JSON.stringify(args));
    assert.ok(
      has('plugin:window|set_size', { label: 'main', value: { Logical: { width: 1100, height: 720 } } }),
      'the saved size is handed to the window on start',
    );
    assert.ok(has('plugin:window|set_position', { label: 'main', value: { Logical: { x: 60, y: 40 } } }));

    await page.click('.wc-min');
    await page.click('.wc-max');
    await page.click('.wc-close');
    const after = await page.evaluate(() => globalThis.__calls.map(([c]) => c));
    assert.ok(after.includes('plugin:window|minimize'));
    assert.ok(after.includes('plugin:window|toggle_maximize'));
    assert.ok(after.includes('plugin:window|close'));
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
