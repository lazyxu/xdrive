import type { AgentStatus, AgentTransfers, AgentUpdateState } from './agent_client.cjs'

export type DesktopTaskbarProgress =
  | { value: number; mode: 'normal' | 'indeterminate' }
  | null

export function desktopTaskbarProgress(
  update: AgentUpdateState | null,
  transfers: AgentTransfers,
  status?: AgentStatus,
): DesktopTaskbarProgress {
  if (update?.status === 'downloading') {
    const total = Math.max(0, update.bytes_total || 0)
    const done = Math.max(0, update.bytes_done || 0)
    if (total > 0) {
      return { value: Math.max(0, Math.min(1, done / total)), mode: 'normal' }
    }
    return { value: 2, mode: 'indeterminate' }
  }
  if (update?.status === 'checking' || update?.status === 'installing') {
    return { value: 2, mode: 'indeterminate' }
  }

  if (status?.paused) return null

  const active = transfers.transfers.filter((item) => item.state === 'running' || item.state === 'retrying')
  if (active.length === 0) {
    return status?.sync_status === '正在同步'
      ? { value: 2, mode: 'indeterminate' }
      : null
  }
  if (active.some((item) => item.bytes_total <= 0)) {
    return { value: 2, mode: 'indeterminate' }
  }

  const total = active.reduce((sum, item) => sum + Math.max(0, item.bytes_total), 0)
  const done = active.reduce((sum, item) => sum + Math.max(0, Math.min(item.bytes_done, item.bytes_total)), 0)
  if (total <= 0) return { value: 2, mode: 'indeterminate' }
  return { value: Math.max(0, Math.min(1, done / total)), mode: 'normal' }
}
