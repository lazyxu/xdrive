// Incremental SHA-256 for verified installer downloads in browsers.
// WebCrypto digest() requires buffering the entire file, which is unsafe for
// multi-GB SPK/IPA/desktop packages. This implementation keeps a single
// 64-byte block and 64 schedule words regardless of download size.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotate = (value: number, bits: number) =>
  (value >>> bits) | (value << (32 - bits))

export class XDriveStreamingSHA256 {
  private readonly hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  private readonly buffer = new Uint8Array(64)
  private readonly words = new Uint32Array(64)
  private used = 0
  private total = 0
  private finalized = false

  update(input: Uint8Array): void {
    if (this.finalized) throw new Error('SHA-256 digest was already finalized')
    if (this.total + input.byteLength > Number.MAX_SAFE_INTEGER) {
      throw new Error('SHA-256 input size exceeds safe integer bounds')
    }
    this.total += input.byteLength
    let offset = 0
    while (offset < input.byteLength) {
      const n = Math.min(64 - this.used, input.byteLength - offset)
      this.buffer.set(input.subarray(offset, offset + n), this.used)
      this.used += n
      offset += n
      if (this.used === 64) {
        this.compress()
        this.used = 0
      }
    }
  }

  digestHex(): string {
    if (this.finalized) throw new Error('SHA-256 digest was already finalized')
    this.finalized = true
    const bits = BigInt(this.total) * 8n
    this.buffer[this.used++] = 0x80
    if (this.used > 56) {
      this.buffer.fill(0, this.used, 64)
      this.compress()
      this.used = 0
    }
    this.buffer.fill(0, this.used, 56)
    for (let i = 0; i < 8; i += 1) {
      this.buffer[56 + i] = Number((bits >> BigInt(56 - 8 * i)) & 0xffn)
    }
    this.compress()
    return Array.from(this.hash, (word) => word.toString(16).padStart(8, '0')).join('')
  }

  private compress(): void {
    const w = this.words
    for (let i = 0; i < 16; i += 1) {
      const j = 4 * i
      w[i] = ((this.buffer[j] << 24) | (this.buffer[j + 1] << 16) |
        (this.buffer[j + 2] << 8) | this.buffer[j + 3]) >>> 0
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15], y = w[i - 2]
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = this.hash
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choice = (e & f) ^ (~e & g)
      const t1 = (h + S1 + choice + SHA256_K[i] + w[i]) >>> 0
      const S0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i += 1) this.hash[i] = (this.hash[i] + next[i]) >>> 0
  }
}
