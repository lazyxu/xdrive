import { formatBytes } from './byte_format.cjs'

export type SourceRunNotificationStatus =
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type SourceRunNotificationSource = {
  name: string
}

export type SourceRunNotificationRun = {
  mode: 'scan' | 'sync'
  status: SourceRunNotificationStatus
  scanned_file_items: number
  scanned_directory_items: number
  scanned_bytes: number
  synced_file_items: number
  synced_directory_items: number
  synced_bytes: number
  created_items: number
  updated_items: number
  skipped_items: number
  transferred_bytes: number
  failed_items: number
}

function count(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function runStatusLabel(run: SourceRunNotificationRun) {
  const noun = run.mode === 'scan' ? '扫描' : '同步'
  switch (run.status) {
    case 'completed': return `${noun}完成`
    case 'partial': return `${noun}部分完成`
    case 'failed': return `${noun}失败`
    case 'cancelled': return `${noun}已取消`
    default: return `${noun}进行中`
  }
}

export function sourceRunIsTerminal(status: SourceRunNotificationStatus) {
  return status === 'completed' || status === 'partial' || status === 'failed' || status === 'cancelled'
}

export function sourceRunNotificationPresentation(
  source: SourceRunNotificationSource,
  run: SourceRunNotificationRun,
) {
  const status = runStatusLabel(run)
  const failed = count(run.failed_items)
  const skipped = count(run.skipped_items)
  const scannedFiles = count(run.scanned_file_items)
  const scannedDirectories = count(run.scanned_directory_items)
  const scannedBytes = Math.max(0, run.scanned_bytes || 0)

  if (run.mode === 'scan') {
    const details = [
      `扫描 ${scannedFiles.toLocaleString('zh-CN')} 个文件`,
      `${scannedDirectories.toLocaleString('zh-CN')} 个文件夹`,
      formatBytes(scannedBytes),
    ]
    const outcome = [
      skipped > 0 ? `跳过 ${skipped.toLocaleString('zh-CN')}` : '',
      failed > 0 ? `失败 ${failed.toLocaleString('zh-CN')}` : '',
    ].filter(Boolean)
    return {
      title: `xDrive ${source.name}`,
      body: [status, details.join(' · '), outcome.join(' · ')].filter(Boolean).join('\n'),
    }
  }

  const syncedFiles = count(run.synced_file_items)
  const syncedDirectories = count(run.synced_directory_items)
  const syncedBytes = Math.max(0, run.synced_bytes || 0)
  const changed = syncedFiles + syncedDirectories
  const lines = [status]
  if (changed > 0) {
    lines.push(
      `已同步 ${syncedFiles.toLocaleString('zh-CN')} 个文件 · ${syncedDirectories.toLocaleString('zh-CN')} 个文件夹 · ${formatBytes(syncedBytes)}`,
    )
  } else if (run.status === 'completed') {
    lines.push(
      `没有需要同步的变更 · 扫描 ${scannedFiles.toLocaleString('zh-CN')} 个文件 · ${scannedDirectories.toLocaleString('zh-CN')} 个文件夹 · ${formatBytes(scannedBytes)}`,
    )
  } else {
    lines.push('本次没有成功同步文件或文件夹')
  }

  const outcome = [
    count(run.created_items) > 0 ? `新增 ${count(run.created_items).toLocaleString('zh-CN')}` : '',
    count(run.updated_items) > 0 ? `更新/移动 ${count(run.updated_items).toLocaleString('zh-CN')}` : '',
    run.transferred_bytes > 0 ? `实际传输 ${formatBytes(run.transferred_bytes)}` : '',
    skipped > 0 ? `跳过 ${skipped.toLocaleString('zh-CN')}` : '',
    failed > 0 ? `失败 ${failed.toLocaleString('zh-CN')}` : '',
  ].filter(Boolean)
  if (outcome.length > 0) lines.push(outcome.join(' · '))

  return {
    title: `xDrive ${source.name}`,
    body: lines.join('\n'),
  }
}
