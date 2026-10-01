export type SupportedExternalSourceKind = 'synology_photos' | 'synology_files' | 'yike_photos'
export type ExternalSourceDirection = 'push' | 'pull'
export type ExternalSourceCreatePreset = 'synology_push' | 'synology_pull' | 'synology_files_pull' | 'yike_pull'
export type SynologyPhotoSpace = 'personal' | 'shared'
export type ExternalSourceRunMode = 'scan' | 'sync'
export type ExternalSourceStatus = 'active' | 'paused'
export type ExternalSourceScheduleType = 'interval' | 'cron' | 'manual'
export type ExternalSourceRunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export const externalSourceSavedCredentialMask = '••••••••••••'

export function isExternalSourceSavedCredentialMask(value: unknown) {
  return String(value ?? '') === externalSourceSavedCredentialMask
}

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
  target_path?: string
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
  run_number: number
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

export interface ExternalSourceRunFailure {
  id: number
  source_item_id: number
  external_id: string
  kind: string
  path: string
  size: number
  error: string
  failed_at: string
}

export interface ExternalSourceItemMetadata {
  original_path?: string
  owner_external_id?: string
  captured_at?: string
  remote_created_at?: string
  content_md5?: string
  thumbnail_url?: string
  pair_group_id?: string
  pair_role?: string
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
  metadata?: ExternalSourceItemMetadata
}

export interface ExternalSourceCollection {
  id: number
  external_id: string
  kind: string
  name: string
  state: 'active' | 'missing' | string
  remote_revision?: string
  item_count: number
  last_seen_at: string
  created_at: string
  updated_at: string
}

export interface ExternalSourceCollectionItem extends ExternalSourceItem {
  position: number
}

export interface ExternalSourceCredentialStatus {
  configured: boolean
  key_version?: number
  updated_at?: string
}

export interface ExternalSourceCredentialReveal {
  field: 'cookie' | 'password'
  value: string
  expires_in_seconds: number
}

export interface SynologyDsmCredentialInput {
  base_url: string
  username: string
  password: string
}

export interface ExternalSourceConnectorConfig {
  configured: boolean
  revision: number
  payload: Record<string, unknown>
  updated_at?: string
}

export interface ExternalSourceBrowseDirectory {
  name: string
  path: string
}

export interface ExternalSourceBrowsePage {
  path?: string
  items: ExternalSourceBrowseDirectory[]
  total: number
  next_offset?: number
}

export type ExternalSourceDirectoryBrowser = (
  path: string,
  limit?: number,
  offset?: number,
) => Promise<ExternalSourceBrowsePage>

export interface ExternalSourceCredentialTestResult {
  valid: boolean
  kind: string
  account_external_id?: string
  account_name?: string
}

export interface ExternalSourceOverview {
  source: ExternalSource
  latest_run?: ExternalSourceRun
  credential?: ExternalSourceCredentialStatus
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
  runMode: ExternalSourceRunMode
  ignoreRules: string
  scheduleType: ExternalSourceScheduleType
  scheduleExpression: string
  scheduleTimezone: string
}

export interface ExternalSourceCreateOption {
  value: ExternalSourceCreatePreset
  kind: SupportedExternalSourceKind
  direction: ExternalSourceDirection
  label: string
  description: string
}

export const externalSourceCreateOptions: ExternalSourceCreateOption[] = [
  {
    value: 'synology_push',
    kind: 'synology_photos',
    direction: 'push',
    label: '群晖 Photos · Push',
    description: '在 NAS 上运行 xdrive-source-agent，主动把照片推送到 xDrive。',
  },
  {
    value: 'synology_pull',
    kind: 'synology_photos',
    direction: 'pull',
    label: '群晖 Photos · Pull',
    description: '由 xDrive Server 通过 DSM / Synology Photos API 定时读取并同步照片。',
  },
  {
    value: 'synology_files_pull',
    kind: 'synology_files',
    direction: 'pull',
    label: '群晖 File Station · Pull',
    description: '由 xDrive Server 通过 DSM / File Station API 同步选定目录中的任意文件和文件夹。',
  },
  {
    value: 'yike_pull',
    kind: 'yike_photos',
    direction: 'pull',
    label: '一刻相册 · Pull',
    description: '由 xDrive Server 使用一刻相册 Cookie 读取并备份媒体。',
  },
]

