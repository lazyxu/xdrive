export class IncrementalSHA256 {
  update(bytes: Uint8Array): this
  digestHex(): string
}
