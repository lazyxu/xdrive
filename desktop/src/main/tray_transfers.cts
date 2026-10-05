import type { AgentTransfer, AgentTransfers } from './agent_client.cjs'

export type TrayTransferItem = {
  label: string
}

export type TrayTransferPresentation = {
  label: string
  items: TrayTransferItem[]
  extraActive: number
  failed: number
}

function formatBinaryRate(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s']
  let value = bytesPerSecond
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

function compactName(value: string, max = 34) {
  const name = value.trim() || '未命名文件'
  if (name.length <= max) return name
  return name.slice(0, Math.max(1, max - 1)) + '…'
}

function transferDirection(item: AgentTransfer) {
  if (item.direction === 'upload' || item.kind === 'upload') return '上传'
  if (item.kind === 'dehydration') return '释放'
  return '下载'
}

function rootTransfers(items: AgentTransfer[]) {
  const ids = new Set(items.map((item) => item.id))
  return items.filter((item) => !item.parent_id || !ids.has(item.parent_id))
}

function transferItemProgress(item: AgentTransfer) {
  const total = Math.max(0, item.items_total || 0)
  const completed = Math.max(0, item.items_completed || 0)
  const failed = Math.max(0, item.items_failed || 0)
  return { total, processed: Math.min(total, completed + failed) }
}

function transferLine(item: AgentTransfer) {
  const parts = [transferDirection(item), compactName(item.file_name || item.path || item.id)]
  const group = item.scope === 'group'
  const progress = transferItemProgress(item)
  if (group && item.scan_complete === false) {
    parts.push(`扫描中 · 已发现 ${progress.total} 个文件`)
  } else if (item.state === 'retrying') {
    parts.push('正在重试')
  } else if (item.state === 'cancelling') {
    parts.push('正在取消')
  } else if (item.bytes_total > 0) {
    const percent = Math.max(0, Math.min(100, item.bytes_done * 100 / item.bytes_total))
    parts.push(`${percent.toFixed(1)}%`)
  } else {
    parts.push('处理中')
  }
  if (group && progress.total > 0 && item.scan_complete !== false) {
    parts.push(`${progress.processed}/${progress.total} 文件`)
  }
  const speed = formatBinaryRate(item.instant_bytes_per_second)
  if (speed) parts.push(speed)
  return parts.join(' · ')
}

export function trayTransferPresentation(transfers: AgentTransfers, maxItems = 3): TrayTransferPresentation {
  const roots = rootTransfers(transfers.transfers)
  const active = roots.filter((item) => (
    item.state === 'queued' ||
    item.state === 'running' ||
    item.state === 'retrying' ||
    item.state === 'cancelling'
  ))
  const failed = roots.filter((item) => item.state === 'failed').length
  const totalSpeed = active.reduce((sum, item) => sum + Math.max(0, item.instant_bytes_per_second || 0), 0)

  let label = '传输 · 空闲'
  if (active.length > 0) {
    const speed = formatBinaryRate(totalSpeed)
    label = `传输 · ${active.length} 进行中${speed ? ` · ${speed}` : ''}`
  } else if (failed > 0) {
    label = `传输 · ${failed} 个失败`
  }

  return {
    label,
    items: active.slice(0, Math.max(0, maxItems)).map((item) => ({ label: transferLine(item) })),
    extraActive: Math.max(0, active.length - Math.max(0, maxItems)),
    failed,
  }
}
