'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/pwaUpdates.ts')
const source = fs.readFileSync(filename, 'utf8')
const built = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((built.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

function browser(channelMode, waiting) {
  const events = []
  const messages = []
  let updates = 0
  let channelConstructed = 0
  const registration = {
    waiting: waiting ? { state: 'installed' } : null,
    installing: null,
    addEventListener(name) { events.push('registration:' + name) },
    async update() { updates++ },
  }
  const worker = {
    controller: { scriptURL: '/sw.js' },
    ready: Promise.resolve(registration),
    async getRegistration() { return registration },
    addEventListener(name) { events.push('worker:' + name) },
  }
  const window = {
    isSecureContext: true,
    addEventListener(name) { events.push('window:' + name) },
  }
  class Channel {
    constructor(name) {
      channelConstructed++
      assert.equal(name, 'xdrive-pwa-public-updates')
      if (channelMode === 'constructor-denied') throw new Error('Channel constructor denied')
    }
    addEventListener(name) { events.push('channel:' + name) }
    postMessage(data) { messages.push(data) }
    close() { events.push('channel:close') }
  }
  const sandbox = vm.createContext({
    exports: {}, window, navigator: { onLine: true, serviceWorker: worker },
    setTimeout, clearTimeout,
  })
  if (channelMode === 'getter-denied') {
    Object.defineProperty(sandbox, 'BroadcastChannel', {
      configurable: true, get() { throw new Error('WebKit denies BroadcastChannel global') },
    })
  } else if (channelMode !== 'missing') {
    Object.defineProperty(sandbox, 'BroadcastChannel', {
      configurable: true, value: Channel,
    })
  }
  vm.runInContext(built.outputText, sandbox, { filename })
  return {
    api: sandbox.exports, events, messages,
    get updates() { return updates },
    get channelConstructed() { return channelConstructed },
  }
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

test('denied BroadcastChannel global keeps real SW lookup and manual update usable', async () => {
  const app = browser('getter-denied', false)
  assert.doesNotThrow(() => app.api.startXDrivePwaUpdateObservation())
  await settle()
  assert.equal(app.api.xDrivePwaUpdateSnapshot().phase, 'idle')
  assert.equal(app.api.xDrivePwaUpdateSnapshot().hasController, true)
  assert.equal(app.api.xDrivePwaUpdateSnapshot().otherWindowReportedUpdate, false)
  assert.equal(app.updates, 0, 'observer must not automatically call update()')
  assert.ok(app.events.includes('worker:controllerchange'))
  assert.ok(app.events.includes('registration:updatefound'))
  assert.equal(await app.api.checkXDrivePwaUpdate(), 'checked')
  assert.equal(app.updates, 1)
  assert.equal(app.messages.length, 0, 'denied channel cannot broadcast')
})

test('denied channel getter must not hide genuine waiting worker or activate it', async () => {
  const app = browser('getter-denied', true)
  assert.doesNotThrow(() => app.api.startXDrivePwaUpdateObservation())
  await settle()
  assert.equal(app.api.xDrivePwaUpdateSnapshot().phase, 'waiting')
  assert.equal(app.updates, 0)
  assert.equal(app.messages.length, 0)
  assert.equal(await app.api.checkXDrivePwaUpdate(), 'waiting')
  assert.equal(app.updates, 1)
})

test('missing or constructor-denied channel preserves independent update observation', async () => {
  for (const mode of ['missing', 'constructor-denied']) {
    const app = browser(mode, false)
    assert.doesNotThrow(() => app.api.startXDrivePwaUpdateObservation(), mode)
    await settle()
    assert.equal(app.api.xDrivePwaUpdateSnapshot().phase, 'idle')
    assert.equal(await app.api.checkXDrivePwaUpdate(), 'checked')
    assert.equal(app.updates, 1)
  }
})

test('working channel still publishes only public waiting hints', async () => {
  const app = browser('supported', true)
  app.api.startXDrivePwaUpdateObservation()
  await settle()
  assert.equal(app.api.xDrivePwaUpdateSnapshot().phase, 'waiting')
  assert.equal(app.channelConstructed, 1)
  assert.deepEqual(app.messages.map(message => message.kind), ['xdrive-public-update-ready'])
  assert.doesNotMatch(source, /skipWaiting\s*\(|location\.reload\s*\(|localStorage|sessionStorage|Authorization/)
})
