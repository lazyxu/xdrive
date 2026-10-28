'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaPeerActivity.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'pwaPeerActivity.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function browser({ denied = null, supported = true } = {}) {
  const exports = {}
  const outbound = []
  const registered = []
  const activity = { observed: true, browserUpload: false, browserDownload: false,
    viewerOpen: false, mediaEditorOpen: false, unsavedSystemDependencies: false }
  class Channel {
    constructor(name) {
      if (denied === 'channel') throw new Error('SecurityError: BroadcastChannel constructor denied')
      this.name = name; this.closed = false
    }
    addEventListener(name, fn) {
      if (denied === 'channel-listener') throw new Error('SecurityError: Channel listener denied')
      registered.push([name, fn])
    }
    postMessage(message) { outbound.push(message) }
    close() { this.closed = true }
  }
  const crypto = {}
  Object.defineProperty(crypto, 'randomUUID', {
    get() {
      if (denied === 'uuid') throw new Error('SecurityError: crypto.randomUUID getter denied')
      return () => '00000000-0000-4000-8000-000000000001'
    },
  })
  const events = []
  const win = {
    isSecureContext: true,
    addEventListener(name) {
      if (denied === name || denied === 'window-events')
        throw new Error('SecurityError: Window event denied: ' + name)
      events.push(name)
    },
    setInterval() {
      if (denied === 'interval') throw new Error('SecurityError: timer denied')
    },
  }
  if (denied === 'secure-context') {
    Object.defineProperty(win, 'isSecureContext', {
      get() { throw new Error('SecurityError: secure-context getter denied') },
    })
  }
  const env = {
    exports, window: win,
    document: { addEventListener(name) {
      if (denied === name) throw new Error('SecurityError: Document event denied: ' + name)
      events.push(name)
    } },
    crypto,
    require(name) {
      assert.equal(name, './pwaWorkloadSafety')
      return {
        subscribeXDrivePwaWindowActivity() {},
        xDrivePwaWindowActivitySnapshot() { return activity },
        xDrivePwaKnownWindowBlockers(s) { return s.browserUpload ? ['upload'] : [] },
      }
    },
  }
  env.BroadcastChannel = supported ? Channel : undefined
  vm.runInNewContext(compiled, env)
  return {
    start: exports.startXDrivePwaPeerActivityObservation,
    snapshot: exports.xDrivePwaPeerActivitySnapshot,
    outbound, registered, events,
  }
}

test('PWA Safari denied randomUUID getter cannot block the pre-React first paint', () => {
  const app = browser({ denied: 'uuid' })
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, false)
  assert.equal(app.snapshot().recentlyObservedPeers, 0)
  assert.equal(app.outbound.length, 0)
  assert.deepEqual(app.events, [])
})

test('PWA Safari denied BroadcastChannel constructor cannot block the pre-React first paint', () => {
  const app = browser({ denied: 'channel' })
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, false)
  assert.equal(app.snapshot().knownPeerBusy, false)
  assert.equal(app.outbound.length, 0)
  assert.deepEqual(app.events, [])
})

test('PWA unsupported peer feature remains optional and advertises no cross-window coverage', () => {
  const app = browser({ supported: false })
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, false)
  assert.deepEqual(app.events, [])
})

test('PWA healthy browser preserves bounded anonymous peer update hints', () => {
  const app = browser()
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, true)
  assert.equal(app.registered.length, 1)
  assert.deepEqual(app.events, ['pageshow', 'pagehide', 'visibilitychange'])
  assert.equal(app.outbound.length, 2)
  for (const message of app.outbound) {
    assert.ok(['hello', 'status'].includes(message.kind))
    assert.match(message.sender, /^[0-9a-f-]{36}$/)
    assert.ok(Object.keys(message).every(key =>
      ['kind', 'sender', 'sequence', 'observed', 'busy'].includes(key)))
  }
  assert.doesNotMatch(JSON.stringify(app.outbound), /Authorization|cookie|token|path|node_id/)
})
test('PWA Safari denied secure-context getter cannot break pre-React peer startup', () => {
  const app = browser({ denied: 'secure-context' })
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, false,
    'no anonymous peer-channel coverage is claimed without secure-context proof')
  assert.equal(app.snapshot().knownPeerBusy, false)
  assert.equal(app.outbound.length, 0)
  assert.deepEqual(app.events, [])
})

for (const denied of ['pageshow', 'pagehide', 'visibilitychange', 'interval', 'window-events']) {
  test('PWA restricted WebKit ' + denied + ' hint denial cannot prevent healthy peer status', () => {
    const app = browser({ denied })
    assert.doesNotThrow(app.start)
    assert.equal(app.snapshot().available, true, 'working channel remains observable')
    assert.equal(app.registered.length, 1, 'one message listener remains active')
    assert.equal(app.outbound.length, 2, 'initial hello + anonymized status still sent')
    const expected = ['pageshow', 'pagehide', 'visibilitychange'].filter(name =>
      name !== denied && !(denied === 'window-events' && name !== 'visibilitychange'))
    assert.deepEqual(app.events, expected)
    assert.doesNotMatch(JSON.stringify(app.outbound), /cookie|token|Authorization|node_id|file_path/)
  })
}

test('PWA denied BroadcastChannel message listener closes partial channel without false peer coverage', () => {
  const app = browser({ denied: 'channel-listener' })
  assert.doesNotThrow(app.start)
  assert.equal(app.snapshot().available, false)
  assert.equal(app.snapshot().recentlyObservedPeers, 0)
  assert.deepEqual(app.events, [])
  assert.equal(app.outbound.length, 0)
})
