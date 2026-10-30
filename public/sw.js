const CACHE = 'ciblix-v2';
const PRECACHE = [
  '/',
  '/connexion',
  '/styles.css',
  '/homepage.css',
  '/app.js',
  '/homepage.js',
  '/i18n.js',
  '/auth-ui.js',
  '/legal.js',
  '/live.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/assets/icon-ciblix.png',
  '/assets/logo-ciblix.png',
  '/assets/pwa-192.png',
  '/assets/pwa-512.png',
  '/assets/pwa-maskable-192.png',
  '/assets/pwa-maskable-512.png',
  '/fonts/InterVariable.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('/') : undefined);
    if (cached) return cached;
    throw error;
  }
}
