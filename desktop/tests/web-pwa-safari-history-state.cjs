'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/webAppRuntime.ts')
const source = fs.readFileSync(filename, 'utf8')
const result = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((result.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

function withBrowser({ denied = false, initialHash = '#/app/overview', initialState = null }, verify) {
  const original = global.window
  const events = new Map()
  const writes = []
  const foreground = []
  const routes = []
  let storedState = initialState
  let backCount = 0
  const location = {
    hash: initialHash,
    href: 'https://xdrive.example.invalid/' + initialHash,
  }
  function commitURL(next) {
    if (!next) return
    const resolved = new URL(next, location.href)
    location.hash = resolved.hash
    location.href = resolved.href
  }
  const history = {
    get state() {
      if (denied) throw new Error('Safari denied History.state')
      return storedState
    },
    replaceState(state, _unused, url) {
      storedState = state
      commitURL(url)
      writes.push('replace')
    },
    pushState(state, _unused, url) {
      storedState = state
      commitURL(url)
      writes.push('push')
    },
    go() { writes.push('go') },
    back() { backCount++ },
  }
  global.window = {
    location, history,
    addEventListener(name, callback) { events.set(name, callback) },
    removeEventListener(name) { events.delete(name) },
    open() { throw new Error('unexpected new tab') },
  }
  const effects = []
  const layoutEffects = []
  const react = {
    startTransition(callback) { callback() },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, next => { routes.push(next) }]
    },
    useRef(value) { return { current: value } },
    useCallback(fn) { return fn },
    useEffect(fn) { effects.push(fn) },
    useLayoutEffect(fn) { layoutEffects.push(fn) },
  }
  const shared = {
    xDriveParseWebAppHash(value) {
      const match = typeof value === 'string'
        ? /^#\/app\/(overview|files|admin-users|media-viewer)$/.exec(value) : null
      return match ? { app: match[1], params: {} } : null
    },
    xDriveWebAppHash(route) { return '#/app/' + route.app },
    xDriveWebAppViewer(app) { return app === 'media-viewer' },
  }
  const module = { exports: {} }
  try {
    new Function('module', 'exports', 'require', result.outputText)(
      module, module.exports, name => {
        if (name === 'react') return react
        if (name === '../../ui/shared/src') return shared
        if (name === '../../ui/shared/src/mui/ViewerForegroundPriority') {
          return { xDriveEnterForegroundPage: label => foreground.push(label) }
        }
        throw new Error('unexpected dependency: ' + name)
      },
    )
    const api = module.exports.useXDriveWebAppRuntime(() => true)
    for (const effect of layoutEffects) effect()
    for (const effect of effects) effect()
    return verify({
      api, events, writes, foreground, routes, location,
      get backCount() { return backCount },
    })
  } finally {
    global.window = original
  }
}

test('PWA cold mount survives rejected History.state without inventing an appReturn', () => {
  withBrowser({ denied: true }, ({ api, writes, routes, foreground, location }) => {
    assert.equal(api.route.app, 'overview')
    assert.equal(api.canExitApp, false)
    assert.deepEqual(writes, ['replace'])
    api.launch({ app: 'files', params: {} })
    assert.equal(location.hash, '#/app/files')
    assert.equal(routes.at(-1).app, 'files')
    assert.equal(foreground.at(-1), 'web:files')
    assert.deepEqual(writes, ['replace', 'push'])
  })
})

test('unknown browser history refuses unsaved-route navigation rather than accepting it', () => {
  withBrowser({ denied: true }, ({ api, events, writes, location, routes }) => {
    api.launch({ app: 'files', params: {} })
    location.hash = '#/app/admin-users'
    events.get('popstate')()
    assert.equal(location.hash, '#/app/files')
    assert.equal(routes.some(route => route.app === 'admin-users'), false)
    assert.equal(writes.at(-1), 'replace')
    api.cancelHistoryNavigation()
  })
})

test('denied Viewer history metadata uses an explicit route fallback, not an unproved Back', () => {
  withBrowser({ denied: true, initialHash: '#/app/media-viewer' },
    ({ api, location, routes, backCount }) => {
      api.closeViewer({ app: 'overview', params: {} })
      assert.equal(backCount, 0)
      assert.equal(location.hash, '#/app/overview')
      assert.equal(routes.at(-1).app, 'overview')
    })
})

test('readable genuine History.state retains Viewer Back and parent route behavior', () => {
  withBrowser({
    initialHash: '#/app/media-viewer',
    initialState: {
      xdriveWebApp: true, xdriveHistoryIndex: 3,
      appReturn: '#/app/files', viewerReturn: true,
    },
  }, ({ api, backCount, location }) => {
    assert.equal(api.route.app, 'media-viewer')
    assert.equal(api.canExitApp, true)
    api.closeViewer({ app: 'overview', params: {} })
    assert.equal(backCount, 1)
    assert.equal(location.hash, '#/app/media-viewer')
  })
})

test('all History.state reads go through the same guarded browser helper', () => {
  assert.equal((source.match(/window\.history\.state/g) || []).length, 1)
  assert.ok(source.includes('function xDriveReadableWebHistoryState()'))
  assert.ok(source.includes('const parentHash = (xDriveReadableWebHistoryState()'))
  assert.doesNotMatch(source, /skipWaiting|localStorage|sessionStorage\.setItem\\(.*history/)
})
