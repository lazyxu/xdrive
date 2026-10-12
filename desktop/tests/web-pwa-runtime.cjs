const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..', '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const worker = read('assets', 'icon', 'web', 'sw.js')
const offline = read('assets', 'icon', 'web', 'offline.html')
const runtime = read('web', 'src', 'pwaRuntime.ts')
const main = read('web', 'src', 'main.tsx')
const caddy = read('deploy', 'Caddyfile.common')

function harness(shouldFail = false) {
  const events = new Map()
  const stores = new Map([['xdrive-pwa-public-offline-old', new Map()], ['unrelated-cache', new Map()]])
  const calls = []
  const response = { status: 200, tag: 'network' }
  let claimed = false
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)
      return {
        async add(request) { store.set(request.url, { tag: 'public-offline' }) },
        async match(url) { return store.get(url) },
      }
    },
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) },
  }
  const self = {
    location: { origin: 'https://drive.example' },
    clients: { async claim() { claimed = true } },
    addEventListener(kind, handler) { events.set(kind, handler) },
  }
  vm.runInNewContext(worker, {
    self, caches,
    Request: class { constructor(url, options) { this.url = url; this.options = options } },
    Response: { error: () => ({ tag: 'network-error' }) },
    URL,
    fetch: request => { calls.push(request.url); return shouldFail ? Promise.reject(Error('offline')) : Promise.resolve(response) },
  }, { filename: 'sw.js' })
  const dispatched = (kind, request) => {
    let promise
    events.get(kind)({
      request,
      waitUntil(value) { promise = value },
      respondWith(value) { promise = value },
    })
    return promise
  }
  return { stores, calls, response, dispatched, get claimed() { return claimed } }
}

test('PWA registers only for secure production Web app, not desktop/perf harnesses', () => {
  assert.match(runtime, /import\.meta\.env\.DEV/)
  assert.match(runtime, /window\.isSecureContext/)
  assert.match(runtime, /navigator\.serviceWorker\.register\('\/sw\.js'/)
  assert.match(runtime, /updateViaCache: 'none'/)
  assert.match(runtime, /window\.addEventListener\('load', register, \{ once: true \}\)/)
  assert.match(main, /import \{ registerXDrivePwa \} from '\.\/pwaRuntime'/)
  assert.match(main, /<React\.StrictMode>[\s\S]*?<Root \/>[\s\S]*?<\/React\.StrictMode>[\s\S]*?registerXDrivePwa\(\)/)
  assert.equal((main.match(/registerXDrivePwa\(\)/g) ?? []).length, 1)
})

test('PWA offline shell contains no private data or fetched CSS/JS dependency', () => {
  assert.match(offline, /<html lang="zh-CN">/)
  assert.match(offline, /href=""/)
  assert.match(offline, /暂时无法连接 xDrive/)
  assert.doesNotMatch(offline, /<script|<link[^>]+(?:stylesheet|href="https?:)|<img/)
  assert.match(caddy, /@pwa_static path \/sw\.js \/site\.webmanifest \/offline\.html/)
  assert.match(caddy, /header @pwa_static Cache-Control "no-cache, must-revalidate"/)
})

test('worker installs one publicly safe fallback, claims without skipWaiting and preserves unrelated caches', async () => {
  const h = harness()
  await h.dispatched('install')
  assert.deepEqual([...h.stores.get('xdrive-pwa-public-offline-v1').keys()], ['/offline.html'])
  await h.dispatched('activate')
  assert.equal(h.claimed, true)
  assert.equal(h.stores.has('xdrive-pwa-public-offline-old'), false)
  assert.equal(h.stores.has('unrelated-cache'), true)
  assert.doesNotMatch(worker, /\.skipWaiting\s*\(|caches\.match\(request\)|\.put\(request/)
})

test('worker serves SPA navigation from network and shows public offline page on network failure', async () => {
  for (const fail of [false, true]) {
    const h = harness(fail)
    await h.dispatched('install')
    const request = { method: 'GET', mode: 'navigate', url: 'https://drive.example/#/app/files?dir=12' }
    const result = await h.dispatched('fetch', request)
    assert.equal(result.tag, fail ? 'public-offline' : 'network')
    assert.deepEqual(h.calls, [request.url])
  }
})

test('worker never intercepts API, file tickets, media, non-navigation or other origins', async () => {
  const h = harness(true)
  await h.dispatched('install')
  for (const input of [
    { method: 'GET', mode: 'navigate', url: 'https://drive.example/api/v1/download/ticket' },
    { method: 'GET', mode: 'navigate', url: 'https://drive.example/api/v1/media/thumbnail/123' },
    { method: 'GET', mode: 'navigate', url: 'https://drive.example/share/secret' },
    { method: 'GET', mode: 'cors', url: 'https://drive.example/' },
    { method: 'POST', mode: 'navigate', url: 'https://drive.example/' },
    { method: 'GET', mode: 'navigate', url: 'https://other.example/' },
  ]) {
    assert.equal(h.dispatched('fetch', input), undefined, JSON.stringify(input))
  }
  assert.equal(h.calls.length, 0)
  assert.equal([...h.stores.get('xdrive-pwa-public-offline-v1').keys()].length, 1)
})
