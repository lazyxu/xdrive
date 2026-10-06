import { formatBytes } from './format'

export const XDRIVE_BACKGROUND_TASK_LIMIT = 200
export const XDRIVE_BACKGROUND_TASK_ACTIVE_POLL_MS = 1_500
export const XDRIVE_BACKGROUND_TASK_VISIBLE_IDLE_POLL_MS = 3_000

export type XDriveBackgroundTaskProgress = {
  phase?: string
  current?: number
  total?: number
  unit?: string
  percent?: number
  current_item?: string
}

export type XDriveBackgroundTaskControlAction =
  | 'cancel'
  | 'retry'
  | 'undo'
  | 'redo'
  | 'reanalyze'
  | string

export type XDriveBackgroundTaskControlResult = {
  task_id: string
  action: string
  result_task_id?: string
  accepted: boolean
}

export type XDriveBackgroundTask = {
  id: string
  kind: string
  domain: string
  scope: string
  owner_id?: number
  owner_username?: string
  state: string
  trigger?: string
  initiator?: string
  priority?: number
  resource?: string
  source_id?: number
  source_name?: string
  source_kind?: string
  progress: XDriveBackgroundTaskProgress
  active_count?: number
  queued_count?: number
  running_count?: number
  control_actions?: string[]
  started_at?: string
  updated_at: string
  finished_at?: string
  error?: string
}

export function xDriveBackgroundTaskActive(state: string) {
  return state === 'queued' || state === 'running' || state === 'cancelling' || state === 'cancel_requested'
}

export function xDriveBackgroundTaskPollIntervalMs(tasks: readonly XDriveBackgroundTask[]) {
  return tasks.some((task) => xDriveBackgroundTaskActive(task.state))
    ? XDRIVE_BACKGROUND_TASK_ACTIVE_POLL_MS
    : XDRIVE_BACKGROUND_TASK_VISIBLE_IDLE_POLL_MS
}

export function xDriveBackgroundTaskKindLabel(kind: string) {
  switch (kind) {
    case 'source.sync': return '同步文件夹'
    case 'media.index': return '媒体索引'
    case 'media.thumbnail': return '缩略图生成'
    case 'media.analysis_preview': return '分析预览'
    case 'photo.face': return '人脸识别'
    case 'photo.place': return '地点识别'
    case 'photo.person_cluster': return '人物聚类'
    case 'file_operation.copy': return '文件操作 · 复制'
    case 'file_operation.move': return '文件操作 · 移动'
    case 'file_operation.delete': return '文件操作 · 删除'
    case 'file_operation.undo': return '文件操作 · 撤销'
    case 'file_operation.redo': return '文件操作 · 重做'
    default: return kind || '后台任务'
  }
}

export function xDriveBackgroundTaskStateLabel(state: string) {
  switch (state) {
    case 'queued': return '等待执行'
    case 'running': return '进行中'
    case 'cancelling':
    case 'cancel_requested': return '正在取消'
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    case 'failed': return '失败'
    default: return state || '未知'
  }
}

export function xDriveBackgroundTaskResourceLabel(resource?: string) {
  switch (resource) {
    case 'interactive_io': return '交互 I/O'
    case 'network': return '网络'
    case 'media_cpu': return '媒体 CPU'
    case 'ml_cpu': return 'ML CPU'
    case 'background_cpu': return '后台 CPU'
    case 'maintenance_io': return '维护 I/O'
    default: return resource || '—'
  }
}

export function xDriveBackgroundTaskTriggerLabel(trigger?: string) {
  switch (trigger) {
    case 'user_action': return '用户触发'
    case 'system_event': return '系统事件'
    case 'schedule': return '定时'
    case 'reconcile': return '对账'
    case 'admin_action': return '管理员触发'
    case 'mixed': return '混合'
    default: return trigger || '—'
  }
}

export function xDriveBackgroundTaskControlLabel(action: string) {
  switch (action) {
    case 'cancel': return '取消'
    case 'retry': return '重试'
    case 'undo': return '撤销'
    case 'redo': return '重做'
    case 'reanalyze': return '重新分析'
    default: return action
  }
}

export function xDriveBackgroundTaskControlCapabilityLabel(action: string) {
  const label = xDriveBackgroundTaskControlLabel(action)
  return label ? `可${label}` : action
}

export function xDriveBackgroundTaskPercent(task: XDriveBackgroundTask) {
  const explicit = task.progress?.percent
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit))
  const current = task.progress?.current ?? 0
  const total = task.progress?.total ?? 0
  if (total > 0) return Math.max(0, Math.min(100, (current / total) * 100))
  return undefined
}

export function xDriveBackgroundTaskProgressLabel(task: XDriveBackgroundTask) {
  const current = task.progress?.current ?? 0
  const total = task.progress?.total ?? 0
  const unit = task.progress?.unit ?? ''
  const value = (amount: number) => unit === 'byte' ? formatBytes(amount) : amount.toLocaleString('zh-CN')
  if (total > 0) {
    const suffix = unit === 'byte' ? '' : unit === 'task' ? ' 个任务' : ' 项'
    return `${value(current)} / ${value(total)}${suffix}`
  }
  if (current > 0) return unit === 'byte' ? value(current) : `${value(current)}${unit === 'task' ? ' 个任务' : ' 项'}`
  return task.progress?.phase || xDriveBackgroundTaskStateLabel(task.state)
}

function backgroundTaskTimestamp(value?: string) {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function xDriveBackgroundTaskElapsedMs(task: XDriveBackgroundTask, now = Date.now()) {
  const started = backgroundTaskTimestamp(task.started_at)
  if (started === undefined) return 0
  const finished = backgroundTaskTimestamp(task.finished_at)
  const updated = backgroundTaskTimestamp(task.updated_at)
  const endpoint = finished ?? (xDriveBackgroundTaskActive(task.state) ? now : updated ?? now)
  return Math.max(0, endpoint - started)
}
