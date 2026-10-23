'use strict';

/* Network-first service worker.
   Online: every request revalidates with the server, so a new deploy reaches the
   Home Screen app on its next launch. Offline: the last good copy is served.
   The page itself checks for changes when the app is resumed (see checkUpdate in app.js). */

const CACHE = 'study-shell';
const CORE = [
  './', 'index.html', 'styles.css', 'icons.js', 'engine.js', 'kit.js', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'data/library.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req.url, res.clone()).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req.url, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
