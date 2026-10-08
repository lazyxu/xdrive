export type XDriveTransferScope = 'item' | 'group'
export type XDriveTransferPhase =
  | 'scanning'
  | 'queued'
  | 'transferring'
  | 'finalizing'
  | string

export type XDriveTransferState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'retrying'
  | 'cancelling'
  | 'cancelled'
  | 'handed_off'
  | string

export type XDriveTransferTask = {
  id: string
  parent_id?: string
  root_id?: string
  scope?: XDriveTransferScope
  phase?: XDriveTransferPhase
  scan_complete?: boolean
  file_name: string
  path?: string
  relative_path?: string
  kind: 'upload' | 'download' | 'hydration' | 'dehydration' | string
  direction: 'upload' | 'download' | 'local' | string
  state: XDriveTransferState
  bytes_done: number
  bytes_total: number
  percent: number
  items_total?: number
  items_completed?: number
  items_failed?: number
  items_running?: number
  items_queued?: number
  instant_bytes_per_second: number
  average_bytes_per_second: number
  // On a group, an explicit source identifies its own network sample (for
  // example an archive response), rather than the sum of its logical children.
  speed_source?: 'client' | 'server'
  speed_updated_at?: string
  elapsed_ms: number
  error?: string
  retry_count: number
  retryable: boolean
  started_at: string
  updated_at: string
  completed_at?: string
}

export type XDriveTransferTreeNode = {
  task: XDriveTransferTask
  children: XDriveTransferTreeNode[]
}

export type XDriveTransferItemProgress = {
  total: number
  completed: number
  failed: number
  running: number
  queued: number
  processed: number
}

export function xDriveNormalizeTransferTask(
  task: XDriveTransferTask,
): XDriveTransferTask {
  const scope: XDriveTransferScope = task.scope === 'group' ? 'group' : 'item'
  const state = task.state || 'running'
  const itemTerminal = state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'handed_off'
  const itemFailed = state === 'failed' ? 1 : 0
  const itemCompleted = state === 'completed' ? 1 : 0
  return {
    ...task,
    root_id: task.root_id || task.parent_id || task.id,
    scope,
    phase: task.phase || (
      state === 'queued'
        ? 'queued'
        : itemTerminal
          ? 'finalizing'
          : 'transferring'
    ),
    scan_complete: task.scan_complete ?? scope === 'item',
    items_total: Math.max(0, task.items_total ?? (scope === 'item' ? 1 : 0)),
    items_completed: Math.max(0, task.items_completed ?? itemCompleted),
    items_failed: Math.max(0, task.items_failed ?? itemFailed),
    items_running: Math.max(
      0,
      task.items_running ?? (
        scope === 'item' && (state === 'running' || state === 'retrying') ? 1 : 0
      ),
    ),
    items_queued: Math.max(
      0,
      task.items_queued ?? (scope === 'item' && state === 'queued' ? 1 : 0),
    ),
  }
}

export function xDriveTransferScope(
  task: Pick<XDriveTransferTask, 'scope'>,
): XDriveTransferScope {
  return task.scope === 'group' ? 'group' : 'item'
}

export function xDriveTransferIsGroup(
  task: Pick<XDriveTransferTask, 'scope'>,
) {
  return xDriveTransferScope(task) === 'group'
}

export function xDriveTransferRootID(
  task: Pick<XDriveTransferTask, 'id' | 'parent_id' | 'root_id'>,
) {
  return task.root_id || task.parent_id || task.id
}

export function xDriveTransferActive(
  task: Pick<XDriveTransferTask, 'state'>,
) {
  return task.state === 'queued' ||
    task.state === 'running' ||
    task.state === 'retrying' ||
    task.state === 'cancelling'
}

export function xDriveTransferTerminal(
  task: Pick<XDriveTransferTask, 'state'>,
) {
  return task.state === 'completed' ||
    task.state === 'partial' ||
    task.state === 'failed' ||
    task.state === 'cancelled' ||
    task.state === 'handed_off'
}

export function xDriveTransferRootTasks(
  tasks: readonly XDriveTransferTask[],
) {
  const ids = new Set(tasks.map((task) => task.id))
  return tasks.filter((task) => !task.parent_id || !ids.has(task.parent_id))
}

export function xDriveTransferChildren(
  tasks: readonly XDriveTransferTask[],
  parentID: string,
) {
  return tasks.filter((task) => task.parent_id === parentID)
}

export function xDriveTransferTree(
  tasks: readonly XDriveTransferTask[],
): XDriveTransferTreeNode[] {
  const normalized = tasks.map(xDriveNormalizeTransferTask)
  const children = new Map<string, XDriveTransferTask[]>()
  for (const task of normalized) {
    if (!task.parent_id) continue
    const siblings = children.get(task.parent_id) ?? []
    siblings.push(task)
    children.set(task.parent_id, siblings)
  }
  const build = (task: XDriveTransferTask): XDriveTransferTreeNode => ({
    task,
    children: (children.get(task.id) ?? []).map(build),
  })
  return xDriveTransferRootTasks(normalized).map(build)
}

