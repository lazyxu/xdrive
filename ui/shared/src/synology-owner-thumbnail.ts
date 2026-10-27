import type { XDriveByteProgressHandler } from './file-preview'
import type { XDriveFileExplorerItem } from './mui/FileExplorer'
import type { XDriveSynologyBackupLocalClient } from './synology-backup-adapter'

// The canonical FileExplorerThumbnail owns visibility admission, bounded
// concurrency, request cancellation, LRU cache and Blob URL reclamation.
// This adapter only translates a verified Server Owner derivative to that port.
export async function xDriveSynologyLoadOwnerThumbnail(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerFileThumbnail'>,
  item: XDriveFileExplorerItem,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
): Promise<string> {
  if (item.kind !== 'file' || typeof item.id !== 'number' ||
    !Number.isSafeInteger(item.id) || item.id < 1 ||
    typeof item.revision !== 'number' ||
    !Number.isSafeInteger(item.revision) || item.revision < 1) {
    throw new Error('Invalid Owner thumbnail item')
  }
  if (signal?.aborted) throw new Error('Owner thumbnail cancelled')
  // No invented progress: the JSON derivative exposes no streaming byte
  // count; the shared progress component remains indeterminate until ready.
  onProgress?.(0, undefined, null)
  const thumb = await client.ownerFileThumbnail(item.id, item.revision, signal)
  if (signal?.aborted) throw new Error('Owner thumbnail cancelled')
  if (!thumb.data.length || thumb.data.length > 2 << 20 ||
    (thumb.contentType !== 'image/jpeg' && thumb.contentType !== 'image/png')) {
    throw new Error('Invalid Owner thumbnail bytes')
  }
  const owned = new Uint8Array(thumb.data.length)
  owned.set(thumb.data)
  const alphaMask = thumb.alphaState === 'masked'
    ? 'data:image/png;base64,' + thumb.alphaMask
    : thumb.alphaState === 'opaque' ? '' : null
  // The common thumbnail component must keep progress outside transparent
  // pixels. When exact alpha is unavailable, it hides the pie.
  onProgress?.(owned.length, owned.length, alphaMask)
  if (signal?.aborted) throw new Error('Owner thumbnail cancelled')
  const url = URL.createObjectURL(new Blob([owned], { type: thumb.contentType }))
  if (signal?.aborted) {
    URL.revokeObjectURL(url)
    throw new Error('Owner thumbnail cancelled')
  }
  return url
}
