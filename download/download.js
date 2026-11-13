/**
 * The download page. It finds the visitor's computer, asks GitHub for the
 * latest Quire release, and offers the right installer first. It also keeps the
 * dark-mode switch and the "Install as app" button working without a build step.
 * The page text comes from logic.js, and everything from GitHub goes in as text.
 */
import {
  PLATFORMS,
  RELEASES_API,
  RELEASES_PAGE,
  detectPlatform,
  formatBytes,
  formatDate,
  planDownloads,
  releaseState,
  versionOf,
} from './logic.js';

const $ = (id) => document.getElementById(id);
const THEME_KEY = 'quire:download-theme';
const GLYPH = Object.freeze({ exe: 'EXE', msi: 'MSI', dmg: 'DMG', appimage: 'APP', deb: 'DEB', rpm: 'RPM' });
const DESKTOP = new Set(['windows', 'mac', 'linux']);

const els = {
  status: $('status'),
  primary: $('primary'),
  browser: $('browser-link'),
  note: $('primary-note'),
  groups: $('groups'),
  foot: $('foot-version'),
  theme: $('theme'),
  install: $('install'),
  installHelp: $('install-help'),
};

/* ---------- storage: every read and write can fail in a private window ---------- */

function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* the switch still works for this visit */
  }
}

/* ---------- theme ---------- */

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  els.theme.setAttribute('aria-pressed', String(dark));
}

function initTheme() {
  const stored = readStored(THEME_KEY);
  const systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  applyTheme(stored ? stored === 'dark' : systemDark);
  els.theme.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    applyTheme(dark);
    writeStored(THEME_KEY, dark ? 'dark' : 'light');
  });
}

/* ---------- small DOM helpers (text only, never HTML strings) ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(text, tone = '', busy = false) {
  els.status.className = `status${tone ? ` is-${tone}` : ''}`;
  els.status.setAttribute('aria-busy', String(busy));
  els.status.textContent = text;
  return els.status;
}

function showPrimary({ text, href, download = false }) {
  els.primary.hidden = false;
  els.primary.textContent = text;
  els.primary.href = href;
  if (download) els.primary.setAttribute('download', '');
  else els.primary.removeAttribute('download');
}

function hidePrimary() {
  els.primary.hidden = true;
  els.primary.removeAttribute('download');
}

function setNote(text) {
  els.note.textContent = text;
}

/* ---------- the file list ---------- */

function fileRow(asset, recommended) {
  const li = el('li');
  const link = el('a', 'file');
  link.href = asset.url;
  link.setAttribute('download', '');

  const glyph = el('span', 'file-glyph', GLYPH[asset.kind] ?? 'FILE');
  glyph.setAttribute('aria-hidden', 'true');

  const copy = el('span');
  copy.append(el('span', 'file-name', asset.name));
  copy.append(el('span', 'file-meta', `${asset.kindLabel} · ${asset.archLabel}${recommended ? ' · recommended' : ''}`));

  const size = el('span', 'file-size', formatBytes(asset.size));
  link.append(glyph, copy, size);
  li.append(link);
  return li;
}

function renderGroups(plan, platform) {
  els.groups.textContent = '';
  els.groups.removeAttribute('aria-busy');
  const byId = new Map(plan.groups.map((group) => [group.id, group]));

  for (const meta of PLATFORMS) {
    const section = el('section', 'platform');
    const heading = el('h3', '', meta.label);
    if (meta.id === platform) heading.append(el('span', 'you', 'Your computer'));
    section.append(heading);

    const group = byId.get(meta.id);
    if (group?.items.length) {
      const list = el('ul', 'file-list');
      group.items.forEach((asset, index) => {
        const recommended = meta.id === platform && index === 0;
        list.append(fileRow(asset, recommended));
      });
      section.append(list);
    } else {
      section.append(el('p', 'empty', 'Not in the latest release yet.'));
    }
    els.groups.append(section);
  }
}

function renderGroupsMessage(text) {
  els.groups.textContent = '';
  els.groups.removeAttribute('aria-busy');
  els.groups.append(el('p', 'empty', text));
}

/* ---------- the release, from GitHub ---------- */

async function requestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    const body = response.ok ? await response.json() : null;
    return releaseState({ status: response.status, body });
  } catch {
    return releaseState({ status: null });
  } finally {
    clearTimeout(timer);
  }
}