export function xDriveTransferItemProgress(
  task: XDriveTransferTask,
  children: readonly XDriveTransferTask[] = [],
): XDriveTransferItemProgress {
  const normalized = xDriveNormalizeTransferTask(task)
  if (xDriveTransferIsGroup(normalized) && children.length > 0) {
    const direct = children.map(xDriveNormalizeTransferTask)
    const total = normalized.items_total && normalized.items_total > 0
      ? normalized.items_total
      : direct.length
    const completed = task.items_completed ?? direct.filter((item) => item.state === 'completed').length
    const failed = task.items_failed ?? direct.filter((item) => item.state === 'failed').length
    const running = task.items_running ?? direct.filter(xDriveTransferActive).length
    const queued = task.items_queued ?? direct.filter((item) => item.state === 'queued').length
    return {
      total,
      completed,
      failed,
      running,
      queued,
      processed: Math.min(total, completed + failed),
    }
  }
  const total = normalized.items_total ?? 0
  const completed = normalized.items_completed ?? 0
  const failed = normalized.items_failed ?? 0
  const running = normalized.items_running ?? 0
  const queued = normalized.items_queued ?? 0
  return {
    total,
    completed,
    failed,
    running,
    queued,
    processed: Math.min(total, completed + failed),
  }
}

export function xDriveTransferAggregateBytes(
  task: XDriveTransferTask,
  children: readonly XDriveTransferTask[] = [],
) {
  if (!xDriveTransferIsGroup(task) || children.length === 0) {
    return {
      done: Math.max(0, task.bytes_done || 0),
      total: Math.max(0, task.bytes_total || 0),
    }
  }
  const done = children.reduce((sum, child) => {
    const childTotal = Math.max(0, child.bytes_total || 0)
    const childDone = Math.max(0, child.bytes_done || 0)
    const processedDone = child.state === 'completed' && child.percent >= 100
      ? Math.max(childDone, childTotal)
      : childDone
    return sum + processedDone
  }, 0)
  const total = children.reduce((sum, child) => sum + Math.max(0, child.bytes_total || 0), 0)
  return {
    done: Math.max(done, task.bytes_done || 0),
    total: Math.max(total, task.bytes_total || 0),
  }
}

export function xDriveActiveTransferCount(
  tasks: readonly XDriveTransferTask[],
) {
  return xDriveTransferRootTasks(tasks).filter(xDriveTransferActive).length
}

export function xDriveTransferHasHistory(
  tasks: readonly XDriveTransferTask[],
) {
  return xDriveTransferRootTasks(tasks).some(xDriveTransferTerminal)
}

export type XDriveTransferSpeedSummary = {
  bytesPerSecond: number
  clientBytesPerSecond: number
  serverBytesPerSecond: number
  serverReported: boolean
}

export type XDriveTransferDirectionSummary = XDriveTransferSpeedSummary & {
  activeCount: number
}

export type XDriveNetworkTransferSummary = {
  upload: XDriveTransferDirectionSummary
  download: XDriveTransferDirectionSummary
  activeCount: number
  historyCount: number
}

export function xDriveNetworkTransferTasks(tasks: readonly XDriveTransferTask[]) {
  return tasks.filter((task) => (
    (task.direction === 'upload' || task.direction === 'download') &&
    task.kind !== 'dehydration'
  ))
}

export function xDriveTransferCurrentBytesPerSecond(
  task: XDriveTransferTask,
  now = Date.now(),
) {
  if (!xDriveTransferActive(task) || task.state === 'queued') return 0
  if (task.phase === 'queued' || task.phase === 'finalizing') return 0
  const explicitSample = Boolean(task.speed_source && task.speed_updated_at)
  if (task.bytes_done <= 0 && !explicitSample) return 0
  const sampledAt = Date.parse(task.speed_updated_at ?? task.updated_at)
  const age = now - sampledAt
  if (!Number.isFinite(age) || age < -1000 || age >= 3000) return 0
  if (task.state === 'retrying') {
    const retryStartedAt = Date.parse(task.started_at)
    if (!Number.isFinite(retryStartedAt) || sampledAt < retryStartedAt) return 0
  }
  const speed = task.instant_bytes_per_second
  return Number.isFinite(speed) && speed > 0 ? speed : 0
}

