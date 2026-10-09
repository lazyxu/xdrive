/** Read a media response with an optional bounded byte observer.
 * When nobody observes it, preserve the existing native Response.blob() path.
 * Streamed responses keep fetch/AbortSignal ownership and never buffer a second
 * JavaScript array of every chunk. Content-Length is only the HTTP body length.
 */
export type XDriveMediaByteObserver = (loadedBytes: number, totalBytes?: number) => void

export async function xDriveMediaResponseBlob(
  response: Response,
  signal?: AbortSignal,
  onProgress?: XDriveMediaByteObserver,
): Promise<Blob> {
  signal?.throwIfAborted()
  if (!onProgress) {
    const blob = await response.blob()
    signal?.throwIfAborted()
    return blob
  }

  const encoding = response.headers.get('content-encoding')?.toLowerCase().trim()
  const declared = response.headers.get('content-length')
  const numericTotal = declared !== null && /^\d+$/.test(declared) ? Number(declared) : 0
  // Fetch may decode a Content-Encoding response while retaining the encoded
  // Content-Length header. Do not show a fabricated percentage in that case.
  const totalBytes = (!encoding || encoding === 'identity') &&
    Number.isSafeInteger(numericTotal) && numericTotal > 0 ? numericTotal : undefined
  const notify = (loadedBytes: number) => {
    try { onProgress(loadedBytes, totalBytes) } catch { /* UI observers never own I/O */ }
  }
  if (!response.body) {
    const blob = await response.blob()
    signal?.throwIfAborted()
    notify(blob.size)
    return blob
  }

  let loadedBytes = 0
  let lastEmittedAt = 0
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      signal?.throwIfAborted()
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
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' },
  }).blob()
  signal?.throwIfAborted()
  notify(loadedBytes)
  return blob
}
