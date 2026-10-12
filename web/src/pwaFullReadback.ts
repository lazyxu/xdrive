// CI-only opt-in release proof for existing real Chromium/PostgreSQL/CAS
// sparse-zero fixtures. No file is cached or kept offline by this helper.
export async function xDriveVerifySparseZeroOPFSFile(
  file: Pick<Blob, 'size' | 'slice'>,
  expectedBytes: number,
  blockBytes = 1024 * 1024,
): Promise<number> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 ||
      !Number.isSafeInteger(blockBytes) || blockBytes <= 0 || blockBytes > 1024 * 1024) {
    throw new Error('Invalid bounded OPFS verification size')
  }
  if (file.size !== expectedBytes) {
    throw new Error(`OPFS file size ${file.size} differs from expected ${expectedBytes}`)
  }
  let verified = 0
  while (verified < expectedBytes) {
    const end = Math.min(expectedBytes, verified + blockBytes)
    const part = new Uint8Array(await file.slice(verified, end).arrayBuffer())
    if (part.byteLength !== end - verified || part.some(value => value !== 0)) {
      throw new Error(`OPFS persisted byte mismatch at offset ${verified}`)
    }
    verified = end
  }
  return verified
}
