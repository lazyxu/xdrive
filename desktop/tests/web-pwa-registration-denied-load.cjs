'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Exercise actual production TypeScript. Vite replaces the DEV constant at build.
const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/pwaRuntime.ts'), 'utf8')
const replaced = source.replace('import.meta.env.DEV', 'false')
assert.notEqual(replaced, source)
const code = ts.transpileModule(replaced, {
  fileName: 'pwaRuntime.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function browser({ phase = 'loading', denial = null, secure = true } = {}) {
  let registered = 0
  const subscriptions = new Map()
  const events = []
  const win = {
    isSecureContext: secure,
    addEventListener(name, handler, options) {
      if (denial === 'load' && name === 'load') {
        throw Error('SecurityError: window.load listener denied')
      }
      subscriptions.set(name, { handler, options })
    },
    dispatchEvent(event) { events.push(event.type) },
  }
  const doc = {}
  Object.defineProperty(doc, 'readyState', {
    get() {
      if (denial === 'readyState') {
        throw Error('SecurityError: document.readyState getter denied')
      }
      return phase
    },
  })
  const nav = {
    serviceWorker: {
      register(url, options) {
        registered++
        assert.equal(url, '/sw.js')
        assert.equal(options.scope, '/')
        assert.equal(options.updateViaCache, 'none')
        return Promise.resolve({})
      },
    },
  }
  const exports = {}
  class BrowserEvent { constructor(type) { this.type = type } }
  new Function('exports', 'window', 'document', 'navigator', 'Event', code)(
    exports, win, doc, nav, BrowserEvent)
  return {
    register: exports.registerXDrivePwa, subscriptions, events,
    get registered() { return registered },
  }
}

test('denied load listener does not crash normal Web/PWA boot', async () => {
  const h = browser({ denial: 'load' })
  assert.doesNotThrow(() => h.register())
  await Promise.resolve()
  assert.equal(h.registered, 0)
  assert.equal(h.subscriptions.has('load'), false)
  assert.deepEqual(h.events, [])
})

test('denied document.readyState does not crash normal Web/PWA boot', async () => {
  const h = browser({ denial: 'readyState' })
  assert.doesNotThrow(() => h.register())
  await Promise.resolve()
  assert.equal(h.registered, 0)
  assert.deepEqual(h.events, [])
})

test('allowed deferred registration still waits for actual load event', async () => {
  const h = browser()
  h.register()
  assert.equal(h.registered, 0)
  const load = h.subscriptions.get('load')
  assert.equal(load?.options?.once, true)
  load.handler()
  await Promise.resolve()
  assert.equal(h.registered, 1)
  assert.deepEqual(h.events, ['xdrive-pwa-registered'])
})

test('loaded secure pages register; insecure pages cannot', async () => {
  const loaded = browser({ phase: 'complete' })
  loaded.register()
  await Promise.resolve()
  assert.equal(loaded.registered, 1)
  assert.deepEqual(loaded.events, ['xdrive-pwa-registered'])
  const insecure = browser({ phase: 'loading', secure: false })
  insecure.register()
  assert.equal(insecure.registered, 0)
  assert.equal(insecure.subscriptions.size, 0)
})
