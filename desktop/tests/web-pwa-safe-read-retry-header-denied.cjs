'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/pwaSafeReadRetry.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

const moduleUnderTest = { exports: {} }
new Function('module', 'exports', 'document', 'DOMException', 'fetch', compiled.outputText)(
  moduleUnderTest, moduleUnderTest.exports,
  { visibilityState: 'visible' }, DOMException,
  () => { throw new Error('unexpected global fetch') },
)
const read = moduleUnderTest.exports.xDriveFetchPwaSafeRead
const pathName = '/api/v1/nodes/42/children?range=true'

function blockedResponse(status, denial) {
  let cancelled = 0
  const first = {
    status,
    body: { cancel() { cancelled++; return Promise.resolve() } },
  }
  if (denial === 'headers') {
    Object.defineProperty(first, 'headers', {
      get() { throw new Error('WebKit blocked Response.headers') },
    })
  } else {
    first.headers = {
      get(name) {
        assert.equal(name, 'Retry-After')
        if (denial === 'get') throw new Error('WebKit blocked Headers.get')
        if (denial === 'non-string') return { toString() { throw new Error('not a header') } }
        return null
      },
    }
  }
  return { first, get cancelled() { return cancelled } }
}

test('Safari denied Retry-After Headers.get preserves readable HTTP 429 and 503', async () => {
  for (const status of [429, 503]) {
    const record = blockedResponse(status, 'get')
    let calls = 0
    const returned = await read(pathName, pathName, {}, async () => {
      calls++
      return record.first
    })
    assert.strictEqual(returned, record.first)
    assert.equal(returned.status, status)
    assert.equal(calls, 1, 'denied header must not authorize a second Owner GET')
    assert.equal(record.cancelled, 0, 'original body remains intact for error display')
  }
})

test('denied Response.headers getter and non-string Retry-After never discard 429', async () => {
  for (const mode of ['headers', 'non-string']) {
    const record = blockedResponse(429, mode)
    let calls = 0
    const returned = await read(pathName, pathName, {}, async () => {
      calls++
      return record.first
    })
    assert.strictEqual(returned, record.first, mode)
    assert.equal(record.cancelled, 0, mode)
    assert.equal(calls, 1, mode)
  }
})

test('healthy bounded Retry-After header continues to release 503 before one retry', async () => {
  let attempts = 0
  let cancellations = 0
  const first = {
    status: 503,
    headers: { get(name) { return name === 'Retry-After' ? '0' : null } },
    body: { cancel() { cancellations++; return Promise.resolve() } },
  }
  const final = { status: 200 }
  const result = await read(pathName, pathName, {}, async () => {
    attempts++
    return attempts === 1 ? first : final
  })
  assert.strictEqual(result, final)
  assert.equal(attempts, 2)
  assert.equal(cancellations, 1)
})

test('mutations, tickets, and nonretry statuses still never query optional headers', async () => {
  for (const [method, url, status] of [
    ['POST', pathName, 503],
    ['GET', '/api/v1/download/ticket', 503],
    ['GET', pathName, 401],
  ]) {
    const record = blockedResponse(status, 'headers')
    let attempts = 0
    assert.strictEqual(await read(url, url, { method }, async () => {
      attempts++
      return record.first
    }), record.first)
    assert.equal(attempts, 1)
    assert.equal(record.cancelled, 0)
  }
  assert.doesNotMatch(source, /skipWaiting\s*\(|location\.reload\s*\(|localStorage|sessionStorage/)
})
