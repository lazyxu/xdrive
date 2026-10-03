export type XDriveFileOperationType = 'copy' | 'move' | 'delete'

export type XDriveFileOperationStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed'

export type XDriveFileOperation = {
  id: string
  type: XDriveFileOperationType
  status: XDriveFileOperationStatus
  parent_id?: number
  retry_of_id?: string
  total_items: number
  processed_items: number
  total_bytes: number
  processed_bytes: number
  percent: number
  current_item?: string
  failed_item_id?: number
  failure_code?: string
  error?: string
  retryable: boolean
  cancel_requested_at?: string
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export function xDriveFileOperationTypeLabel(type: XDriveFileOperationType | string) {
  switch (type) {
    case 'copy': return '复制'
    case 'move': return '移动'
    case 'delete': return '移到回收站'
    default: return type || '文件操作'
  }
}

export function xDriveFileOperationStatusLabel(status: XDriveFileOperationStatus | string) {
  switch (status) {
    case 'queued': return '等待执行'
    case 'running': return '进行中'
    case 'cancel_requested': return '正在取消'
    case 'cancelled': return '已取消'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status || '未知'
  }
}

export function xDriveFileOperationActive(status: XDriveFileOperationStatus | string) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

export function xDriveFileOperationTerminal(status: XDriveFileOperationStatus | string) {
  return status === 'cancelled' || status === 'completed' || status === 'failed'
}

export function xDriveFileOperationPercent(operation: XDriveFileOperation) {
  if (operation.status === 'completed') return 100
  if (Number.isFinite(operation.percent)) {
    return Math.max(0, Math.min(100, operation.percent))
  }
  if (operation.total_bytes > 0) {
    return Math.max(0, Math.min(100, (operation.processed_bytes / operation.total_bytes) * 100))
  }
  if (operation.total_items > 0) {
    return Math.max(0, Math.min(100, (operation.processed_items / operation.total_items) * 100))
  }
  return 0
}

function operationTimestamp(value?: string) {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function xDriveFileOperationElapsedMs(operation: XDriveFileOperation, now = Date.now()) {
  const started = operationTimestamp(operation.started_at)
  if (started === undefined) return 0

  const finished = operationTimestamp(operation.finished_at)
  const endpoint = finished ?? (xDriveFileOperationActive(operation.status) ? now : operationTimestamp(operation.updated_at) ?? now)
  return Math.max(0, endpoint - started)
}

export function xDriveFileOperationAverageBytesPerSecond(operation: XDriveFileOperation, now = Date.now()) {
  const elapsed = xDriveFileOperationElapsedMs(operation, now)
  if (elapsed <= 0 || operation.processed_bytes <= 0) return 0
  return operation.processed_bytes / (elapsed / 1000)
}

export function xDriveFileOperationAverageItemsPerSecond(operation: XDriveFileOperation, now = Date.now()) {
  const elapsed = xDriveFileOperationElapsedMs(operation, now)
  if (elapsed <= 0 || operation.processed_items <= 0) return 0
  return operation.processed_items / (elapsed / 1000)
}

export function xDriveFileOperationEtaMs(operation: XDriveFileOperation, now = Date.now()) {
  if (!xDriveFileOperationActive(operation.status) || operation.status === 'queued') return undefined
  if (operation.total_bytes > 0 && operation.processed_bytes >= operation.total_bytes) return 0
  if (operation.total_items > 0 && operation.processed_items >= operation.total_items) return 0

  if (operation.total_bytes > 0 && operation.processed_bytes > 0 && operation.processed_bytes < operation.total_bytes) {
    const bytesPerSecond = xDriveFileOperationAverageBytesPerSecond(operation, now)
    if (bytesPerSecond > 0) {
      return Math.max(0, Math.round(((operation.total_bytes - operation.processed_bytes) / bytesPerSecond) * 1000))
    }
  }

  if (operation.total_items > 0 && operation.processed_items > 0 && operation.processed_items < operation.total_items) {
    const itemsPerSecond = xDriveFileOperationAverageItemsPerSecond(operation, now)
    if (itemsPerSecond > 0) {
      return Math.max(0, Math.round(((operation.total_items - operation.processed_items) / itemsPerSecond) * 1000))
    }
  }

  return undefined
}

export type XDriveFileOperationStatusSnapshotItem = Pick<XDriveFileOperation, 'id' | 'status'>

export function xDriveFileOperationTransitionSnapshot(
  previous: ReadonlyMap<string, string>,
  operations: readonly XDriveFileOperationStatusSnapshotItem[],
) {
  const statuses = new Map<string, string>()
  let hasTerminalTransition = false

  for (const operation of operations) {
    const previousStatus = previous.get(operation.id)
    if (
      previousStatus &&
      xDriveFileOperationActive(previousStatus) &&
      !xDriveFileOperationActive(operation.status)
    ) {
      hasTerminalTransition = true
    }
    statuses.set(operation.id, operation.status)
  }

  return { statuses, hasTerminalTransition }
}
