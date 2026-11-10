export class IncrementalSHA256 {
  update(bytes: Uint8Array): this
  digestHex(): string
}

export function feedFullUploadHash(
  fullFileHasher: IncrementalSHA256, bytes: Uint8Array, check?: () => void,
): Promise<void>
