export type SupportedExternalSourceKind = 'synology_photos' | 'yike_photos'
export type ExternalSourceDirection = 'push' | 'pull'
export type ExternalSourceRunMode = 'scan' | 'sync'
export type ExternalSourceStatus = 'active' | 'paused'
export type ExternalSourceRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface ExternalSource {
  id: number
  name: string
  kind: string
  direction: ExternalSourceDirection
  sync_mode: 'backup' | 'mirror'
  run_mode: ExternalSourceRunMode
  status: ExternalSourceStatus
  revision: number
  target_node_id?: number
  ignore_rules?: string
  checkpoint?: string
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_requested_at?: string
  created_at: string
  updated_at: string
}

export interface ExternalSourceRun {
  id: string
  source_id: number
  source_revision: number
  target_node_id?: number
  mode: ExternalSourceRunMode
  trigger: string
  status: ExternalSourceRunStatus
  scanned_items: number
  scanned_bytes: number
  ignored_items: number
  ignored_bytes: number
  new_items: number
  new_bytes: number
  changed_items: number
  changed_bytes: number
  moved_items: number
  unchanged_items: number
  unchanged_bytes: number
  missing_items: number
  missing_bytes: number
  planned_transfer_items: number
  planned_transfer_bytes: number
  created_items: number
  updated_items: number
  skipped_items: number
  transferred_items: number
  transferred_bytes: number
  failed_items: number
  error?: string
  started_at: string
  finished_at?: string
}

export interface ExternalSourceCredentialStatus {
  configured: boolean
  key_version?: number
  updated_at?: string
}

export interface ExternalSourceRow {
  source: ExternalSource
  latestRun?: ExternalSourceRun
  credential?: ExternalSourceCredentialStatus
}

export interface CreateExternalSourceInput {
  name: string
  kind: string
  direction: ExternalSourceDirection
  sync_mode: 'backup'
  run_mode: ExternalSourceRunMode
  target_node_id: number
  ignore_rules?: string
}

export interface UpdateExternalSourceInput {
  name?: string
  run_mode?: ExternalSourceRunMode
  status?: ExternalSourceStatus
  target_node_id?: number
  ignore_rules?: string
}

export type ExternalSourceStateTone = 'neutral' | 'good' | 'warning' | 'bad' | 'busy'

export interface ExternalSourceState {
  key:
    | 'paused'
    | 'running'
    | 'pending'
    | 'error'
    | 'credential_ready'
    | 'credential_missing'
    | 'ready'
    | 'partial'
    | 'idle'
  tone: ExternalSourceStateTone
  label: string
}

export interface ExternalSourceTriggerState {
  ready: boolean
  label: string
}

export interface ExternalSourceDefaults {
  kind: SupportedExternalSourceKind
  name: string
  direction: ExternalSourceDirection
  ignoreRules: string
}

export function formatExternalSourceTime(value?: string, now = new Date()) {
  if (!value) return '尚无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚无记录'

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000)
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (diffDays === 0) return `今天 ${time}`
  if (diffDays === 1) return `昨天 ${time}`
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function externalSourceModeLabel(source: Pick<ExternalSource, 'direction' | 'run_mode'>) {
  return `${source.direction === 'push' ? 'Push' : 'Pull'} · ${source.run_mode === 'scan' ? '仅扫描' : '同步'}`
}

export function externalSourceKindLabel(kind: string) {
  if (kind === 'synology_photos') return '群晖 Photos'
  if (kind === 'yike_photos') return '一刻相册'
  return kind
}

export function externalSourceRunStatusLabel(status: ExternalSourceRunStatus) {
  const labels: Record<ExternalSourceRunStatus, string> = {
    running: '运行中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status]
}

export function getExternalSourceState(row: ExternalSourceRow): ExternalSourceState {
  const { source, latestRun, credential } = row
  if (source.status === 'paused') return { key: 'paused', tone: 'neutral', label: '已暂停' }
  if (latestRun?.status === 'running') return { key: 'running', tone: 'busy', label: '运行中' }
  if (source.run_requested_at) return { key: 'pending', tone: 'busy', label: '等待执行' }
  if (source.last_error) return { key: 'error', tone: 'bad', label: '异常' }
  if (source.kind === 'yike_photos') {
    return credential?.configured
      ? { key: 'credential_ready', tone: 'good', label: 'Cookie 已配置' }
      : { key: 'credential_missing', tone: 'warning', label: 'Cookie 未配置' }
  }
  if (source.last_success_at) return { key: 'ready', tone: 'good', label: '正常' }
  if (latestRun?.status === 'partial') return { key: 'partial', tone: 'warning', label: '部分完成' }
  return { key: 'idle', tone: 'neutral', label: '尚未运行' }
}

export function getExternalSourceTriggerState(row: ExternalSourceRow): ExternalSourceTriggerState {
  const { source, latestRun, credential } = row
  if (source.run_requested_at) return { ready: false, label: '已提交扫描请求' }
  if (source.kind === 'yike_photos' && !credential?.configured) return { ready: false, label: '请先配置 Cookie' }
  if (source.status !== 'active') return { ready: false, label: '来源已暂停' }
  if (latestRun?.status === 'running') return { ready: false, label: '来源正在运行' }
  if (source.kind === 'synology_photos') {
    return { ready: true, label: '提交请求，由群晖 source-agent 下一次任务检查执行' }
  }
  return { ready: true, label: '立即请求 Pull worker 扫描此来源' }
}

export function externalSourceDefaults(kind: SupportedExternalSourceKind): ExternalSourceDefaults {
  if (kind === 'yike_photos') {
    return {
      kind,
      name: '一刻相册',
      direction: 'pull',
      ignoreRules: '',
    }
  }
  return {
    kind,
    name: '群晖 Photos',
    direction: 'push',
    ignoreRules: '@eaDir/\n\\#recycle/\n',
  }
}
