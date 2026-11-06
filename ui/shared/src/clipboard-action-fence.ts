/**
 * Async Browser clipboard reads and copy callbacks cannot reliably be aborted.
 * Lock and Owner unmount invalidate their captured versions, so late results
 * never repopulate decrypted React state or show success for the wrong vault.
 */
export class XDriveClipboardActionFence {
  private version = 0

  capture(): number {
    return this.version
  }

  invalidate(): void {
    this.version++
  }

  isCurrent(version: number): boolean {
    return version === this.version
  }
}
