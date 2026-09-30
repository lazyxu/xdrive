export type XDriveTransferTask = {
  id: string
  file_name: string
  path?: string
  kind: 'upload' | 'download' | 'hydration' | 'dehydration' | string
  direction: 'upload' | 'download' | 'local' | string
  state: 'running' | 'completed' | 'failed' | 'retrying' | string
  bytes_done: number
  bytes_total: number
  percent: number
  instant_bytes_per_second: number
  average_bytes_per_second: number
  elapsed_ms: number
  error?: string
  retry_count: number
  retryable: boolean
  started_at: string
  updated_at: string
  completed_at?: string
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

export function xDriveTransferStateLabel(value: string) {
  switch (value) {
    case 'running': return '进行中'
    case 'retrying': return '正在重试'
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
  if (task.state !== 'running' && task.state !== 'retrying') return undefined
  if (task.bytes_total <= 0 || task.bytes_done >= task.bytes_total) return undefined
  const speed = task.instant_bytes_per_second > 0
    ? task.instant_bytes_per_second
    : task.average_bytes_per_second
  if (speed <= 0) return undefined
  return Math.max(0, Math.round(((task.bytes_total - task.bytes_done) / speed) * 1000))
}

export function xDriveTransferPercent(task: XDriveTransferTask) {
  if (task.bytes_total > 0) {
    return Math.max(0, Math.min(100, (task.bytes_done / task.bytes_total) * 100))
  }
  return Math.max(0, Math.min(100, task.percent || 0))
}
