'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../web/src/nativeFileShare.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const compiledExports = {}
new Function('exports', 'Blob', 'DOMException', compiled.outputText)(compiledExports, Blob, DOMException)
const read = compiledExports.xDriveReadBoundedNativeShareBlob

function response(bytes = [1, 2, 3], hooks = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes))
      if (!hooks.keepOpen) controller.close()
    },
    cancel() { hooks.onCancel?.() },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-length': String(bytes.length), 'content-type': 'image/png' },
  })
}

test('bounded native share supports an AbortSignal without optional throwIfAborted()', async () => {
  let attached = 0
  let detached = 0
  const legacySignal = {
    aborted: false,
    addEventListener(event) { assert.equal(event, 'abort'); attached++ },
    removeEventListener(event) { assert.equal(event, 'abort'); detached++ },
  }
  const shared = await read(response(), legacySignal)
  assert.equal(shared.size, 3)
  assert.equal(shared.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await shared.arrayBuffer())], [1, 2, 3])
  assert.equal(attached, 1)
  assert.equal(detached, 1)
})

test('denied AbortSignal listener fails closed and releases already acquired media stream', async () => {
  let cancelled = 0
  let removals = 0
  const streamed = response([1, 2, 3], { onCancel: () => cancelled++, keepOpen: true })
  const signal = {
    aborted: false,
    addEventListener() { throw new Error('Safari denied AbortSignal listener') },
    removeEventListener() { removals++ },
  }
  await assert.rejects(read(streamed, signal), /无法监听系统分享取消操作/)
  assert.equal(cancelled, 1, 'failed subscription must cancel the already held stream')
  assert.equal(streamed.body.locked, false)
  assert.equal(removals, 0)
})

test('cancel between listener subscription and byte read cannot expose a partial share', async () => {
  let cancelled = 0
  let aborted = false
  const streamed = response([7, 8, 9], { onCancel: () => cancelled++, keepOpen: true })
  const signal = {
    get aborted() { return aborted },
    addEventListener() { aborted = true },
    removeEventListener() {},
  }
  await assert.rejects(read(streamed, signal), { name: 'AbortError' })
  assert.equal(cancelled, 1)
  assert.equal(streamed.body.locked, false)
})

test('denied AbortSignal.aborted getter never returns file bytes', async () => {
  const signal = {
    get aborted() { throw new Error('Safari denied AbortSignal.aborted') },
    addEventListener() {},
    removeEventListener() {},
  }
  await assert.rejects(read(response(), signal), /无法确认系统分享取消状态/)
})

test('denied listener removal cannot mask a successful bounded byte share', async () => {
  const signal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { throw new Error('Safari denied removeEventListener') },
  }
  const blob = await read(response([4, 5, 6]), signal)
  assert.equal(blob.size, 3)
})

test('synchronous reader.cancel denial cannot escape abort event or emit partial bytes', async () => {
  const controller = new AbortController()
  let completeRead
  let cancellations = 0
  let unlocked = 0
  const fakeBody = {
    getReader() {
      return {
        read() { return new Promise(resolve => { completeRead = resolve }) },
        cancel() { cancellations++; throw new Error('reader.cancel denied') },
        releaseLock() { unlocked++ },
      }
    },
  }
  const fakeResponse = {
    status: 200,
    headers: { get(name) {
      return name === 'content-length' ? '3' : 'image/png'
    } },
    body: fakeBody,
  }
  const pending = read(fakeResponse, controller.signal)
  assert.equal(typeof completeRead, 'function')
  assert.doesNotThrow(() => controller.abort())
  completeRead({ done: false, value: Uint8Array.from([1, 2, 3]) })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancellations, 2, 'abort callback and finally both attempt best-effort cancellation')
  assert.equal(unlocked, 1)
})

test('16 MiB upper bound and HTTP 200 original-only policy remain unchanged', async () => {
  assert.equal(compiledExports.XDRIVE_NATIVE_SHARE_MAX_BYTES, 16 * 1024 * 1024)
  await assert.rejects(read(response([1, 2, 3]), undefined, 2), /文件太大/)
  await assert.rejects(read({ status: 206 }, undefined), /响应不完整/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|skipWaiting|window\.location\.reload|Authorization/)
})
