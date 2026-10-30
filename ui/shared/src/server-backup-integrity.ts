import type {
  XDriveServerBackupHistoryEntry, XDriveServerBackupPage,
  XDriveServerBackupSnapshot,
} from './server-backup-admin'

/**
 * Treat task success and proven backup-byte verification separately. Old Host
 * histories may contain a success flag without a structured verification
 * receipt; no Admin surface may count that as an integrity pass.
 */
export type XDriveServerBackupVerificationEvidence = 'passed' | 'failed' | 'unattested'

export function classifyServerBackupVerificationEvidence(
  entry: XDriveServerBackupHistoryEntry,
): XDriveServerBackupVerificationEvidence {
  if (entry.action !== 'verify') return 'unattested'
  // Even without a structured receipt, an actual Host failure is a failure.
  if (entry.state === 'failed' || entry.verification?.state === 'failed') return 'failed'
  const proof = entry.verification
  const id = entry.snapshot_id || ''
  const expected = id.startsWith('v1:') ? 'v1' :
    (id.startsWith('v2-default:') || id.startsWith('v2-configured:')) ? 'v2' : null
  if (entry.state !== 'success' || !proof || !expected ||
      proof.protocol !== 'xdrive-host-backup-verify-v1' ||
      proof.state !== 'success' || proof.format !== expected ||
      proof.scope !== 'backup_snapshot_and_referenced_cas' ||
      (proof.failure_category !== undefined && proof.failure_category !== '') ||
      !Number.isSafeInteger(proof.cas_objects_checked) || proof.cas_objects_checked < 0 ||
      !Number.isSafeInteger(proof.cas_bytes_hashed) || proof.cas_bytes_hashed < 0 ||
      (expected === 'v1' && (proof.cas_objects_checked !== 0 || proof.cas_bytes_hashed !== 0))) {
    return 'unattested'
  }
  return 'passed'
}

/**
 * Counts only Host-discovered snapshots. A structurally complete generation or
 * a previous successful verification is never treated as current integrity
 * evidence: bytes can change after the last receipt.
 */
export type XDriveServerBackupIntegritySummary = {
  snapshots: number
  fullCandidates: number
  databaseOnly: number
  incomplete: number
  inconsistent: number
  historicalPassed: number
  historicalFailed: number
  withoutRecentReceipt: number
  newestFullID: string | null
  needsAttention: boolean
}

export function summarizeServerBackupIntegrity(
  page: XDriveServerBackupPage,
): XDriveServerBackupIntegritySummary {
  const snapshots = page.inventory.snapshots
  const lastVerify = new Map<string, XDriveServerBackupHistoryEntry>()
  for (const entry of page.history || []) {
    if (entry.action !== 'verify' || !entry.snapshot_id) continue
    const previous = lastVerify.get(entry.snapshot_id)
    // Host currently writes newest first; compare timestamps anyway so a
    // reordered but otherwise valid bounded history cannot show stale success.
    if (!previous || (entry.finished_at || '') > (previous.finished_at || '')) {
      lastVerify.set(entry.snapshot_id, entry)
    }
  }

  let fullCandidates = 0
  let databaseOnly = 0
  let incomplete = 0
  let inconsistent = 0
  let historicalPassed = 0
  let historicalFailed = 0
  let withoutRecentReceipt = 0
  let newestFull: XDriveServerBackupSnapshot | undefined

  for (const snapshot of snapshots) {
    if (snapshot.state === 'inconsistent') {
      inconsistent++
    } else if (snapshot.state !== 'complete') {
      incomplete++
    } else if (!snapshot.file_data_included) {
      databaseOnly++
    } else {
      fullCandidates++
      if (!newestFull || snapshot.created_at > newestFull.created_at) {
        newestFull = snapshot
      }
    }

    const receipt = lastVerify.get(snapshot.id)
    const evidence = receipt ? classifyServerBackupVerificationEvidence(receipt) : 'unattested'
    if (evidence === 'passed') historicalPassed++
    else if (evidence === 'failed') historicalFailed++
    else withoutRecentReceipt++
  }

  return {
    snapshots: snapshots.length,
    fullCandidates,
    databaseOnly,
    incomplete,
    inconsistent,
    historicalPassed,
    historicalFailed,
    withoutRecentReceipt,
    newestFullID: newestFull?.id || null,
    needsAttention: fullCandidates === 0 || incomplete > 0 ||
      inconsistent > 0 || historicalFailed > 0 || withoutRecentReceipt > 0,
  }
}

