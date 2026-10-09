const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load() {
  const source = fs.readFileSync(path.join(__dirname, '../../web/src/downloadSink.ts'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', output)(mod.exports, mod)
  return mod.exports.xDriveWriteWebDownloadToSink
}
function byteSource(payload, step = 17003, failure) {
  let offset = 0, byobReads = 0, defaultReads = 0, cancelled = 0
  const body = new ReadableStream({
    type: 'bytes',
    pull(controller) {
      if (failure && offset >= step) { controller.error(failure); return }
      const request = controller.byobRequest
      if (offset === payload.length) {
        controller.close()
        request?.respond(0)
        return
      }
      const size = Math.min(step, payload.length - offset, request?.view.byteLength ?? step)
      const piece = payload.subarray(offset, offset + size)
      if (request) {
        byobReads += 1
        assert.ok(request.view.buffer.byteLength <= 1024 * 1024)
        new Uint8Array(request.view.buffer, request.view.byteOffset, size).set(piece)
        offset += size
        request.respond(size)
      } else {
        defaultReads += 1
        offset += size
        controller.enqueue(Uint8Array.from(piece))
      }
    },
    cancel() { cancelled += 1 },
  })
  return { body, stats: () => ({ byobReads, defaultReads, cancelled }) }
}
function destination(write) {
  const state = { writes: 0, closes: 0, aborts: 0, reason: null }
  return { state, sink: { kind: 'file-system', settled: false, writable: {
    async write(chunk) { await write(chunk, state.writes); state.writes += 1 },
    async close() { state.closes += 1 },
    async abort(reason) { state.aborts += 1; state.reason = reason },
  } } }
}
test('Web download consumes a real byte stream through bounded BYOB reads with exact tail and post-write progress', async () => {
  const payload = Uint8Array.from({ length: 2 * 1024 * 1024 + 37 }, (_, i) => i % 251)
  const src = byteSource(payload)
  const written = [], progress = []
  let bytes = 0, active = 0
  const dest = destination(async (chunk) => {
    assert.equal(active++, 0)
    const before = Uint8Array.from(chunk)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(chunk, before, 'backing storage must not be reused during an awaited write')
    written.push(before)
    bytes += chunk.byteLength
    active -= 1
  })
  const count = await load()(src.body, dest.sink, async () => { throw Error('unexpected fallback') }, done => {
    assert.equal(active, 0)
    assert.equal(done, bytes)
    progress.push(done)
  })
  assert.equal(count, payload.length)
  assert.deepEqual(Buffer.concat(written), Buffer.from(payload))
  assert.ok(src.stats().byobReads > 0, 'supported byte stream must use BYOB')
  assert.equal(src.stats().defaultReads, 0)
  assert.equal(progress.at(-1), payload.length)
  assert.equal(dest.state.closes, 1)
  assert.equal(dest.state.aborts, 0)
  assert.equal(src.body.locked, false)
})
test('Web BYOB download handles empty byte-stream EOF without a write', async () => {
  const src = byteSource(new Uint8Array())
  const dest = destination(async () => { throw Error('empty stream must not write') })
  assert.equal(await load()(src.body, dest.sink, async () => new Blob()), 0)
  assert.equal(dest.state.closes, 1)
  assert.equal(src.body.locked, false)
})
test('Web BYOB write failure cancels the reader and never publishes failed bytes', async () => {
  const src = byteSource(new Uint8Array(2 * 1024 * 1024 + 7), 1024 * 1024)
  const error = Error('disk full'), progress = []
  const dest = destination(async (_chunk, index) => { if (index === 1) throw error })
  await assert.rejects(load()(src.body, dest.sink, async () => new Blob(), done => progress.push(done)), error)
  assert.equal(progress.length, 1)
  assert.equal(progress[0], 1024 * 1024)
  assert.equal(src.stats().cancelled, 1)
  assert.equal(dest.state.closes, 0)
  assert.equal(dest.state.aborts, 1)
  assert.equal(dest.state.reason, error)
  assert.equal(src.body.locked, false)
})
test('Web BYOB read failure preserves the error and aborts destination', async () => {
  const error = Error('connection reset')
  const src = byteSource(new Uint8Array(2 * 1024 * 1024), 1024 * 1024, error)
  const dest = destination(async () => {})
  await assert.rejects(load()(src.body, dest.sink, async () => new Blob()), error)
  assert.equal(dest.state.closes, 0)
  assert.equal(dest.state.aborts, 1)
  assert.equal(dest.state.reason, error)
  assert.equal(src.body.locked, false)
})
test('Web BYOB download preserves a write error when stream cancel and destination abort also fail', async () => {
  const error = Error('primary write failure'), progress = []
  let aborts = 0, cancellations = 0
  const body = new ReadableStream({
    type: 'bytes',
    pull(controller) {
      const request = controller.byobRequest
      new Uint8Array(request.view.buffer).fill(7)
      request.respond(request.view.byteLength)
    },
    cancel() { cancellations += 1; throw Error('secondary cancel failure') },
  })
  const sink = { kind: 'file-system', settled: false, writable: {
    async write() { throw error },
    async close() { throw Error('must not close') },
    async abort() { aborts += 1; throw Error('secondary abort failure') },
  } }
  await assert.rejects(load()(body, sink, async () => new Blob(), done => progress.push(done)), error)
  assert.deepEqual(progress, [])
  assert.equal(cancellations, 1)
  assert.equal(aborts, 1)
  assert.equal(sink.settled, true)
  assert.equal(body.locked, false)
})
test('Web BYOB download reports only written bytes and aborts if destination close fails', async () => {
  const error = Error('close failed'), progress = []
  const src = byteSource(new Uint8Array([4, 5, 6]))
  const dest = destination(async () => {})
  dest.sink.writable.close = async () => { throw error }
  await assert.rejects(load()(src.body, dest.sink, async () => new Blob(), done => progress.push(done)), error)
  assert.deepEqual(progress, [3])
  assert.equal(dest.state.aborts, 1)
  assert.equal(dest.state.reason, error)
  assert.equal(src.body.locked, false)
})
test('Web reusable BYOB download publishes slow-stream progress before waiting for a full MiB', async () => {
  const { performance } = require('node:perf_hooks')
  const total = 1024 * 1024 + 37
  let offset = 0, firstProgress = null
  const started = performance.now()
  const body = new ReadableStream({
    type: 'bytes',
    async pull(controller) {
      if (offset === total) {
        const request = controller.byobRequest
        controller.close()
        request?.respond(0)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 50))
      const request = controller.byobRequest
      const count = Math.min(32 * 1024, total - offset, request.view.byteLength)
      new Uint8Array(request.view.buffer, request.view.byteOffset, count).fill(3)
      offset += count
      request.respond(count)
    },
  })
  const dest = destination(async () => {})
  const count = await load()(body, dest.sink, async () => new Blob(), () => {
    firstProgress ??= performance.now() - started
  })
  assert.equal(count, total)
  assert.ok(firstProgress < 500, `first valid byte progress waited ${firstProgress}ms for a full buffer`)
})
