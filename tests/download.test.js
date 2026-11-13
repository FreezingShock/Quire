import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  classifyAsset,
  detectPlatform,
  formatBytes,
  formatDate,
  guessArch,
  isTrustedDownload,
  planDownloads,
  releaseState,
  versionOf,
} from '../download/logic.js';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CHROME_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const SAFARI_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const RELEASE_BASE = 'https://github.com/FreezingShock/Quire/releases/download/v0.1.0/';

/** A release shaped like the GitHub API, with the file names Tauri produces. */
function sampleRelease(extra = []) {
  const names = [
    ['Quire_0.1.0_x64-setup.exe', 4_200_000],
    ['Quire_0.1.0_x64_en-US.msi', 5_100_000],
    ['Quire_0.1.0_arm64-setup.exe', 4_000_000],
    ['Quire_0.1.0_aarch64.dmg', 9_800_000],
    ['Quire_0.1.0_x64.dmg', 10_100_000],
    ['Quire_0.1.0_amd64.AppImage', 88_000_000],
    ['quire_0.1.0_amd64.deb', 6_000_000],
    ['quire-0.1.0-1.x86_64.rpm', 6_200_000],
    ['Quire_0.1.0_x64-setup.exe.sig', 300],
    ['latest.json', 900],
  ];
  return {
    tag_name: 'v0.1.0',
    published_at: '2026-11-13T20:00:00Z',
    assets: [
      ...names.map(([name, size]) => ({ name, size, browser_download_url: RELEASE_BASE + name })),
      ...extra,
    ],
  };
}

test('a Windows browser is recognized even when the legacy platform string says Linux', () => {
  assert.equal(detectPlatform({ userAgent: CHROME_WINDOWS, platform: 'Linux x86_64' }), 'windows');
  assert.equal(detectPlatform({ userAgent: CHROME_WINDOWS, userAgentData: { platform: 'Windows' } }), 'windows');
});

test('Mac, Linux, and unknown browsers are sorted correctly', () => {
  assert.equal(detectPlatform({ userAgent: SAFARI_MAC, platform: 'MacIntel', maxTouchPoints: 0 }), 'mac');
  assert.equal(detectPlatform({ userAgent: CHROME_LINUX, platform: 'Linux x86_64' }), 'linux');
  assert.equal(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)' }), 'other');
  assert.equal(detectPlatform({}), 'other');
});

test('phones and iPads are not offered desktop installers', () => {
  assert.equal(detectPlatform({ userAgent: ANDROID, platform: 'Linux armv8l' }), 'mobile');
  assert.equal(detectPlatform({ userAgent: IPHONE, platform: 'iPhone' }), 'mobile');
  // iPadOS asks for the desktop site: it looks like a Mac, but it has a touch screen.
  assert.equal(detectPlatform({ userAgent: SAFARI_IPAD, platform: 'MacIntel', maxTouchPoints: 5 }), 'mobile');
});

test('installer names map to a platform, a kind, and a chip', () => {
  assert.deepEqual(
    { platform: classifyAsset('Quire_0.1.0_x64-setup.exe').platform, kind: classifyAsset('Quire_0.1.0_x64-setup.exe').kind, arch: classifyAsset('Quire_0.1.0_x64-setup.exe').arch },
    { platform: 'windows', kind: 'exe', arch: 'x64' },
  );
  assert.equal(classifyAsset('Quire_0.1.0_aarch64.dmg').arch, 'arm64');
  assert.equal(classifyAsset('Quire_0.1.0_x64.dmg').arch, 'x64');
  assert.equal(classifyAsset('Quire_0.1.0_universal.dmg').arch, 'universal');
  assert.equal(classifyAsset('Quire_0.1.0_amd64.AppImage').kindLabel, 'AppImage (no install)');
  assert.equal(classifyAsset('quire_0.1.0_amd64.deb').platform, 'linux');
  assert.equal(classifyAsset('quire-0.1.0-1.x86_64.rpm').arch, 'x64');
});

test('signature files, update manifests, and source archives are not offered', () => {
  for (const name of ['Quire_0.1.0_x64-setup.exe.sig', 'latest.json', 'Source code (zip).zip', 'notes.md', 'Quire.app.tar.gz.sig']) {
    assert.equal(classifyAsset(name), null, name);
  }
});

