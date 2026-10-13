// Opt-in benchmark-only full-byte verifier for deterministic high-entropy
// Web uploads/downloads. No production user file passes through this helper.
// A 256-bit AES-CTR stream over all-zero plaintext creates a reproducible,
// cryptographically pseudorandom (non-sparse/non-compressible) test file.
// Verify each OPFS byte with bounded chunks, not a 1–4 GiB JS allocation.
const keyPrefix = 'xdrive-p042-cas-aes256ctr:'
const maxChunk = 1024 * 1024

async function benchmarkKey(sample: string): Promise<CryptoKey> {
  if (!/^sample-[1-9][0-9]*$/.test(sample)) throw new Error('Invalid deterministic benchmark sample')
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(keyPrefix + sample))
  return crypto.subtle.importKey('raw', digest, 'AES-CTR', false, ['encrypt'])
}

function counterForByteOffset(offset: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 16 !== 0) {
    throw new Error('Invalid AES-CTR aligned OPFS sample offset')
  }
  const counter = new Uint8Array(new ArrayBuffer(16))
  let blocks = BigInt(offset) / 16n
  for (let i = 15; i >= 8; i--) {
    counter[i] = Number(blocks & 255n)
    blocks >>= 8n
  }
  if (blocks !== 0n) throw new Error('AES-CTR benchmark counter out of range')
  return counter
}

// This permits either the full file or arbitrary aligned subsets to be checked.
export async function xDriveVerifyDeterministicHighEntropyOPFS(
  file: Pick<Blob, 'size' | 'slice'>,
  expectedSize: number,
  sample: string,
  ranges?: Array<{offset: number; length: number}>,
): Promise<number> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 ||
      expectedSize > 4 * (2 ** 30) || file.size !== expectedSize) {
    throw new Error('Invalid physical OPFS benchmark size')
  }
  const key = await benchmarkKey(sample)
  const requested = ranges ?? [{offset: 0, length: expectedSize}]
  let verifiedBytes = 0
  for (const range of requested) {
    if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length) ||
        range.offset < 0 || range.length <= 0 || range.offset % 16 !== 0 ||
        range.length % 16 !== 0 || range.offset + range.length > expectedSize) {
      throw new Error('Invalid bounded deterministic OPFS check range')
    }
    for (let offset = range.offset; offset < range.offset + range.length; ) {
      const count = Math.min(maxChunk, range.offset + range.length - offset)
      const actual = new Uint8Array(await file.slice(offset, offset + count).arrayBuffer())
      const expected = new Uint8Array(await crypto.subtle.encrypt({
        name: 'AES-CTR', counter: counterForByteOffset(offset), length: 64,
      }, key, new Uint8Array(count)))
      if (actual.length !== count || expected.length !== count) throw new Error('Short OPFS read')
      for (let i = 0; i < count; i++) {
        if (actual[i] !== expected[i]) {
          throw new Error(`Incompressible OPFS byte mismatch at offset ${offset + i}`)
        }
      }
      verifiedBytes += count
      offset += count
    }
  }
  return verifiedBytes
}
