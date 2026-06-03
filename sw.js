const CACHE_NAME = 'dailydash-v27-safe-stats';
const urlsToCache = [
  './',
  'index.html',
  'login.html',
  'style.css',
  'src/app.js',
  'src/auth.js',
  'src/guard.js',
  'src/services/supabaseClient.js',
  'src/shared/modal.js',
  'src/shared/format.js',
  'src/shared/date.js',
  'src/shared/dom.js',
  'src/features/analytics.js',
  'icon.jpeg',
  'favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
