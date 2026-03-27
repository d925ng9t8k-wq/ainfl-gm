const CACHE_NAME = 'pilot-v1';
const ASSETS = [
  '/pilot-chat.html',
  '/pilot-manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes('/message') || e.request.url.includes('/health')) {
    return; // Let API calls go through normally
  }
  e.addEventListener('fetch', () => {});
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push notification support
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : { title: 'Pilot', body: 'New message from your Pilot' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'Pilot | 9 Enterprises', {
      body: data.body || 'You have a new message',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const client of list) {
        if (client.url.includes('pilot-chat') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/pilot-chat.html');
    })
  );
});
