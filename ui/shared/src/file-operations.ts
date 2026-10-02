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
