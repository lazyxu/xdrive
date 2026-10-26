const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

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

test('PWA optional registration survives synchronous browser denial without blocking Web startup', async () => {
  // Execute transpiled production pwaRuntime.ts (not a copied approximation).
  // Vite's static DEV replacement is the sole source substitution.
  const production = runtime.replace('import.meta.env.DEV', 'false')
  assert.notEqual(production, runtime)
  const code = ts.transpileModule(production, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  function browser({ readyState = 'complete', fail = 'sync', secure = true } = {}) {
    let registered = 0
    const events = []
    const listeners = new Map()
    const win = {
      isSecureContext: secure,
      addEventListener(name, cb, options) { listeners.set(name, { cb, options }) },
      dispatchEvent(event) { events.push(event.type) },
    }
    const nav = {}
    Object.defineProperty(nav, 'serviceWorker', {
      configurable: true,
      enumerable: true,
      get() {
        if (fail === 'getter') throw new Error('restricted Service Worker getter')
        return {
          register(path, options) {
            registered++
            assert.equal(path, '/sw.js')
            assert.equal(options.scope, '/')
            assert.equal(options.updateViaCache, 'none')
            if (fail === 'sync') throw new Error('SecurityError: registration blocked')
            if (fail === 'async') return Promise.reject(new Error('registration denied'))
            return Promise.resolve({})
          },
        }
      },
    })
    const doc = { readyState }
    class BrowserEvent { constructor(type) { this.type = type } }
    const exports = {}
    new Function('exports', 'window', 'navigator', 'document', 'Event', code)(
      exports, win, nav, doc, BrowserEvent)
    return {
      register: exports.registerXDrivePwa,
      listeners, events,
      get registered() { return registered },
    }
  }

  for (const fail of ['getter', 'sync', 'async', 'success']) {
    const h = browser({ fail })
    assert.doesNotThrow(() => h.register(), 'optional SW ' + fail + ' must not throw')
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(h.registered, fail === 'getter' ? 0 : 1)
    assert.deepEqual(h.events, fail === 'success' ? ['xdrive-pwa-registered'] : [],
      'only a real successful registration may announce readiness')
  }
  for (const fail of ['getter', 'sync']) {
    const h = browser({ fail, readyState: 'loading' })
    h.register()
    assert.equal(h.registered, 0)
    assert.equal(h.listeners.get('load')?.options?.once, true)
    assert.doesNotThrow(() => h.listeners.get('load').cb())
    assert.equal(h.registered, fail === 'getter' ? 0 : 1)
  }
  const h = browser({ secure: false, fail: 'sync' })
  h.register()
  assert.equal(h.registered, 0, 'insecure origins never attempt SW registration')
})


test('Safari denied PWA registration capability getters cannot interrupt ordinary Web boot', () => {
  // Execute the actual Vite production source after replacing its DEV
  // compile-time constant; deliberately do not invent another registration
  // path or grant registration when the secure-context hint is unknown.
  const code = ts.transpileModule(runtime.replace('import.meta.env.DEV', 'false'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  function run(win, nav) {
    const mod = {}
    new Function('exports', 'window', 'navigator', 'document', 'Event', code)(
      mod, win, nav, { readyState: 'complete' }, class { constructor(type) { this.type = type } })
    mod.registerXDrivePwa()
  }
  let registrations = 0
  const safeNavigator = {
    serviceWorker: { register() { registrations++; return Promise.resolve({}) } },
  }
  const securedWindow = {
    isSecureContext: true,
    dispatchEvent() {},
    addEventListener() {},
  }
  const deniedSecure = { ...securedWindow }
  Object.defineProperty(deniedSecure, 'isSecureContext', {
    get() { throw new Error('SecurityError: secure-context getter denied') },
  })
  assert.doesNotThrow(() => run(deniedSecure, safeNavigator))
  assert.equal(registrations, 0, 'unknown security status cannot register SW')

  const deniedCapability = new Proxy(safeNavigator, {
    has(target, key) {
      if (key === 'serviceWorker') throw new Error('SecurityError: capability has-trap denied')
      return Reflect.has(target, key)
    },
  })
  assert.doesNotThrow(() => run(securedWindow, deniedCapability))
  assert.equal(registrations, 0, 'a denied capability test must not register SW')

  assert.doesNotThrow(() => run({ ...securedWindow, isSecureContext: false }, safeNavigator))
  assert.equal(registrations, 0, 'HTTP/nonsecure browser origin cannot register SW')
  assert.match(main, /root\.render\([\s\S]*?registerXDrivePwa\(\)/,
    'regular files/gallery first render still precedes optional registration')
})
