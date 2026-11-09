import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { xDriveWriteWebDownloadToSink } from '../src/downloadSink.ts'
import { XDriveStreamingSHA256 } from '../src/releaseBundleSHA256.ts'

function sinkFixture() {
  const recorded = { chunks: [], closed: 0, aborted: 0 }
  return {
    recorded,
    sink: { kind: 'file-system', settled: false, writable: {
      async write(bytes) { recorded.chunks.push(Buffer.from(bytes)) },
      async close() { recorded.closed++ },
      async abort() { recorded.aborted++ },
    } },
  }
}
function stream(bytes) {
  let sent = false
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.close()
      else { controller.enqueue(bytes); sent = true }
    },
  })
}
test('exact installer digest is checked before file-system close', async () => {
  const bytes = new TextEncoder().encode('verified-current-server-bundle')
  const want = createHash('sha256').update(bytes).digest('hex')
  const hasher = new XDriveStreamingSHA256()
  const { recorded, sink } = sinkFixture()
  const n = await xDriveWriteWebDownloadToSink(
    stream(bytes), sink, async () => new Blob([]), undefined, bytes.length, {
      onChunk: (chunk) => hasher.update(chunk),
      verify: () => assert.equal(hasher.digestHex(), want),
    },
  )
  assert.equal(n, bytes.length)
  assert.equal(recorded.closed, 1)
  assert.equal(recorded.aborted, 0)
  assert.equal(Buffer.concat(recorded.chunks).toString(), new TextDecoder().decode(bytes))
})

test('wrong digest aborts picked file and never closes it', async () => {
  const bytes = new TextEncoder().encode('tampered-current-server-bundle')
  const hasher = new XDriveStreamingSHA256()
  const { recorded, sink } = sinkFixture()
  await assert.rejects(
    xDriveWriteWebDownloadToSink(stream(bytes), sink, async () => new Blob([]),
      undefined, bytes.length, {
        onChunk: (chunk) => hasher.update(chunk),
        verify: () => { if (hasher.digestHex() !== '0'.repeat(64)) throw new Error('hash mismatch') },
      }),
    /hash mismatch/,
  )
  assert.equal(recorded.closed, 0)
  assert.equal(recorded.aborted, 1)
})
test('truncated installer aborts before digest commit', async () => {
  const { recorded, sink } = sinkFixture()
  await assert.rejects(
    xDriveWriteWebDownloadToSink(stream(new Uint8Array([1, 2])), sink,
      async () => new Blob([]), undefined, 3),
    /不完整/,
  )
  assert.equal(recorded.closed, 0)
  assert.equal(recorded.aborted, 1)
})
