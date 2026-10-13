const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('web/src/pwaPeerActivity.ts')
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, removeComments: true,
} }).outputText

function fixture() {
  let clock = 1000, counter = 0
  const channels = new Set(), traffic = []
  class TestBroadcastChannel {
    constructor(name) { this.name = name; this.listeners = []; this.closed = false; channels.add(this) }
    addEventListener(name, callback) { if (name === 'message') this.listeners.push(callback) }
    postMessage(message) {
      traffic.push(JSON.parse(JSON.stringify(message)))
      for (const other of channels) if (other !== this && !other.closed && other.name === this.name)
        for (const fn of other.listeners) fn({ data: message })
    }
    close() { this.closed = true; channels.delete(this) }
  }
  const uuid = () => '00000000-0000-4000-8000-' + String(++counter).padStart(12, '0')
  function createWindow({ secure = true, supported = true } = {}) {
    let activity = { observed: false, browserUpload: false, browserDownload: false,
      viewerOpen: false, unsavedSystemDependencies: false }
    const localListeners = [], intervals = [], events = {}
    const store = {
      subscribeXDrivePwaWindowActivity: listener => { localListeners.push(listener); return () => {} },
      xDrivePwaWindowActivitySnapshot: () => activity,
      xDrivePwaKnownWindowBlockers: state => [
        state.browserUpload && 'upload', state.browserDownload && 'download',
        state.viewerOpen && 'viewer', state.unsavedSystemDependencies && 'draft',
      ].filter(Boolean),
    }
    const exports = {}
    const window = {
      isSecureContext: secure,
      setInterval: fn => { intervals.push(fn); return intervals.length },
      addEventListener: (event, fn) => { events[event] = fn },
    }
    vm.runInNewContext(code, {
      exports, window, document: { addEventListener: (name, fn) => { events[name] = fn } },
      crypto: { randomUUID: uuid },
      BroadcastChannel: supported ? TestBroadcastChannel : undefined,
      Date: { now: () => clock },
      require: name => { assert.equal(name, './pwaWorkloadSafety'); return store },
    })
    return {
      start: exports.startXDrivePwaPeerActivityObservation,
      current: () => JSON.parse(JSON.stringify(exports.xDrivePwaPeerActivitySnapshot())),
      activity: patch => { activity = { ...activity, ...patch }; for (const listener of localListeners) listener() },
      tick: () => { for (const fn of intervals) fn() },
      event: name => events[name]?.(),
    }
  }
  return {
    createWindow, traffic, tick: ms => { clock += ms },
    inject: message => {
      for (const channel of channels) for (const cb of channel.listeners) cb({ data: message })
    },
  }
}

test('S3D2B: unsupported or insecure environments never claim peer coverage', () => {
  const f = fixture()
  const unsupported = f.createWindow({ supported: false })
  const insecure = f.createWindow({ secure: false })
  unsupported.start(); insecure.start()
  assert.equal(unsupported.current().available, false)
  assert.equal(insecure.current().available, false)
  assert.equal(f.traffic.length, 0)
})

test('S3D2B: peer hello and live busy hints use only anonymous bounded fields', () => {
  const f = fixture()
  const a = f.createWindow(), b = f.createWindow()
  a.start(); b.start()
  assert.equal(a.current().available, true)
  assert.equal(b.current().recentlyObservedPeers, 1)
  a.activity({ observed: true, browserUpload: true })
  assert.equal(b.current().knownPeerBusy, true)
  a.activity({ browserUpload: false, viewerOpen: true })
  assert.equal(b.current().knownPeerBusy, true)
  a.activity({ viewerOpen: false })
  assert.equal(b.current().knownPeerBusy, false)
  a.activity({ observed: false })
  assert.equal(b.current().knownPeerUnknown, true)
  assert.ok(f.traffic.every(message => Object.keys(message).every(key =>
    ['kind', 'sender', 'sequence', 'busy', 'observed'].includes(key))))
  assert.doesNotMatch(JSON.stringify(f.traffic), /Authorization|Cookie|access_token|path|node_id/)
})

test('S3D2B: stale and background-frozen peer observations are never a safe update proof', () => {
  const f = fixture()
  const a = f.createWindow(), b = f.createWindow()
  a.start(); b.start()
  a.activity({ observed: true, browserDownload: true })
  assert.equal(b.current().knownPeerBusy, true)
  f.tick(46000)
  b.tick()
  assert.equal(b.current().knownPeerBusy, false)
  assert.equal(b.current().recentlyObservedPeers, 0)
  a.tick()
  assert.equal(b.current().knownPeerBusy, true)
  a.event('pagehide')
  assert.equal(b.current().knownPeerBusy, false)
  assert.equal(b.current().knownPeerUnknown, true)
  a.event('pageshow')
  assert.equal(b.current().knownPeerBusy, true)
})

test('S3D2B: invalid, reordered and impossible peer messages are ignored', () => {
  const f = fixture()
  const a = f.createWindow()
  a.start()
  const peer = 'dddddddd-0000-4000-8000-aaaaaaaaaaaa'
  f.inject({ kind: 'status', sender: peer, sequence: 1, observed: true, busy: true })
  assert.equal(a.current().knownPeerBusy, true)
  f.inject({ kind: 'status', sender: peer, sequence: 1, observed: true, busy: false })
  assert.equal(a.current().knownPeerBusy, true)
  f.inject({ kind: 'status', sender: peer, sequence: 2, observed: false, busy: true })
  assert.equal(a.current().knownPeerBusy, true)
  f.inject({ kind: 'status', sender: '../invalid', sequence: 3, observed: true, busy: false })
  assert.equal(a.current().knownPeerBusy, true)
  f.inject({ kind: 'status', sender: peer, sequence: 3, observed: true, busy: false })
  assert.equal(a.current().knownPeerBusy, false)
})

test('S3D2B: shared Web/Mobile wiring is read-only and never activates Service Worker', () => {
  const main = read('web/src/main.tsx')
  const section = read('web/src/PwaUpdateSection.tsx')
  const docs = read('docs/pwa-delivery.md')
  assert.ok(main.includes('startXDrivePwaPeerActivityObservation()'))
  assert.ok(section.includes('subscribeXDrivePwaPeerActivity'))
  assert.ok(section.includes('knownPeerBusy'))
  assert.ok(section.includes('data-xdrive-pwa-peer-activity'))
  assert.ok(section.includes('其他窗口活动无法被完整证明'))
  assert.ok(docs.includes('PWA-S3D2B'))
  assert.doesNotMatch(code, /api\/v1|localStorage|sessionStorage|skipWaiting\s*\(|clients\.claim\s*\(|location\.reload\s*\(|fetch\s*\(/)
  assert.doesNotMatch(section, /skipWaiting|location\.reload|api\/v1/)
})