/** Pick actual latest completed Host verification, not array display order. */
export function latestServerBackupVerification(
  history: XDriveServerBackupPage['history'],
  snapshotID: string,
): XDriveServerBackupHistoryEntry | undefined {
  let latest: XDriveServerBackupHistoryEntry | undefined
  for (const entry of history || []) {
    if (entry.action !== 'verify' || entry.snapshot_id !== snapshotID) continue
    if (!latest || (entry.finished_at || '') > (latest.finished_at || '')) latest = entry
  }
  return latest
}

/** A historical verification receipt is never proof that an older snapshot
 * is currently complete or restorable. The Host owns action/status/timestamps. */
export function serverBackupHistoricalVerificationLabel(
  history: XDriveServerBackupPage['history'], snapshotID: string,
): string {
  const latest = latestServerBackupVerification(history, snapshotID)
  if (!latest) return '未见历史校验'
  const evidence = classifyServerBackupVerificationEvidence(latest)
  const outcome = evidence === 'passed' ? '历史通过' :
    evidence === 'failed' ? '历史失败' : '历史结果未证实'
  const mode = latest.mode === 'deep' ? 'deep' : latest.mode === 'fast' ? 'fast' : '级别未知'
  const date = latest.finished_at ? new Date(latest.finished_at).toLocaleString() : '时间未知'
  return outcome + ' · ' + mode + ' · ' + date +
    (evidence === 'passed' ? '（结构化校验凭据）' :
      evidence === 'unattested' ? '（缺少可信结构化校验凭据）' : '')
}

/** Duration is computed only from the two authentic Host timestamps. */
export function serverBackupReceiptDurationSeconds(
  entry: XDriveServerBackupHistoryEntry,
): number | null {
  const start = Date.parse(entry.started_at || '')
  const finish = Date.parse(entry.finished_at || '')
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null
  return Math.round((finish - start) / 1000)
}

/** Explain only authenticated structured error codes; never expose a raw Host log. */
export function serverBackupReceiptExplanation(
  entry: XDriveServerBackupHistoryEntry,
): string {
  if (entry.state === 'success') {
    if (entry.action === 'verify') {
      return classifyServerBackupVerificationEvidence(entry) === 'passed'
        ? '宿主机记录这次校验通过，并附有结构化完整性凭据。历史结果不保证快照当前仍然完整，恢复时必须重新校验。'
        : '宿主机记录操作成功，但缺少可信结构化校验凭据；不能视为备份完整性通过，请重新运行验证。'
    }
    if (entry.action === 'delete_selected') {
      return entry.selected_delete
        ? '宿主机持久化了所选 v2 快照的精确退役回执；清理数量为历史逻辑字节，保留快照当前完整性仍需重新校验。'
        : '缺少经服务端校验的删除回执，不应将历史状态解释为可信的删除成功。'
    }
    return '宿主机记录该操作完成。创建备份成功不等于实际恢复演练通过。'
  }
  switch (entry.error_code) {
    case 'lock_busy':
      return '宿主机备份、安装或定时任务锁正在被占用；未开始并行修改。'
    case 'deep_preview_missing_or_stale':
      return '所选 v2 快照的 deep 预览已过期、不匹配或没有可信历史凭据；未授权本次删除。请重新预览后确认。'
    case 'selected_delete_unverified':
      return '指定 v2 删除可能已经发生，但未得到完整可信的删除回执或无法持久化历史。不要自动重试；先核查备份清单和宿主机私有日志。'
    case 'interrupted':
      return '宿主机重启或操作中断，未自动重放危险操作。请重新检查后手动提交。'
    case 'operation_failed':
      return '宿主机报告执行失败；具体原因仅保存在宿主机私有日志，网页不会展示原始路径或日志。'
    default:
      return '宿主机报告失败；该历史记录没有可公开的结构化失败分类。'
  }
}
