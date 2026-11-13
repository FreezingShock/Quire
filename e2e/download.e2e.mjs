/**
 * End-to-end checks for the download page in a real Chromium. Run with `npm run test:e2e`.
 *
 * GitHub's API is answered by the test (page.route), so the checks do not depend on
 * a published release or on the network. Set QUIRE_CHROMIUM to use a browser binary
 * that is already installed.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4800 + Math.floor(Math.random() * 150);
const PAGE = `http://localhost:${PORT}/download/`;
const SCREENSHOTS = process.env.QUIRE_SHOTS ?? null;

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const RELEASE_BASE = 'https://github.com/FreezingShock/Quire/releases/download/v0.1.0/';

const release = {
  tag_name: 'v0.1.0',
  published_at: '2026-11-13T20:00:00Z',
  assets: [
    ['Quire_0.1.0_x64-setup.exe', 4_200_000],
    ['Quire_0.1.0_x64_en-US.msi', 5_100_000],
    ['Quire_0.1.0_aarch64.dmg', 9_800_000],
    ['Quire_0.1.0_amd64.AppImage', 88_000_000],
    ['Quire_0.1.0_x64-setup.exe.sig', 300],
  ].map(([name, size]) => ({ name, size, browser_download_url: RELEASE_BASE + name })),
};

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

/**
 * A fresh page. `github` decides what the release request returns: a release object,
 * { status: 404 }, { status: 500 }, or 'offline' for a network failure.
 */
async function openPage({ userAgent = WINDOWS_UA, viewport = { width: 1280, height: 860 }, github = { status: 200, body: release } } = {}) {
  const context = await browser.newContext({ userAgent, viewport, deviceScaleFactor: 2, acceptDownloads: false });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // A 404 or a dropped connection is the browser's own log line for the request the test asked for.
  const expectedFailure = github === 'offline' || github.status !== 200;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (expectedFailure && /Failed to load resource/.test(message.text())) return;
    errors.push(`console: ${message.text()}`);
  });
  await page.route('https://api.github.com/**', (route) => {
    if (github === 'offline') return route.abort('internetdisconnected');
    return route.fulfill({
      status: github.status,
      contentType: 'application/json',
      body: JSON.stringify(github.body ?? { message: 'Not Found' }),
    });
  });
  await page.goto(PAGE);
  page.errors = errors;
  page.close = () => context.close();
  return page;
}

async function waitForStatus(page, text) {
  await page.waitForFunction((expected) => document.getElementById('status')?.textContent.includes(expected), text);
}

function assertNoErrors(page) {
  assert.deepEqual(page.errors, [], page.errors.join('\n'));
}

test('a Windows visitor is offered the installer first, marked as their computer', async () => {
  const page = await openPage();
  try {
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    const primary = page.locator('#primary');
    assert.equal(await primary.isVisible(), true);
    assert.equal(await primary.textContent(), 'Download for Windows');
    assert.equal(await primary.getAttribute('href'), RELEASE_BASE + 'Quire_0.1.0_x64-setup.exe');
    assert.notEqual(await primary.getAttribute('download'), null);

    const yourComputer = page.locator('.platform', { hasText: 'Windows' }).locator('.you');
    assert.equal(await yourComputer.count(), 1);
    assert.match(await page.locator('#primary-note').textContent(), /Installer · Intel \/ AMD 64-bit · 4\.0 MB/);
    assert.equal(await page.locator('.file').count(), 4, 'signature files are not listed');
    assert.equal(await page.locator('#foot-version').textContent(), 'Quire 0.1.0 · released Nov 13, 2026');
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a Mac visitor gets the Apple silicon disk image', async () => {
  const page = await openPage({ userAgent: MAC_UA });
  try {
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    assert.equal(await page.locator('#primary').getAttribute('href'), RELEASE_BASE + 'Quire_0.1.0_aarch64.dmg');
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});

test('with no release published yet, the page says so and points to the browser version', async () => {
  const page = await openPage({ github: { status: 404 } });
  try {
    await waitForStatus(page, 'No desktop build is out yet');
    assert.equal(await page.locator('#primary').isHidden(), true);
    assert.equal(await page.locator('#browser-link').getAttribute('href'), '../');
    assert.match(await page.locator('#groups').textContent(), /No desktop files are published yet/);
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});

test('when GitHub cannot be reached, the page offers a retry and the browser version', async () => {
  const page = await openPage({ github: 'offline' });
  try {
    await waitForStatus(page, "Couldn't check GitHub just now");
    assert.equal(await page.locator('.retry').count(), 1);
    assert.equal(await page.locator('#browser-link').isVisible(), true);
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});

test('a phone gets the browser version, not an installer, and nothing scrolls sideways', async () => {
  const page = await openPage({
    userAgent: PHONE_UA,
    viewport: { width: 390, height: 844 },
  });
  try {
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    assert.equal(await page.locator('#primary').textContent(), 'Use Quire in your browser');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page is ${overflow}px wider than the screen`);
    assertNoErrors(page);
    if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/download-phone.png`, fullPage: true, scale: 'device' });
  } finally {
    await page.close();
  }
});

test('the dark switch applies, and it is remembered on the next visit', async () => {
  const page = await openPage();
  try {
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    await page.click('#theme');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    assert.equal(await page.getAttribute('#theme', 'aria-pressed'), 'true');
    await page.reload();
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});

test('desktop layout holds together in light and dark', async () => {
  const page = await openPage();
  try {
    await waitForStatus(page, 'Quire 0.1.0 is ready');
    if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/download-desktop-light.png`, fullPage: true, scale: 'device' });
    await page.click('#theme');
    if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/download-desktop-dark.png`, fullPage: true, scale: 'device' });
    assertNoErrors(page);
  } finally {
    await page.close();
  }
});
