export type SupportedExternalSourceKind = 'synology_photos' | 'yike_photos'
export type ExternalSourceDirection = 'push' | 'pull'
export type ExternalSourceRunMode = 'scan' | 'sync'
export type ExternalSourceStatus = 'active' | 'paused'
export type ExternalSourceScheduleType = 'interval' | 'cron' | 'manual'
export type ExternalSourceRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface ExternalSource {
  id: number
  name: string
  kind: string
  direction: ExternalSourceDirection
  sync_mode: 'backup' | 'mirror'
  run_mode: ExternalSourceRunMode
  status: ExternalSourceStatus
  schedule_type?: ExternalSourceScheduleType
  schedule_expression?: string
  schedule_timezone?: string
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
  processed_transfer_items?: number
  processed_transfer_bytes?: number
  created_items: number
  updated_items: number
  skipped_items: number
  transferred_items: number
  transferred_bytes: number
  failed_items: number
  active_transfer_path?: string
  active_transfer_bytes?: number
  active_transfer_total_bytes?: number
  cancel_requested_at?: string
  error?: string
  started_at: string
  finished_at?: string
}

export interface ExternalSourceItem {
  source_item_id: number
  external_id: string
  node_id?: number
  kind: string
  path: string
  size: number
  modified_at?: string
  sha256?: string
  remote_revision?: string
  state: 'pending' | 'synced' | 'missing' | 'ignored' | 'error' | string
  last_error?: string
}

export interface ExternalSourceCredentialStatus {
  configured: boolean
  key_version?: number
  updated_at?: string
}

export interface ExternalSourceCredentialTestResult {
  valid: boolean
  kind: string
  account_external_id?: string
  account_name?: string
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
  schedule_type?: ExternalSourceScheduleType
  schedule_expression?: string
  schedule_timezone?: string
  target_node_id: number
  ignore_rules?: string
}

export interface UpdateExternalSourceInput {
  name?: string
  run_mode?: ExternalSourceRunMode
  status?: ExternalSourceStatus
  schedule_type?: ExternalSourceScheduleType
  schedule_expression?: string
  schedule_timezone?: string
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
  scheduleType: ExternalSourceScheduleType
  scheduleExpression: string
  scheduleTimezone: string
}

export const yikeConnectorNotice = '一刻相册连接依赖当前网页版未公开接口，服务端变化可能导致连接暂时失效。xDrive 仅执行读取与备份，不会上传、删除或修改一刻相册中的内容。'
export const yikeManagedTargetLabel = '来源 / 一刻相册 / uid_<百度UID>_<账号名称>'

export const yikeCookieHelp = {
  title: '如何获取 Cookie',
  summary: '请从你自己已登录的一刻相册网页版中复制 photo.baidu.com 请求的完整 Cookie 请求头值；不要只复制某一个字段，也不要包含 Cookie: 前缀。',
  steps: [
    '浏览器登录 photo.baidu.com',
    '按 F12 打开开发者工具',
    '打开 Network / 网络',
    '刷新一刻相册页面',
    '点击一个发往 photo.baidu.com/youai/... 的请求',
    '在 Request Headers / 请求标头中找到 Cookie',
    '复制 Cookie: 后面的整段内容',
    '粘贴到 xDrive，然后点“测试连接”',
  ],
  security: 'Cookie 属于敏感登录凭据，请仅用于你自己的账号，不要发送给其他人或第三方服务。xDrive 会在服务器端加密保存。',
} as const

export interface ExternalSourceConnectorProfile {
  kind: string
  label: string
  direction: ExternalSourceDirection
  credential: 'cookie' | null
  manualTriggerExecutor: 'pull_worker' | 'source_agent'
  defaultName: string
  defaultIgnoreRules: string
}

export interface ExternalSourceCardView {
  modeLabel: string
  state: ExternalSourceState
  trigger: ExternalSourceTriggerState
  lastActivityLabel: '上次扫描' | '上次成功'
  lastActivityAt?: string
  scannedItems?: number
  scannedBytes?: number
  failedItems?: number
  connector: ExternalSourceConnectorProfile
}

export interface ExternalSourceDetailView {
  connector: ExternalSourceConnectorProfile
  kindLabel: string
  modeLabel: string
  state: ExternalSourceState
  targetNodeID?: number
  lastRunAt?: string
  lastSuccessAt?: string
  scheduleLabel: string
  credential?: {
    label: 'Cookie'
    configured: boolean
  }
  revision: number
  ignoreRules?: string
  error?: string
}

