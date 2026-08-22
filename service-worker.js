/**
 * SilentBridge - 100% Offline Service Worker (Cache-First Strategy)
 * Enables instant app execution in towerless, zero-internet, and airplane mode disaster zones.
 */

const CACHE_NAME = 'silentbridge-offline-v2';
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

// Install: Pre-cache all offline assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SilentBridge SW] Pre-caching offline application assets...');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SilentBridge SW] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Cache-First strategy with network fallback
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Offline fallback
        if (event.request.mode === 'navigate') {
          return caches.match('./sender.html');
        }
      });
    })
  );
});
