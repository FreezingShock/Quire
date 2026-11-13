import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop, DESKTOP_ENTRIES } from '../scripts/build-desktop.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [full.slice(base.length + 1).replaceAll('\\', '/')];
  });
}

test('the desktop bundle holds the page, its modules, styles and assets, and nothing else', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'quire-desktop-')), 'dist');
  await buildDesktop({ root: ROOT, out });

  assert.ok(existsSync(join(out, 'index.html')));
  assert.ok(existsSync(join(out, 'src', 'controller', 'build-ui.js')), 'nested modules are copied');
  assert.ok(existsSync(join(out, 'styles', 'app.css')));
  assert.ok(existsSync(join(out, 'assets', 'icon-512.png')));

  const copied = listFiles(out);
  assert.equal(copied.some((file) => file.startsWith('tests/') || file.startsWith('e2e/')), false);
  assert.equal(copied.includes('sw.js'), false, 'the desktop shell needs no service worker');
  assert.equal(copied.some((file) => file.startsWith('src-tauri/') || file.startsWith('.github/')), false);
});

test('the bundle entries cover every folder the page loads from', () => {
  for (const dir of ['src', 'styles', 'assets']) assert.ok(DESKTOP_ENTRIES.includes(dir), `${dir} is missing`);
  assert.ok(DESKTOP_ENTRIES.includes('index.html'));
});

test('the Tauri config points at the desktop bundle and matches the package version', () => {
  assert.equal(conf.build.frontendDist, '../dist-desktop');
  assert.equal(conf.version, pkg.version, 'bump package.json and tauri.conf.json together');
  assert.equal(conf.identifier, 'com.quire.desktop', 'changing the identifier moves where IndexedDB data lives');
});

test('the Rust crate version matches the package version', () => {
  const cargo = read('src-tauri/Cargo.toml');
  assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll('.', '\\.')}"$`, 'm'));
});

test('the Windows installer is per-user, lightweight, and uses Quire art', () => {
  const nsis = conf.bundle.windows.nsis;
  assert.equal(nsis.installMode, 'currentUser', 'no administrator prompt');
  assert.equal(conf.bundle.windows.webviewInstallMode.type, 'downloadBootstrapper', 'WebView2 is fetched only when missing');
  for (const file of [nsis.installerIcon, nsis.headerImage, nsis.sidebarImage, ...conf.bundle.icon]) {
    assert.ok(existsSync(join(ROOT, 'src-tauri', file)), `${file} is missing`);
  }
});

test('the bundled icons exist and the icon files are not empty', () => {
  for (const file of conf.bundle.icon) {
    const path = join(ROOT, 'src-tauri', file);
    assert.ok(statSync(path).size > 0, `${file} is empty`);
  }
});

test('the app shell opens the desktop window with the desktop flag before page scripts', () => {
  const lib = read('src-tauri/src/lib.rs');
  assert.match(lib, /initialization_script\(/);
  assert.match(lib, /__QUIRE_DESKTOP__/);
  assert.match(lib, /tauri_plugin_opener/, 'external links open in the default browser');
});

test('the desktop release workflow builds Windows and macOS installers and attaches them to a release', () => {
  const wf = read('.github/workflows/desktop-release.yml');
  for (const os of ['windows-latest', 'macos-latest', 'macos-15-intel']) assert.match(wf, new RegExp(os));
  assert.doesNotMatch(wf, /ubuntu/, 'Linux is not a release target');
  assert.match(wf, /tauri-apps\/tauri-action@/);
  assert.match(wf, /releaseDraft:\s*false/);
  assert.match(wf, /contents:\s*write/);
  assert.match(wf, /includeUpdaterJson:\s*\$\{\{ steps\.updater\.outputs\.enabled == 'true' \}\}/, 'updater output is only on when the key is set');
  assert.match(wf, /--config src-tauri\/tauri\.updater\.conf\.json/);
  assert.match(wf, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
});

test('the updater reads latest.json from the latest release, and the bundles are built with updater archives', () => {
  const updater = conf.plugins.updater;
  assert.deepEqual(updater.endpoints, ['https://github.com/FreezingShock/Quire/releases/latest/download/latest.json']);
  assert.equal(conf.bundle.createUpdaterArtifacts, undefined, 'the overlay turns this on only when the key is set');
  const overlay = JSON.parse(read('src-tauri/tauri.updater.conf.json'));
  assert.equal(overlay.bundle.createUpdaterArtifacts, true);
  assert.equal(updater.windows.installMode, 'passive');
});

test('the updater public key, when set, is a base64 minisign key, and the private key is never in the repo', () => {
  const key = conf.plugins.updater.pubkey;
  if (key !== '') assert.match(key, /^[A-Za-z0-9+/=]{40,}$/, 'a base64 public key from `tauri signer generate`');
  assert.equal(read('src-tauri/tauri.conf.json').includes('PRIVATE KEY'), false);
});

test('every feature plugin has its Rust module, registration, command list and capability', () => {
  const lib = read('src-tauri/src/lib.rs');
  const features = readdirSync(join(ROOT, 'src-tauri', 'features')).filter((name) => name.endsWith('.commands'));
  assert.ok(features.includes('app.commands'));
  for (const file of features) {
    const name = file.slice(0, -'.commands'.length);
    assert.match(name, /^[a-z0-9]+$/, `${file}: plugin names are lowercase letters and digits only`);
    assert.ok(existsSync(join(ROOT, 'src-tauri', 'src', `${name}.rs`)), `src-tauri/src/${name}.rs is missing`);
    assert.match(lib, new RegExp(`^mod ${name};$`, 'm'), `lib.rs needs mod ${name};`);
    assert.match(lib, new RegExp(`\\.plugin\\(${name}::init\\(\\)\\)`), `lib.rs needs .plugin(${name}::init())`);
    assert.ok(existsSync(join(ROOT, 'src-tauri', 'capabilities', `${name}.json`)), `capabilities/${name}.json is missing`);
    const commands = read(`src-tauri/features/${file}`).split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    assert.ok(commands.length > 0, `${file} lists no commands`);
  }
});