export interface ExternalSourceRunMetric {
  key: 'scanned' | 'planned_transfer' | 'transferred' | 'new' | 'changed' | 'moved' | 'missing' | 'failed'
  label: string
  items: number
  bytes?: number
}

export interface ExternalSourceRunProgressView {
  percent?: number
  label: string
  activePath?: string
  cancelling: boolean
}

export interface ExternalSourceRunDetailView {
  statusLabel: string
  startedAt: string
  progress?: ExternalSourceRunProgressView
  metrics: ExternalSourceRunMetric[]
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

export function externalSourceScheduleLabel(source: Pick<ExternalSource, 'schedule_type' | 'schedule_expression' | 'schedule_timezone'>) {
  if (source.schedule_type === 'cron' && source.schedule_expression) {
    return `Cron ${source.schedule_expression} · ${source.schedule_timezone || 'UTC'}`
  }
  if (source.schedule_type === 'interval' && source.schedule_expression) {
    return `每 ${source.schedule_expression}`
  }
  if (source.schedule_type === 'manual') {
    return '仅手动'
  }
  return '兼容默认间隔'
}

export function defaultExternalSourceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function externalSourceConnectorProfile(kind: string): ExternalSourceConnectorProfile {
  if (kind === 'yike_photos') {
    return {
      kind,
      label: '一刻相册',
      direction: 'pull',
      credential: 'cookie',
      manualTriggerExecutor: 'pull_worker',
      defaultName: '一刻相册',
      defaultIgnoreRules: '',
    }
  }
  if (kind === 'synology_photos') {
    return {
      kind,
      label: '群晖 Photos',
      direction: 'push',
      credential: null,
      manualTriggerExecutor: 'source_agent',
      defaultName: '群晖 Photos',
      defaultIgnoreRules: '@eaDir/\n\\#recycle/\n',
    }
  }
  return {
    kind,
    label: kind,
    direction: 'pull',
    credential: null,
    manualTriggerExecutor: 'pull_worker',
    defaultName: kind,
    defaultIgnoreRules: '',
  }
}

export function externalSourceKindLabel(kind: string) {
  return externalSourceConnectorProfile(kind).label
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
  const connector = externalSourceConnectorProfile(source.kind)
  if (source.status === 'paused') return { key: 'paused', tone: 'neutral', label: '已暂停' }
  if (latestRun?.status === 'running') return { key: 'running', tone: 'busy', label: '运行中' }
  if (source.run_requested_at) return { key: 'pending', tone: 'busy', label: '等待执行' }
  if (source.last_error) return { key: 'error', tone: 'bad', label: '异常' }
  if (connector.credential === 'cookie') {
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
  const connector = externalSourceConnectorProfile(source.kind)
  if (source.run_requested_at) return { ready: false, label: '已提交扫描请求' }
  if (connector.credential === 'cookie' && !credential?.configured) return { ready: false, label: '请先配置 Cookie' }
  if (source.status !== 'active') return { ready: false, label: '来源已暂停' }
  if (latestRun?.status === 'running') return { ready: false, label: '来源正在运行' }
  if (connector.manualTriggerExecutor === 'source_agent') {
    return { ready: true, label: '提交请求，由群晖 source-agent 下一次任务检查执行' }
  }
  return { ready: true, label: '立即请求 Pull worker 扫描此来源' }
}

export function externalSourceTriggerActionLabel(row: ExternalSourceRow) {
  if (row.source.run_requested_at) return '已请求'
  if ((row.latestRun?.failed_items ?? 0) > 0) return '重试失败项'
  return '立即扫描'
}

export function externalSourceDefaults(kind: SupportedExternalSourceKind): ExternalSourceDefaults {
  const profile = externalSourceConnectorProfile(kind)
  return {
    kind,
    name: profile.defaultName,
    direction: profile.direction,
    ignoreRules: profile.defaultIgnoreRules,
    scheduleType: 'interval',
    scheduleExpression: '6h',
    scheduleTimezone: defaultExternalSourceTimezone(),
  }
}

export function externalSourceCardView(row: ExternalSourceRow): ExternalSourceCardView {
  const { source, latestRun } = row
  return {
    modeLabel: externalSourceModeLabel(source),
    state: getExternalSourceState(row),
    trigger: getExternalSourceTriggerState(row),
    lastActivityLabel: source.run_mode === 'scan' ? '上次扫描' : '上次成功',
    lastActivityAt: source.run_mode === 'scan' ? source.last_run_at : source.last_success_at,
    scannedItems: latestRun?.scanned_items,
    scannedBytes: latestRun?.scanned_bytes,
    failedItems: latestRun?.failed_items,
    connector: externalSourceConnectorProfile(source.kind),
  }
}

export function externalSourceDetailView(row: ExternalSourceRow): ExternalSourceDetailView {
  const connector = externalSourceConnectorProfile(row.source.kind)
  return {
    connector,
    kindLabel: connector.label,
    modeLabel: externalSourceModeLabel(row.source),
    state: getExternalSourceState(row),
    targetNodeID: row.source.target_node_id,
    lastRunAt: row.source.last_run_at,
    lastSuccessAt: row.source.last_success_at,
    scheduleLabel: externalSourceScheduleLabel(row.source),
    credential: connector.credential === 'cookie'
      ? { label: 'Cookie', configured: row.credential?.configured === true }
      : undefined,
    revision: row.source.revision,
    ignoreRules: row.source.ignore_rules || undefined,
    error: row.source.last_error || undefined,
  }
}

function formatExternalSourceBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

export function externalSourceRunDetailView(run: ExternalSourceRun): ExternalSourceRunDetailView {
  const activeBytes = Math.max(0, Math.min(run.active_transfer_bytes || 0, run.active_transfer_total_bytes || 0))
  const plannedBytes = Math.max(0, run.planned_transfer_bytes || 0)
  const processedBytes = Math.max(0, run.processed_transfer_bytes || 0) + activeBytes
  const running = run.status === 'running'
  const syncProgress = run.mode === 'sync' && plannedBytes > 0
  const percent = running && syncProgress
    ? Math.max(0, Math.min(100, Math.round((processedBytes / plannedBytes) * 1000) / 10))
    : undefined
  const processedItems = Math.max(0, run.processed_transfer_items || 0)
  const progress = running
    ? {
        percent,
        label: run.cancel_requested_at
          ? '正在取消…'
          : run.mode === 'sync' && run.planned_transfer_items > 0
            ? `已处理 ${processedItems.toLocaleString('zh-CN')} / 已发现 ${run.planned_transfer_items.toLocaleString('zh-CN')} 项 · ${formatExternalSourceBytes(processedBytes)} / ${formatExternalSourceBytes(plannedBytes)} · 已扫描 ${run.scanned_items.toLocaleString('zh-CN')} 项`
            : `已扫描 ${run.scanned_items.toLocaleString('zh-CN')} 项`,
        activePath: run.active_transfer_path || undefined,
        cancelling: Boolean(run.cancel_requested_at),
      }
    : undefined

  return {
    statusLabel: externalSourceRunStatusLabel(run.status),
    startedAt: run.started_at,
    progress,
    metrics: [
      { key: 'scanned', label: '扫描', items: run.scanned_items, bytes: run.scanned_bytes },
      { key: 'planned_transfer', label: '计划传输', items: run.planned_transfer_items, bytes: run.planned_transfer_bytes },
      { key: 'transferred', label: '实际传输', items: run.transferred_items, bytes: run.transferred_bytes },
      { key: 'new', label: '新增', items: run.new_items },
      { key: 'changed', label: '变更', items: run.changed_items },
      { key: 'moved', label: '移动', items: run.moved_items },
      { key: 'missing', label: '缺失', items: run.missing_items },
      { key: 'failed', label: '失败', items: run.failed_items },
    ],
  }
}


export function externalSourceCredentialTestErrorLabel(code: string) {
  const normalized = String(code || '').trim()
  const labels: Record<string, string> = {
    yike_auth_failed: '一刻相册登录已失效，请重新获取 Cookie',
    yike_rate_limited: '一刻相册请求过于频繁，请稍后重试',
    yike_timeout: '连接一刻相册超时，请稍后重试',
    yike_unavailable: '一刻相册服务暂时不可用，请稍后重试',
    yike_connection_failed: '无法连接一刻相册，请检查网络后重试',
    invalid_source_credential: 'Cookie 格式无效，请重新获取',
    source_credential_not_configured: '尚未配置一刻相册 Cookie',
    unsupported_source_credential_kind: '当前来源不支持连接测试',
  }
  return labels[normalized] || normalized || '连接测试失败'
}

export function externalSourceCredentialTestSuccessLabel(result: ExternalSourceCredentialTestResult) {
  const name = result.account_name?.trim()
  const id = result.account_external_id?.trim()
  if (name && id) return `连接成功：${name}（${id}）`
  if (name) return `连接成功：${name}`
  if (id) return `连接成功：账号 ${id}`
  return '连接成功'
}
