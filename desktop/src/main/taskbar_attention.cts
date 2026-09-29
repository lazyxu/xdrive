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

const taskbarOverlayPNGs: Record<Exclude<TaskbarOverlayKind, null>, string> = {
  conflict: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA10lEQVR42u1XyxGEMAgVxiq2Ij24xXrZirQNvGay4Rsz6hiOjuE9HgTIMLzdwHuAiEh0CABNCGjAUSJwNrCXCETA9/lb/P/zW90kwArOgXKWk+FIYAvw0hlOTagBT6O0piVXAj1RSI65/GvqIRd9RHZLILnCeHUnxLPue7SbYiRvtWm4Zwo6gU7A0tWkqtZuDudzTHu0txdEr2s6Dy5PgTgNPbJaB5drGkq1YJ2GWj2htj5ZCrJmK0LLDhchYV3J1KlVsm1aaJuWv2+cPXctv8XDpPXTrNsBVr+73RS3CXMAAAAASUVORK5CYII=',
  offline: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA0UlEQVR42u2XMQ7DIAxFY182c9ceoGvmnpZMlSzEpzZ8C6SWOfAeH4Gd4/j1IdEJpZTSXVBEUgS+gUdFhA2OisgI/Hy8mt+/r2dYQrxwBEWjlkESmgFvzUFpagb8k4BHQiO7iMbfkugKWMNZOEqiTkGZr1rrFrgTmL3vEbhlKePsPXC0pq6InSYwC58SYMCHBVjwIQEmHAqgqjYDR2uqt24zd25ZuiJ2eATWzBYU5kNVJ63Rksp4JbsCtaGVyOiKlrdk+zalW7TlW/yYZP+a/ccNZeWghbGXhbcAAAAASUVORK5CYII=',
}

export function taskbarOverlayPNG(kind: Exclude<TaskbarOverlayKind, null>) {
  return Buffer.from(taskbarOverlayPNGs[kind], 'base64')
}
