export type XDriveServerUpdateSource = 'github' | 'gitlab'
export type XDriveServerUpdateChannel = 'stable' | 'master'
export type XDriveServerUpdatePhase = 'unavailable' | 'idle' | 'queued' | 'running' | 'success' | 'failed'

export interface XDriveServerUpdateState {
  supported: boolean
  state: XDriveServerUpdatePhase
  source: XDriveServerUpdateSource
  channel: XDriveServerUpdateChannel
  request_id?: string
  stage?: string
  stage_current?: number
  stage_total?: number
  bytes_done?: number
  bytes_total?: number
  message?: string
  error?: string
  started_at?: string
  updated_at?: string
  finished_at?: string
  runner_heartbeat_at?: string
}

export const xDriveServerUpdateSources: Array<{ value: XDriveServerUpdateSource; label: string }> = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
]

export const xDriveServerUpdateChannels: Array<{ value: XDriveServerUpdateChannel; label: string }> = [
  { value: 'stable', label: 'stable' },
  { value: 'master', label: 'master' },
]

export function xDriveServerUpdateProgress(state: XDriveServerUpdateState | null) {
  if (!state) return 0
  if ((state.bytes_total || 0) > 0) {
    return Math.max(0, Math.min(100, ((state.bytes_done || 0) / (state.bytes_total || 1)) * 100))
  }
  if ((state.stage_total || 0) > 0) {
    return Math.max(0, Math.min(100, ((state.stage_current || 0) / (state.stage_total || 1)) * 100))
  }
  if (state.state === 'success') return 100
  return 0
}

export function xDriveServerUpdateStateLabel(state: XDriveServerUpdateState | null) {
  switch (state?.state) {
    case 'queued': return '等待宿主机执行'
    case 'running': return '正在更新'
    case 'success': return '更新成功'
    case 'failed': return '更新失败'
    case 'idle': return '可以更新'
    default: return '不可用'
  }
}
