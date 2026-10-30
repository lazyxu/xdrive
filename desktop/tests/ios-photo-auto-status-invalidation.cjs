'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const source = read('web/src/iosForegroundAutoScheduler.ts')
const ui = read('ui/shared/src/mui/IOSPhotoBackupSettings.tsx')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.deepEqual((transpiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', transpiled.outputText)(mod, mod.exports)
const startScheduler = mod.exports.xDriveStartIOSForegroundAutoScheduler
const tick = () => new Promise(resolve => setImmediate(resolve))

function createDOM() {
  const prev = { document: global.document, window: global.window,
    CustomEvent: global.CustomEvent }
  const emitted = []
  const listeners = new Map()
  const doc = {
    visibilityState: 'visible',
    addEventListener: (name, cb) => listeners.set('document:'+name, cb),
    removeEventListener: name => listeners.delete('document:'+name),
  }
  const win = {
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: (name, cb) => listeners.set('window:'+name, cb),
    removeEventListener: name => listeners.delete('window:'+name),
    dispatchEvent: event => { emitted.push(event); return true },
  }
  global.document = doc
  global.window = win
  global.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail }
  }
  return {
    emitted,
    restore() {
      for (const key of ['document', 'window', 'CustomEvent']) {
        if (prev[key] === undefined) delete global[key]
        else global[key] = prev[key]
      }
    },
  }
}

test('native-confirmed foreground tick only invalidates the exact Owner schedule, no secrets', async () => {
  const dom = createDOM()
  const owner = { ownerID: 73, username: 'current-owner',
    accessToken: 'web-short-lived-sensitive-bearer' }
  let calls = 0
  const host = {
    foregroundAutoSupported: true,
    capabilities: async () => true,
    autoTick: async () => { calls++; return { ran: true, uploaded: 1,
      schedule: { enabled: true, windowIndex: 2 } } },
    cancel: async () => {},
  }
  try {
    const stop = startScheduler(host, async () => owner)
    await tick()
    assert.equal(calls, 1)
    assert.equal(dom.emitted.length, 1)
    assert.equal(dom.emitted[0].type, 'xdrive-ios-photo-auto-status-invalidated')
    assert.deepEqual(dom.emitted[0].detail,
      { ownerID: 73, username: 'current-owner' })
    assert.doesNotMatch(JSON.stringify(dom.emitted),
      /web-short-lived-sensitive-bearer|accessToken|grantSecret|localIdentifier|uploaded/)
    stop()
  } finally { dom.restore() }
})

test('native notDue or cancellation never fabricates a completed backup event', async () => {
  const dom = createDOM()
  let resolveNative
  const host = {
    foregroundAutoSupported: true,
    capabilities: async () => true,
    autoTick: () => new Promise(resolve => { resolveNative = resolve }),
    cancel: async () => {},
  }
  try {
    const stop = startScheduler(host, async () =>
      ({ ownerID: 5, username: 'new-owner', accessToken: 'opaque' }))
    await tick()
    resolveNative({ ran: true })
    stop()
    await tick()
    assert.equal(dom.emitted.length, 0, 'late canceled Owner must not update UI')
  } finally { dom.restore() }

  const another = createDOM()
  try {
    const stop = startScheduler({
      foregroundAutoSupported: true,
      capabilities: async () => true,
      autoTick: async () => ({ ran: false, reason: 'notDue' }),
      cancel: async () => {},
    }, async () => ({ ownerID: 5, username: 'new-owner', accessToken: 'opaque' }))
    await tick()
    assert.equal(another.emitted.length, 0)
    stop()
  } finally { another.restore() }
})

test('shared Settings treats event as untrusted hint, re-reads native Owner schedule only', () => {
  const snippet = ui.slice(ui.indexOf('const onNativeScheduleChanged ='),
    ui.indexOf("window.addEventListener('xdrive-ios-photo-auto-status-invalidated'"))
  assert.match(snippet, /scope\.ownerID !== session\.ownerID/)
  assert.match(snippet, /scope\.username !== session\.username/)
  assert.match(snippet, /host\.autoStatus\(session\)/)
  assert.match(snippet, /mounted && request === lastRequest/)
  assert.doesNotMatch(snippet, /setAutoStatus\(scope\)|setAutoStatus\(event\.detail\)/)
  assert.match(ui, /window\.removeEventListener\('xdrive-ios-photo-auto-status-invalidated'/)
  assert.match(ui, /session\?\.accessToken/)
})
