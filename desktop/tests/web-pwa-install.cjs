const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const logicSource = read('web/src/pwaInstall.ts')

function harness({ userAgent = 'Chrome Android', mode = 'browser', secure = true, sw = true,
  protocol = 'https:', hostname = 'drive.example', fetchReply } = {}) {
  const events = new Map()
  const mediaEvents = new Map()
  const queries = []
  const win = {
    isSecureContext: secure,
    location: { protocol, hostname },
    addEventListener(name, callback) { events.set(name, callback) },
    matchMedia(query) {
      return { matches: query === '(display-mode: ' + mode + ')',
        addEventListener(name, fn) { mediaEvents.set(query, fn) } }
    },
  }
  const nav = { userAgent, platform: userAgent.includes('Mac') ? 'MacIntel' : 'Linux',
    maxTouchPoints: userAgent.includes('Touch') ? 5 : 0,
    ...(sw ? { serviceWorker: {} } : {}),
  }
  const answers = fetchReply ?? (url => ({ status: 200, headers: { get(name) {
    if (name === 'Content-Type') {
      if (url === '/site.webmanifest') return 'application/manifest+json'
      if (url === '/sw.js') return 'text/javascript'
      if (url === '/offline.html') return 'text/html'
      if (url.endsWith('.png')) return 'image/png'
      return 'text/html'
    }
    if (name === 'Cache-Control') {
      return url.endsWith('.png') ? 'public, max-age=604800' : 'no-cache, must-revalidate'
    }
    return null
  } } }))
  const request = async (url, options) => {
    queries.push([url, options])
    return answers(url, options)
  }
  const filename = path.join(root, 'web/src/pwaInstall.ts')
  const code = ts.transpileModule(logicSource, { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'window', 'navigator', 'fetch', code)(exports, win, nav, request)
  return { mod: exports, events, mediaEvents, queries, nav, win }
}

test('S2: install prompt is retained, invoked synchronously on user click and consumed only once', async () => {
  const { mod, events } = harness()
  const changes = []
  mod.startXDrivePwaInstallObservation()
  const unsubscribe = mod.subscribeXDrivePwaInstall(() => changes.push(mod.xDrivePwaInstallSnapshot()))
  let prevent = 0
  let promptCalls = 0
  const event = { preventDefault() { prevent += 1 }, prompt() {
    promptCalls += 1
    return Promise.resolve({ outcome: 'dismissed' })
  } }
  events.get('beforeinstallprompt')(event)
  assert.equal(prevent, 1)
  assert.equal(mod.xDrivePwaInstallSnapshot().promptAvailable, true)
  const pending = mod.requestXDrivePwaInstall()
  assert.equal(promptCalls, 1, 'native prompt must run synchronously before await')
  assert.equal(mod.xDrivePwaInstallSnapshot().promptAvailable, false)
  assert.equal(await pending, 'dismissed')
  assert.equal(await mod.requestXDrivePwaInstall(), 'unavailable')
  assert.equal(promptCalls, 1)
  assert.ok(changes.length >= 2)
  unsubscribe()
})

test('S2: mode is observed, but absence of prompt never means definitely not installed', async () => {
  const h = harness({ userAgent: 'iPhone Safari', mode: 'standalone' })
  h.mod.startXDrivePwaInstallObservation()
  assert.equal(h.mod.xDrivePwaInstallSnapshot().displayMode, 'standalone')
  assert.equal(h.mod.xDrivePwaInstallSnapshot().platformHint, 'ios')
  assert.equal(await h.mod.requestXDrivePwaInstall(), 'unavailable')
  let invoked = 0
  h.events.get('beforeinstallprompt')({ preventDefault() {}, prompt() { invoked += 1 } })
  assert.equal(await h.mod.requestXDrivePwaInstall(), 'unavailable')
  assert.equal(invoked, 0)
  h.events.get('appinstalled')()
  assert.equal(h.mod.xDrivePwaInstallSnapshot().installedEventObserved, true)
})

test('S2: iPad desktop-style UA is only a guidance hint; capability is event-based', () => {
  const h = harness({ userAgent: 'Mac OS Touch', mode: 'browser', sw: false, secure: false })
  h.mod.startXDrivePwaInstallObservation()
  const snapshot = h.mod.xDrivePwaInstallSnapshot()
  assert.equal(snapshot.platformHint, 'ios')
  assert.equal(snapshot.serviceWorkerSupported, false)
  assert.equal(snapshot.secureContext, false)
  assert.equal(snapshot.promptAvailable, false)
})

test('S2: no-credential HEAD diagnostics reject HTML SPA fallbacks and stale static caching', async () => {
  const h = harness({ fetchReply(url) {
    return { status: 200, headers: { get(name) {
      if (name === 'Content-Type') return url.includes('manifest') ? 'text/html' : 'text/javascript'
      if (name === 'Cache-Control') return url.includes('manifest') ? 'no-store' : 'public, max-age=86400'
      return null
    } } }
  } })
  const checks = await h.mod.checkXDrivePwaAssets()
  assert.deepEqual(checks.map(x => x.id + ':' + x.state), ['context:pass', 'transport:pass', 'manifest:fail', 'worker:warn', 'offline:fail', 'icon192:fail', 'icon512:fail'])
  assert.deepEqual(h.queries.map(([url]) => url), ['/site.webmanifest', '/sw.js', '/offline.html', '/pwa-192.png', '/pwa-512.png'])
  for (const [, options] of h.queries) {
    assert.equal(options.method, 'HEAD')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers?.Authorization, undefined)
  }
})