export const synologyPhotoSpaceOptions: Array<{ value: SynologyPhotoSpace; label: string }> = [
  { value: 'personal', label: '个人空间' },
  { value: 'shared', label: '共享空间' },
]

export function normalizeSynologyPhotoSpaces(input: readonly SynologyPhotoSpace[]) {
  const selected = new Set(input)
  return synologyPhotoSpaceOptions
    .map((item) => item.value)
    .filter((space) => selected.has(space))
}

export function normalizeSynologyFileRoots(input: readonly string[]) {
  const roots = input
    .map((value) => String(value ?? ''))
    .filter((value) => value.trim() !== '')
    .map((value) => value.replace(/\/{2,}/g, '/'))
    .map((value) => value.length > 1 ? value.replace(/\/+$/, '') : value)
  return Array.from(new Set(roots)).sort((a, b) => a.localeCompare(b))
}

export function synologyFileRootsValidationError(input: readonly string[]) {
  const roots = normalizeSynologyFileRoots(input)
  if (roots.length === 0) return '至少填写一个 File Station 根目录'
  for (const root of roots) {
    if (!root.startsWith('/')) return `File Station 根目录必须是绝对路径：${root}`
    if (root === '/') return '不能选择整个 NAS 根目录 /，请至少选择一个共享文件夹'
    if (root.includes('\\')) return `File Station 根目录不能包含反斜杠：${root}`
  }
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      if (roots[i].startsWith(`${roots[j]}/`) || roots[j].startsWith(`${roots[i]}/`)) {
        return `File Station 根目录不能互相包含：${roots[i]} 与 ${roots[j]}`
      }
    }
  }
  return ''
}

export function externalSourceCreateOption(value: ExternalSourceCreatePreset) {
  return externalSourceCreateOptions.find((item) => item.value === value) ?? externalSourceCreateOptions[0]
}

export function externalSourceCreatePresetFor(kind: string, direction: ExternalSourceDirection): ExternalSourceCreatePreset {
  if (kind === 'yike_photos') return 'yike_pull'
  if (kind === 'synology_files') return 'synology_files_pull'
  return direction === 'pull' ? 'synology_pull' : 'synology_push'
}

export const yikeConnectorNotice = '一刻相册连接依赖当前网页版未公开接口，服务端变化可能导致连接暂时失效。xDrive 仅执行读取与备份，不会上传、删除或修改一刻相册中的内容。'
export const yikeRateLimitNotice = '为减少一刻相册返回“操作过于频繁（50005）”，xDrive 会将私有 API 控制面限制为约 2 次/秒，并尽量批量获取下载链接。若下载链接接口仍触发 50005，当前同步会立即停止继续请求，并进入约 10–15 分钟起步的冷却后自动续跑；已完成文件不会重复下载。该限制不限制照片/视频文件本身的下载速度。'
export const yikeManagedTargetLabel = '同步文件夹 / 一刻相册 / uid_<百度UID>_<账号名称>'
export const synologyDsmAddressHelp = 'DSM 默认 HTTPS 端口为 5001。使用 https://IP:5001 时，证书必须受 xDrive Server 信任且包含该 IP；如果证书签发给域名，请填写该域名。'

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
  credential: 'cookie' | 'synology_dsm' | null
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
    label: string
    configured: boolean
  }
  revision: number
  ignoreRules?: string
  error?: string
}

