// Network-first for the app's own files so updates show up right away; the cache is only the offline fallback.
// cache:'no-cache' makes the browser re-check with the server instead of trusting its own ~10 minute HTTP cache.
const CACHE = 'creator-studio-v4';
const FILES = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './css/styles.css',
  './js/core.js',
  './js/zip.js',
  './js/media.js',
  './js/imagegen.js',
  './js/higgs.js',
  './js/recipes.js',
  './js/postkit.js',
  './js/factory.js',
  './js/formats.js',
  './js/create.js',
  './js/create-ext.js',
  './js/produce.js',
  './js/queue.js',
  './js/creators.js',
  './js/files.js',
  './js/library.js',
  './js/playbook.js',
  './js/settings.js',
  './js/app.js'
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
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