test('S2: blocked browser static resources return diagnostics not false install success', async () => {
  const h = harness({ secure: false, fetchReply() { throw Error('no connection') } })
  const checks = await h.mod.checkXDrivePwaAssets()
  assert.deepEqual(checks.map(x => x.state), ['fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
  assert.ok(checks[0].detail.includes('HTTPS'))
})

test('S2: UI entries exist before and after login, lazy-load the dialog and preserve Files routes', () => {
  const app = read('web/src/App.tsx')
  const main = read('web/src/main.tsx')
  const dialog = read('web/src/PwaInstallDialog.tsx')
  const contract = read('web/src/webAppRuntime.ts')
  const roadmap = read('docs/pwa-delivery.md')
  assert.ok(app.includes("lazy(() => import('./PwaInstallDialog'))"))
  assert.ok(app.includes('data-xdrive-pwa-account-entry'))
  assert.ok(app.includes('data-xdrive-pwa-login-entry'))
  assert.ok(dialog.includes('data-xdrive-pwa-prompt'))
  assert.ok(dialog.includes('data-xdrive-pwa-check'))
  assert.ok(dialog.includes('requestXDrivePwaInstall()'))
  assert.ok(dialog.includes('checkXDrivePwaAssets({ signal: controller.signal })'))
  assert.ok(dialog.includes('离线页和安装图标发起无凭据 HEAD 请求'))
  assert.ok(dialog.includes('区分实际 HTTPS 与本机 HTTP 安全上下文'))
  assert.ok(main.includes('startXDrivePwaInstallObservation()'))
  assert.ok(contract.includes('window.location.hash'))
  assert.ok(app.includes('<XDriveMobileAppHeader'))
  assert.ok(roadmap.includes('PWA-S2A'))
  assert.doesNotMatch(logicSource, /localStorage|sessionStorage|Authorization|api\/v1|window\.location\.reload/)
})


test('S2B4: loopback secure context is a warning, not fake public HTTPS readiness', async () => {
  const h = harness({ protocol: 'http:', hostname: '127.0.0.1' })
  const checks = await h.mod.checkXDrivePwaAssets()
  assert.equal(checks[0].id, 'context')
  assert.equal(checks[0].state, 'pass')
  assert.equal(checks[1].id, 'transport')
  assert.equal(checks[1].state, 'warn')
  assert.match(checks[1].detail, /本机 HTTP/)
  assert.deepEqual(checks.slice(2).map(x => x.state),
    ['pass', 'pass', 'pass', 'pass', 'pass'])
  assert.equal(h.queries.length, 5)
})

test('S2B4: icon long-cache is valid but a 200 HTML SPA fallback is not a PNG', async () => {
  const h = harness({ fetchReply(url) {
    return { status: 200, headers: { get(name) {
      if (name === 'Content-Type') return url === '/pwa-512.png' ? 'text/html'
        : url === '/site.webmanifest' ? 'application/manifest+json'
          : url === '/sw.js' ? 'text/javascript'
            : url === '/offline.html' ? 'text/html' : 'image/png'
      return 'public, max-age=86400'
    } } }
  } })
  const checks = await h.mod.checkXDrivePwaAssets()
  assert.equal(checks.find(x => x.id === 'manifest').state, 'warn')
  assert.equal(checks.find(x => x.id === 'worker').state, 'warn')
  assert.equal(checks.find(x => x.id === 'offline').state, 'warn')
  assert.equal(checks.find(x => x.id === 'icon192').state, 'pass',
    'versioned public install icon is allowed a long static cache')
  assert.equal(checks.find(x => x.id === 'icon512').state, 'fail')
})

test('S2B4: unsafe non-loopback HTTP cannot be mistaken for mobile HTTPS', async () => {
  const h = harness({ protocol: 'http:', hostname: 'drive.example', secure: false })
  const checks = await h.mod.checkXDrivePwaAssets()
  assert.equal(checks[0].state, 'fail')
  assert.equal(checks[1].state, 'fail')
  assert.match(checks[1].detail, /HTTPS/)
})

function successfulPublicHead(url) {
  const mime = url === '/site.webmanifest' ? 'application/manifest+json'
    : url === '/sw.js' ? 'text/javascript'
      : url === '/offline.html' ? 'text/html' : 'image/png'
  return { status: 200, headers: { get(name) {
    return name === 'Content-Type' ? mime : name === 'Cache-Control'
      ? 'no-cache, must-revalidate' : null
  } } }
}

test('S2B8: five public HEADs start concurrently and the single 6s maximum budget aborts a hung one', async () => {
  let cancelled = 0
  const h = harness({ fetchReply(url, options) {
    if (url !== '/sw.js') return successfulPublicHead(url)
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        cancelled++
        reject(new Error('aborted'))
      }, { once: true })
    })
  } })
  const resultPromise = h.mod.checkXDrivePwaAssets({ timeoutMs: 30 })
  assert.deepEqual(h.queries.map(([url]) => url),
    ['/site.webmanifest', '/sw.js', '/offline.html', '/pwa-192.png', '/pwa-512.png'],
    'requests must begin in parallel rather than five serial waits')
  const result = await resultPromise
  assert.equal(cancelled, 1)
  assert.deepEqual(result.map(x => x.id), [
    'context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512',
  ], 'result order remains stable despite parallel completion')
  assert.deepEqual(result.map(x => x.state), ['pass', 'pass', 'pass', 'fail', 'pass', 'pass', 'pass'])
  assert.match(result[3].detail, /超时/)
  for (const [, options] of h.queries) {
    assert.equal(options.method, 'HEAD')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.mode, 'same-origin')
    assert(options.signal instanceof AbortSignal)
  }
})

