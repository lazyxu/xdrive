import type { XDriveFileExplorerItem } from './mui/FileExplorer'
import type { XDriveByteProgressHandler } from './file-preview'
import type { XDriveSynologyBackupLocalClient } from './synology-backup-adapter'
import {
  XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES,
  XDRIVE_SYNOLOGY_VIEWER_PREVIEW_MAX_BYTES,
} from './synology-backup-adapter'
import { xDriveFileNeedsBrowserCompatibleImagePreview } from './file-preview'
import { xDriveRegisterViewerImageSource } from './mui/ViewerImageSourceInfo'

/** The native iOS viewer keeps HEIC; browser-only DSM needs a compatible still. */
export function xDriveSynologyViewerNeedsDerived(name: string) {
  return /\.livp$/i.test(name) || xDriveFileNeedsBrowserCompatibleImagePreview(name)
}

function compatibleImageHeader(first: Uint8Array, last: Uint8Array,
  total: number, format: 'webp' | 'jpeg'): boolean {
  if (format === 'jpeg') return first.length >= 3 && last.length >= 2 &&
    first[0] === 0xff && first[1] === 0xd8 && first[2] === 0xff &&
    last[last.length - 2] === 0xff && last[last.length - 1] === 0xd9
  if (first.length < 16) return false
  const ascii = (at: number, word: string) =>
    [...word].every((letter, i) => first[at + i] === letter.charCodeAt(0))
  const riffLength = new DataView(first.buffer, first.byteOffset, first.byteLength).getUint32(4, true)
  return ascii(0, 'RIFF') && ascii(8, 'WEBP') &&
    (ascii(12, 'VP8 ') || ascii(12, 'VP8L') || ascii(12, 'VP8X')) &&
    riffLength + 8 === total
}

/** Read one exact Owner + revision + format. Every 256KiB request travels
 * through the same-user Agent and DSM CGI, with the original Server Owner
 * and revision reverified on every slice. No token or signed URL is exposed. */
export async function xDriveSynologyLoadViewerPreview(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerFileViewerPreviewRange'>,
  file: Pick<XDriveFileExplorerItem, 'id' | 'kind' | 'name' | 'revision'>,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
): Promise<string> {
  if (file.kind !== 'file' || typeof file.id !== 'number' ||
    !Number.isSafeInteger(file.id) || file.id < 1 ||
    typeof file.revision !== 'number' ||
    !Number.isSafeInteger(file.revision) || file.revision < 1) {
    throw new Error('Invalid Owner Viewer image source')
  }
  let previous: unknown
  for (const format of ['webp', 'jpeg'] as const) {
    signal?.throwIfAborted()
    try {
      let offset = 0
      let total = 0
      let etag = ''
      const parts: BlobPart[] = []
      let first = new Uint8Array(0)
      let last = new Uint8Array(0)
      onProgress?.(0)
      do {
        signal?.throwIfAborted()
        const length = Math.min(XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES,
          total ? total - offset : XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES)
        const part = await client.ownerFileViewerPreviewRange(
          file.id, file.revision, format, offset, length, signal)
        if (part.nodeID !== file.id || part.revision !== file.revision ||
          part.format !== format || part.offset !== offset ||
          part.total < 1 || part.total > XDRIVE_SYNOLOGY_VIEWER_PREVIEW_MAX_BYTES ||
          part.data.length < 1 || part.data.length > length) {
          throw new Error('Owner Viewer preview chunk identity changed')
        }
        if (!offset) {
          total = part.total
          etag = part.etag
          first = part.data.slice(0, 16)
        } else if (part.total !== total || part.etag !== etag) {
          throw new Error('Owner Viewer preview ETag changed during transfer')
        }
        const copy = new Uint8Array(part.data.length)
        copy.set(part.data)
        parts.push(copy)
        last = copy.slice(Math.max(0, copy.length - 12))
        offset += copy.length
        if (offset > total) throw new Error('Oversized Owner Viewer preview')
        onProgress?.(offset, total)
      } while (offset < total)
      const mime = format === 'webp' ? 'image/webp' : 'image/jpeg'
      if (!compatibleImageHeader(first, last, total, format)) {
        throw new Error('Corrupt Owner Viewer preview image envelope')
      }
      const blob = new Blob(parts, { type: mime })
      if (!blob.size || blob.size !== total) throw new Error('Incomplete Owner Viewer image')
      const url = URL.createObjectURL(blob)
      try {
        // A correct WebP envelope may still fail to decode in this browser.
        // Fail over to JPEG while retaining the current tiny thumbnail.
        const image = new Image()
        image.src = url
        if (typeof image.decode === 'function') {
          await image.decode()
        } else {
          await new Promise<void>((resolve, reject) => {
            if (image.complete) {
              image.naturalWidth ? resolve() : reject(new Error('preview decode failed'))
              return
            }
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('preview decode failed'))
          })
        }
        signal?.throwIfAborted()
        if (image.naturalWidth < 1 || image.naturalHeight < 1 ||
          Math.max(image.naturalWidth, image.naturalHeight) > 4096) {
          throw new Error('Invalid Viewer derivative image dimensions')
        }
        xDriveRegisterViewerImageSource(url, {
          format: format === 'webp' ? 'WebP' : 'JPEG',
          quality: format === 'webp' ? 90 : 93, byteSize: total,
        })
        return url
      } catch (error) {
        URL.revokeObjectURL(url)
        throw error
      }
    } catch (error) {
      signal?.throwIfAborted()
      previous = error
    }
  }
  throw previous instanceof Error ? previous : new Error('Viewer image derivative unavailable')
}
