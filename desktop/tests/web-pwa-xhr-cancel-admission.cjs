'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../web/src/transferTransport.ts')
const source = fs.readFileSync(filename, 'utf8')
const code = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.deepEqual((code.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

function browser({ abortThrows = false } = {}) {
  const requests = []
  class XHR {
    upload = {}
    status = 0
    statusText = ''
    responseText = ''
    sends = 0
    aborts = 0
    headers = {}
    constructor() { requests.push(this) }
    open(method, url) {
      assert.equal(method, 'PUT')
      assert.equal(url, '/api/v1/uploads/test/chunks/0')
    }
    setRequestHeader(key, value) { this.headers[key] = value }
    send(body) { this.sends++; this.body = body }
    abort() {
      this.aborts++
      if (abortThrows) throw new Error('WebKit denied XHR.abort')
      this.onabort?.()
    }
    emit(status, body = '') {
      this.status = status
      this.responseText = body
      this.onload?.()
    }
    fail(event) { this[event]?.() }
  }
  const m = { exports: {} }
  new Function('module', 'exports', 'require', 'XMLHttpRequest',
    'Response', 'DOMException', 'Blob', code.outputText)(
    m, m.exports,
    name => {
      assert.equal(name, './downloadSink')
      return {
        xDriveCreateWebDownloadProgressReporter: callback => ({
          progress(loaded) { callback(loaded) },
          flush() {},
        }),
      }
    },
    XHR, Response, DOMException, Blob,
  )
  const send = (signal, onProgress = () => {}) => m.exports.xDriveUploadBytes(
    '/api/v1/uploads/test/chunks/0', {
      headers: { 'X-Test': 'authenticated' },
      body: new ArrayBuffer(4), signal, onProgress,
    },
  )
  return { requests, send, poll: m.exports.xDriveWaitForTransferPoll }
}

test('XHR cancel between first signal check and subscription prevents all PUT bytes', async () => {
  const h = browser()
  let reads = 0, removals = 0
  const signal = {
    get aborted() { return ++reads >= 2 },
    addEventListener() {},
    removeEventListener() { removals++ },
  }
  const pending = h.send(signal)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].sends, 0)
  assert.equal(h.requests[0].aborts, 1)
  assert.equal(reads, 2)
  assert.equal(removals, 1)
})

test('denied XHR abort subscription fails closed with no PUT dispatch', async () => {
  const h = browser()
  let removals = 0
  const signal = {
    aborted: false,
    addEventListener() { throw new Error('Safari denied addEventListener') },
    removeEventListener() { removals++ },
  }
  await assert.rejects(h.send(signal), { name: 'AbortError' })
  assert.equal(h.requests[0].sends, 0)
  assert.equal(removals, 1, 'best-effort cleanup for partially installed listeners')
})

test('synchronous cancel event during subscription cannot be undone by a later false getter', async () => {
  const h = browser()
  const signal = {
    aborted: false,
    addEventListener(_name, callback) { callback() },
    removeEventListener() {},
  }
  await assert.rejects(h.send(signal), { name: 'AbortError' })
  assert.equal(h.requests[0].sends, 0)
  assert.equal(h.requests[0].aborts, 1)
})

test('denied listener removal cannot strand real 204, 401 or network-failure outcomes', async () => {
  for (const status of [204, 401]) {
    const h = browser()
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() { throw Error('Safari denied cleanup') },
    }
    const pending = h.send(signal)
    h.requests[0].emit(status)
    const result = await pending
    assert.equal(result.status, status)
    assert.equal(h.requests[0].sends, 1)
  }
  const h = browser()
  const signal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { throw Error('Safari denied cleanup') },
  }
  const pending = h.send(signal)
  h.requests[0].fail('onerror')
  await assert.rejects(pending, /上传连接失败/)
})

test('cancelled active XHR settles even when the native xhr.abort throws', async () => {
  const h = browser({ abortThrows: true })
  const c = new AbortController()
  const pending = h.send(c.signal)
  assert.equal(h.requests[0].sends, 1)
  assert.doesNotThrow(() => c.abort())
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(h.requests[0].aborts, 1)
  h.requests[0].emit(204)
})

test('a throwing progress observer cannot break an accepted authenticated PUT', async () => {
  const h = browser()
  const pending = h.send(undefined, () => { throw new Error('retired progress observer') })
  assert.doesNotThrow(() => h.requests[0].upload.onprogress({ loaded: 4 }))
  h.requests[0].emit(204)
  assert.equal((await pending).status, 204)
})

test('a pre-aborted or unreadable signal allocates no XHR', async () => {
  for (const signal of [
    { aborted: true },
    { get aborted() { throw Error('Safari denied AbortSignal.aborted') } },
    { aborted: undefined },
  ]) {
    const h = browser()
    await assert.rejects(h.send(signal), { name: 'AbortError' })
    assert.equal(h.requests.length, 0)
  }
})

test('poll cancel during admission rejects before scheduling a subsequent request', async () => {
  const h = browser()
  let reads = 0, removed = 0
  const signal = {
    get aborted() { return ++reads >= 2 },
    addEventListener() {},
    removeEventListener() { removed++ },
  }
  await assert.rejects(h.poll(signal, 60_000), { name: 'AbortError' })
  assert.equal(reads, 2)
  assert.equal(removed, 1)
})

test('poll missing listener and cleanup denials always settle and never hang', async () => {
  const h = browser()
  await assert.rejects(h.poll({
    aborted: false, addEventListener() { throw Error('denied') },
    removeEventListener() { throw Error('cleanup denied') },
  }, 10), { name: 'AbortError' })
  await h.poll({
    aborted: false, addEventListener() {},
    removeEventListener() { throw Error('cleanup denied') },
  }, 1)
})

test('genuine transfer poll cancellation and healthy wait preserve current contract', async () => {
  const h = browser()
  const c = new AbortController()
  const pending = h.poll(c.signal, 10_000)
  c.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  const other = new AbortController()
  await h.poll(other.signal, 1)
})

test('PWA upload transport keeps XHR-only direct chunk writes and no persistent private cache', () => {
  assert.ok(source.includes("xhr.open('PUT', url)"))
  assert.ok(source.includes('xhr.send(input.body)'))
  assert.doesNotMatch(source, /localStorage|sessionStorage|caches\.open|skipWaiting/)
})