test('the right installer comes first for each system, with the matching chip', () => {
  const release = sampleRelease();

  const windows = planDownloads(release, 'windows');
  assert.equal(windows.primary.name, 'Quire_0.1.0_x64-setup.exe');
  assert.deepEqual(
    windows.groups.find((group) => group.id === 'windows').items.map((item) => item.name),
    ['Quire_0.1.0_x64-setup.exe', 'Quire_0.1.0_x64_en-US.msi', 'Quire_0.1.0_arm64-setup.exe'],
  );

  // Apple silicon is the likely default on a Mac, so the arm64 disk image comes first.
  assert.equal(planDownloads(release, 'mac').primary.name, 'Quire_0.1.0_aarch64.dmg');
  assert.equal(planDownloads(release, 'linux').primary.name, 'Quire_0.1.0_amd64.AppImage');
  assert.equal(planDownloads(release, 'mobile').primary, null);
  assert.equal(planDownloads(release, 'other').primary, null);
});

test('every platform is listed, and a missing one has no primary file', () => {
  const onlyWindows = { assets: sampleRelease().assets.filter((asset) => asset.name.endsWith('.exe')) };
  const plan = planDownloads(onlyWindows, 'mac');
  assert.equal(plan.primary, null);
  assert.deepEqual(plan.groups.map((group) => group.id), ['windows']);
  assert.equal(plan.assetCount, 2);
});

test('links that do not point at this repository\'s releases are dropped', () => {
  const release = sampleRelease([
    { name: 'Quire_0.1.0_x64-setup.exe', size: 1, browser_download_url: 'https://example.com/evil.exe' },
    { name: 'Quire_9.9.9_x64.msi', size: 1, browser_download_url: 'javascript:alert(1)' },
  ]);
  const plan = planDownloads(release, 'windows');
  assert.equal(plan.groups[0].items.some((item) => item.url.includes('example.com')), false);
  assert.equal(plan.groups[0].items.some((item) => item.name.includes('9.9.9')), false);
  assert.equal(isTrustedDownload('javascript:alert(1)'), false);
  assert.equal(isTrustedDownload(RELEASE_BASE + 'Quire.exe'), true);
});

test('a release answers the page state: a build, no build yet, or an error', () => {
  assert.equal(releaseState({ status: 200, body: sampleRelease() }).state, 'ready');
  assert.equal(releaseState({ status: 404, body: { message: 'Not Found' } }).state, 'none');
  assert.equal(releaseState({ status: 403, body: null }).state, 'error');
  assert.equal(releaseState({ status: 200, body: null }).state, 'error');
  assert.equal(releaseState({ status: null }).state, 'error');
});

test('a guessed architecture follows the platform', () => {
  assert.equal(guessArch('mac'), 'arm64');
  assert.equal(guessArch('windows'), 'x64');
  assert.equal(guessArch('linux'), 'x64');
});

test('version, size, and date text read cleanly', () => {
  assert.equal(versionOf({ tag_name: 'v0.1.0' }), '0.1.0');
  assert.equal(versionOf({ tag_name: 'app-v1.2.3-beta.1' }), '1.2.3-beta.1');
  assert.equal(formatBytes(0), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(4_200_000), '4.0 MB');
  assert.equal(formatBytes(88_000_000), '84 MB');
  assert.equal(formatDate('not a date'), '');
  assert.equal(formatDate('2026-11-13T20:00:00Z', 'en-US').includes('2026'), true);
});

test('the download page is a static page that links only to files that exist', () => {
  const html = read('download/index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
    .map((match) => match[1])
    .filter((ref) => !/^(https?:|mailto:)/.test(ref));
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const target = new URL(ref, new URL('download/', ROOT));
    if (target.pathname.endsWith('/')) continue; // "../" is the app's start page
    assert.ok(existsSync(target), `missing ${ref}`);
  }
  assert.match(html, /<script type="module" src="download\.js"/);
});

test('the download page does not hardcode a domain, and it never writes HTML from release data', () => {
  const files = readdirSync(new URL('download/', ROOT));
  for (const file of files) {
    const text = read(`download/${file}`);
    assert.equal(text.includes('quirejournal.com'), false, `${file} names a domain`);
  }
  const script = read('download/download.js');
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(script), false);
});

test('the service worker keeps the download page for offline visits', () => {
  const sw = read('sw.js');
  for (const path of ['./download/index.html', './download/download.css', './download/download.js', './download/logic.js']) {
    assert.ok(sw.includes(`'${path}'`), `${path} missing from SHELL`);
  }
});
