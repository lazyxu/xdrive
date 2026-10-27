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

function browser({ denied = null, supported = true, eventFailure = null } = {}) {
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
    addEventListener(name, fn) { registered.push([name, fn]) }
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
      if (eventFailure === name || eventFailure === 'all') {
        throw new Error('Safari denied Window event: ' + name)
      }
      events.push(name)
    },
    setInterval() {
      if (eventFailure === 'timer' || eventFailure === 'all') {
        throw new Error('Safari denied optional heartbeat')
      }
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
      if (eventFailure === name || eventFailure === 'all') {
        throw new Error('Safari denied Document event: ' + name)
      }
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

test('PWA Safari denied optional lifecycle listener preserves anonymous peer status', () => {
  const eventNames = ['pageshow', 'pagehide', 'visibilitychange']
  for (const denied of [...eventNames, 'timer', 'all']) {
    const app = browser({ eventFailure: denied })
    assert.doesNotThrow(app.start, denied)
    assert.equal(app.snapshot().available, true,
      'a denied lifecycle listener must not silently break supported peer observation')
    assert.deepEqual(app.events,
      denied === 'all' ? [] : eventNames.filter(name => name !== denied),
      'independent supported listeners continue to subscribe')
    assert.equal(app.registered.length, 1, 'the existing channel handler stays registered')
    assert.equal(app.outbound.length, 2,
      'initial hello and status must still be sent without optional lifecycle hints')
    const remote = {
      kind: 'status', sender: '00000000-0000-4000-8000-000000000002',
      sequence: 1, observed: true, busy: true,
    }
    app.registered[0][1]({ data: remote })
    assert.equal(app.snapshot().knownPeerBusy, true,
      'a busy peer remains visible when Safari denies an optional listener')
    assert.doesNotMatch(JSON.stringify(app.outbound), /Authorization|cookie|token|path|node_id/)
  }
})
