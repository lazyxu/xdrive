const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaRuntime.ts'), 'utf8')
const compiled = ts.transpileModule(source.replace('import.meta.env.DEV', 'false'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function browser({ readyState = 'loading', denyReady = false, denyLoad = false,
  secure = true } = {}) {
  let registrations = 0
  const listeners = new Map()
  const dispatched = []
  const window = {
    isSecureContext: secure,
    addEventListener(type, handler, options) {
      if (type === 'load' && denyLoad) throw new Error('load subscription denied')
      listeners.set(type, { handler, options })
    },
    dispatchEvent(event) { dispatched.push(event.type) },
  }
  const navigator = { serviceWorker: {
    register(path, options) {
      assert.equal(path, '/sw.js')
      assert.equal(options.scope, '/')
      assert.equal(options.updateViaCache, 'none')
      registrations++
      return Promise.resolve({})
    },
  } }
  const document = {}
  Object.defineProperty(document, 'readyState', { get() {
    if (denyReady) throw new Error('readyState denied')
    return readyState
  } })
  const exports = {}
  new Function('exports', 'window', 'navigator', 'document', 'Event', compiled)(
    exports, window, navigator, document,
    class { constructor(type) { this.type = type } },
  )
  return {
    register: exports.registerXDrivePwa, listeners, dispatched,
    get registrations() { return registrations },
  }
}

test('Safari denied DOM readyState is an optional SW failure, never an app startup exception', () => {
  const h = browser({ denyReady: true })
  assert.doesNotThrow(() => h.register())
  assert.equal(h.registrations, 0)
  assert.equal(h.listeners.size, 0)
})

test('Safari denied load event observer never starts an unverified early SW registration', () => {
  const h = browser({ denyLoad: true })
  assert.doesNotThrow(() => h.register())
  assert.equal(h.registrations, 0)
  assert.equal(h.listeners.size, 0)
})

test('successful normal load registers once with public worker path and emits observable status', async () => {
  const h = browser()
  h.register()
  assert.equal(h.registrations, 0)
  assert.equal(h.listeners.get('load')?.options?.once, true)
  h.listeners.get('load').handler()
  assert.equal(h.registrations, 1)
  await Promise.resolve()
  assert.deepEqual(h.dispatched, ['xdrive-pwa-registered'])
})

test('already loaded secure Web registers normally; insecure Web never schedules registration', async () => {
  const ready = browser({ readyState: 'complete' })
  ready.register()
  assert.equal(ready.registrations, 1)
  await Promise.resolve()
  assert.deepEqual(ready.dispatched, ['xdrive-pwa-registered'])
  const insecure = browser({ secure: false, denyReady: true, denyLoad: true })
  assert.doesNotThrow(() => insecure.register())
  assert.equal(insecure.registrations, 0)
})
