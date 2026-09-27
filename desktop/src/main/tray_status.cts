import type { AgentStatus, AgentTransfers, AgentUpdateState } from './agent_client.cjs'

export type TrayStatusKind = 'normal' | 'syncing' | 'paused' | 'conflict' | 'offline'

export function trayStatusIconFile(kind: TrayStatusKind) {
  return `tray-${kind}.png`
}

export function trayStatusKind(
  connected: boolean,
  status: AgentStatus | undefined,
  transfers: AgentTransfers,
  update: AgentUpdateState | null,
): TrayStatusKind {
  if (!connected || !status) return 'offline'
  if (status.has_conflict || status.conflict_count > 0) return 'conflict'
  if (status.paused) return 'paused'
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
  if (
    update?.status === 'checking' ||
    update?.status === 'downloading' ||
    update?.status === 'installing' ||
    transfers.transfers.some((item) => item.state === 'running' || item.state === 'retrying') ||
    status.sync_status.startsWith('正在')
  ) {
    return 'syncing'
  }
  return 'normal'
}
