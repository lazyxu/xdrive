const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/transferTransport.ts'), 'utf8')
const js = ts.transpileModule(source, {
  fileName: 'transferTransport.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture({ progressThrows = false } = {}) {
  const requests = []
  class MockXHR {
    upload = {}
    status = 0
    statusText = ''
    responseText = ''
    constructor() { requests.push(this) }
    open(method, url) { assert.equal(method, 'PUT'); assert.equal(url, '/api/v1/uploads/test/chunks/0') }
    setRequestHeader() {}
    send(body) { this.body = body }
    abort() { this.onabort?.() }
    emit(status, body = '') {
      this.status = status
      this.responseText = body
      queueMicrotask(() => this.onload?.())
    }
    fail(kind) { queueMicrotask(() => this[kind]?.()) }
  }
  const module = { exports: {} }
  const reporter = (report) => {
    let last = 0
    return { progress(bytes) { last = bytes }, flush() { if (progressThrows) report(last) } }
  }
  new Function('module', 'exports', 'require', 'XMLHttpRequest', 'Response', 'DOMException', 'Blob', js)(
    module, module.exports,
    specifier => { assert.equal(specifier, './downloadSink'); return { xDriveCreateWebDownloadProgressReporter: reporter } },
    MockXHR, Response, DOMException, Blob,
  )
  const start = (signal = undefined) => module.exports.xDriveUploadBytes(
    '/api/v1/uploads/test/chunks/0', {
      headers: { Authorization: 'Bearer internal-test-only' },
      body: new ArrayBuffer(2), signal,
      onProgress: () => { throw new Error('stale progress subscriber') },
    })
  const settled = promise => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('XHR terminal event left the upload pending')), 90)),
  ])
  return { requests, start, settled }
}

test('S4B Web/Mobile: HTTP 0 onload rejects and never leaves the upload running', async () => {
  const f = fixture()
  const outcome = f.settled(f.start())
  f.requests[0].emit(0)
  await assert.rejects(outcome, /上传连接失败/)
})

test('S4B Web/Mobile: invalid 204 with a body rejects instead of leaving an unhandled event throw', async () => {
  const f = fixture()
  const outcome = f.settled(f.start())
  f.requests[0].emit(204, 'unexpected-body')
  await assert.rejects(outcome, /Response|status|body/i)
})

test('S4B Web/Mobile: a stale throwing progress subscriber must not mask an XHR network failure', async () => {
  const f = fixture({ progressThrows: true })
  const outcome = f.settled(f.start())
  f.requests[0].fail('onerror')
  await assert.rejects(outcome, /上传连接失败/)
})

test('S4B Web/Mobile: success, 401 and pre-aborted signals preserve the original upload contract', async () => {
  for (const status of [204, 401]) {
    const f = fixture()
    const outcome = f.settled(f.start())
    f.requests[0].emit(status)
    const response = await outcome
    assert.equal(response.status, status)
    assert.equal(response.ok, status === 204)
  }
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.settled(f.start(controller.signal)), { name: 'AbortError' })
  assert.equal(f.requests.length, 0)
})
