import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { XDriveStreamingSHA256 } from '../src/releaseBundleSHA256.ts'

test('NIST empty/abc/million-a SHA-256 vectors', () => {
  for (const [data, expected] of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ]) {
    const x = new XDriveStreamingSHA256()
    x.update(new TextEncoder().encode(data))
    assert.equal(x.digestHex(), expected)
    assert.throws(() => x.update(new Uint8Array([1])), /already finalized/)
  }
  const million = new XDriveStreamingSHA256()
  const block = new TextEncoder().encode('a'.repeat(1000))
  for (let i = 0; i < 1000; i += 1) million.update(block)
  assert.equal(million.digestHex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
})

test('chunk boundaries, 64-byte padding edge cases and multimegabyte streaming match native crypto', () => {
  for (const length of [0, 1, 2, 3, 55, 56, 57, 63, 64, 65, 128, 129, 1024, 100000]) {
    const data = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 255)
    const want = createHash('sha256').update(data).digest('hex')
    for (const chunkSize of [1, 7, 64, 127, 1024]) {
      const digest = new XDriveStreamingSHA256()
      for (let i = 0; i < length; i += chunkSize) digest.update(data.subarray(i, i + chunkSize))
      assert.equal(digest.digestHex(), want, 'length=' + length + ' chunk=' + chunkSize)
    }
  }
  const digest = new XDriveStreamingSHA256()
  const native = createHash('sha256')
  const block = Uint8Array.from({ length: 131077 }, (_, i) => (i * 17 + 9) & 255)
  for (let i = 0; i < 80; i += 1) {
    digest.update(block)
    native.update(block)
  }
  assert.equal(digest.digestHex(), native.digest('hex'))
})
