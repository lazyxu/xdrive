import type { AgentTransfer, AgentTransfers } from './agent_client.cjs'
import { formatBytesPerSecond } from './byte_format.cjs'

/** A rate sample's original freshness timestamp must never be renewed by
 * unrelated progress or a tray-menu rebuild. */
export type TrayTransferSpeedSample = Pick<
  AgentTransfer,
  'instant_bytes_per_second' | 'speed_updated_at' | 'updated_at'
>

export const TRAY_TRANSFER_RATE_DISPLAY_MS = 2000
const TRAY_TRANSFER_RATE_MAX_AGE_MS = 3000

export function trayTransferRateKey(item: Pick<AgentTransfer, 'id' | 'started_at'>) {
  return `${item.id}\u0000${item.started_at}`
}

function currentRate(
  item: AgentTransfer,
  now: number,
  samples?: ReadonlyMap<string, TrayTransferSpeedSample>,
) {
  if (item.state !== 'running' && item.state !== 'retrying') return 0
  if (item.phase === 'queued' || item.phase === 'finalizing') return 0
  const sample = samples ? samples.get(trayTransferRateKey(item)) : item
  if (!sample) return 0
  const timestamp = Date.parse(sample.speed_updated_at ?? sample.updated_at)
  const age = now - timestamp
  if (!Number.isFinite(age) || age < -1000 || age >= TRAY_TRANSFER_RATE_MAX_AGE_MS) return 0
  if (item.state === 'retrying' && timestamp < Date.parse(item.started_at)) return 0
  const speed = sample.instant_bytes_per_second
  return Number.isFinite(speed) && speed > 0 ? speed : 0
}

export type TrayTransferItem = {
  label: string
}

export type TrayTransferPresentation = {
  label: string
  items: TrayTransferItem[]
  extraActive: number
  failed: number
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

function transferLine(item: AgentTransfer, now: number, samples?: ReadonlyMap<string, TrayTransferSpeedSample>) {
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
  const speed = formatBytesPerSecond(currentRate(item, now, samples))
  if (speed) parts.push(speed)
  return parts.join(' · ')
}

export function trayTransferPresentation(
  transfers: AgentTransfers,
  maxItems = 3,
  now = Date.now(),
  rateSamples?: ReadonlyMap<string, TrayTransferSpeedSample>,
): TrayTransferPresentation {
  const roots = rootTransfers(transfers.transfers)
  const active = roots.filter((item) => (
    item.state === 'queued' ||
    item.state === 'running' ||
    item.state === 'retrying' ||
    item.state === 'cancelling'
  ))
  const failed = roots.filter((item) => item.state === 'failed').length
  const totalSpeed = active.reduce((sum, item) => sum + currentRate(item, now, rateSamples), 0)

  let label = '传输 · 空闲'
  if (active.length > 0) {
    const speed = formatBytesPerSecond(totalSpeed)
    label = `传输 · ${active.length} 进行中${speed ? ` · ${speed}` : ''}`
  } else if (failed > 0) {
    label = `传输 · ${failed} 个失败`
  }

  return {
    label,
    items: active.slice(0, Math.max(0, maxItems)).map((item) => ({ label: transferLine(item, now, rateSamples) })),
    extraActive: Math.max(0, active.length - Math.max(0, maxItems)),
    failed,
  }
}
