// Network-first for the app's own files so updates show up right away; the cache is only the offline fallback.
const CACHE = 'creator-studio-v2';
const FILES = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './css/styles.css',
  './js/core.js', './js/formats.js', './js/create.js', './js/queue.js',
  './js/creators.js', './js/library.js', './js/settings.js', './js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
