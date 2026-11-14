import type { XDriveLocalBoundBackupSchedule } from './device-backups'

export type XDriveLocalBackupAutoReadinessView = {
  title: string
  detail: string
  needsAttention: boolean
  /** Existing Agent's rule time only; not a promised operation start time. */
  nextScheduledAt?: string
}

/** Every answer is a current owning-Agent read of a *saved* schedule.
 * Neither historical SourceRuns nor the browser clock are used to invent
 * a trusted private checkpoint, operating health or completed backup. */
export function xDriveLocalBackupAutoReadinessView(
  schedule: XDriveLocalBoundBackupSchedule,
): XDriveLocalBackupAutoReadinessView {
  const fail = (detail: string): XDriveLocalBackupAutoReadinessView => ({
    title: '自动备份就绪状态未核实', detail, needsAttention: true,
  })
  if (!schedule || !Number.isSafeInteger(schedule.source_id) ||
    schedule.source_id < 1 || !Number.isSafeInteger(schedule.revision) ||
    schedule.revision < 1 || !['', 'manual', 'interval', 'cron'].includes(schedule.schedule_type)) {
    return fail('当前本机 Source 或计划版本不可验证，请刷新所属 Agent。')
  }
  const active = schedule.schedule_type === 'interval' || schedule.schedule_type === 'cron'
  const status = schedule.auto_readiness
  if (status === undefined || status === 'unavailable') {
    return fail('此 Agent 尚未提供可信检查点的就绪结论；计划已保存不代表已自动运行。')
  }
  if (schedule.next_scheduled_at !== undefined && status !== 'checkpoint_ready') {
    return fail('本机 Agent 返回的计划执行信息不一致，不能据此安排上传。')
  }
  switch (status) {
    case 'manual':
      if (schedule.schedule_type !== 'manual') break
      return {
        title: '仅手动备份', detail: '已关闭自动计划。本机原件不会因计划配置而自动上传。',
        needsAttention: false,
      }
    case 'not_enabled':
      if (schedule.schedule_type !== '') break
      return {
        title: '自动计划未启用',
        detail: '历史默认值并不表示本机已授权自动备份。',
        needsAttention: false,
      }
    case 'ineligible_source':
      if (!active) break
      return {
        title: '自动备份条件不足',
        detail: '该 Source 非 Backup 模式或尚未绑定有效云端目标；请检查本机配置。',
        needsAttention: true,
      }
    case 'checkpoint_unverified':
      if (!active) break
      return {
        title: '需要本机检查点核对',
        detail: '当前版本没有可信的私有备份检查点。可能尚未完成首次手动备份，或版本、原始记录已变化；请先从本机核对，不会盲目自动上传。',
        needsAttention: true,
      }
    case 'revision_rebaseline_pending':
      if (!active) break
      return {
        title: '计划版本变更，待建立新基线',
        detail: '所属 Agent 已核对上一版本的私有清洁检查点。后台将重新扫描，并以当前版本认证读取历史已提交的原始 Operation；不会复制旧版完成状态。',
        needsAttention: true,
      }
    case 'reconciliation_pending':
      if (!active) break
      return {
        title: '后台安全恢复等待中',
        detail: '上次 Agent 中断或遇到不确定上传。后台会按持久退避重新进入原始 Operation 核对；当前还没有确认完整备份，也不会直接生成新的操作 ID。',
        needsAttention: true,
      }
    case 'review_required':
      if (!active) break
      return {
        title: '自动备份暂停，需核对收据',
        detail: '最近批次可能正在处理、已暂停或取消，或存在不确定的原始上传收据。必须由所属 Agent 核对，不能直接创建新上传任务。',
        needsAttention: true,
      }
    case 'checkpoint_ready': {
      if (!active || typeof schedule.next_scheduled_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          schedule.next_scheduled_at)) break
      const timestamp = Date.parse(schedule.next_scheduled_at)
      if (!Number.isFinite(timestamp)) break
      return {
        title: '当前版本的可信备份检查点已核实',
        detail: '已根据私有检查点和当前规则计算计划到期时间；并不保证 Agent 同时启动。联网状态、其他任务和持久冷却仍会在实际调度时重新检查。',
        nextScheduledAt: new Date(timestamp).toISOString(),
        needsAttention: false,
      }
    }
  }
  return fail('本机计划就绪结论与保存的模式不一致；请重新读取，不会据此假定自动备份完成。')
}
