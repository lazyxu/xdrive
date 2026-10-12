const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const runtimeFile = path.join(__dirname, '..', '..', 'web', 'src', 'webAppRuntime.ts')
const runtimeText = fs.readFileSync(runtimeFile, 'utf8')

function parseHash(hash) {
  const match = /^#\/app\/([a-z-]+)(?:\?(.+))?$/.exec(hash)
  if (!match) return null
  if (match[1] === 'admin-services') {
    const query = new URLSearchParams(match[2] || '')
    return { app: match[1], params: {
      ...(query.has('service') ? { service: query.get('service') } : {}),
      ...(query.has('tab') ? { tab: query.get('tab') } : {}),
    } }
  }
  return { app: match[1], params: {} }
}
function routeHash(route) {
  const params = new URLSearchParams(route.params)
  return '#/app/' + route.app + (params.size ? '?' + params.toString() : '')
}

function createHarness() {
  const listeners = new Map()
  const window = {
    location: { hash: '#/app/files', href: 'https://xdrive.test/#/app/files' },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    open() {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
    dispatch(type) { for (const fn of listeners.get(type) || []) fn({ type }) },
  }
  const hashFrom = (url) => {
    const n = String(url).indexOf('#')
    return n === -1 ? '' : String(url).slice(n)
  }
  const history = {
    entries: [{ hash: window.location.hash, state: null }],
    position: 0,
    queue: [],
    get state() { return this.entries[this.position].state },
    get length() { return this.entries.length },
    updateLocation() {
      window.location.hash = this.entries[this.position].hash
      window.location.href = 'https://xdrive.test/' + window.location.hash
    },
    pushState(state, unused, url) {
      this.entries.splice(this.position + 1)
      this.entries.push({ hash: hashFrom(url), state })
      ++this.position
      this.updateLocation()
    },
    replaceState(state, unused, url) {
      this.entries[this.position] = { hash: hashFrom(url), state }
      this.updateLocation()
    },
    go(delta) {
      const dest = this.position + delta
      if (dest < 0 || dest >= this.entries.length) return
      this.position = dest
      this.updateLocation()
      // History traversal and hashchange are dispatched asynchronously.
      this.queue.push(() => {
        window.dispatch('popstate')
        window.dispatch('hashchange')
      })
    },
    back() { this.go(-1) },
    flush() {
      let limit = 20
      while (this.queue.length && --limit > 0) this.queue.shift()()
      assert.ok(limit > 0, 'history guard entered a navigation loop')
    },
    manualHash(hash) {
      this.entries.splice(this.position + 1)
      this.entries.push({ hash, state: null })
      ++this.position
      this.updateLocation()
      this.queue.push(() => window.dispatch('hashchange'))
    },
  }
  window.history = history
  const routeEvents = []
  const react = {
    useState(initial) {
      const original = typeof initial === 'function' ? initial() : initial
      routeEvents.push(original)
      return [original, (next) => { routeEvents.push(next) }]
    },
    useRef(value) { return { current: value } },
    useCallback(fn) { return fn },
    useEffect(effect) { effect() },
  }
  const fakeShared = {
    xDriveParseWebAppHash: parseHash,
    xDriveWebAppHash: routeHash,
    xDriveWebAppViewer: (app) => app === 'preview',
  }
  const compiled = ts.transpileModule(runtimeText, {
    fileName: 'web/src/webAppRuntime.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  assert.equal(compiled.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0)
  const module = { exports: {} }
  new Function('module', 'exports', 'require', 'window', compiled.outputText)(
    module, module.exports,
    (id) => id === 'react' ? react : id === '../../ui/shared/src' ? fakeShared : assert.fail(id), window,
  )
  return {
    runtime: module.exports,
    history,
    window,
    routeEvents,
    currentRoute: () => routeEvents[routeEvents.length - 1],
  }
}

const admin = { app: 'admin-services', params: { service: 'caddy', tab: 'config' } }
const files = { app: 'files', params: {} }

test('browser Back cancel restores exact admin history entry without losing draft', () => {
  const h = createHarness()
  let dirty = false
  let blocked = 0
  const runtime = h.runtime.useXDriveWebAppRuntime((from, to) => {
    if (!dirty || from.app !== 'admin-services' || to.app === 'admin-services') return false
    ++blocked
    return true
  })
  runtime.launch(admin)
  assert.equal(h.history.position, 1)
  assert.equal(h.history.entries[1].state.xdriveHistoryIndex, 1)
  dirty = true
  h.history.back()
  h.history.flush()
  assert.equal(blocked, 1)
  assert.deepEqual(h.currentRoute(), admin, 'the dirty form stays mounted')
  assert.equal(h.history.position, 1, 'Back reversed without a fake pushState entry')
  assert.equal(h.history.length, 2)
  assert.equal(h.window.location.hash, routeHash(admin))
  runtime.cancelHistoryNavigation()
  h.history.back()
  h.history.flush()
  assert.equal(blocked, 2)
  runtime.confirmHistoryNavigation()
  h.history.flush()
  assert.deepEqual(h.currentRoute(), files)
  assert.equal(h.history.position, 0)
  assert.equal(h.history.length, 2)
  assert.equal(h.window.location.hash, '#/app/files')
})

test('confirm and cancel while asynchronous history restoration is pending', () => {
  for (const confirm of [false, true]) {
    const h = createHarness()
    let dirty = false
    const runtime = h.runtime.useXDriveWebAppRuntime((from, to) =>
      dirty && from.app === 'admin-services' && to.app !== 'admin-services')
    runtime.launch(admin)
    dirty = true
    h.history.back()
    h.history.queue.shift()()
    if (confirm) runtime.confirmHistoryNavigation()
    else runtime.cancelHistoryNavigation()
    h.history.flush()
    assert.equal(h.history.position, confirm ? 0 : 1)
    assert.deepEqual(h.currentRoute(), confirm ? files : admin)
    assert.equal(h.history.length, 2)
  }
})

test('manual unindexed hash edit fails closed with cancel and confirm', () => {
  const h = createHarness()
  let pending = 0
  const runtime = h.runtime.useXDriveWebAppRuntime((from, to) => {
    if (from.app === 'admin-services' && to.app !== 'admin-services') {
      ++pending
      return true
    }
    return false
  })
  runtime.launch(admin)
  h.history.manualHash('#/app/overview')
  h.history.flush()
  assert.equal(pending, 1)
  assert.deepEqual(h.currentRoute(), admin)
  assert.equal(h.window.location.hash, routeHash(admin))
  runtime.cancelHistoryNavigation()
  h.history.manualHash('#/app/overview')
  h.history.flush()
  assert.equal(pending, 2)
  runtime.confirmHistoryNavigation()
  assert.deepEqual(h.currentRoute(), { app: 'overview', params: {} })
  assert.equal(h.window.location.hash, '#/app/overview')
})

test('clean navigation and same-app deep links avoid cross-app prompt', () => {
  const h = createHarness()
  let dirty = false
  let promptCount = 0
  const runtime = h.runtime.useXDriveWebAppRuntime((from, to) => {
    if (dirty && from.app === 'admin-services' && to.app !== 'admin-services') {
      promptCount++
      return true
    }
    return false
  })
  runtime.launch(admin)
  runtime.launch({ app: 'admin-services', params: { service: 'database', tab: 'status' } })
  dirty = true
  h.history.back()
  h.history.flush()
  assert.equal(promptCount, 0, 'same-app history remains owned by editor guard')
  assert.deepEqual(h.currentRoute(), admin)
  dirty = false
  h.history.back()
  h.history.flush()
  assert.deepEqual(h.currentRoute(), files)
  assert.equal(promptCount, 0)
})

test('browser Forward indexed cross-app transition retains history on cancel', () => {
  const h = createHarness()
  let dirty = false
  const runtime = h.runtime.useXDriveWebAppRuntime((from, to) =>
    dirty && from.app === 'admin-services' && to.app !== 'admin-services')
  runtime.launch(admin)
  runtime.launch(files)
  h.history.back()
  h.history.flush()
  assert.deepEqual(h.currentRoute(), admin)
  dirty = true
  h.history.go(1)
  h.history.flush()
  assert.deepEqual(h.currentRoute(), admin)
  assert.equal(h.history.position, 1)
  runtime.cancelHistoryNavigation()
  h.history.go(1)
  h.history.flush()
  runtime.confirmHistoryNavigation()
  h.history.flush()
  assert.deepEqual(h.currentRoute(), files)
  assert.equal(h.history.position, 2)
  assert.equal(h.history.length, 3)
})

test('runtime guard is wired before Web route commit and keeps Viewer behavior', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'App.tsx'), 'utf8')
  assert.ok(app.includes('useXDriveWebAppRuntime(guardBrowserNavigation)'))
  assert.ok(app.includes('cancelHistoryNavigation()'))
  assert.ok(app.includes('confirmHistoryNavigation()'))
  assert.ok(runtimeText.includes("window.addEventListener('popstate', sync)"))
  assert.ok(runtimeText.includes("window.addEventListener('hashchange', sync)"))
  assert.ok(runtimeText.includes('window.history.go(-delta)'))
  assert.ok(runtimeText.includes('window.history.replaceState(indexedState('))
  assert.ok(runtimeText.includes('viewerReturn'))
  assert.ok(runtimeText.includes('appReturn'))
})
