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


export function taskbarOverlayDataURL(kind: Exclude<TaskbarOverlayKind, null>) {
  const body = kind === 'conflict'
    ? '<circle cx="16" cy="16" r="13" fill="#E5484D" stroke="#FFFFFF" stroke-width="3"/><path d="M16 8.5V18" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/><circle cx="16" cy="23" r="2" fill="#FFFFFF"/>'
    : '<circle cx="16" cy="16" r="13" fill="#667085" stroke="#FFFFFF" stroke-width="3"/><path d="M9 23L23 9" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
