const CACHE_NAME = 'dashboard-v1';
const SHELL_ASSETS = [
  '/dashboard.html',
  '/dashboard-manifest.json',
  '/favicon.svg',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700;800&display=swap'
];

// Install: pre-cache the dashboard shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, but don't fail install if fonts are unavailable
      return cache.addAll(['/dashboard.html', '/dashboard-manifest.json', '/favicon.svg'])
        .catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
//   API calls (cloud worker / hub) → network-only, never cache
//   Navigation (the dashboard page itself) → network-first, fall back to cache
//   Everything else (fonts, icons) → cache-first, fall back to network
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // API calls: pure network-only, no caching
  if (
    url.includes('workers.dev') ||
    url.includes('localhost:3457') ||
    url.includes('/api/')
  ) {
    return; // Let browser handle natively
  }

  // Navigation: network-first so we always get fresh HTML
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match('/dashboard.html'))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
