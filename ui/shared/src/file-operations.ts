export const XDRIVE_FILE_OPERATION_HISTORY_LIMIT = 200

export const XDRIVE_FILE_OPERATION_ACTIVE_POLL_MS = 1_500
export const XDRIVE_FILE_OPERATION_VISIBLE_IDLE_POLL_MS = 3_000
export const XDRIVE_FILE_OPERATION_IDLE_POLL_MS = 15_000

export type XDriveFileOperationType = 'copy' | 'move' | 'delete' | 'undo' | 'redo'
export type XDriveFileOperationConflictPolicy = 'fail' | 'skip' | 'keep_both' | 'replace'
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
  undo_of_id?: string
  undone_by_id?: string
  redo_of_id?: string
  redone_by_id?: string
  undoable?: boolean
  redoable?: boolean
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
    case 'undo': return '撤销文件操作'
    case 'redo': return '重做文件操作'
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
  undo_conflict: '原操作之后文件状态已发生变化，无法安全撤销。',
  redo_conflict: '撤销之后文件状态已发生变化，无法安全重做。',
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

export function xDriveActiveFileOperationCount(
  operations: readonly Pick<XDriveFileOperation, 'status'>[],
) {
  return operations.filter((operation) => xDriveFileOperationActive(operation.status)).length
}

export function xDriveFileOperationHasHistory(
  operations: readonly Pick<XDriveFileOperation, 'status'>[],
) {
  return operations.some((operation) => !xDriveFileOperationActive(operation.status))
}

function xDriveFileOperationLineageActive(operation: XDriveFileOperation) {
  return (operation.type === 'undo' || operation.type === 'redo') &&
    xDriveFileOperationActive(operation.status)
}

export function xDriveLatestUndoableFileOperation(
  operations: readonly XDriveFileOperation[],
) {
  if (operations.some(xDriveFileOperationLineageActive)) {
    return undefined
  }
  return operations.find((operation) => (
    operation.status === 'completed' && operation.undoable
  ))
}

export function xDriveLatestRedoableFileOperation(
  operations: readonly XDriveFileOperation[],
) {
  if (operations.some(xDriveFileOperationLineageActive)) {
    return undefined
  }
  return operations.find((operation) => (
    operation.status === 'completed' && operation.redoable
  ))
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
    case 'replace': return '替换或合并'
    default: return '遇到冲突时停止'
  }
}

/** Counts and optional item failures from the actual Desktop download result. */
export type XDriveFileExplorerDownloadResult = {
  downloaded: number
  failed: number
  skippedFolders: number
  failures?: readonly { name: string; message: string }[]
  canceled?: boolean
}

export type XDriveFileExplorerActionFeedbackValue =
  | { kind: 'operation'; operation: XDriveFileOperation }
  | { kind: 'download'; result: XDriveFileExplorerDownloadResult }

export type XDriveFileExplorerActionFeedbackPresentation = {
  tone: 'neutral' | 'busy' | 'good' | 'warning' | 'bad'
  title: string
  message: string
  details: Array<{ label: string; value: string }>
  operationID?: string
}

export function xDriveFileExplorerActionFeedback(
  value: XDriveFileExplorerActionFeedbackValue,
): XDriveFileExplorerActionFeedbackPresentation {
  if (value.kind === 'download') {
    const result = value.result
    const parts = [`已下载 ${result.downloaded.toLocaleString('zh-CN')} 个文件`]
    if (result.failed > 0) parts.push(`${result.failed.toLocaleString('zh-CN')} 个失败`)
    if (result.skippedFolders > 0) parts.push(`跳过 ${result.skippedFolders.toLocaleString('zh-CN')} 个文件夹`)
    return {
      tone: result.canceled ? 'neutral'
        : result.failed > 0 ? result.downloaded > 0 ? 'warning' : 'bad'
          : result.skippedFolders > 0 ? 'warning' : result.downloaded > 0 ? 'good' : 'neutral',
      title: result.canceled ? '下载已取消'
        : result.failed > 0 ? result.downloaded > 0 ? '部分文件下载失败' : '下载失败'
          : result.downloaded > 0 ? '下载完成' : '没有下载文件',
      message: `${parts.join('，')}。`,
      details: (result.failures ?? []).map((failure) => ({
        label: failure.name || '文件',
        value: failure.message || '下载失败',
      })),
    }
  }

  const operation = value.operation
  const count = operation.total_items.toLocaleString('zh-CN')
  const atomic = operation.type === 'copy' || operation.type === 'move' || operation.type === 'delete'
  const details: XDriveFileExplorerActionFeedbackPresentation['details'] = []
  let tone: XDriveFileExplorerActionFeedbackPresentation['tone'] = 'busy'
  let message = `任务共 ${count} 个项目。`

  switch (operation.status) {
    case 'queued':
      message = `任务已提交，等待执行。涉及 ${count} 个项目。`
      break
    case 'running':
      // Progress counters are not a committed per-item outcome ledger.
      message = `处理进度：${operation.processed_items.toLocaleString('zh-CN')} / ${count} 个项目，任务尚未完成。`
      break
    case 'cancel_requested':
      message = `已请求取消，等待任务确认。涉及 ${count} 个项目。`
      break
    case 'cancelled':
      tone = 'neutral'
      message = `${atomic ? '本次整批操作已取消，未提交任何更改。' : '任务已取消。'}涉及 ${count} 个项目。`
      break
    case 'failed':
      tone = 'bad'
      message = `${atomic ? '本次整批操作失败，未提交任何更改。' : '任务失败。'}涉及 ${count} 个项目。`
      break
    case 'completed':
      tone = operation.conflict_policy === 'skip' ? 'warning' : 'good'
      // Completed skip-policy counters include skipped roots; their number is
      // not returned by the current operation DTO.
      message = operation.conflict_policy === 'skip'
        ? `任务已完成，按“跳过冲突”策略处理。任务共 ${count} 个项目，跳过数量未提供。`
        : `任务已完成，共 ${count} 个项目。`
      break
  }

  if (operation.status === 'failed') {
    const failedItem = xDriveFileOperationFailureItemLabel(operation)
    const reason = xDriveFileOperationFailureMessage(operation)
    if (failedItem) details.push({ label: '失败项目', value: failedItem })
    details.push({ label: '原因', value: reason })
    if (operation.failure_code) details.push({ label: '错误代码', value: operation.failure_code })
    if (operation.error && operation.error !== reason) {
      details.push({ label: '详细信息', value: operation.error })
    }
  } else if (xDriveFileOperationActive(operation.status) && operation.current_item) {
    details.push({ label: '当前项目', value: operation.current_item })
  }
  if (operation.conflict_policy && operation.conflict_policy !== 'fail') {
    details.push({ label: '冲突策略', value: xDriveFileOperationConflictPolicyLabel(operation.conflict_policy) })
  }

  return {
    tone,
    title: `${xDriveFileOperationTypeLabel(operation.type)} · ${xDriveFileOperationStatusLabel(operation.status)}`,
    message,
    details,
    operationID: operation.id,
  }
}
