'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.resolve(__dirname, '../../web/src/pwaInstall.ts')
const source = fs.readFileSync(file, 'utf8')
const output = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((output.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])

function browser({ abortThrows = false, deniedSignalState = false, hung = false } = {}) {
  let abortCalls = 0
  const requests = []
  class RestrictedController extends AbortController {
    constructor() {
      super()
      if (deniedSignalState) Object.defineProperty(this.signal, 'aborted', {
        get() { throw new Error('Safari denied internal AbortSignal.aborted') },
      })
    }
    abort() {
      abortCalls++
      if (abortThrows) throw new Error('Safari denied AbortController.abort()')
      return super.abort()
    }
  }
  const mime = url => url === '/site.webmanifest' ? 'application/manifest+json'
    : url === '/sw.js' ? 'text/javascript'
      : url === '/offline.html' ? 'text/html' : 'image/png'
  const publicFetch = (url, init) => {
    requests.push({ url, init })
    if (hung) return new Promise(() => {})
    return Promise.resolve({
      status: 200,
      headers: {
        get(name) {
          return name === 'Content-Type' ? mime(url)
            : name === 'Cache-Control' ? 'no-cache, must-revalidate' : null
        },
      },
    })
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'window', 'navigator', 'fetch',
    'AbortController', 'setTimeout', 'clearTimeout', output.outputText)(
    mod, mod.exports,
    { isSecureContext: true, location: { protocol: 'https:', hostname: 'test.invalid' } },
    { userAgent: 'iPhone Safari' }, publicFetch,
    RestrictedController, setTimeout, clearTimeout,
  )
  return {
    check: mod.exports.checkXDrivePwaAssets,
    requests,
    get abortCalls() { return abortCalls },
  }
}

test('pre-aborted caller remains bounded with zero public HEADs even if abort() throws', async () => {
  const h = browser({ abortThrows: true })
  const caller = new AbortController()
  caller.abort()
  const checks = await h.check({ signal: caller.signal, timeoutMs: 25 })
  assert.equal(h.requests.length, 0)
  assert.equal(h.abortCalls, 1)
  assert.deepEqual(checks.map(x => x.id),
    ['context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512'])
  assert.deepEqual(checks.slice(2).map(x => x.state), Array(5).fill('fail'))
  assert.ok(checks.slice(2).every(x => x.detail.includes('取消')))
})

test('Safari-denied abort() cannot strand five noncooperative HEADs after the timeout', async () => {
  const h = browser({ abortThrows: true, hung: true })
  const checks = await Promise.race([
    h.check({ timeoutMs: 20 }),
    new Promise((_resolve, reject) => setTimeout(() =>
      reject(new Error('public HEAD diagnostics remained stuck')), 2000)),
  ])
  assert.equal(h.requests.length, 5)
  assert.equal(h.abortCalls, 1)
  assert.deepEqual(checks.slice(2).map(x => x.state), Array(5).fill('fail'))
  assert.ok(checks.slice(2).every(x => x.detail.includes('超时')))
  assert.ok(h.requests.every(({ url, init }) => url.startsWith('/') &&
    init.method === 'HEAD' && init.credentials === 'omit' &&
    init.cache === 'no-store' && init.mode === 'same-origin'))
})

test('closing an active install check safely interrupts noncooperative fetch with abort denial', async () => {
  const h = browser({ abortThrows: true, hung: true })
  const caller = new AbortController()
  const pending = h.check({ signal: caller.signal, timeoutMs: 500 })
  assert.equal(h.requests.length, 5)
  assert.doesNotThrow(() => caller.abort())
  const checks = await pending
  assert.equal(h.abortCalls, 1)
  assert.ok(checks.slice(2).every(x => x.state === 'fail' && x.detail.includes('取消')))
})

test('denied internal signal state rejects all public HEAD admission rather than guessing', async () => {
  const h = browser({ deniedSignalState: true })
  const checks = await h.check({ timeoutMs: 50 })
  assert.equal(h.requests.length, 0)
  assert.deepEqual(checks.slice(2).map(x => x.state), Array(5).fill('fail'))
  assert.ok(checks.slice(2).every(x => x.detail.includes('无法读取取消状态')))
})

test('normal HTTPS public diagnostics remain successful with the same strict MIME and cache rules', async () => {
  const h = browser()
  const checks = await h.check({ timeoutMs: 250 })
  assert.deepEqual(checks.map(x => x.state), Array(7).fill('pass'))
  assert.equal(h.requests.length, 5)
  assert.equal(h.abortCalls, 0)
  assert.doesNotMatch(source, /skipWaiting\s*\(|window\.location\.reload|Authorization|\/api\/v1/)
})
