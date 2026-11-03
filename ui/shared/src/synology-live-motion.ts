import type { XDriveByteProgressHandler } from './file-preview'
import type { XDriveSynologyBackupLocalClient } from './synology-backup-adapter'
import { XDRIVE_SYNOLOGY_OWNER_LIVE_MOTION_MAX_BYTES } from './synology-backup-adapter'

/**
 * One shared, bounded and digest-verified DSM Owner Live Photo motion reader.
 * Gallery and Files pass their own current selection/Owner fence. A Live hold
 * is the only caller that starts the read; this creates no second player,
 * signed URL, persisted cache, or independent DSM media service.
 */
export async function xDriveSynologyLoadOwnerLiveMotion(
  client: Pick<XDriveSynologyBackupLocalClient, 'ownerLivePhotoMotion'>,
  nodeID: number,
  revision: number,
  isCurrent: () => boolean,
  signal?: AbortSignal,
  onProgress?: XDriveByteProgressHandler,
): Promise<string | null> {
  if (!Number.isSafeInteger(nodeID) || nodeID < 1 ||
      !Number.isSafeInteger(revision) || revision < 1 ||
      signal?.aborted || !isCurrent()) return null

  const motion = await client.ownerLivePhotoMotion(nodeID, revision, signal)
  if (signal?.aborted || !isCurrent() ||
      !motion || motion.nodeID !== nodeID || motion.revision !== revision ||
      !Number.isSafeInteger(motion.size) || motion.size < 1 ||
      motion.size > XDRIVE_SYNOLOGY_OWNER_LIVE_MOTION_MAX_BYTES ||
      !(motion.data instanceof Uint8Array) || motion.size !== motion.data.length ||
      (motion.mimeType !== 'video/mp4' && motion.mimeType !== 'video/quicktime') ||
      !/^[0-9a-f]{64}$/.test(motion.sha256) || !globalThis.crypto?.subtle) return null

  // Copy exact authenticated bytes before digest and Blob publication.
  const ownedBuffer = new ArrayBuffer(motion.size)
  const owned = new Uint8Array(ownedBuffer)
  owned.set(motion.data)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', owned))
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  if (signal?.aborted || !isCurrent() || actual !== motion.sha256) return null

  const url = URL.createObjectURL(new Blob([ownedBuffer], { type: motion.mimeType }))
  if (signal?.aborted || !isCurrent()) {
    URL.revokeObjectURL(url)
    return null
  }
  // The shared LivePhotoSurface owns abort, retry, playback and URL disposal.
  onProgress?.(motion.size, motion.size, null)
  return url
}
