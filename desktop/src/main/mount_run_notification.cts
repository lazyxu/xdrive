import type { AgentSyncRun } from './agent_client.cjs'
import type { DesktopSyncNotificationLevel } from './window_preferences.cjs'
import { formatBytes } from './byte_format.cjs'

export type MountRunNotificationTarget = {
  kind: 'mount-run'
  runID: string
  server: string
  username: string
}

const mountRunIDShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function mountRunNotificationTarget(
  runID: string, owner: { server?: string; username?: string },
): MountRunNotificationTarget | null {
  const id = typeof runID === 'string' ? runID.trim() : ''
  const server = owner.server?.trim() ?? ''
  const username = owner.username?.trim() ?? ''
  if (!mountRunIDShape.test(id) || !server || !username) return null
  return { kind: 'mount-run', runID: id, server, username }
}

function count(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

export function mountRunIsTerminal(status: string) {
  return status === 'completed' || status === 'partial' ||
    status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

// A state-string transition is never a durable sync receipt. Successful
// notifications require recorded file changes, not an empty reconciliation.
export function mountRunShouldNotify(
  run: AgentSyncRun, level: DesktopSyncNotificationLevel,
): boolean {
  if (!mountRunIsTerminal(run.status)) return false
  const s = run.stats
  if (run.status === 'failed' || run.status === 'partial' || run.status === 'interrupted' ||
      count(s.failed) > 0 || count(s.conflicted) > 0) return true
  if (run.status === 'cancelled') return level === 'all'
  if (level === 'errors-only') return false
  if (level === 'all') return true
  return count(s.created) + count(s.updated) + count(s.moved) +
    count(s.renamed) + count(s.deleted) > 0
}

export function mountRunNotificationPresentation(run: AgentSyncRun) {
  if (!mountRunIsTerminal(run.status)) return null
  const s = run.stats
  const issues = run.status === 'failed' || run.status === 'partial' ||
    run.status === 'interrupted' || count(s.failed) > 0 || count(s.conflicted) > 0
  const actionCounts: Array<[string, number]> = [
    ['新增', s.created], ['更新', s.updated], ['移动', s.moved],
    ['重命名', s.renamed], ['删除', s.deleted],
  ]
  const hasFileChanges = actionCounts.some(([, value]) => count(value) > 0)
  const title = issues ? 'xDrive · 同步需要处理'
    : run.status === 'cancelled' ? 'xDrive · 同步已取消'
      : hasFileChanges ? 'xDrive · 文件同步完成' : 'xDrive · 同步检查结束'
  const parts = actionCounts.filter(([, value]) => count(value) > 0)
    .map(([label, value]) => `${label} ${count(value).toLocaleString('zh-CN')}`)
  // Network transfer direction and logical mutations can overlap: show them
  // separately and never sum them as a purported number of distinct files.
  if (count(s.uploaded) > 0) parts.push(`上传 ${count(s.uploaded).toLocaleString('zh-CN')}`)
  if (count(s.downloaded) > 0) parts.push(`下载 ${count(s.downloaded).toLocaleString('zh-CN')}`)
  if (s.transferred_bytes !== null && Number.isFinite(s.transferred_bytes) && s.transferred_bytes > 0) {
    parts.push(`实际传输 ${formatBytes(s.transferred_bytes)}`)
  }
  if (count(s.failed) > 0) parts.push(`失败 ${count(s.failed).toLocaleString('zh-CN')}`)
  if (count(s.conflicted) > 0) parts.push(`冲突 ${count(s.conflicted).toLocaleString('zh-CN')}`)
  if (count(s.skipped) > 0) parts.push(`跳过 ${count(s.skipped).toLocaleString('zh-CN')}`)
  const intro = issues ? '本轮同步未完全成功'
    : run.status === 'cancelled' ? '本轮同步已取消'
      : parts.length > 0 ? '本轮已记录的文件变更'
        : run.detail_complete && run.outcome === 'no_change'
          ? '本轮检查未发现文件变更'
          : '本轮未记录逐项变更；不能据此断言没有变化'
  return {
    title,
    body: [intro, parts.join(' · '), '点击查看本次同步活动与逐项明细。'].filter(Boolean).join('\n'),
  }
}

// The poller is an observer, not a second SyncRun author. Seed the first page
// without re-notifying past history. A new terminal must have finished since
// the preceding successful observation, and within a bounded freshness window.
// Retain seen run IDs through monitor restarts; reset only on Owner changes.
export class MountRunNotificationTracker {
  private identity = ''
  private observedAt = 0
  private seen = new Map<string, string>()

  reset() {
    this.identity = ''
    this.observedAt = 0
    this.seen.clear()
  }

  observe(identity: string, rows: readonly AgentSyncRun[], now = Date.now()): AgentSyncRun[] {
    if (!identity) {
      this.reset()
      return []
    }
    const first = this.identity !== identity || this.observedAt === 0
    if (first) {
      this.identity = identity
      this.seen.clear()
    }
    const notifications: AgentSyncRun[] = []
    for (const run of rows) {
      if (!mountRunIDShape.test(run.run_id)) continue
      const previousStatus = this.seen.get(run.run_id)
      if (!first && mountRunIsTerminal(run.status) &&
          (!previousStatus || previousStatus === 'running')) {
        const finishedAt = Date.parse(run.finished_at ?? '')
        if (Number.isFinite(finishedAt) && finishedAt >= this.observedAt - 2000 &&
            finishedAt <= now + 2000 && now - finishedAt <= 120_000) {
          notifications.push(run)
        }
      }
      // Reinsert to keep the most recently observed IDs when bounding memory.
      this.seen.delete(run.run_id)
      this.seen.set(run.run_id, run.status)
    }
    while (this.seen.size > 500) {
      const oldest = this.seen.keys().next().value
      if (!oldest) break
      this.seen.delete(oldest)
    }
    this.observedAt = now
    return notifications.reverse()
  }
}
