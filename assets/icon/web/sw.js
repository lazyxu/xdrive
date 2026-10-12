/* xDrive's deliberately public-only PWA fallback. No API, file, media or auth cache. */
const OFFLINE_CACHE = 'xdrive-pwa-public-offline-v1'
const OFFLINE_PREFIX = 'xdrive-pwa-public-offline-'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', event => {
  // Do not skipWaiting: never replace a running transfer/viewer without its owner.
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache =>
    cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name =>
      name.startsWith(OFFLINE_PREFIX) && name !== OFFLINE_CACHE,
    ).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || request.mode !== 'navigate') return
  const url = new URL(request.url)
  // Scope is deliberately limited to the public SPA document. In particular,
  // /api/*, ticket downloads, media blobs and credentialed fetches never enter
  // a CacheStorage-backed response path, even if a browser navigates to them.
  if (url.origin !== self.location.origin || (url.pathname !== '/' && url.pathname !== '/index.html')) return
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(OFFLINE_CACHE)
    return (await cache.match(OFFLINE_URL)) || Response.error()
  }))
})
