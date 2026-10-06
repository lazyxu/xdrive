export const XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6
export const XDRIVE_MEDIA_THUMBNAIL_CACHE_SIZE = 512

export type XDriveMediaThumbnailPriority = 0 | 1 | 2

export type XDriveMediaThumbnailSourceLoader = (
  nodeID: number,
) => Promise<string | null>

type ThumbnailTask = {
  nodeID: number
  priority: XDriveMediaThumbnailPriority
  sequence: number
  promise: Promise<string | null>
  resolve: (value: string | null) => void
  reject: (error: unknown) => void
  cancelled: boolean
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
  private readonly queued = new Map<number, ThumbnailTask>()
  private readonly inFlight = new Map<number, ThumbnailTask>()
  private readonly cache = new Map<number, string>()

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
  ): Promise<string | null> => {
    if (this.disposed || !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      return Promise.resolve(null)
    }

    const cached = this.cache.get(nodeID)
    if (cached !== undefined) {
      this.cache.delete(nodeID)
      this.cache.set(nodeID, cached)
      return Promise.resolve(cached)
    }

    const active = this.inFlight.get(nodeID)
    if (active) return active.promise

    const queued = this.queued.get(nodeID)
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
      priority,
      sequence: this.sequence++,
      promise,
      resolve,
      reject,
      cancelled: false,
    }
    this.queued.set(nodeID, task)
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
    if (this.queued.get(task.nodeID) === task) this.queued.delete(task.nodeID)
    if (this.inFlight.get(task.nodeID) === task) this.inFlight.delete(task.nodeID)
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
      this.queued.delete(task.nodeID)
      if (task.cancelled) continue
      this.active += 1
      this.inFlight.set(task.nodeID, task)
      void this.loader(task.nodeID)
        .then((url) => {
          if (task.cancelled || this.disposed) {
            if (url) this.revokeURL(url)
            return
          }
          if (url) this.cacheURL(task.nodeID, url)
          task.resolve(url)
        })
        .catch((error) => {
          if (!task.cancelled && !this.disposed) task.reject(error)
        })
        .finally(() => {
          if (this.inFlight.get(task.nodeID) === task) {
            this.inFlight.delete(task.nodeID)
          }
          this.active = Math.max(0, this.active - 1)
          this.schedulePump()
        })
    }
  }

  private cacheURL(nodeID: number, url: string) {
    const previous = this.cache.get(nodeID)
    if (previous && previous !== url) this.revokeURL(previous)
    this.cache.delete(nodeID)
    this.cache.set(nodeID, url)
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.entries().next().value as [number, string] | undefined
      if (!oldest) break
      this.cache.delete(oldest[0])
      this.revokeURL(oldest[1])
    }
  }
}
