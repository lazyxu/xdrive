/**
 * Only private xDrive Desktop loopback tickets may be released through Main.
 * Never hand Blob URLs, remote signed URLs, arbitrary local ports or query
 * parameters to a privileged release call.
 */
function isDesktopPreviewTicket(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' && Number(url.port) > 0 &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/preview\/[0-9a-f]{64}$/.test(url.pathname)
  } catch {
    return false
  }
}

export function xDriveReleaseDiscardedDesktopPreviewURL(
  value: string,
  release: (url: string) => Promise<unknown>,
): void {
  if (!isDesktopPreviewTicket(value)) return
  try { void release(value).catch(() => {}) } catch { /* Best-effort on a stale session. */ }
}

/**
 * Bind an accepted proxy ticket to the mounted Preview Engine AbortSignal.
 * A discarded IPC response after cancellation must use the explicit
 * xDriveReleaseDiscardedDesktopPreviewURL function instead of leasing.
 */
export function xDriveLeaseDesktopPreviewURL(
  value: string,
  signal: AbortSignal | undefined,
  release: (url: string) => Promise<unknown>,
): string {
  if (!isDesktopPreviewTicket(value)) {
    signal?.throwIfAborted()
    return value
  }
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    xDriveReleaseDiscardedDesktopPreviewURL(value, release)
  }
  if (signal?.aborted) {
    dispose()
    signal.throwIfAborted()
  }
  signal?.addEventListener('abort', dispose, { once: true })
  return value
}
