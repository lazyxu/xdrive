import type { XDriveFileExplorerItem } from './mui/FileExplorer'
import type { XDriveByteProgressHandler } from './file-preview'
import type {
  XDriveSynologyBackupLocalClient,
  XDriveSynologyOwnerMediaRange,
} from './synology-backup-adapter'
import { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES } from './synology-backup-adapter'

// An intentionally narrow first media slice; video/audio/Live need a true
// browser Range stream and must not be synthesized as a giant Blob.
export const XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES = 32 << 20

export function xDriveSynologyPreviewMIME(name: string): string | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'pdf': return 'application/pdf'
    default: return null
  }
}

function matchesSignature(first: Uint8Array, mime: string): boolean {
  const ascii = (begin: number, value: string) =>
    first.length >= begin + value.length &&
    [...value].every((character, index) => first[begin + index] === character.charCodeAt(0))
  if (mime === 'image/jpeg') return first.length >= 3 &&
    first[0] === 0xff && first[1] === 0xd8 && first[2] === 0xff
  if (mime === 'image/png') return first.length >= 8 &&
    [0x89, 80, 78, 71, 13, 10, 26, 10].every((value, index) => first[index] === value)
  if (mime === 'image/webp') return ascii(0, 'RIFF') && ascii(8, 'WEBP')
  if (mime === 'image/gif') return ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
  if (mime === 'application/pdf') return ascii(0, '%PDF-')
  return false
}

export async function xDriveSynologyLoadBoundedMediaPreview(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerFileMediaRange'>,
  file: XDriveFileExplorerItem,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
): Promise<string> {
  const mime = file.kind === 'file' ? xDriveSynologyPreviewMIME(file.name) : null
  const size = file.size
  if (!mime || typeof file.id !== 'number' || !Number.isSafeInteger(file.id) || file.id < 1 ||
    typeof file.revision !== 'number' || !Number.isSafeInteger(file.revision) || file.revision < 1 ||
    typeof size !== 'number' || !Number.isSafeInteger(size) ||
    size < 1 || size > XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES) {
    throw new Error('仅支持最多 32 MiB 的 JPEG、PNG、WebP、GIF 或 PDF Owner 预览')
  }
  const parts: BlobPart[] = []
  let loaded = 0
  let contentHash = ''
  onProgress?.(0, size, null)
  while (loaded < size) {
    if (signal?.aborted) throw new Error('Owner media preview cancelled')
    const requested = Math.min(XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES, size - loaded)
    const range: XDriveSynologyOwnerMediaRange = await client.ownerFileMediaRange(
      file.id, file.revision, loaded, requested, signal)
    if (signal?.aborted) throw new Error('Owner media preview cancelled')
    if (range.offset !== loaded || range.total !== size ||
      range.revision !== file.revision ||
      !/^[0-9a-f]{64}$/.test(range.sha256) ||
      (contentHash && contentHash !== range.sha256) ||
      range.data.length !== requested) {
      throw new Error('Owner media revision, SHA-256 or byte range changed during preview')
    }
    if (loaded === 0 && !matchesSignature(range.data, mime)) {
      throw new Error('Owner media content does not match its safe preview type')
    }
    contentHash = range.sha256
    // BlobPart must own an ArrayBuffer rather than a possibly shared/resizable view.
    // This also prevents a caller from mutating already accepted range bytes.
    const owned = new Uint8Array(range.data.length)
    owned.set(range.data)
    parts.push(owned)
    loaded += range.data.length
    onProgress?.(loaded, size, null)
  }
  if (signal?.aborted) throw new Error('Owner media preview cancelled')
  // Digest-check the COMPLETE content, not merely the consistency of digest
  // headers across fragments. A corrupted CAS/Range response cannot render.
  const blob = new Blob(parts, { type: mime })
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure Owner media verification unavailable')
  }
  const bytes = await blob.arrayBuffer()
  if (signal?.aborted) throw new Error('Owner media preview cancelled')
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  const verified = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  if (signal?.aborted || verified !== contentHash) {
    throw new Error('Owner media content SHA-256 verification failed')
  }
  // Only a fully verified, bounded Blob is passed into the shared Viewer.
  // The shared preview lifecycle owns revoking its object URL on close/switch.
  return URL.createObjectURL(blob)
}
