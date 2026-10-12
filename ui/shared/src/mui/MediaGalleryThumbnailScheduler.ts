import type { XDriveByteProgressHandler } from '../file-preview'

export const XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6
export const XDRIVE_MEDIA_THUMBNAIL_CACHE_SIZE = 512

export type XDriveMediaThumbnailPriority = 0 | 1 | 2

export type XDriveMediaThumbnailSourceLoader = (
  nodeID: number,
  signal?: AbortSignal,
  revision?: number,
  onProgress?: XDriveByteProgressHandler,
  bypassHTTPCache?: boolean,
) => Promise<string | null>

type ThumbnailProgressSubscriber = {
  notify: XDriveByteProgressHandler
  remove: () => void
}

type ThumbnailTask = {
  nodeID: number
  revision: number
  key: string
  priority: XDriveMediaThumbnailPriority
  sequence: number
  promise: Promise<string | null>
  resolve: (value: string | null) => void
  reject: (error: unknown) => void
  cancelled: boolean
  /** True only during an explicit visible repair of a decoder-proven bad URL. */
  bypassHTTPCache: boolean
  controller: AbortController
  progressListeners: Set<ThumbnailProgressSubscriber>
}

function revokeThumbnailURL(url: string) {
  if (url.startsWith('blob:') && typeof URL !== 'undefined') {
    URL.revokeObjectURL(url)
  }
}

export class XDriveMediaThumbnailScheduler {
  private readonly loader: XDriveMediaThumbnailSourceLoader
  private readonly concurrency: number
  private readonly maxCacheEntries: number
  private readonly revokeURL: (url: string) => void
  private active = 0
  private sequence = 0
  private disposed = false
  private pumpScheduled = false
  private readonly queue: ThumbnailTask[] = []
  private readonly queued = new Map<string, ThumbnailTask>()
  private readonly inFlight = new Map<string, ThumbnailTask>()
  private readonly cache = new Map<string, string>()
  // Bounded to the existing thumbnail LRU capacity. The first genuine DOM
  // decode error permits ONE future uncached attempt; another decode error
  // for that same Node:revision exhausts it. Never launch work in onError.
  private readonly decodeRecovery = new Map<string, 'pending' | 'attempted' | 'exhausted'>()

  private rememberDecodeRecovery(key: string, state: 'pending' | 'attempted' | 'exhausted') {
    this.decodeRecovery.delete(key)
    this.decodeRecovery.set(key, state)
    while (this.decodeRecovery.size > this.maxCacheEntries) {
      const oldest = this.decodeRecovery.keys().next().value
      if (typeof oldest !== 'string') break
      this.decodeRecovery.delete(oldest)
    }
  }

  constructor(
    loader: XDriveMediaThumbnailSourceLoader,
    {
      concurrency = XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY,
      maxCacheEntries = XDRIVE_MEDIA_THUMBNAIL_CACHE_SIZE,
      revokeURL = revokeThumbnailURL,
    }: {
      concurrency?: number
      maxCacheEntries?: number
      revokeURL?: (url: string) => void
    } = {},
  ) {
    this.loader = loader
    this.concurrency = Math.max(1, Math.trunc(concurrency) || 1)
    this.maxCacheEntries = Math.max(1, Math.trunc(maxCacheEntries) || 1)
    this.revokeURL = revokeURL
  }

