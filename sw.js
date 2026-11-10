/**
 * Quire service worker. It caches the app shell so Quire opens with no
 * connection, and it keeps the cache fresh: every successful network answer
 * replaces the cached copy, so a normal online load always runs the newest files.
 * Entries never pass through here. They live in IndexedDB on the device.
 */

const CACHE = 'quire-shell-v1';

// Installed up front so the first offline open works. Keep this in step with the
// files the app loads. Anything missing here is cached the first time it loads.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/quire-icon.svg',
  './assets/favicon.svg',
  './assets/icon-32.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/aero-wallpaper.svg',
  './assets/luna-hills.svg',
  './styles/app.css',
  './styles/reader.css',
  './styles/live.css',
  './styles/home.css',
  './styles/gadgets.css',
  './styles/vista.css',
  './styles/versions.css',
  './styles/skins.css',
  './styles/options.css',
  './styles/pwa.css',
  './styles/lock.css',
  './styles/mixtape.css',
  './styles/focus.css',
  './styles/capsule.css',
  './styles/screensaver.css',
  './src/main.js',
  './src/ambient.js',
  './src/app.js',
  './src/gadgets.js',
  './src/gadget-views.js',
  './src/dialogs.js',
  './src/dom.js',
  './src/focus.js',
  './src/drawing.js',
  './src/export.js',
  './src/history.js',
  './src/home.js',
  './src/capsule.js',
  './src/capsule-ui.js',
  './src/icons.js',
  './src/journal.js',
  './src/layers.js',
  './src/library.js',
  './src/livemarkup.js',
  './src/livetext.js',
  './src/lock.js',
  './src/markdown.js',
  './src/media.js',
  './src/menubar.js',
  './src/options.js',
  './src/model.js',
  './src/mixtape.js',
  './src/mixtape-view.js',
  './src/postcard.js',
  './src/yearpixels.js',
  './src/prefs.js',
  './src/prompts.js',
  './src/pwa.js',
  './src/skins.js',
  './src/screensaver.js',
  './src/screensaver-scenes.js',
  './src/screensaver-custom.js',
  './src/screensaver-editor.js',
  './src/snap.js',
  './src/sketch.js',
  './src/sound.js',
  './src/splash.js',
  './src/vault.js',
  './src/storage.js',
  './src/tools.js',
  './src/textops.js',
  './src/versions.js',
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