function showRetry() {
  const again = el('button', 'btn retry', 'Try again');
  again.type = 'button';
  again.addEventListener('click', () => loadRelease());
  els.status.append(' ', again);
}

function renderNoRelease(platform) {
  setStatus('No desktop build is out yet', 'warn');
  hidePrimary();
  setNote(
    DESKTOP.has(platform)
      ? 'The installers appear here as soon as the first release is published. Until then, Quire works in your browser.'
      : 'Quire works in your browser for now. Desktop installers appear here once they are published.',
  );
  renderGroupsMessage('No desktop files are published yet. Check back soon, or use Quire in your browser.');
  els.foot.textContent = 'Quire · desktop build not published yet';
}

function renderError() {
  setStatus("Couldn't check GitHub just now", 'warn');
  showRetry();
  hidePrimary();
  setNote('You can still use Quire in your browser, or open the releases page to look for the files yourself.');
  renderGroupsMessage('The file list could not be loaded.');
  els.foot.textContent = 'Quire';
}

function renderRelease(release, platform) {
  const plan = planDownloads(release, platform);
  const version = versionOf(release);
  const when = formatDate(release.published_at ?? release.created_at);
  const label = PLATFORMS.find((meta) => meta.id === platform)?.label;

  if (plan.assetCount === 0) {
    renderNoRelease(platform);
    return;
  }

  if (DESKTOP.has(platform) && plan.primary) {
    const asset = plan.primary;
    setStatus(`Quire ${version} is ready`, 'ready');
    showPrimary({ text: `Download for ${label}`, href: asset.url, download: true });
    const size = formatBytes(asset.size);
    const parts = [asset.kindLabel, asset.archLabel, size].filter(Boolean);
    setNote(`${parts.join(' · ')}. The other files for your system are listed below.`);
  } else if (DESKTOP.has(platform)) {
    setStatus(`Quire ${version} is ready`, 'ready');
    showPrimary({ text: `See ${label} files`, href: RELEASES_PAGE });
    setNote(`This release has no ${label} build yet. The releases page has the earlier files.`);
  } else if (platform === 'mobile') {
    setStatus(`Quire ${version} is ready`, 'ready');
    showPrimary({ text: 'Use Quire in your browser', href: '../' });
    els.browser.hidden = true;
    setNote('The desktop app is for Windows, macOS, and Linux. On your phone, use the browser version and add it to your home screen.');
  } else {
    setStatus(`Quire ${version} is ready`, 'ready');
    hidePrimary();
    setNote("We couldn't tell which system this is, so every file is listed below.");
  }

  renderGroups(plan, platform);
  els.foot.textContent = when ? `Quire ${version} · released ${when}` : `Quire ${version}`;
}

let currentPlatform = 'other';

async function loadRelease() {
  setStatus('Checking the latest release…', '', true);
  renderGroupsMessage('Loading the list of files…');
  const result = await requestRelease();
  if (result.state === 'ready') renderRelease(result.release, currentPlatform);
  else if (result.state === 'none') renderNoRelease(currentPlatform);
  else renderError();
}

/* ---------- install as an app ---------- */

let deferredPrompt = null;

function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1);
}

function showInstallHelp(text) {
  els.installHelp.hidden = false;
  els.installHelp.textContent = text;
}

function markInstalled() {
  deferredPrompt = null;
  els.install.textContent = 'Installed as app';
  els.install.disabled = true;
  showInstallHelp('Quire is installed. Open it from your apps or home screen.');
}

function initInstall() {
  if (isStandalone()) {
    markInstalled();
    return;
  }

  globalThis.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });
  globalThis.addEventListener('appinstalled', markInstalled);

  els.install.addEventListener('click', async () => {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') markInstalled();
      else showInstallHelp('Install was dismissed. You can try again from this button any time.');
      return;
    }
    if (isIOS()) {
      showInstallHelp('Tap the Share button, then choose Add to Home Screen.');
    } else {
      showInstallHelp("Open your browser's menu and choose Install app or Add to Home screen. Chrome and Edge also show an install icon in the address bar.");
    }
  });
}

/* ---------- start ---------- */

function start() {
  initTheme();
  initInstall();
  currentPlatform = detectPlatform(navigator);
  // The download button waits for the release. "Use in browser" is always there.
  hidePrimary();
  loadRelease();
}

start();
