export const XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6
export const XDRIVE_MEDIA_THUMBNAIL_CACHE_SIZE = 512

export type XDriveMediaThumbnailPriority = 0 | 1 | 2

export type XDriveMediaThumbnailSourceLoader = (
  nodeID: number,
  signal?: AbortSignal,
  revision?: number,
) => Promise<string | null>

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
  controller: AbortController
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
  ): Promise<string | null> => {
    if (this.disposed || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      return Promise.resolve(null)
    }
    const currentRevision = Number.isSafeInteger(revision) && revision > 0 ? revision : 0
    const key = `${nodeID}:${currentRevision}`

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
    if (active) return active.promise

    const queued = this.queued.get(key)
    if (queued) {
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
      controller: new AbortController(),
    }
    this.queued.set(key, task)
    this.queue.push(task)
    this.sortQueue()
    this.schedulePump()
    return promise
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
  }

  private cancelTask(task: ThumbnailTask) {
    if (task.cancelled) return
    task.cancelled = true
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
      void this.loader(task.nodeID, task.controller.signal, task.revision || undefined)
        .then((url) => {
          if (task.cancelled || this.disposed) {
            if (url) this.revokeURL(url)
            return
          }
          if (url) this.cacheURL(task.key, url)
          task.resolve(url)
        })
        .catch((error) => {
          if (!task.cancelled && !this.disposed) task.reject(error)
        })
        .finally(() => {
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