export interface ExternalSourceRunMetric {
  key:
    | 'scanned'
    | 'ignored'
    | 'new'
    | 'changed'
    | 'moved'
    | 'unchanged'
    | 'missing'
    | 'planned_transfer'
    | 'created'
    | 'updated'
    | 'skipped'
    | 'transferred'
    | 'failed'
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
  statusTone: ExternalSourceStateTone
  modeLabel: string
  triggerLabel: string
  startedAt: string
  finishedAt?: string
  durationLabel: string
  successItems: number
  failedItems: number
  error?: string
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

export function externalSourceConnectorProfile(kind: string, direction?: ExternalSourceDirection): ExternalSourceConnectorProfile {
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
  if (kind === 'synology_files') {
    return {
      kind,
      label: '群晖 File Station',
      direction: 'pull',
      credential: 'synology_dsm',
      manualTriggerExecutor: 'pull_worker',
      defaultName: '群晖 File Station',
      defaultIgnoreRules: '',
    }
  }
  if (kind === 'synology_photos' && direction === 'pull') {
    return {
      kind,
      label: '群晖 Photos',
      direction: 'pull',
      credential: 'synology_dsm',
      manualTriggerExecutor: 'pull_worker',
      defaultName: '群晖 Photos Pull',
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
    direction: direction ?? 'pull',
    credential: null,
    manualTriggerExecutor: direction === 'push' ? 'source_agent' : 'pull_worker',
    defaultName: kind,
    defaultIgnoreRules: '',
  }
}

export function externalSourceKindLabel(kind: string, direction?: ExternalSourceDirection) {
  return externalSourceConnectorProfile(kind, direction).label
}

export function externalSourceCredentialLabel(profile: ExternalSourceConnectorProfile) {
  if (profile.credential === 'cookie') return 'Cookie'
  if (profile.credential === 'synology_dsm') return 'DSM 凭据'
  return '凭据'
}

export function externalSourceCollectionKindLabel(kind: string) {
  if (kind === 'album') return '相册'
  return kind || '集合'
}

export function externalSourceCollectionStateLabel(state: string) {
  if (state === 'active') return '正常'
  if (state === 'missing') return '远端已不存在'
  return state || '未知'
}

export function externalSourceCollectionStateTone(state: string): ExternalSourceStateTone {
  if (state === 'active') return 'good'
  if (state === 'missing') return 'warning'
  return 'neutral'
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

export function externalSourceRunStatusTone(status: ExternalSourceRunStatus): ExternalSourceStateTone {
  if (status === 'running') return 'busy'
  if (status === 'completed') return 'good'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'bad'
  return 'neutral'
}

export function getExternalSourceState(row: ExternalSourceRow): ExternalSourceState {
  const { source, latestRun, credential } = row
  const connector = externalSourceConnectorProfile(source.kind, source.direction)
  if (source.status === 'paused') return { key: 'paused', tone: 'neutral', label: '已暂停' }
  if (latestRun?.status === 'running' && latestRun.cancel_requested_at) {
    return { key: 'running', tone: 'busy', label: '正在取消…' }
  }
  if (latestRun?.status === 'running') return { key: 'running', tone: 'busy', label: '运行中' }
  if (source.run_requested_at) return { key: 'pending', tone: 'busy', label: '等待执行' }
  if (source.last_error) return { key: 'error', tone: 'bad', label: '异常' }
  if (connector.credential) {
    const label = externalSourceCredentialLabel(connector)
    const separator = connector.credential === 'cookie' ? ' ' : ''
    return credential?.configured
      ? { key: 'credential_ready', tone: 'good', label: `${label}${separator}已配置` }
      : { key: 'credential_missing', tone: 'warning', label: `${label}${separator}未配置` }
  }
  if (source.last_success_at) return { key: 'ready', tone: 'good', label: '正常' }
  if (latestRun?.status === 'partial') return { key: 'partial', tone: 'warning', label: '部分完成' }
  return { key: 'idle', tone: 'neutral', label: '尚未运行' }
}

export function getExternalSourceTriggerState(row: ExternalSourceRow): ExternalSourceTriggerState {
  const { source, latestRun, credential } = row
  const connector = externalSourceConnectorProfile(source.kind, source.direction)
  if (source.run_requested_at) return { ready: false, label: '已提交扫描请求' }
  if (connector.credential && !credential?.configured) return { ready: false, label: `请先配置 ${externalSourceCredentialLabel(connector)}` }
  if (source.status !== 'active') return { ready: false, label: '同步文件夹已暂停' }
  if (latestRun?.status === 'running' && latestRun.cancel_requested_at) {
    return { ready: false, label: '同步文件夹正在取消' }
  }
  if (latestRun?.status === 'running') return { ready: false, label: '同步文件夹正在运行' }
  if (connector.manualTriggerExecutor === 'source_agent') {
    return { ready: true, label: '提交请求，由群晖 source-agent 下一次任务检查执行' }
  }
  return { ready: true, label: '立即唤醒 Pull worker 扫描此同步文件夹；定时轮询作为兜底' }
}

export function externalSourceTriggerActionLabel(row: ExternalSourceRow) {
  if (row.source.run_requested_at) return '已请求'
  if ((row.latestRun?.failed_items ?? 0) > 0) return '重试失败项'
  return '立即扫描'
}

export function externalSourceDefaults(kind: SupportedExternalSourceKind, direction?: ExternalSourceDirection): ExternalSourceDefaults {
  const profile = externalSourceConnectorProfile(kind, direction)
  return {
    kind,
    name: profile.defaultName,
    direction: profile.direction,
    runMode: profile.direction === 'pull' ? 'sync' : 'scan',
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
    connector: externalSourceConnectorProfile(source.kind, source.direction),
  }
}

export function externalSourceDetailView(row: ExternalSourceRow): ExternalSourceDetailView {
  const connector = externalSourceConnectorProfile(row.source.kind, row.source.direction)
  const runInProgress = row.latestRun?.status === 'running' || !!row.source.run_requested_at
  return {
    connector,
    kindLabel: connector.label,
    modeLabel: externalSourceModeLabel(row.source),
    state: getExternalSourceState(row),
    targetNodeID: row.source.target_node_id,
    lastRunAt: row.source.last_run_at,
    lastSuccessAt: row.source.last_success_at,
    scheduleLabel: externalSourceScheduleLabel(row.source),
    credential: connector.credential
      ? { label: externalSourceCredentialLabel(connector), configured: row.credential?.configured === true }
      : undefined,
    revision: row.source.revision,
    ignoreRules: row.source.ignore_rules || undefined,
    error: runInProgress ? undefined : (row.source.last_error || undefined),
  }
}

function formatExternalSourceBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

function externalSourceRunDurationLabel(run: ExternalSourceRun) {
  const started = new Date(run.started_at).getTime()
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '未知'
  const seconds = Math.max(0, Math.round((finished - started) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  if (minutes < 60) return remainSeconds ? `${minutes} 分 ${remainSeconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`
}

function externalSourceRunTriggerLabel(trigger: string) {
  if (trigger === 'manual') return '手动触发'
  if (trigger === 'scheduled') return '计划任务'
  return trigger || '未知'
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
    statusLabel: run.status === 'running' && run.cancel_requested_at
      ? '正在取消…'
      : externalSourceRunStatusLabel(run.status),
    statusTone: externalSourceRunStatusTone(run.status),
    modeLabel: run.mode === 'sync' ? '同步' : '扫描',
    triggerLabel: externalSourceRunTriggerLabel(run.trigger),
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationLabel: externalSourceRunDurationLabel(run),
    successItems: Math.max(0, run.scanned_items - run.failed_items),
    failedItems: Math.max(0, run.failed_items),
    error: run.error || undefined,
    progress,
    metrics: [
      { key: 'scanned', label: '扫描', items: run.scanned_items, bytes: run.scanned_bytes },
      { key: 'ignored', label: '忽略', items: run.ignored_items, bytes: run.ignored_bytes },
      { key: 'new', label: '新增', items: run.new_items, bytes: run.new_bytes },
      { key: 'changed', label: '变更', items: run.changed_items, bytes: run.changed_bytes },
      { key: 'moved', label: '移动', items: run.moved_items },
      { key: 'unchanged', label: '未变化', items: run.unchanged_items, bytes: run.unchanged_bytes },
      { key: 'missing', label: '缺失', items: run.missing_items, bytes: run.missing_bytes },
      { key: 'planned_transfer', label: '计划传输', items: run.planned_transfer_items, bytes: run.planned_transfer_bytes },
      { key: 'created', label: '创建', items: run.created_items },
      { key: 'updated', label: '更新', items: run.updated_items },
      { key: 'skipped', label: '跳过', items: run.skipped_items },
      { key: 'transferred', label: '实际传输', items: run.transferred_items, bytes: run.transferred_bytes },
      { key: 'failed', label: '失败', items: run.failed_items },
    ],
  }
}


export function externalSourceCredentialTestErrorLabel(code: string, detail = '') {
  const normalized = String(code || '').trim()
  const labels: Record<string, string> = {
    yike_auth_failed: '一刻相册登录已失效，请重新获取 Cookie',
    yike_rate_limited: '一刻相册请求过于频繁，请稍后重试',
    yike_timeout: '连接一刻相册超时，请稍后重试',
    yike_unavailable: '一刻相册服务暂时不可用，请稍后重试',
    yike_connection_failed: '无法连接一刻相册，请检查网络后重试',
    yike_target_contains_unmanaged_data: '固定的一刻相册目录中已有未归属文件，请先移动或整理该目录后再重新添加同步文件夹',
    yike_target_path_conflict: '固定的一刻相册路径被同名文件占用，请先整理“同步文件夹 / 一刻相册”路径后重试',
    synology_auth_failed: 'Synology DSM 登录失败，请检查地址、用户名和密码',
    synology_http_forbidden: 'Synology DSM 或应用入口拒绝访问（HTTP 403），这不代表密码错误',
    synology_multiple_login: 'Synology DSM 检测到重复登录，请稍后重试',
    synology_rate_limited: 'Synology DSM 请求过于频繁，请稍后重试',
    synology_permission_denied: 'Synology DSM 账号没有访问所需服务的权限',
    synology_otp_required: 'Synology DSM 要求两步验证/OTP，当前连接器尚未提供 OTP',
    synology_photos_unavailable: 'Synology Photos API 不可用，请确认 NAS 已安装并启用 Synology Photos',
    synology_file_station_unavailable: 'Synology File Station API 不可用，请确认 DSM 已启用 File Station 且账号有访问权限',
    synology_tls_unknown_authority: 'Synology DSM HTTPS 证书不受信任',
    synology_tls_hostname_mismatch: 'Synology DSM HTTPS 证书与访问地址不匹配',
    synology_tls_certificate_invalid: 'Synology DSM HTTPS 证书无效',
    synology_dns_failed: '无法解析 Synology DSM 地址',
    synology_connection_refused: 'Synology DSM 端口拒绝连接',
    synology_network_unreachable: 'xDrive Server 无法路由到 Synology DSM',
    synology_api_error: 'Synology DSM API 返回错误',
    synology_unavailable: '无法连接 Synology DSM，请检查 NAS 地址、网络和 HTTPS 配置',
    synology_timeout: '连接 Synology DSM 超时，请稍后重试',
    source_timeout: '连接同步文件夹超时，请稍后重试',
    source_connection_failed: '无法连接同步文件夹，请检查网络和凭据后重试',
    invalid_source_credential: '同步文件夹凭据格式无效，请检查后重试',
    source_credential_not_configured: '尚未配置同步文件夹凭据',
    unsupported_source_credential_kind: '当前同步文件夹不支持连接测试',
  }
  const label = labels[normalized] || normalized || '连接测试失败'
  const normalizedDetail = String(detail || '').trim()
  return normalizedDetail ? `${label}：${normalizedDetail}` : label
}

export function externalSourceCredentialTestSuccessLabel(result: ExternalSourceCredentialTestResult) {
  const name = result.account_name?.trim()
  const id = result.account_external_id?.trim()
  if (name && id) return `连接成功：${name}（${id}）`
  if (name) return `连接成功：${name}`
  if (id) return `连接成功：账号 ${id}`
  return '连接成功'
}
