const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const logicSource = read('web/src/pwaInstall.ts')

function harness({ userAgent = 'Chrome Android', mode = 'browser', secure = true, sw = true, fetchReply } = {}) {
  const events = new Map()
  const mediaEvents = new Map()
  const queries = []
  const win = {
    isSecureContext: secure,
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
  const answers = fetchReply ?? (() => ({ status: 200, headers: { get(name) {
    return name === 'Content-Type' ? 'application/manifest+json' : 'no-cache, must-revalidate'
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
  assert.deepEqual(checks.map(x => x.id + ':' + x.state), ['context:pass', 'manifest:fail', 'worker:warn'])
  assert.deepEqual(h.queries.map(([url]) => url), ['/site.webmanifest', '/sw.js'])
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
  assert.deepEqual(checks.map(x => x.state), ['fail', 'fail', 'fail'])
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
  assert.ok(dialog.includes('checkXDrivePwaAssets()'))
  assert.ok(main.includes('startXDrivePwaInstallObservation()'))
  assert.ok(contract.includes('window.location.hash'))
  assert.ok(app.includes('<XDriveMobileAppHeader'))
  assert.ok(roadmap.includes('PWA-S2A'))
  assert.doesNotMatch(logicSource, /localStorage|sessionStorage|Authorization|api\/v1|window\.location\.reload/)
})
