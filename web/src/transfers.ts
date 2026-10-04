import type { XDriveTransferTask } from '../../ui/shared/src'

const STORAGE_KEY = 'xdrive.web.transfer_history'
const MAX_HISTORY = 200

function nowISO(now = Date.now()) {
  return new Date(now).toISOString()
}

function loadTransferHistory(): XDriveTransferTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed
      .filter((item): item is XDriveTransferTask => Boolean(item && typeof item.id === 'string'))
      .map((item) => {
        if (item.state !== 'running' && item.state !== 'retrying') return item
        return {
          ...item,
          state: 'failed',
          error: item.error || '页面刷新后无法继续跟踪该传输，请重新发起。',
          retryable: false,
          elapsed_ms: Math.max(item.elapsed_ms || 0, now - new Date(item.started_at).getTime()),
          updated_at: nowISO(now),
          completed_at: nowISO(now),
        }
      })
      .slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

class WebTransferStore {
  private items = loadTransferHistory()
  private listeners = new Set<(items: XDriveTransferTask[]) => void>()
  private sequence = 0

  snapshot() {
    return [...this.items]
  }

  subscribe(listener: (items: XDriveTransferTask[]) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  create(input: {
    fileName: string
    path?: string
    kind: 'upload' | 'download'
    bytesTotal?: number
  }) {
    const now = Date.now()
    const id = `web-${now}-${++this.sequence}`
    const item: XDriveTransferTask = {
      id,
      file_name: input.fileName,
      path: input.path || input.fileName,
      kind: input.kind,
      direction: input.kind,
      state: 'running',
      bytes_done: 0,
      bytes_total: Math.max(0, input.bytesTotal || 0),
      percent: 0,
      instant_bytes_per_second: 0,
      average_bytes_per_second: 0,
      elapsed_ms: 0,
      retry_count: 0,
      retryable: false,
      started_at: nowISO(now),
      updated_at: nowISO(now),
    }
    this.items = [item, ...this.items].slice(0, MAX_HISTORY)
    this.emit()
    return id
  }

  progress(id: string, bytesDone: number, bytesTotal?: number) {
    const now = Date.now()
    this.patch(id, (item) => {
      const previousTime = new Date(item.updated_at).getTime()
      const deltaSeconds = Math.max(0.001, (now - previousTime) / 1000)
      const nextDone = Math.max(0, bytesDone)
      const nextTotal = Math.max(0, bytesTotal ?? item.bytes_total)
      const instant = Math.max(0, (nextDone - item.bytes_done) / deltaSeconds)
      const started = new Date(item.started_at).getTime()
      const elapsed = Math.max(0, now - started)
      const average = elapsed > 0 ? nextDone / (elapsed / 1000) : 0
      return {
        ...item,
        bytes_done: nextDone,
        bytes_total: nextTotal,
        percent: nextTotal > 0 ? Math.max(0, Math.min(100, (nextDone / nextTotal) * 100)) : item.percent,
        instant_bytes_per_second: Number.isFinite(instant) ? instant : 0,
        average_bytes_per_second: Number.isFinite(average) ? average : 0,
        elapsed_ms: elapsed,
        updated_at: nowISO(now),
      }
    })
  }

  complete(id: string, bytesDone?: number, bytesTotal?: number) {
    const now = Date.now()
    this.patch(id, (item) => {
      const done = Math.max(0, bytesDone ?? item.bytes_done)
      const total = Math.max(0, bytesTotal ?? item.bytes_total)
      const finalDone = total > 0 ? Math.max(done, total) : done
      const elapsed = Math.max(0, now - new Date(item.started_at).getTime())
      const average = elapsed > 0 ? finalDone / (elapsed / 1000) : item.average_bytes_per_second
      return {
        ...item,
        state: 'completed',
        bytes_done: finalDone,
        bytes_total: total,
        percent: total > 0 ? 100 : item.percent,
        instant_bytes_per_second: 0,
        average_bytes_per_second: Number.isFinite(average) ? average : 0,
        elapsed_ms: elapsed,
        updated_at: nowISO(now),
        completed_at: nowISO(now),
        error: '',
      }
    })
  }

  completeSkipped(id: string, bytesTotal?: number) {
    const now = Date.now()
    this.patch(id, (item) => {
      const total = Math.max(0, bytesTotal ?? item.bytes_total)
      return {
        ...item,
        state: 'completed',
        bytes_done: 0,
        bytes_total: total,
        percent: 100,
        instant_bytes_per_second: 0,
        average_bytes_per_second: 0,
        elapsed_ms: Math.max(0, now - new Date(item.started_at).getTime()),
        updated_at: nowISO(now),
        completed_at: nowISO(now),
        error: '',
      }
    })
  }

  fail(id: string, error: unknown) {
    const now = Date.now()
    this.patch(id, (item) => ({
      ...item,
      state: 'failed',
      instant_bytes_per_second: 0,
      elapsed_ms: Math.max(0, now - new Date(item.started_at).getTime()),
      error: error instanceof Error ? error.message : String(error || '传输失败'),
      retryable: false,
      updated_at: nowISO(now),
      completed_at: nowISO(now),
    }))
  }

  clearHistory() {
    this.items = this.items.filter((item) => item.state === 'running' || item.state === 'retrying')
    this.emit()
  }

  private patch(id: string, updater: (item: XDriveTransferTask) => XDriveTransferTask) {
    let changed = false
    this.items = this.items.map((item) => {
      if (item.id !== id) return item
      changed = true
      return updater(item)
    })
    if (changed) this.emit()
  }

  private emit() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items.slice(0, MAX_HISTORY)))
    } catch {
      // Transfer tracking must never block file I/O.
    }
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const webTransferStore = new WebTransferStore()
