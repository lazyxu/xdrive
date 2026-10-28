'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../web/src/mediaBinaryProgress.ts')
const source = fs.readFileSync(filename, 'utf8')
const transpiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((transpiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'Response', 'Blob', 'DOMException', 'TransformStream',
  'performance', transpiled.outputText)(
  mod, mod.exports, Response, Blob, DOMException, TransformStream, performance,
)
const read = mod.exports.xDriveMediaResponseBlob

test('legacy Safari AbortSignal without throwIfAborted retains original native Blob bytes', async () => {
  const signal = { aborted: false }
  const response = new Response(new Uint8Array([4, 5, 6]), {
    headers: { 'content-type': 'image/jpeg' },
  })
  const blob = await read(response, signal)
  assert.equal(blob.size, 3)
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [4, 5, 6])
})

test('real streaming media progress does not depend on optional throwIfAborted', async () => {
  const controller = new AbortController()
  Object.defineProperty(controller.signal, 'throwIfAborted', {
    configurable: true, value: undefined,
  })
  const calls = []
  const response = new Response(new Uint8Array([1, 2, 3, 4]), {
    headers: { 'content-type': 'image/png', 'content-length': '4' },
  })
  const blob = await read(response, controller.signal, (done, total) => calls.push([done, total]))
  assert.equal(blob.size, 4)
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4])
  assert.deepEqual(calls.at(-1), [4, 4])
})

test('pre-aborted and unreadable AbortSignal refuse private bytes before consuming body', async () => {
  const aborted = new AbortController()
  aborted.abort()
  for (const signal of [
    aborted.signal,
    { get aborted() { throw new Error('WebKit denied abort state') } },
    { aborted: 'no-proven-state' },
  ]) {
    const response = new Response(new Uint8Array([9, 8]))
    await assert.rejects(read(response, signal), { name: 'AbortError' })
    assert.equal(response.bodyUsed, false)
  }
})

test('abort observed after native blob completion does not yield a stale Viewer resource', async () => {
  const controller = new AbortController()
  const response = {
    blob: async () => { controller.abort(); return new Blob(['private']) },
  }
  await assert.rejects(read(response, controller.signal), { name: 'AbortError' })
})

test('denied optional response headers preserve body and suppress false progress/alpha proofs', async () => {
  const calls = []
  const response = {
    body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() },
    }),
    headers: { get() { throw new Error('WebKit denied Headers.get') } },
  }
  const blob = await read(response, undefined, (done, total, mask) => {
    calls.push({ done, total, mask })
  }, true)
  assert.equal(blob.size, 3)
  assert.equal(blob.type, 'application/octet-stream')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3])
  assert.equal(calls.at(-1).done, 3)
  assert.equal(calls.at(-1).total, undefined)
  assert.equal(calls.at(-1).mask, null, 'unverified alpha must never be rendered opaque')
})

test('verified opaque JPEG alpha and exact total remain usable when headers are available', async () => {
  const calls = []
  const response = new Response(new Uint8Array([1, 2]), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': '2',
      'x-xdrive-thumbnail-alpha-state': 'opaque',
    },
  })
  const result = await read(response, undefined, (done, total, mask) => calls.push({ done, total, mask }), true)
  assert.equal(result.type, 'image/jpeg')
  assert.deepEqual(calls.at(-1), { done: 2, total: 2, mask: '' })
})

test('media reader remains a response-only transport with no durable browser private cache', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|caches\.open|skipWaiting/)
  assert.equal((source.match(/signal\?\.throwIfAborted\(\)/g) || []).length, 0)
})
