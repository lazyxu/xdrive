/** Optional WebKit AbortSignal.throwIfAborted() is not available everywhere.
 * The standard boolean abort state remains authoritative; denied/unknown
 * observations cannot authorize reading private media bytes. */
function xDriveAssertMediaReadActive(signal?: AbortSignal): void {
  if (!signal) return
  let active = false
  try { active = signal.aborted === false }
  catch { /* restricted AbortSignal getter: fail closed */ }
  if (!active) throw new DOMException('媒体读取已取消或浏览器无法确认取消状态。', 'AbortError')
}

/** A denied optional header getter must not block authorized media itself.
 * It also must never fabricate an opaque-alpha proof or a byte denominator. */
function xDriveMediaHeader(response: Response, name: string): string | null {
  try {
    const value = response.headers.get(name)
    return typeof value === 'string' ? value : null
  } catch { return null }
}

/** Read a media response with an optional bounded byte observer.
 * When nobody observes it, preserve the existing native Response.blob() path.
 * Streamed responses keep fetch/AbortSignal ownership and never buffer a second
 * JavaScript array of every chunk. Content-Length is only the HTTP body length.
 */
export type XDriveMediaByteObserver = (
  loadedBytes: number, totalBytes?: number, alphaMask?: string | null,
) => void

export async function xDriveMediaResponseBlob(
  response: Response,
  signal?: AbortSignal,
  onProgress?: XDriveMediaByteObserver,
  requireAlphaProof = false,
): Promise<Blob> {
  xDriveAssertMediaReadActive(signal)
  if (!onProgress) {
    const blob = await response.blob()
    xDriveAssertMediaReadActive(signal)
    return blob
  }

  const encoding = xDriveMediaHeader(response, 'content-encoding')?.toLowerCase().trim()
  const declared = xDriveMediaHeader(response, 'content-length')
  const numericTotal = declared !== null && /^\d+$/.test(declared) ? Number(declared) : 0
  // Fetch may decode a Content-Encoding response while retaining the encoded
  // Content-Length header. Do not show a fabricated percentage in that case.
  const totalBytes = (!encoding || encoding === 'identity') &&
    Number.isSafeInteger(numericTotal) && numericTotal > 0 ? numericTotal : undefined
  // For thumbnails, old/untrusted servers must not let a rectangular pie
  // cover pixels that might be transparent. The server explicitly proves either
  // opaque pixels or supplies a bounded exact-alpha PNG before the binary body.
  const mime = xDriveMediaHeader(response, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const state = xDriveMediaHeader(response, 'x-xdrive-thumbnail-alpha-state')?.trim().toLowerCase()
  const mask = xDriveMediaHeader(response, 'x-xdrive-thumbnail-alpha-mask')?.trim()
  const alphaMask = !requireAlphaProof ? undefined
    : state === 'opaque' && mime === 'image/jpeg' ? ''
      : state === 'masked' && mime === 'image/png' && mask &&
          mask.length <= 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(mask)
        ? `data:image/png;base64,${mask}` : null
  const notify = (loadedBytes: number) => {
    try { onProgress(loadedBytes, totalBytes, alphaMask) } catch { /* UI observers never own I/O */ }
  }
  notify(0)
  if (!response.body) {
    const blob = await response.blob()
    xDriveAssertMediaReadActive(signal)
    notify(blob.size)
    return blob
  }

  let loadedBytes = 0
  let lastEmittedAt = 0
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      xDriveAssertMediaReadActive(signal)
      loadedBytes += chunk.byteLength
      const now = performance.now()
      if (now - lastEmittedAt >= 100) {
        lastEmittedAt = now
        notify(loadedBytes)
      }
      controller.enqueue(chunk)
    },
  })
  const measured = response.body.pipeThrough(meter, signal ? { signal } : undefined)
  const blob = await new Response(measured, {
    headers: { 'Content-Type': xDriveMediaHeader(response, 'Content-Type') || 'application/octet-stream' },
  }).blob()
  xDriveAssertMediaReadActive(signal)
  notify(loadedBytes)
  return blob
}
