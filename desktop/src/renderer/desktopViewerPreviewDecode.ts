import { xDriveRegisterViewerImageSource } from '@xdrive/shared'

/**
 * Both Desktop Gallery and Files Quick Look use one decode-gated 4K image
 * admission contract. The Agent's MIME/byte validation cannot establish that
 * the current Electron Chromium can decode a WebP or JPEG response.
 *
 * Rejecting a source here lets the calling WebP -> JPEG -> legacy loop retry
 * without ever presenting corrupt bytes as a successful "original" frame.
 */
export async function xDriveDesktopDecodeViewerPreviewURL(
  blob: Blob,
  format: 'webp' | 'jpeg',
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (blob.size <= 0) throw new Error('Empty Desktop Viewer preview')
  const url = URL.createObjectURL(blob)
  const probe = new Image()
  let onAbort: (() => void) | null = null
  try {
    const aborted = signal ? new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException('Viewer preview aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
    }) : null
    signal?.throwIfAborted()

    let decoded: Promise<void>
    if (typeof probe.decode === 'function') {
      probe.src = url
      decoded = probe.decode()
    } else {
      decoded = new Promise<void>((resolve, reject) => {
        probe.onload = () => resolve()
        probe.onerror = () => reject(new Error('Desktop Viewer image decode failed'))
        probe.src = url
        if (probe.complete) {
          if (probe.naturalWidth > 0 && probe.naturalHeight > 0) resolve()
          else reject(new Error('Desktop Viewer image has no decoded pixels'))
        }
      })
    }
    await (aborted ? Promise.race([decoded, aborted]) : decoded)
    signal?.throwIfAborted()
    if (probe.naturalWidth < 1 || probe.naturalHeight < 1 ||
        Math.max(probe.naturalWidth, probe.naturalHeight) > 4096) {
      throw new Error('Invalid Desktop Viewer preview dimensions')
    }
    xDriveRegisterViewerImageSource(url, {
      format: format === 'webp' ? 'WebP' : 'JPEG',
      quality: format === 'webp' ? 90 : 93,
      byteSize: blob.size,
    })
    return url
  } catch (error) {
    // The URL is owned by this attempt until decoding succeeds. In particular,
    // an abort during decode may not leave a later invisible Blob lease alive.
    probe.src = ''
    URL.revokeObjectURL(url)
    throw error
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    probe.onload = null
    probe.onerror = null
  }
}
