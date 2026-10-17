const CACHE_NAME = 'dailydash-v40-1.0.0';

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

// 마감 입력 알림 (웹 푸시) - 서버가 보낸 내용을 띄우고, 누르면 입력 화면을 연다.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const scope = self.registration.scope;
  event.waitUntil(self.registration.showNotification(data.title || 'DailyDash', {
    body: data.body || '',
    icon: new URL('icons/icon-192.png', scope).href,
    badge: new URL('icons/badge-96.png', scope).href,
    tag: data.tag || 'dailydash',
    data: { url: new URL(data.url || 'index.html', scope).href }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
