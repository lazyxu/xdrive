/* Public xDrive App Shell only. Never cache /api, auth, tickets, media, or owner data. */
const OFFLINE_CACHE = 'xdrive-pwa-public-offline-v1'
const OFFLINE_PREFIX = 'xdrive-pwa-public-offline-'
const OFFLINE_URL = '/offline.html'
const SHELL_PREFIX = 'xdrive-pwa-public-shell-'
// The production build replaces these two constants using the Vite manifest.
const SHELL_REVISION = 'template'
const SHELL_URLS = []
const SHELL_CACHE = SHELL_PREFIX + SHELL_REVISION
const SHELL_PATHS = new Set(SHELL_URLS)

function shellMimeOK(pathname, response) {
  if (!response || !response.ok || response.redirected || response.type === 'opaque') return false
  const kind = response.headers.get('Content-Type') || ''
  if (pathname === '/index.html') return /^text\/html\b/i.test(kind)
  if (/\.js$/.test(pathname)) return /^(text|application)\/(javascript|ecmascript)\b/i.test(kind)
  if (/\.css$/.test(pathname)) return /^text\/css\b/i.test(kind)
  if (/\.svg$/.test(pathname)) return /^image\/svg\+xml\b/i.test(kind)
  if (/\.png$/.test(pathname)) return /^image\/png\b/i.test(kind)
  if (/\.webp$/.test(pathname)) return /^image\/webp\b/i.test(kind)
  if (/\.woff2?$/.test(pathname)) return /^font\/woff2?\b/i.test(kind)
  return false
}

async function installShellCache() {
  if (!SHELL_URLS.length) return
  const cache = await caches.open(SHELL_CACHE)
  // Bound concurrency limits installation memory pressure on iOS.
  for (let i = 0; i < SHELL_URLS.length; i += 4) {
    await Promise.all(SHELL_URLS.slice(i, i + 4).map(async pathname => {
      const request = new Request(pathname, {
        cache: 'reload', credentials: 'omit', redirect: 'error',
      })
      const response = await fetch(request)
      if (!shellMimeOK(pathname, response)) throw new Error('Invalid public shell resource: ' + pathname)
      await cache.put(pathname, response)
    }))
  }
}

self.addEventListener('install', event => {
  // Do not skipWaiting: never replace a running transfer/viewer without its owner.
  event.waitUntil(Promise.all([
    caches.open(OFFLINE_CACHE).then(cache =>
      cache.add(new Request(OFFLINE_URL, { cache: 'reload', credentials: 'omit' }))),
    installShellCache(),
  ]))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name =>
      (name.startsWith(OFFLINE_PREFIX) && name !== OFFLINE_CACHE) ||
      (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE),
    ).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Only / and /index.html are document entry points; no private navigations.
  if (request.mode === 'navigate') {
    if (url.pathname !== '/' && url.pathname !== '/index.html') return
    event.respondWith((async () => {
      if (SHELL_PATHS.has('/index.html')) {
        const shell = await caches.open(SHELL_CACHE)
        const hit = await shell.match('/index.html')
        if (hit) return hit
      }
      try { return await fetch(request) } catch {
        const offline = await caches.open(OFFLINE_CACHE)
        return (await offline.match(OFFLINE_URL)) || Response.error()
      }
    })())
    return
  }
  // Exact precache manifest URL matches only. Network access stays untouched for
  // /api/*, previews, originals, shares, Range, cookies, and opaque requests.
  if (!SHELL_PATHS.has(url.pathname) || request.headers.get('Authorization') ||
      request.headers.get('Range')) return
  event.respondWith(caches.open(SHELL_CACHE).then(cache =>
    cache.match(url.pathname)).then(response => response || fetch(request)))
})