test('S2B8: closing a diagnosis cancels all outstanding fetches without private calls or timer leaks', async () => {
  const source = new AbortController()
  let aborted = 0
  const h = harness({ fetchReply(_url, options) {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted++
        reject(new Error('aborted'))
      }, { once: true })
    })
  } })
  const pending = h.mod.checkXDrivePwaAssets({ signal: source.signal, timeoutMs: 1000 })
  assert.equal(h.queries.length, 5)
  source.abort()
  const result = await pending
  assert.equal(aborted, 5)
  assert.deepEqual(result.slice(2).map(x => x.state), Array(5).fill('fail'))
  assert(result.slice(2).every(x => /取消/.test(x.detail)))
  assert.deepEqual(h.queries.map(([url]) => url),
    ['/site.webmanifest', '/sw.js', '/offline.html', '/pwa-192.png', '/pwa-512.png'])
  const dialog = read('web/src/PwaInstallDialog.tsx')
  for (const term of ['inspectionRef.current?.abort()', 'checkXDrivePwaAssets({ signal: controller.signal })',
    '!controller.signal.aborted', 'inspectionRef.current = null']) {
    assert(dialog.includes(term), 'missing component cancellation: ' + term)
  }
})

test('S2B8: an already cancelled check must issue zero network requests', async () => {
  const source = new AbortController()
  source.abort()
  const h = harness()
  const result = await h.mod.checkXDrivePwaAssets({ signal: source.signal })
  assert.equal(h.queries.length, 0)
  assert(result.slice(2).every(x => /取消/.test(x.detail)))
})
