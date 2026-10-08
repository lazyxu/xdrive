import { xDriveNormalizeTransferTask, xDriveTransferActive } from '../../ui/shared/src'
import type { XDriveTransferTask } from '../../ui/shared/src'

const STORAGE_KEY = 'xdrive.web.transfer_history'
const MAX_HISTORY = 200

function nowISO(now = Date.now()) {
  return new Date(now).toISOString()
}

function trimRootHistory(items: XDriveTransferTask[]) {
  const rootOrder: string[] = []
  const seen = new Set<string>()
  const activeRoots = new Set<string>()
  const rootByID = new Map(items.map((item) => [item.id, item]))

  for (const item of items) {
    const rootID = item.root_id || item.id
    if (!seen.has(rootID)) {
      seen.add(rootID)
      rootOrder.push(rootID)
    }
    if (xDriveTransferActive(item)) activeRoots.add(rootID)
  }

  if (rootOrder.length <= MAX_HISTORY) return items
  const removeRoots = new Set<string>()
  for (
    let index = rootOrder.length - 1;
    index >= 0 && rootOrder.length - removeRoots.size > MAX_HISTORY;
    index -= 1
  ) {
    const rootID = rootOrder[index]
    const root = rootByID.get(rootID)
    if (!root || (!xDriveTransferActive(root) && !activeRoots.has(rootID))) {
      removeRoots.add(rootID)
    }
  }
  return removeRoots.size > 0
    ? items.filter((item) => !removeRoots.has(item.root_id || item.id))
    : items
}


function loadTransferHistory(): XDriveTransferTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return trimRootHistory(
      parsed
        .filter((item): item is XDriveTransferTask => Boolean(item && typeof item.id === 'string'))
        .map((item) => {
          const normalized = xDriveNormalizeTransferTask(item)
          if (!xDriveTransferActive(normalized)) return normalized
          return {
            ...normalized,
            state: 'failed',
            items_running: 0,
            items_failed: normalized.scope === 'group'
              ? normalized.items_failed
              : 1,
            error: normalized.error || '页面刷新后无法继续跟踪该传输，请重新发起。',
            retryable: false,
            elapsed_ms: Math.max(normalized.elapsed_ms || 0, now - new Date(normalized.started_at).getTime()),
            updated_at: nowISO(now),
            completed_at: nowISO(now),
          }
        }),
    )
  } catch {
    return []
  }
}

type WebTransferChildInput = {
  fileName: string
  relativePath: string
  bytesTotal?: number
}

class WebTransferStore {
  private items = loadTransferHistory()
  private listeners = new Set<(items: XDriveTransferTask[]) => void>()
  private sequence = 0
  private batchDepth = 0
  private batchChanged = false

  snapshot() {
    return [...this.items]
  }

  subscribe(listener: (items: XDriveTransferTask[]) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => { this.listeners.delete(listener) }
  }

