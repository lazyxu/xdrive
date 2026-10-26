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
    addEventListener(name) { events.push(name) },
    setInterval() {},
  }
  const env = {
    exports, window: win,
    document: { addEventListener(name) { events.push(name) } },
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