  load = (
    nodeID: number,
    priority: XDriveMediaThumbnailPriority = 1,
    revision = 0,
    onProgress?: XDriveByteProgressHandler,
    consumerSignal?: AbortSignal,
  ): Promise<string | null> => {
    if (this.disposed || consumerSignal?.aborted || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      return Promise.resolve(null)
    }
    const currentRevision = Number.isSafeInteger(revision) && revision > 0 ? revision : 0
    const key = `${nodeID}:${currentRevision}`
    // A real browser decode failure after the one uncached retry is terminal
    // for this mounted Gallery session. Changing revision gets a new identity.
    if (this.decodeRecovery.get(key) === 'exhausted') return Promise.resolve(null)

    // A new source revision supersedes only the old requests for this Node,
    // not independent requests for other Nodes or the durable media indexer.
    // Keep the existing 512-entry LRU: old decoded Blob URLs can remain
    // temporarily cached rather than being revoked behind a mounted image.
    if (currentRevision > 0) {
      for (const task of [...this.queue]) {
        if (task.nodeID === nodeID && task.revision < currentRevision) this.cancelTask(task)
      }
      for (const task of [...this.inFlight.values()]) {
        if (task.nodeID === nodeID && task.revision < currentRevision) this.cancelTask(task)
      }
      this.compactQueue()
    }

    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve(cached)
    }

    const active = this.inFlight.get(key)
    if (active) {
      this.trackProgress(active, onProgress, consumerSignal)
      return active.promise
    }

    const queued = this.queued.get(key)
    if (queued) {
      this.trackProgress(queued, onProgress, consumerSignal)
      if (priority < queued.priority) {
        queued.priority = priority
        this.sortQueue()
      }
      return queued.promise
    }

