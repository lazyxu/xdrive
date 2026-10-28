'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/pwaConnectivity.ts')
const source = fs.readFileSync(filename, 'utf8')
const code = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((code.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

function realProbe({ controllerDenied = false } = {}) {
  const mod = { exports: {} }
  const Controller = controllerDenied
    ? class { constructor() { throw new Error('Safari blocked AbortController') } }
    : AbortController
  new Function('module', 'exports', 'fetch', 'AbortController',
    'setTimeout', 'clearTimeout', code.outputText)(
    mod, mod.exports,
    () => { throw new Error('unexpected implicit network request') },
    Controller, setTimeout, clearTimeout,
  )
  return mod.exports.xDriveProbePwaServer
}
const healthy = () => ({
  status: 200, headers: { get: () => 'application/json' },
  json: async () => ({ ok: true }),
})

test('denied AbortController prevents any readiness GET without an unhandled rejection', async () => {
  let requests = 0
  const result = await realProbe({ controllerDenied: true })({
    request: async () => { requests++; return healthy() },
  })
  assert.deepEqual(result, { state: 'browser-restricted' })
  assert.equal(requests, 0)
})

test('received 200 with denied header lookup is response-unreadable, not network offline', async () => {
  for (const kind of ['headers', 'get', 'invalid-type']) {
    let jsonCalls = 0, requests = 0
    const response = { status: 200, json: async () => { jsonCalls++; return { ok: true } } }
    if (kind === 'headers') Object.defineProperty(response, 'headers', {
      get() { throw new Error('WebKit denied Response.headers') },
    })
    else response.headers = { get() {
      if (kind === 'get') throw new Error('WebKit denied Headers.get')
      return { toString() { throw new Error('not a string') } }
    } }
    const actual = await realProbe()({ request: async () => { requests++; return response } })
    assert.deepEqual(actual, { state: 'response-unreadable', httpStatus: 200 })
    assert.equal(requests, 1)
    assert.equal(jsonCalls, 0, 'unverified JSON MIME cannot authorize ready')
  }
})

test('unreadable or malformed HTTP status cannot claim a healthy Server', async () => {
  for (const response of [
    { get status() { throw new Error('restricted status getter') } },
    { status: '200' }, { status: 0 }, { status: NaN },
  ]) {
    assert.deepEqual(await realProbe()({ request: async () => response }),
      { state: 'response-unreadable' })
  }
})

test('actual 429/503/403 and HTML SPA fallback retain their original classification', async () => {
  for (const [status, expected] of [
    [429, 'rate-limited'], [503, 'server-unavailable'], [403, 'access-blocked'],
  ]) {
    let reads = 0
    const result = await realProbe()({ request: async () => ({
      get status() { reads++; if (reads !== 1) throw Error('status reread'); return status },
    }) })
    assert.deepEqual(result, { state: expected, httpStatus: status })
    assert.equal(reads, 1)
  }
  assert.deepEqual(await realProbe()({ request: async () => ({
    status: 200, headers: { get: () => 'text/html' }, json: async () => ({ ok: true }),
  }) }), { state: 'unexpected-response', httpStatus: 200 })
})

test('invalid timeout config falls back to bounded normal behavior, not immediate false timeout', async () => {
  for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(await realProbe()({ timeoutMs, request: async () => healthy() }),
      { state: 'ready', httpStatus: 200 })
  }
})

test('diagnostic UI reports unreadable response separately from network offline', () => {
  const ui = fs.readFileSync(path.join(root, 'web/src/PwaUpdateSection.tsx'), 'utf8')
  assert.ok(ui.includes("serverResult?.state === 'response-unreadable'"))
  assert.ok(ui.includes('已收到服务器响应'))
  assert.ok(ui.includes("serverResult?.state === 'browser-restricted'"))
  assert.doesNotMatch(source, /Authorization|localStorage|sessionStorage|skipWaiting|window\.location\.reload/)
})
