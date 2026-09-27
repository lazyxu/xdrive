import type { AgentStatus } from './agent_client.cjs'

export type TaskbarOverlayKind = 'conflict' | 'offline' | null

export function taskbarOverlayKind(connected: boolean, status?: AgentStatus): TaskbarOverlayKind {
  if (!connected || !status) return 'offline'
  if (status.has_conflict || status.conflict_count > 0) return 'conflict'
  if (
    status.last_error ||
    status.auth_status === '登录已过期' ||
    status.auth_status === '账户已禁用' ||
    status.auth_status === '需要重新登录' ||
    status.sync_status === '连接失败' ||
    status.sync_status === '凭证不可用' ||
    status.sync_status === '需要重新登录'
  ) {
    return 'offline'
  }
  return null
}
