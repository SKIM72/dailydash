const CACHE_NAME = 'dailydash-v37-compare';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('dailydash-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // 정산 데이터(API)는 항상 서버에서 새로 받는다. 캐시된 옛 숫자를 보여주지 않기 위함.
  if (url.pathname.startsWith('/api/')) return;
  // 앱 설치 파일(APK)과 앱 인증 파일은 크거나 항상 최신이어야 하므로 캐시하지 않는다.
  if (url.pathname.includes('/downloads/') || url.pathname.includes('/.well-known/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
