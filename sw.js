/**
 * Quire service worker. It caches the app shell so Quire opens with no
 * connection, and it keeps the cache fresh: every successful network answer
 * replaces the cached copy, so a normal online load always runs the newest files.
 * Entries never pass through here. They live in IndexedDB on the device.
 */

const CACHE = 'quire-shell-v2';

// Installed up front so the first offline open works. Keep this in step with the
// files the app loads: tests/pwa.test.js fails when a file under src/, styles/ or
// assets/ is missing from this list.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/aero-wallpaper.svg',
  './assets/apple-touch-icon.png',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-32.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/luna-hills.svg',
  './assets/quire-icon.svg',
  './styles/app.css',
  './styles/capsule.css',
  './styles/dropdown.css',
  './styles/focus.css',
  './styles/gadgets.css',
  './styles/home.css',
  './styles/live.css',
  './styles/lock.css',
  './styles/mixtape.css',
  './styles/navigation.css',
  './styles/options.css',
  './styles/print.css',
  './styles/pwa.css',
  './styles/reader.css',
  './styles/screensaver.css',
  './styles/skins.css',
  './styles/touch.css',
  './styles/versions.css',
  './styles/vista.css',
  './src/ambient.js',
  './src/app.js',
  './src/capsule-ui.js',
  './src/capsule.js',
  './src/contextmenu.js',
  './src/controller/build-ui.js',
  './src/controller/capsule-actions.js',
  './src/controller/chrome.js',
  './src/controller/constants.js',
  './src/controller/entries.js',
  './src/controller/export-actions.js',
  './src/controller/focus-mode.js',
  './src/controller/helpers.js',
  './src/controller/ink-canvas.js',
  './src/controller/keyboard.js',
  './src/controller/layer-actions.js',
  './src/controller/magnifier.js',
  './src/controller/mixtape.js',
  './src/controller/navigation.js',
  './src/controller/routes.js',
  './src/controller/routing.js',
  './src/controller/saving.js',
  './src/controller/selection.js',
  './src/controller/shapes-spray.js',
  './src/controller/text-boxes.js',
  './src/controller/text-editing.js',
  './src/controller/tool-modes.js',
  './src/controller/toolbox-rows.js',
  './src/controller/transforms.js',
  './src/controller/version-actions.js',
  './src/dashboard.js',
  './src/dialogs.js',
  './src/dropdown.js',
  './src/dom.js',
  './src/drawing.js',
  './src/export.js',
  './src/focus.js',
  './src/gadget-views.js',
  './src/gadgets.js',
  './src/habits.js',
  './src/voice.js',
  './src/gestures.js',
  './src/history.js',
  './src/home.js',
  './src/icon-pixels.js',
  './src/icons.js',
  './src/import.js',
  './src/journal.js',
  './src/keypen.js',
  './src/layers.js',
  './src/library.js',
  './src/livemarkup.js',
  './src/livetext.js',
  './src/lock.js',
  './src/main.js',
  './src/markdown.js',
  './src/media.js',
  './src/memories.js',
  './src/menubar.js',
  './src/mixtape-view.js',
  './src/mixtape.js',
  './src/nav-sections.js',
  './src/model.js',
  './src/onboarding.js',
  './src/options.js',
  './src/palette-search.js',
  './src/palette.js',
  './src/postcard.js',
  './src/prefs.js',
  './src/print-docs.js',
  './src/print-extras.js',
  './src/printing.js',
  './src/prompts.js',
  './src/pwa.js',
  './src/recap.js',
  './src/savedsearches.js',
  './src/screensaver-custom.js',
  './src/screensaver-editor.js',
  './src/screensaver-scenes.js',
  './src/screensaver.js',
  './src/sketch.js',
  './src/skins.js',
  './src/snap.js',
  './src/sound.js',
  './src/splash.js',
  './src/storage.js',
  './src/textops.js',
  './src/tools.js',
  './src/touch.js',
  './src/vault.js',
  './src/versions.js',
  './src/wikilinks.js',
  './src/yearpixels.js',
  './src/zip.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // An unknown page while offline falls back to the app itself, which then routes by hash.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

// Tapping a reminder focuses an open Quire window, or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? new URL('./', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    }),
  );
});
