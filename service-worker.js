/**
 * SilentBridge - 100% Offline & Live-Sync Service Worker
 * Network-First Strategy: Always fetches the latest live updates when online,
 * with instantaneous Cache Fallback for 100% offline airplane mode execution.
 */

const CACHE_NAME = 'silentbridge-live-v3-instant';
const STATIC_ASSETS = [
  './',
  './sender.html',
  './receiver.html',
  './index.html',
  './app.js',
  './audioModem.js',
  './packetEngine.js',
  './crc16.js',
  './manifest.json'
];

// Install: Pre-cache all offline assets and skip waiting immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SilentBridge SW] Pre-caching latest application assets...');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate: Purge ALL previous cache versions and claim clients instantly
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SilentBridge SW] Purging old stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-First strategy for real-time live updates, cache fallback for offline
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline Fallback: Serve from cache when without internet
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./sender.html') || caches.match('./index.html');
          }
        });
      })
  );
});