export function xDriveTransferTreeSpeed(
  node: XDriveTransferTreeNode,
  now = Date.now(),
): XDriveTransferSpeedSummary {
  const empty = {
    bytesPerSecond: 0,
    clientBytesPerSecond: 0,
    serverBytesPerSecond: 0,
    serverReported: node.task.speed_source === 'server',
  }
  if (node.children.length > 0 && !node.task.speed_source) {
    return node.children.reduce((sum, child) => {
      const speed = xDriveTransferTreeSpeed(child, now)
      return {
        bytesPerSecond: sum.bytesPerSecond + speed.bytesPerSecond,
        clientBytesPerSecond: sum.clientBytesPerSecond + speed.clientBytesPerSecond,
        serverBytesPerSecond: sum.serverBytesPerSecond + speed.serverBytesPerSecond,
        serverReported: sum.serverReported || speed.serverReported,
      }
    }, empty)
  }
  if (!xDriveTransferActive(node.task)) return empty
  const speed = xDriveTransferCurrentBytesPerSecond(node.task, now)
  return {
    bytesPerSecond: speed,
    clientBytesPerSecond: node.task.speed_source === 'server' ? 0 : speed,
    serverBytesPerSecond: node.task.speed_source === 'server' ? speed : 0,
    serverReported: node.task.speed_source === 'server',
  }
}

export function xDriveTransferTreeActive(node: XDriveTransferTreeNode): boolean {
  return xDriveTransferActive(node.task) || node.children.some(xDriveTransferTreeActive)
}

export function xDriveNetworkTransferSummary(
  tasks: readonly XDriveTransferTask[],
  now = Date.now(),
): XDriveNetworkTransferSummary {
  const directionSummary = (): XDriveTransferDirectionSummary => ({
    bytesPerSecond: 0,
    clientBytesPerSecond: 0,
    serverBytesPerSecond: 0,
    serverReported: false,
    activeCount: 0,
  })
  const result: XDriveNetworkTransferSummary = {
    upload: directionSummary(),
    download: directionSummary(),
    activeCount: 0,
    historyCount: 0,
  }
  const active = { upload: new Set<string>(), download: new Set<string>() }
  const history = new Set<string>()
  for (const node of xDriveTransferTree(xDriveNetworkTransferTasks(tasks))) {
    const direction = node.task.direction as 'upload' | 'download'
    const rootID = xDriveTransferRootID(node.task)
    if (xDriveTransferTerminal(node.task)) history.add(rootID)
    if (!xDriveTransferTreeActive(node)) continue
    active[direction].add(rootID)
    const speed = xDriveTransferTreeSpeed(node, now)
    result[direction].bytesPerSecond += speed.bytesPerSecond
    result[direction].clientBytesPerSecond += speed.clientBytesPerSecond
    result[direction].serverBytesPerSecond += speed.serverBytesPerSecond
    result[direction].serverReported ||= speed.serverReported
  }
  result.upload.activeCount = active.upload.size
  result.download.activeCount = active.download.size
  const activeRoots = new Set([...active.upload, ...active.download])
  for (const id of activeRoots) history.delete(id)
  result.activeCount = activeRoots.size
  result.historyCount = history.size
  return result
}

export function xDriveTransferKindLabel(value: string) {
  switch (value) {
    case 'upload': return '上传'
    case 'download': return '下载'
    case 'hydration': return '下载到本机'
    case 'dehydration': return '释放本地内容'
    case 'local': return '本地操作'
    default: return value || '传输'
  }
}

export function xDriveTransferPhaseLabel(value?: string) {
  switch (value) {
    case 'scanning': return '正在扫描'
    case 'queued': return '等待中'
    case 'transferring': return '传输中'
    case 'finalizing': return '正在完成'
    default: return value || ''
  }
}

export function xDriveTransferStateLabel(value: string) {
  switch (value) {
    case 'queued': return '等待中'
    case 'running': return '进行中'
    case 'retrying': return '正在重试'
    case 'cancelling': return '正在取消'
    case 'cancelled': return '已取消'
    case 'handed_off': return '由浏览器下载'
    case 'partial': return '部分完成'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return value || '未知'
  }
}

export function formatXDriveTransferDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round((milliseconds || 0) / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`
}

export function xDriveTransferEtaMs(task: XDriveTransferTask) {
  if (!xDriveTransferActive(task)) return undefined
  if (xDriveTransferIsGroup(task) && task.scan_complete === false) return undefined
  if (task.bytes_total <= 0 || task.bytes_done >= task.bytes_total) return undefined
  const speed = task.instant_bytes_per_second > 0
    ? task.instant_bytes_per_second
    : task.average_bytes_per_second
  if (speed <= 0) return undefined
  return Math.max(0, Math.round(((task.bytes_total - task.bytes_done) / speed) * 1000))
}

export function xDriveTransferPercent(task: XDriveTransferTask) {
  if (task.state === 'completed') return 100
  if (task.bytes_total > 0) {
    return Math.max(0, Math.min(100, (task.bytes_done / task.bytes_total) * 100))
  }
  return Math.max(0, Math.min(100, task.percent || 0))
}
