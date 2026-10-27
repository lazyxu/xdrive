import type { XDriveByteProgressHandler } from './file-preview'
import type { XDriveFileExplorerItem } from './mui/FileExplorer'
import type {
  XDriveSynologyBackupLocalClient, XDriveSynologyOwnerMediaRange,
} from './synology-backup-adapter'
import { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES } from './synology-backup-adapter'

// Single-file, verified browser downloads only. Full arbitrary-size streaming
// requires a distinct durable save writer and rollback contract; do not
// construct an unbounded in-memory Blob or silently truncate large files.
export const XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES = 32 << 20

export function xDriveSynologySafeDownloadFilename(name: string): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 512) {
    throw new Error('Invalid Owner download filename')
  }
  // A displayed Owner name is not trusted as a local filesystem component.
  // Strip path separators, controls and Unicode bidi direction overrides,
  // which can otherwise disguise dangerous filename extensions.
  const safe = name.replace(/[\\/\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim().slice(0, 255).replace(/[. ]+$/g, '')
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Invalid Owner download filename')
  }
  // Windows reserves device basenames even when a suffix is present.
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safe)
    ? ('_' + safe).slice(0, 255).replace(/[. ]+$/g, '')
    : safe
}

export async function xDriveSynologyFetchVerifiedDownload(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerFileMediaRange'>,
  item: XDriveFileExplorerItem,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
): Promise<{ filename: string; blob: Blob }> {
  const filename = xDriveSynologySafeDownloadFilename(item.name)
  const size = item.size
  if (item.kind !== 'file' ||
    typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1 ||
    typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1 ||
    typeof size !== 'number' || !Number.isSafeInteger(size) ||
    size < 1 || size > XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES) {
    throw new Error('Only single verified Owner files up to 32 MiB can be downloaded')
  }
  if (signal?.aborted) throw new Error('Owner download cancelled')
  if (!globalThis.crypto?.subtle) throw new Error('Secure Owner download hash verification unavailable')

  const parts: BlobPart[] = []
  let loaded = 0
  let sha256 = ''
  onProgress?.(0, size, null)
  while (loaded < size) {
    if (signal?.aborted) throw new Error('Owner download cancelled')
    const requested = Math.min(XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES, size - loaded)
    const range: XDriveSynologyOwnerMediaRange = await client.ownerFileMediaRange(
      item.id, item.revision, loaded, requested, signal)
    if (signal?.aborted) throw new Error('Owner download cancelled')
    if (range.offset !== loaded || range.total !== size ||
      range.revision !== item.revision || range.data.length !== requested ||
      !/^[0-9a-f]{64}$/.test(range.sha256) ||
      (sha256 !== '' && sha256 !== range.sha256)) {
      throw new Error('Owner download content changed or range was truncated')
    }
    sha256 = range.sha256
    // Copy immutable bytes into our own ArrayBuffer. No caller can mutate a
    // previously accepted range while later Agent reads are in progress.
    const owned = new Uint8Array(range.data.length)
    owned.set(range.data)
    parts.push(owned)
    loaded += owned.length
    onProgress?.(loaded, size, null)
  }
  if (signal?.aborted) throw new Error('Owner download cancelled')
  const blob = new Blob(parts, { type: 'application/octet-stream' })
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256', await blob.arrayBuffer()))
  const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
  if (signal?.aborted || actual !== sha256) {
    throw new Error('Owner download SHA-256 integrity check failed')
  }
  // No browser URL is produced for failed, aborted, stale or altered files.
  return { filename, blob }
}
