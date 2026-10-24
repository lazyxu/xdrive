/**
 * Tie a Desktop preview proxy ticket to the shared Preview Engine's active
 * AbortSignal. Aborting a mounted preview invalidates the token in Main and
 * closes its in-flight native Range reads; an unrelated URL is never released.
 */
export function xDriveLeaseDesktopPreviewURL(
  value: string,
  signal: AbortSignal | undefined,
  release: (url: string) => Promise<unknown>,
): string {
  let nativeProxyURL = false
  try {
    const url = new URL(value)
    nativeProxyURL = url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' && Number(url.port) > 0 &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/preview\/[0-9a-f]{64}$/.test(url.pathname)
  } catch { /* Blob/remote/non-preview URLs are not native tickets. */ }
  if (!nativeProxyURL) {
    signal?.throwIfAborted()
    return value
  }
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    try { void release(value).catch(() => {}) } catch { /* Cleanup is best-effort. */ }
  }
  if (signal?.aborted) {
    dispose()
    signal.throwIfAborted()
  }
  signal?.addEventListener('abort', dispose, { once: true })
  return value
}
