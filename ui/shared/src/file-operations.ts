export const XDRIVE_FILE_OPERATION_HISTORY_LIMIT = 200

export const XDRIVE_FILE_OPERATION_ACTIVE_POLL_MS = 1_500
export const XDRIVE_FILE_OPERATION_VISIBLE_IDLE_POLL_MS = 3_000
export const XDRIVE_FILE_OPERATION_IDLE_POLL_MS = 15_000

export type XDriveFileOperationType = 'copy' | 'move' | 'delete'
export type XDriveFileOperationConflictPolicy = 'fail' | 'skip' | 'keep_both'
export type XDriveFileOperationConflictResolution = Exclude<XDriveFileOperationConflictPolicy, 'fail'>

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
  conflict_policy?: XDriveFileOperationConflictPolicy
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

const XDRIVE_FILE_OPERATION_FAILURE_MESSAGES: Record<string, string> = {
  batch_empty: '没有可处理的项目。',
  batch_too_large: '一次操作的项目数量超过限制，请分批操作。',
  invalid_batch_item: '任务中包含无效项目，请刷新后重新选择。',
  duplicate_batch_item: '任务中包含重复项目，请重新选择。',
  node_not_found: '项目已不存在，请刷新目录后重新操作。',
  root_mutation: '根目录不能执行此操作。',
  revision_conflict: '项目版本已变化，请刷新目录后重新发起操作。',
  invalid_target: '目标位置无效，请选择其他文件夹。',
  nested_batch_selection: '选择中同时包含文件夹及其子项，请调整选择后重新操作。',
  name_conflict: '目标位置存在同名项目，请处理冲突后重新操作。',
  managed_source_target: '该路径由同步来源管理，不能执行此操作。',
  internal_error: '文件操作执行失败，可稍后重试。',
}

export function xDriveFileOperationFailureMessage(
  operation: Pick<XDriveFileOperation, 'status' | 'failure_code' | 'error'>,
) {
  if (operation.status !== 'failed') return ''
  if (operation.failure_code && XDRIVE_FILE_OPERATION_FAILURE_MESSAGES[operation.failure_code]) {
    return XDRIVE_FILE_OPERATION_FAILURE_MESSAGES[operation.failure_code]
  }
  return operation.error || '文件操作执行失败。'
}

export function xDriveFileOperationFailureItemLabel(
  operation: Pick<XDriveFileOperation, 'current_item' | 'failed_item_id'>,
) {
  if (operation.current_item && operation.failed_item_id) {
    return `${operation.current_item}（#${operation.failed_item_id}）`
  }
  if (operation.current_item) return operation.current_item
  if (operation.failed_item_id) return `#${operation.failed_item_id}`
  return ''
}

export function xDriveFileOperationActive(status: XDriveFileOperationStatus | string) {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

export function xDriveFileOperationPollIntervalMs(
  operations: readonly Pick<XDriveFileOperation, 'status'>[],
  taskCenterVisible = false,
) {
  if (operations.some((operation) => xDriveFileOperationActive(operation.status))) {
    return XDRIVE_FILE_OPERATION_ACTIVE_POLL_MS
  }
  return taskCenterVisible
    ? XDRIVE_FILE_OPERATION_VISIBLE_IDLE_POLL_MS
    : XDRIVE_FILE_OPERATION_IDLE_POLL_MS
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

export function xDriveFileOperationUpsert<T extends Pick<XDriveFileOperation, 'id'>>(
  operations: readonly T[],
  operation: T,
): T[] {
  return [
    operation,
    ...operations.filter((item) => item.id !== operation.id),
  ]
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


export function xDriveFileOperationCanResolveConflict(
  operation: Pick<XDriveFileOperation, 'status' | 'failure_code' | 'type'>,
) {
  return operation.status === 'failed' &&
    operation.failure_code === 'name_conflict' &&
    (operation.type === 'copy' || operation.type === 'move')
}

export function xDriveFileOperationContinuationParentIDs(
  operations: readonly Pick<XDriveFileOperation, 'retry_of_id'>[],
) {
  const ids = new Set<string>()
  for (const operation of operations) {
    if (operation.retry_of_id) ids.add(operation.retry_of_id)
  }
  return ids
}

export function xDriveFileOperationConflictPolicyLabel(
  policy: XDriveFileOperationConflictPolicy,
) {
  switch (policy) {
    case 'skip': return '跳过冲突'
    case 'keep_both': return '保留两者'
    default: return '遇到冲突时停止'
  }
}
