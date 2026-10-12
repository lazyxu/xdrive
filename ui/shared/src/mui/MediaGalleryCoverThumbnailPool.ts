import type { XDriveByteProgressHandler } from '../file-preview'
import { XDriveMediaThumbnailScheduler } from './MediaGalleryThumbnailScheduler'
import type { XDriveMediaThumbnailSourceLoader } from './MediaGalleryThumbnailScheduler'

// Cover DTOs expose a node ID, not a verified source revision. Keep revision
// unknown (0) instead of inventing metadata or guessing Live Photo pairs.
export const XDRIVE_GALLERY_COVER_CONCURRENCY = 3
export const XDRIVE_GALLERY_COVER_CACHE_SIZE = 128

export class XDriveMediaGalleryCoverThumbnailPool {
  private readonly scheduler: XDriveMediaThumbnailScheduler
  private readonly retained = new Map<number, number>()
  private scheduled = false
  private disposed = false

  constructor(loader: XDriveMediaThumbnailSourceLoader, revokeURL?: (url: string) => void) {
    this.scheduler = new XDriveMediaThumbnailScheduler(loader, {
      concurrency: XDRIVE_GALLERY_COVER_CONCURRENCY,
      maxCacheEntries: XDRIVE_GALLERY_COVER_CACHE_SIZE,
      ...(revokeURL ? { revokeURL } : {}),
    })
  }

  // Same cover Node can be mounted by pinned albums and Collections.
  // One consumer's exit must not abort another consumer's request.
  retain(nodeID: number): () => void {
    if (this.disposed || !Number.isSafeInteger(nodeID) || nodeID <= 0) return () => undefined
    this.retained.set(nodeID, (this.retained.get(nodeID) ?? 0) + 1)
    this.scheduleRetention()
    let released = false
    return () => {
      if (released || this.disposed) return
      released = true
      const count = this.retained.get(nodeID) ?? 0
      if (count <= 1) this.retained.delete(nodeID)
      else this.retained.set(nodeID, count - 1)
      this.scheduleRetention()
    }
  }

  private scheduleRetention() {
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    // Coalesce React sibling effects before canceling non-retained requests.
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.disposed) this.scheduler.setRetention(this.retained.keys())
    })
  }

  load = (
    nodeID: number,
    signal?: AbortSignal,
    revision?: number,
    onProgress?: XDriveByteProgressHandler,
  ): Promise<string | null> => this.disposed
    ? Promise.resolve(null)
    : this.scheduler.load(nodeID, 1, revision, onProgress, signal)

  invalidateDecodedURL = (nodeID: number, revision: number | undefined, url: string) =>
    !this.disposed && this.scheduler.invalidateDecodedURL(nodeID, revision ?? 0, url)

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.retained.clear()
    this.scheduler.dispose()
  }
}