  batchUpdates<T>(run: () => T): T {
    this.batchDepth += 1
    try {
      return run()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0 && this.batchChanged) {
        this.batchChanged = false
        this.trimHistory()
        this.emit()
      }
    }
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
      root_id: id,
      scope: 'item',
      phase: 'transferring',
      scan_complete: true,
      file_name: input.fileName,
      path: input.path || input.fileName,
      kind: input.kind,
      direction: input.kind,
      state: 'running',
      bytes_done: 0,
      bytes_total: Math.max(0, input.bytesTotal || 0),
      percent: 0,
      items_total: 1,
      items_completed: 0,
      items_failed: 0,
      items_running: 1,
      items_queued: 0,
      instant_bytes_per_second: 0,
      average_bytes_per_second: 0,
      elapsed_ms: 0,
      retry_count: 0,
      retryable: false,
      started_at: nowISO(now),
      updated_at: nowISO(now),
    }
    this.items = [item, ...this.items]
    this.trimHistory()
    this.emit()
    return id
  }

  startGroup(input: {
    fileName: string
    path?: string
    bytesTotal?: number
    itemsTotal?: number
    kind?: 'upload' | 'download'
    direction?: 'upload' | 'download'
  }) {
    const now = Date.now()
    const id = `web-${now}-${++this.sequence}`
    const item: XDriveTransferTask = {
      id,
      root_id: id,
      scope: 'group',
      phase: 'scanning',
      scan_complete: false,
      file_name: input.fileName,
      path: input.path || input.fileName,
      kind: input.kind ?? 'upload',
      direction: input.direction ?? input.kind ?? 'upload',
      state: 'running',
      bytes_done: 0,
      bytes_total: Math.max(0, input.bytesTotal || 0),
      percent: 0,
      items_total: Math.max(0, input.itemsTotal || 0),
      items_completed: 0,
      items_failed: 0,
      items_running: 0,
      items_queued: 0,
      instant_bytes_per_second: 0,
      average_bytes_per_second: 0,
      elapsed_ms: 0,
      retry_count: 0,
      retryable: false,
      started_at: nowISO(now),
      updated_at: nowISO(now),
    }
    this.items = [item, ...this.items]
    this.trimHistory()
    this.emit()
    return id
  }

  startChild(groupID: string, input: WebTransferChildInput) {
    return this.startChildren(groupID, [input])[0]
  }

  startChildren(groupID: string, inputs: readonly WebTransferChildInput[]) {
    const parent = this.items.find((item) => item.id === groupID)
    if (!parent) throw new Error('传输父任务不存在。')
    if (inputs.length === 0) return []

    const now = Date.now()
    const rootID = parent.root_id || parent.id
    const children: XDriveTransferTask[] = inputs.map((input) => {
      const id = `web-${now}-${++this.sequence}`
      return {
        id,
        parent_id: groupID,
        root_id: rootID,
        scope: 'item',
        phase: 'queued',
        scan_complete: true,
        file_name: input.fileName,
        path: input.relativePath || input.fileName,
        relative_path: input.relativePath || input.fileName,
        kind: parent.kind || 'upload',
        direction: parent.direction || 'upload',
        state: 'queued',
        bytes_done: 0,
        bytes_total: Math.max(0, input.bytesTotal || 0),
        percent: 0,
        items_total: 1,
        items_completed: 0,
        items_failed: 0,
        items_running: 0,
        items_queued: 1,
        instant_bytes_per_second: 0,
        average_bytes_per_second: 0,
        elapsed_ms: 0,
        retry_count: 0,
        retryable: false,
        started_at: nowISO(now),
        updated_at: nowISO(now),
      }
    })
    const childIDs = children.map((item) => item.id)
    this.items = [...children.slice().reverse(), ...this.items]
    this.trimHistory()
    this.emit()
    return childIDs
  }

  begin(id: string) {
    const now = Date.now()
    this.patch(id, (item) => ({
      ...item,
      state: 'running',
      phase: 'transferring',
      items_running: item.scope === 'item' ? 1 : item.items_running,
      items_queued: item.scope === 'item' ? 0 : item.items_queued,
      scan_complete: item.scope === 'group' ? true : item.scan_complete,
      updated_at: nowISO(now),
    }))
  }

  updateGroup(id: string, progress: {
    scanComplete: boolean
    bytesDone: number
    bytesTotal: number
    itemsTotal: number
    itemsCompleted: number
    itemsFailed: number
    itemsRunning: number
    itemsQueued: number
  }) {
    const now = Date.now()
    this.patch(id, (item) => {
      const done = Math.max(0, progress.bytesDone)
      const total = Math.max(0, progress.bytesTotal)
      const previousTime = new Date(item.updated_at).getTime()
      const deltaSeconds = Math.max(0.001, (now - previousTime) / 1000)
      const instant = Math.max(0, (done - item.bytes_done) / deltaSeconds)
      const elapsed = Math.max(0, now - new Date(item.started_at).getTime())
      const average = elapsed > 0 ? done / (elapsed / 1000) : 0
      return {
        ...item,
        state: item.state === 'queued' ? 'running' : item.state,
        phase: progress.scanComplete ? 'transferring' : 'scanning',
        scan_complete: progress.scanComplete,
        bytes_done: done,
        bytes_total: total,
        percent: total > 0 ? Math.max(0, Math.min(100, done * 100 / total)) : 0,
        items_total: Math.max(0, progress.itemsTotal),
        items_completed: Math.max(0, progress.itemsCompleted),
        items_failed: Math.max(0, progress.itemsFailed),
        items_running: Math.max(0, progress.itemsRunning),
        items_queued: Math.max(0, progress.itemsQueued),
        instant_bytes_per_second: Number.isFinite(instant) ? instant : 0,
        average_bytes_per_second: Number.isFinite(average) ? average : 0,
        elapsed_ms: elapsed,
        updated_at: nowISO(now),
      }
    })
  }

  finishLifecycle(
    id: string,
    input: {
      state: 'completed' | 'partial' | 'failed' | 'cancelled'
      error?: string
      skipped?: boolean
    },
  ) {
    const now = Date.now()
    this.patch(id, (item) => {
      const completed = input.state === 'completed'
      const skipped = Boolean(input.skipped)
      const finalDone = completed && !skipped && item.scope === 'item' && item.bytes_total > 0
        ? item.bytes_total
        : item.bytes_done
      const elapsed = Math.max(0, now - new Date(item.started_at).getTime())
      const average = elapsed > 0 ? finalDone / (elapsed / 1000) : item.average_bytes_per_second
      return {
        ...item,
        state: input.state,
        phase: 'finalizing',
        bytes_done: skipped ? 0 : finalDone,
        percent: completed ? 100 : item.percent,
        items_completed: item.scope === 'item' && completed ? 1 : item.items_completed,
        items_failed: item.scope === 'item' && input.state === 'failed' ? 1 : item.items_failed,
        items_running: 0,
        items_queued: 0,
        instant_bytes_per_second: 0,
        average_bytes_per_second: Number.isFinite(average) ? average : 0,
        elapsed_ms: elapsed,
        error: input.error || (input.state === 'failed' ? '传输失败' : ''),
        updated_at: nowISO(now),
        completed_at: nowISO(now),
      }
    })
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
        phase: 'finalizing',
        items_completed: 1,
        items_failed: 0,
        items_running: 0,
        items_queued: 0,
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
        phase: 'finalizing',
        items_completed: 1,
        items_failed: 0,
        items_running: 0,
        items_queued: 0,
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
      items_completed: 0,
      items_failed: 1,
      items_running: 0,
      items_queued: 0,
      instant_bytes_per_second: 0,
      elapsed_ms: Math.max(0, now - new Date(item.started_at).getTime()),
      error: error instanceof Error ? error.message : String(error || '传输失败'),
      retryable: false,
      updated_at: nowISO(now),
      completed_at: nowISO(now),
    }))
  }

  clearHistory() {
    const activeRoots = new Set(
      this.items
        .filter(xDriveTransferActive)
        .map((item) => item.root_id || item.id),
    )
    const rootByID = new Map(this.items.map((item) => [item.id, item]))
    const removeRoots = new Set<string>()
    for (const item of this.items) {
      const rootID = item.root_id || item.id
      if (item.id !== rootID || activeRoots.has(rootID)) continue
      const root = rootByID.get(rootID)
      if (root && !xDriveTransferActive(root)) removeRoots.add(rootID)
    }
    if (removeRoots.size === 0) return
    this.items = this.items.filter((item) => !removeRoots.has(item.root_id || item.id))
    this.emit()
  }

  private trimHistory() {
    this.items = trimRootHistory(this.items)
  }

  private patch(id: string, updater: (item: XDriveTransferTask) => XDriveTransferTask) {
    let changed = false
    this.items = this.items.map((item) => {
      if (item.id !== id) return item
      changed = true
      return updater(item)
    })
    if (!changed) return
    if (this.batchDepth > 0) {
      this.batchChanged = true
      return
    }
    this.trimHistory()
    this.emit()
  }

  private emit() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items))
    } catch {
      // Transfer tracking must never block file I/O.
    }
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const webTransferStore = new WebTransferStore()
