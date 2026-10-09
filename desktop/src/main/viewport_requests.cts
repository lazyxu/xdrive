import type { WebContents } from 'electron'

type Sender = Pick<WebContents, 'id' | 'once' | 'removeListener'>

const pendingCancelTTL = 5_000
const maxPendingCancels = 512

/**
 * Request-scoped only. These IDs belong to the calling Renderer WebContents,
 * never to a durable upload, download, sync, deletion or Task Center job.
 * Actual request HTTP is aborted through AgentIPCClient's AbortSignal.
 */
export class DesktopViewportRequests {
  private readonly active = new Map<string, AbortController>()
  private readonly cancelled = new Map<string, NodeJS.Timeout>()

  private key(sender: Sender, requestID: unknown) {
    if (
      typeof requestID !== 'string' ||
      !requestID.trim() ||
      requestID.length > 160
    ) throw new Error('Invalid viewport request id')
    return `${sender.id}:${requestID.trim()}`
  }

  async run<T>(
    sender: Sender,
    requestID: unknown,
    execute: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    // Older renderer calls remain compatible without a request ID.
    if (requestID === undefined) return execute()
    const key = this.key(sender, requestID)
    const preCancelled = this.cancelled.get(key)
    if (preCancelled) {
      clearTimeout(preCancelled)
      this.cancelled.delete(key)
      throw new Error('Viewport request cancelled before admission')
    }
    if (this.active.has(key)) throw new Error('Duplicate viewport request id')

    const controller = new AbortController()
    const onDestroyed = () => controller.abort()
    this.active.set(key, controller)
    sender.once('destroyed', onDestroyed)
    try {
      const result = await execute(controller.signal)
      if (controller.signal.aborted) throw new Error('Viewport request cancelled')
      return result
    } finally {
      sender.removeListener('destroyed', onDestroyed)
      if (this.active.get(key) === controller) this.active.delete(key)
    }
  }

  cancel(sender: Sender, requestID: unknown) {
    const key = this.key(sender, requestID)
    const active = this.active.get(key)
    if (active) {
      active.abort()
      return
    }
    // Cancel can be processed before the request's async IPC handler starts.
    // Keep a short, bounded pre-admission fence for that same sender/request.
    const oldTimer = this.cancelled.get(key)
    if (oldTimer) clearTimeout(oldTimer)
    else if (this.cancelled.size >= maxPendingCancels) {
      const oldest = this.cancelled.keys().next().value
      if (oldest) {
        const timer = this.cancelled.get(oldest)
        if (timer) clearTimeout(timer)
        this.cancelled.delete(oldest)
      }
    }
    const timer = setTimeout(() => {
      if (this.cancelled.get(key) === timer) this.cancelled.delete(key)
    }, pendingCancelTTL)
    timer.unref()
    this.cancelled.set(key, timer)
  }
}
