import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { IncrementalSHA256, feedFullUploadHash } from '../src/uploadFullSha256.mjs'

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex')
const deterministic = (length) => {
  const bytes = new Uint8Array(length)
  let seed = 0x92375
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    bytes[i] = seed & 0xff
  }
  return bytes
}

test('incremental SHA-256 matches native Node crypto at all padding and chunk boundaries', () => {
  for (const size of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 255, 256, 257, 511, 512, 513, 8192, 65537, 1048577]) {
    const data = deterministic(size)
    const expected = hex(data)
    for (const windowSize of [1, 7, 64, 137, 65536]) {
      const sha = new IncrementalSHA256()
      for (let i = 0; i < size; i += windowSize) sha.update(data.subarray(i, i + windowSize))
      assert.equal(sha.digestHex(), expected, `size=${size} window=${windowSize}`)
    }
  }
  const abc = new IncrementalSHA256().update(new TextEncoder().encode('abc'))
  assert.equal(abc.digestHex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('each full-file hashing update is bounded, with cancellation between windows', async () => {
  const sizes = []
  const fakeHash = { update(bytes) { sizes.push(bytes.byteLength) } }
  const bytes = new Uint8Array(2 * 1024 * 1024 + 73)
  let checks = 0
  await feedFullUploadHash(fakeHash, bytes, () => { checks++ })
  assert.deepEqual(sizes, [1048576, 1048576, 73])
  assert.equal(checks, 4)
  let cancelledChecks = 0
  const cancelledHash = { update() { cancelledChecks++ } }
  await assert.rejects(
    feedFullUploadHash(cancelledHash, bytes, () => {
      if (++cancelledChecks === 3) throw new Error('Owner session revoked')
    }),
    /Owner session revoked/,
  )
  assert.equal(cancelledChecks, 3)
})

test('159 MiB video digest is correct with 8 MiB scratch and constant memory', async () => {
  const sha = new IncrementalSHA256()
  const native = createHash('sha256')
  const scratch = deterministic(8 * 1024 * 1024)
  const fileSize = 159 * 1024 * 1024 + 31
  let readBytes = 0
  let checks = 0
  while (readBytes < fileSize) {
    const window = scratch.subarray(0, Math.min(scratch.byteLength, fileSize - readBytes))
    await feedFullUploadHash(sha, window, () => { checks++ })
    native.update(window)
    readBytes += window.byteLength
  }
  assert.equal(sha.digestHex(), native.digest('hex'))
  assert.equal(readBytes, fileSize)
  assert.ok(checks >= 159)
})

test('finalized SHA-256 state cannot silently be reused', () => {
  const sha = new IncrementalSHA256()
  sha.update(new Uint8Array([0]))
  assert.match(sha.digestHex(), /^[0-9a-f]{64}$/)
  assert.throws(() => sha.update(new Uint8Array([0])), /finalized/)
  assert.throws(() => sha.digestHex(), /already read/)
  assert.throws(() => new IncrementalSHA256().update(new Uint32Array(1)), /Uint8Array/)
})

test('Web CAS UploadSession sends the full-file digest with canonical chunk hashes', async () => {
  const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
  assert.match(source, /const fullFileHasher = new IncrementalSHA256\(\)/)
  assert.match(source, /sha256Blob\(file\.slice\(start, end\), hashScratch, fullFileHasher, tracking\.check\)/)
  assert.match(source, /const fullFileSHA256 = fullFileHasher\.digestHex\(\)/)
  assert.match(source, /chunk_sha256: chunkHashes,[\s\S]{0,90}sha256: fullFileSHA256/)
  assert.match(source, /session\.instant_cas_reused \? file\.size : 0/)
  assert.match(source, /existing\.reused\) casReusedBytes/)
})
