const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/downloadSink.ts'), 'utf8')
const api = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'downloadSink.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', compiled)(mod.exports, mod)
const writeStream = mod.exports.xDriveWriteWebDownloadToSink
function disk() {
  const calls = { writes: [], closes: 0, aborts: 0 }
  const sink = { kind: 'file-system', settled: false, writable: {
    async write(x) { calls.writes.push(Array.from(x instanceof Blob ? new Uint8Array(await x.arrayBuffer()) : x)) },
    async close() { calls.closes++ },
    async abort() { calls.aborts++ },
  } }
  return { calls, sink }
}
function body(...chunks) {
  return new ReadableStream({ start(c) {
    for (const part of chunks) c.enqueue(Uint8Array.from(part))
    c.close()
  } })
}
test('S4C1: exact streamed bytes commit once; unknown-length legacy stream unchanged', async () => {
  for (const expected of [4, undefined]) {
    const { sink, calls } = disk()
    assert.equal(await writeStream(body([1, 2], [3, 4]), sink, async () => new Blob(), undefined, expected), 4)
    assert.deepEqual(calls.writes, [[1, 2], [3, 4]])
    assert.equal(calls.closes, 1)
    assert.equal(calls.aborts, 0)
    assert.equal(sink.settled, true)
  }
})
test('S4C1: short EOF is not committed and aborts the temporary destination', async () => {
  const { sink, calls } = disk()
  await assert.rejects(writeStream(body([1, 2]), sink, async () => new Blob(), undefined, 3), /不完整/)
  assert.equal(calls.closes, 0)
  assert.equal(calls.aborts, 1)
})
test('S4C1: extra bytes are rejected before overflowing the expected length', async () => {
  const { sink, calls } = disk()
  await assert.rejects(writeStream(body([1, 2], [3, 4]), sink, async () => new Blob(), undefined, 3), /超出/)
  assert.deepEqual(calls.writes, [[1, 2]])
  assert.equal(calls.closes, 0)
  assert.equal(calls.aborts, 1)
})
test('S4C1: Blob fallback rejects size mismatch before writing and 4GiB values are safe', async () => {
  const first = disk()
  await assert.rejects(writeStream(null, first.sink, async () => new Blob([Uint8Array.of(1, 2, 3)]), undefined, 4), /长度/)
  assert.deepEqual(first.calls.writes, [])
  assert.equal(first.calls.aborts, 1)
  const large = disk()
  await assert.rejects(writeStream(body([1]), large.sink, async () => new Blob(), undefined, 4 * 1024 ** 3 + 1), /不完整/)
  assert.equal(large.calls.closes, 0)
  assert.equal(large.calls.aborts, 1)
})
test('S4C1: zero-length valid stream commits and invalid declared sizes abort', async () => {
  const zero = disk()
  assert.equal(await writeStream(body(), zero.sink, async () => new Blob(), undefined, 0), 0)
  assert.equal(zero.calls.closes, 1)
  const invalid = disk()
  await assert.rejects(writeStream(body([1]), invalid.sink, async () => new Blob(), undefined, -1), /预期/)
  assert.equal(invalid.calls.aborts, 1)
})
test('S4C1: real API forwards metadata size and checks decoded response before success', () => {
  assert.ok(api.includes('        version.size,\n      )'))
  assert.ok(api.includes('        node.size,\n      )'))
  const start = api.indexOf('private async downloadAuthenticated(')
  const end = api.indexOf('async function sha256Buffer', start)
  assert.ok(start > 0 && end > start)
  const method = api.slice(start, end)
  for (const token of [
    'expectedContentBytes?: number',
    "response.headers.get('Content-Encoding')",
    'const exactExpectedBytes = expectedContentBytes ?? plainContentLength',
    '          exactExpectedBytes,',
    'if (exactExpectedBytes !== undefined && completed !== exactExpectedBytes)',
  ]) assert.ok(method.includes(token), token)
  assert.ok(source.indexOf('completed !== expectedBytes') < source.indexOf('await sink.writable.close()'))
  assert.ok(api.includes('adminApplyPhotoHost(input:'),
    'S4C1 must preserve existing Photo Host management API from master')
  assert.ok(api.includes('this.nativeDownloadURL(ticket.url)'))
})
