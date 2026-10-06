import type { AgentUpdateState } from './agent_client.cjs'
import { formatBytes, formatBytesPerSecond } from './byte_format.cjs'

export type TrayUpdatePresentation = {
  headline: string
  detail?: string
  busy: boolean
}

function versionLabel(value?: string) {
  const version = value?.trim()
  if (!version) return ''
  return version.startsWith('v') ? version : `v${version}`
}

export function trayUpdatePresentation(state: AgentUpdateState | null): TrayUpdatePresentation {
  if (!state) return { headline: '状态不可用', busy: false }

  const latest = versionLabel(state.latest_version)
  const current = versionLabel(state.current_version)
  switch (state.status) {
    case 'checking':
      return { headline: '正在检查更新…', busy: true }
    case 'available':
      return { headline: latest ? `发现新版本 ${latest}` : '发现新版本', busy: false }
    case 'up_to_date':
      return { headline: current ? `已是最新 ${current}` : '已是最新', busy: false }
    case 'downloading': {
      const done = Math.max(0, state.bytes_done || 0)
      const total = Math.max(0, state.bytes_total || 0)
      const percent = total > 0 ? Math.max(0, Math.min(100, done * 100 / total)) : null
      const headline = percent === null ? '正在下载更新' : `正在下载 ${percent.toFixed(1)}%`
      const details = []
      if (total > 0) details.push(`已下载 ${formatBytes(done)} / 总大小 ${formatBytes(total)}`)
      else if (done > 0) details.push(`已下载 ${formatBytes(done)}`)
      if ((state.bytes_per_second || 0) > 0) details.push(`当前速度 ${formatBytesPerSecond(state.bytes_per_second || 0)}`)
      return { headline, detail: details.join(' · ') || undefined, busy: true }
    }
    case 'downloaded':
      return { headline: latest ? `${latest} 已下载，等待安装` : '更新已下载，等待安装', busy: false }
    case 'installing':
      return { headline: latest ? `正在安装 ${latest}` : '正在安装更新', busy: true }
    case 'error':
      return { headline: '更新错误', detail: state.last_error || state.message, busy: false }
    case 'idle':
    default:
      return { headline: current ? `当前 ${current} · 等待检查` : '等待检查', busy: false }
  }
}