    let resolve!: (value: string | null) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string | null>((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    })
    const task: ThumbnailTask = {
      nodeID,
      revision: currentRevision,
      key,
      priority,
      sequence: this.sequence++,
      promise,
      resolve,
      reject,
      cancelled: false,
      bypassHTTPCache: false,
      controller: new AbortController(),
      progressListeners: new Set(),
    }
    this.trackProgress(task, onProgress, consumerSignal)
    this.queued.set(key, task)
    this.queue.push(task)
    this.sortQueue()
    this.schedulePump()
    return promise
  }

  // Browser image decoding happens after a successful network/Blob response.
  // A failed decoded URL must not poison this node+revision's LRU on a later
  // viewport remount. Match the exact returned URL: an old onError callback
  // must never evict a newer replacement for the same logical asset.
  invalidateDecodedURL = (nodeID: number, revision: number, failedURL: string): boolean => {
    if (this.disposed || !Number.isSafeInteger(nodeID) || nodeID <= 0 || !failedURL) {
      return false
    }
    const currentRevision = Number.isSafeInteger(revision) && revision > 0 ? revision : 0
    const key = `${nodeID}:${currentRevision}`
    if (this.cache.get(key) !== failedURL) return false
    this.cache.delete(key)
    this.revokeURL(failedURL)
    const state = this.decodeRecovery.get(key)
    if (state === 'attempted') {
      // The fresh bytes also failed in the actual browser image decoder.
      // No third GET for this Node/revision from further virtual remounts.
      this.rememberDecodeRecovery(key, 'exhausted')
    } else if (!state) {
      this.rememberDecodeRecovery(key, 'pending')
    }
    return true
  }

  setRetention(nodeIDs: Iterable<number>) {
    const retained = new Set(nodeIDs)
    for (const task of [...this.queue]) {
      if (!retained.has(task.nodeID)) this.cancelTask(task)
    }
    for (const task of [...this.inFlight.values()]) {
      if (!retained.has(task.nodeID)) this.cancelTask(task)
    }
    this.compactQueue()
    this.schedulePump()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const task of [...this.queue]) this.cancelTask(task)
    for (const task of [...this.inFlight.values()]) this.cancelTask(task)
    this.queue.length = 0
    this.queued.clear()
    this.inFlight.clear()
    for (const url of this.cache.values()) this.revokeURL(url)
    this.cache.clear()
    this.decodeRecovery.clear()
  }

  private trackProgress(
    task: ThumbnailTask,
    callback?: XDriveByteProgressHandler,
    consumerSignal?: AbortSignal,
  ) {
    if (!callback || consumerSignal?.aborted) return
    const subscription: ThumbnailProgressSubscriber = {
      notify: callback,
      remove: () => undefined,
    }
    const remove = () => {
      task.progressListeners.delete(subscription)
      consumerSignal?.removeEventListener('abort', remove)
    }
    subscription.remove = remove
    task.progressListeners.add(subscription)
    consumerSignal?.addEventListener('abort', remove, { once: true })
  }

  private clearProgress(task: ThumbnailTask) {
    for (const subscription of [...task.progressListeners]) subscription.remove()
  }

  private cancelTask(task: ThumbnailTask) {
    if (task.cancelled) return
    task.cancelled = true
    if (task.bypassHTTPCache && this.decodeRecovery.get(task.key) === 'attempted') {
      // The viewport abandoned the uncached request before it completed.
      // Give its next genuinely visible mount the same single opportunity.
      this.rememberDecodeRecovery(task.key, 'pending')
    }
    this.clearProgress(task)
    task.controller.abort()
    if (this.queued.get(task.key) === task) this.queued.delete(task.key)
    if (this.inFlight.get(task.key) === task) this.inFlight.delete(task.key)
    task.resolve(null)
  }

  private sortQueue() {
    this.queue.sort((left, right) => (
      left.priority - right.priority ||
      left.sequence - right.sequence
    ))
  }

  private compactQueue() {
    let write = 0
    for (let read = 0; read < this.queue.length; read += 1) {
      const task = this.queue[read]
      if (task.cancelled) continue
      this.queue[write++] = task
    }
    this.queue.length = write
  }

  private schedulePump() {
    if (this.disposed || this.pumpScheduled) return
    this.pumpScheduled = true
    queueMicrotask(() => {
      this.pumpScheduled = false
      this.pump()
    })
  }

  private pump() {
    if (this.disposed) return
    this.compactQueue()
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!
      this.queued.delete(task.key)
      if (task.cancelled) continue
      this.active += 1
      this.inFlight.set(task.key, task)
      task.bypassHTTPCache = this.decodeRecovery.get(task.key) === 'pending'
      if (task.bypassHTTPCache) this.rememberDecodeRecovery(task.key, 'attempted')
      // Prefetch-only work with no UI subscriber uses the native Blob fast path;
      // subscribers arriving mid-request still get its final image, but do not
      // retroactively turn a no-observer HTTP response into a counted stream.
      const notify = task.progressListeners.size > 0
        ? (loadedBytes: number, totalBytes?: number, alphaMask?: string | null) => {
            if (task.cancelled || this.disposed) return
            for (const entry of [...task.progressListeners]) {
              try { entry.notify(loadedBytes, totalBytes, alphaMask) } catch { /* UI does not own I/O */ }
            }
          }
        : undefined
      void this.loader(
        task.nodeID, task.controller.signal, task.revision || undefined,
        notify, task.bypassHTTPCache || undefined,
      )
        .then((url) => {
          if (task.cancelled || this.disposed) {
            if (url) this.revokeURL(url)
            return
          }
          // The bytes were delivered; a later actual image onError decides
          // whether the already-attempted recovery has exhausted its chance.
          task.bypassHTTPCache = false
          if (url) this.cacheURL(task.key, url)
          task.resolve(url)
        })
        .catch((error) => {
          task.bypassHTTPCache = false
          if (!task.cancelled && !this.disposed) task.reject(error)
        })
        .finally(() => {
          this.clearProgress(task)
          if (this.inFlight.get(task.key) === task) {
            this.inFlight.delete(task.key)
          }
          this.active = Math.max(0, this.active - 1)
          this.schedulePump()
        })
    }
  }

  private cacheURL(key: string, url: string) {
    const previous = this.cache.get(key)
    if (previous && previous !== url) this.revokeURL(previous)
    this.cache.delete(key)
    this.cache.set(key, url)
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.entries().next().value as [string, string] | undefined
      if (!oldest) break
      this.cache.delete(oldest[0])
      this.revokeURL(oldest[1])
    }
  }
}
