const CACHE_NAME = 'ams-brasil-lacrosse-v5';
const urlsToCache = [
  '/brazil-lacrosse-logo.png',
  '/icon-192.png',
  '/manifest.json'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.log('Cache install failed:', error);
      })
  );
  // NOTE: we intentionally do NOT call skipWaiting() here. A new service worker
  // stays in "waiting" so the app can show an "update available" prompt; it only
  // activates when the user confirms (via the SKIP_WAITING message below).
});

// Allow the app to trigger activation of a waiting worker (from the update prompt)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control immediately
  self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip API requests (always go to network)
  if (event.request.url.includes('/api/')) {
    return;
  }

  const req = event.request;
  const isNavigation = req.mode === 'navigate';
  const url = req.url;
  // App shell / code must always be fresh to avoid trapping users on a stale build
  const isAppShell = isNavigation ||
    url.endsWith('.html') ||
    url.includes('/static/js/') ||
    url.includes('/static/css/') ||
    url.endsWith('/service-worker.js');

  if (isAppShell) {
    // Network-first: fetch latest, fall back to cache only when offline
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Cache-first for other static assets (images, fonts, manifest)
  event.respondWith(
    caches.match(req).then((response) => {
      if (response) {
        return response;
      }
      return fetch(req).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseToCache);
        });
        return response;
      });
    })
  );
});

// Background sync for offline form submissions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  // Future: sync offline data when back online
  console.log('Syncing data...');
}

// Push notifications - PWA in-app reminders
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'AMS Brasil Lacrosse', body: event.data ? event.data.text() : 'Nova notificação' };
  }
  const title = data.title || 'AMS Brasil Lacrosse';
  const options = {
    body: data.body || 'Nova notificação',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    vibrate: [100, 50, 100],
    tag: data.tag || 'default',
    data: { url: data.url || '/', ts: Date.now() },
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'close', title: 'Fechar' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click on notification - focus or open the URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
