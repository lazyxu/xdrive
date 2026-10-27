import type { XDriveFileExplorerItem } from './mui/FileExplorer'
import type {
  XDriveSynologyBackupLocalClient,
  XDriveSynologyOwnerStreamMIME,
} from './synology-backup-adapter'
import { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES } from './synology-backup-adapter'

// Only browser-playable media formats with an auditable fixed MIME allowlist.
// The existing shared Viewer still owns controls, seek/buffer state and cleanup.
export function xDriveSynologyPlaybackMIME(name: string): XDriveSynologyOwnerStreamMIME | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'mp4':
    case 'm4v': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'mp3': return 'audio/mpeg'
    case 'm4a': return 'audio/mp4'
    case 'ogg': return 'audio/ogg'
    case 'wav': return 'audio/wav'
    case 'flac': return 'audio/flac'
    default: return null
  }
}

export function xDriveSynologyPlaybackMagic(data: Uint8Array, mime: XDriveSynologyOwnerStreamMIME): boolean {
  const starts = (prefix: string) => [...prefix].every((c, i) =>
    i < data.length && data[i] === c.charCodeAt(0))
  switch (mime) {
    case 'video/mp4':
    case 'audio/mp4': return data.length >= 8 &&
      [...'ftyp'].every((c, i) => data[4 + i] === c.charCodeAt(0))
    case 'video/webm': return data.length >= 4 &&
      data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
    case 'audio/mpeg': return starts('ID3') ||
      (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
    case 'audio/ogg': return starts('OggS')
    case 'audio/wav': return data.length >= 12 && starts('RIFF') &&
      [...'WAVE'].every((c, i) => data[8 + i] === c.charCodeAt(0))
    case 'audio/flac': return starts('fLaC')
  }
}

// The browser performs one small Owner-authenticated content proof. The
// subsequent video/audio element fetches data natively via the exact DSM CGI
// Range URL; it does not download the entire file into JavaScript memory.
// No misleading whole-file byte progress is emitted: native buffering time is
// provided by the existing shared Viewer.
export async function xDriveSynologyLoadNativeMediaStream(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerFileMediaRange' | 'ownerFileMediaStreamURL'>,
  item: XDriveFileExplorerItem,
  signal?: AbortSignal,
): Promise<string> {
  const mime = item.kind === 'file' ? xDriveSynologyPlaybackMIME(item.name) : null
  if (!mime ||
    typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 1 ||
    typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1 ||
    typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1) {
    throw new Error('Only Owner-authenticated playable media files can use DSM Range streaming')
  }
  if (signal?.aborted) throw new Error('Owner stream load cancelled')
  const length = Math.min(XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES, item.size)
  const first = await client.ownerFileMediaRange(item.id, item.revision, 0, length, signal)
  if (signal?.aborted) throw new Error('Owner stream load cancelled')
  if (first.offset !== 0 || first.revision !== item.revision ||
    first.total !== item.size || first.data.length !== length ||
    !/^[0-9a-f]{64}$/.test(first.sha256) ||
    !xDriveSynologyPlaybackMagic(first.data, mime)) {
    throw new Error('Server Owner media content or revision is not trusted')
  }
  // This is a scoped local route, NOT an authorization ticket. A copied URL
  // without the same logged-in DSM principal and owning Agent fails closed.
  return client.ownerFileMediaStreamURL(item.id, item.revision, item.size, first.sha256, mime)
}
