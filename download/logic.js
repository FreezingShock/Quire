/**
 * Pure helpers for the download page: spotting the visitor's computer, sorting
 * the installers that a GitHub release carries, and turning a release into the
 * rows the page shows. Nothing here touches the DOM, so tests/download.test.js
 * can check it directly.
 */

export const REPO_OWNER = 'FreezingShock';
export const REPO_NAME = 'Quire';
export const RELEASES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

export const PLATFORMS = Object.freeze([
  { id: 'windows', label: 'Windows', short: 'Windows' },
  { id: 'mac', label: 'macOS', short: 'Mac' },
  { id: 'linux', label: 'Linux', short: 'Linux' },
]);

/** What each installer file is, in words a person would use. */
const KINDS = Object.freeze({
  exe: { label: 'Installer', rank: 0 },
  msi: { label: 'MSI package', rank: 1 },
  dmg: { label: 'Disk image', rank: 0 },
  appimage: { label: 'AppImage (no install)', rank: 0 },
  deb: { label: 'Debian / Ubuntu package', rank: 1 },
  rpm: { label: 'Fedora / openSUSE package', rank: 2 },
});

/** Chips the page can name: the architecture a file was built for. */
const ARCH_LABELS = Object.freeze({
  arm64: 'Apple silicon / ARM',
  x64: 'Intel / AMD 64-bit',
  universal: 'Universal',
});

/** Which architecture to offer first, when the browser cannot say. */
const DEFAULT_ARCH = Object.freeze({ windows: 'x64', mac: 'arm64', linux: 'x64' });

/**
 * Guess the visitor's operating system from the browser's navigator.
 * Returns 'windows', 'mac', 'linux', 'mobile', or 'other'.
 * Phones are checked first, because Android reports "Linux" and iPadOS reports "Mac".
 */
export function detectPlatform(nav = {}) {
  const ua = String(nav.userAgent ?? '');
  const hint = String(nav.userAgentData?.platform ?? '');
  const legacy = String(nav.platform ?? '');
  const touchPoints = Number(nav.maxTouchPoints ?? 0);

  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return 'mobile';
  // iPadOS asks for the desktop site, so it reports "Mac" with a touch screen.
  if (/mac/i.test(legacy) && touchPoints > 1) return 'mobile';
  // The user agent comes first: the legacy platform string can say "Linux" on a Windows browser.
  return osFrom(ua) ?? osFrom(hint) ?? osFrom(legacy) ?? 'other';
}

function osFrom(text) {
  if (/windows|win32|win64|wow64/i.test(text)) return 'windows';
  if (/macintosh|mac os x|macos|macintel|\bmac\b/i.test(text)) return 'mac';
  // Chrome OS reports "X11; CrOS", and it has no desktop installer.
  if (/cros/i.test(text)) return null;
  if (/linux|x11/i.test(text)) return 'linux';
  return null;
}

/** The architecture a visitor probably wants, when the browser does not say. */
export function guessArch(platform) {
  return DEFAULT_ARCH[platform] ?? 'x64';
}

/**
 * Read one release asset file name, such as "Quire_0.1.0_x64-setup.exe" or
 * "quire_0.1.0_arm64.dmg". Returns null for files that are not installers
 * (signature files, update manifests, source archives).
 */
export function classifyAsset(name) {
  const file = String(name ?? '');
  const lower = file.toLowerCase();
  let platform = null;
  let kind = null;

  if (/\.exe$/.test(lower)) [platform, kind] = ['windows', 'exe'];
  else if (/\.msi$/.test(lower)) [platform, kind] = ['windows', 'msi'];
  else if (/\.dmg$/.test(lower)) [platform, kind] = ['mac', 'dmg'];
  else if (/\.appimage$/.test(lower)) [platform, kind] = ['linux', 'appimage'];
  else if (/\.deb$/.test(lower)) [platform, kind] = ['linux', 'deb'];
  else if (/\.rpm$/.test(lower)) [platform, kind] = ['linux', 'rpm'];
  if (!platform) return null;

  let arch = 'universal';
  if (/aarch64|arm64/.test(lower)) arch = 'arm64';
  else if (/x64|x86_64|amd64/.test(lower)) arch = 'x64';
  else if (platform !== 'mac') arch = 'x64';

  return { platform, kind, arch, kindLabel: KINDS[kind].label, archLabel: ARCH_LABELS[arch] };
}

/** Sort rank: the architecture that matches first, then the kind of installer. */
function rankOf(asset, wantArch) {
  const archRank = asset.arch === wantArch ? 0 : asset.arch === 'universal' ? 1 : 2;
  return [archRank, KINDS[asset.kind].rank];
}

function compareRanks(a, b) {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * Turn the assets of one GitHub release into the page's view model.
 * Installers only, in the order the page shows them: each platform, then its
 * best match first. `primary` is the file to offer for `platform`, or null.
 */
export function planDownloads(release, platform = 'other') {
  const assets = (release?.assets ?? [])
    .map((asset) => {
      const info = classifyAsset(asset.name);
      if (!info || !isTrustedDownload(asset.browser_download_url)) return null;
      return {
        name: asset.name,
        url: asset.browser_download_url,
        size: Number(asset.size) || 0,
        ...info,
      };
    })
    .filter(Boolean);

  const wantArch = guessArch(platform);
  const groups = PLATFORMS.map((meta) => {
    const items = assets
      .filter((asset) => asset.platform === meta.id)
      .sort((a, b) => {
        const order = compareRanks(rankOf(a, wantArch), rankOf(b, wantArch));
        return order || a.name.localeCompare(b.name);
      });
    return { ...meta, items };
  }).filter((group) => group.items.length > 0);

  const forThisComputer = groups.find((group) => group.id === platform);
  const primary = forThisComputer?.items[0] ?? null;

  return { groups, primary, assetCount: assets.length };
}

/** Only links to this repository's GitHub downloads are rendered, never anything else from the API. */
export function isTrustedDownload(url) {
  return typeof url === 'string' && url.startsWith(`https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/`);
}

/** "Quire v0.1.0" style title from a release tag such as "v0.1.0" or "app-v0.1.0". */
export function versionOf(release) {
  const tag = String(release?.tag_name ?? release?.name ?? '').trim();
  const match = tag.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : tag;
}

/** A human size such as "84.2 MB". */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** A short date such as "Nov 13, 2026" from an ISO timestamp. */
export function formatDate(iso, locale = 'en-US') {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Pick the page state from what the GitHub request returned.
 * `status` is the HTTP status, or null when the request failed outright.
 */
export function releaseState({ status, body }) {
  if (status === 404) return { state: 'none' };
  if (status === null || status === undefined || status >= 400) return { state: 'error' };
  const release = body && typeof body === 'object' ? body : null;
  if (!release) return { state: 'error' };
  return { state: 'ready', release };
}
