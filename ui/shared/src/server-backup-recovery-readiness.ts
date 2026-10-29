import type {
  XDriveServerBackupHistoryEntry, XDriveServerBackupPage, XDriveServerBackupSnapshot,
} from './server-backup-admin'
import type { XDriveBackupRecoveryEvidence } from './server-backup-recovery-evidence'

export type XDriveBackupRecoveryReadiness = {
  state: 'none' | 'unsafe' | 'verify_failed' | 'verify_unattested' |
    'v1_historical_only' | 'drill_failed' | 'drill_missing' | 'v2_historical_only'
  label: string
  action: string
}

/** One strictly bound Host-isolated v2 restore receipt for both the recovery
 * advice and the evidence table. This is historical proof only, never
 * authorization to restore or proof of current data integrity. */
export function isTrustedServerBackupIsolatedDrill(
  event: XDriveServerBackupHistoryEntry | null,
  snapshot: XDriveServerBackupSnapshot | undefined,
): boolean {
  const proof = event?.drill
  if (!event || !snapshot || !proof) return false
  const started = Date.parse(proof.started_at)
  const finished = Date.parse(proof.finished_at)
  return snapshot.format === 'v2' &&
    snapshot.state === 'complete' && snapshot.file_data_included === true &&
    event.action === 'drill' && event.snapshot_id === snapshot.id &&
    event.state === 'success' &&
    proof.protocol === 'xdrive-host-isolated-drill-v1' &&
    proof.state === 'success' &&
    proof.environment === 'host_ephemeral_offline_tmpfs' &&
    proof.snapshot === snapshot.name &&
    proof.files_restored === true && proof.postgresql_restored === true &&
    proof.production_verified === false &&
    Number.isInteger(proof.max_mib) && proof.max_mib > 0 && proof.max_mib <= 1024 &&
    proof.failure_category === '' &&
    Number.isFinite(started) && Number.isFinite(finished) && finished >= started
}

/** Conservative, historical-only preparation advice. This never authorizes
 * production restore or replaces the Host's independent destructive preflight. */
export function assessServerBackupRecoveryReadiness(
  page: XDriveServerBackupPage,
  evidence: XDriveBackupRecoveryEvidence,
  snapshotID: string,
): XDriveBackupRecoveryReadiness {
  const snapshot = page.inventory.snapshots.find(item => item.id === snapshotID)
  if (!snapshot || evidence.snapshotKind === 'none') {
    return {
      state: 'none',
      label: '尚未选择当前宿主机发现的恢复候选',
      action: '选择已发现的备份快照。不能从其他账户或旧宿主机的历史记录推断可恢复性。',
    }
  }
  if (snapshot.state !== 'complete' || !snapshot.file_data_included ||
      evidence.snapshotKind !== 'complete_candidate') {
    return {
      state: 'unsafe',
      label: '当前快照不是完整文件与数据库的恢复候选',
      action: '先诊断缺失、损坏或数据库专用归档；禁止将不完整快照当作整机恢复点。',
    }
  }

  const verify = evidence.lastVerify
  const proof = verify?.verification
  if (verify?.state === 'failed' || proof?.state === 'failed') {
    return {
      state: 'verify_failed',
      label: '最近一次宿主机校验失败（历史）',
      action: '先排查快照、索引和 CAS 的失败分类，再重新执行验证；历史失败不能被更早的成功遮盖。',
    }
  }
  if (!verify || verify.state !== 'success' || !proof ||
      proof.protocol !== 'xdrive-host-backup-verify-v1' ||
      proof.state !== 'success' || proof.format !== snapshot.format ||
      proof.scope !== 'backup_snapshot_and_referenced_cas' ||
      (proof.failure_category !== undefined && proof.failure_category !== '') ||
      !Number.isSafeInteger(proof.cas_objects_checked) || proof.cas_objects_checked < 0 ||
      !Number.isSafeInteger(proof.cas_bytes_hashed) || proof.cas_bytes_hashed < 0 ||
      (snapshot.format === 'v1' && (proof.cas_objects_checked !== 0 || proof.cas_bytes_hashed !== 0))) {
    return {
      state: 'verify_unattested',
      label: '尚无可信的结构化备份完整性校验成功凭据',
      action: '先运行所选备份校验。旧版仅有成功文字的历史记录不足以证明实际 CAS/校验和覆盖。',
    }
  }
  if (snapshot.format === 'v1') {
    return {
      state: 'v1_historical_only',
      label: '已记录 v1 备份校验成功（历史），未证明数据库可恢复',
      action: '执行独立受控的 v1 恢复演练；当前页面的隔离演练按钮只支持 v2。正式恢复仍需重新校验。',
    }
  }

  const drill = evidence.lastDrill
  if (drill?.state === 'failed' || drill?.drill?.state === 'failed') {
    return {
      state: 'drill_failed',
      label: '最近一次 v2 隔离恢复演练失败（历史）',
      action: '先查看真实 Host 演练失败分类并修复，再重新执行文件与 PostgreSQL 的离线恢复演练。',
    }
  }
  if (!isTrustedServerBackupIsolatedDrill(drill, snapshot)) {
    return {
      state: 'drill_missing',
      label: '存在历史校验，但缺少可信的 v2 离线恢复演练成功凭据',
      action: '运行所选 v2 备份隔离演练，实际恢复文件与 PostgreSQL；仅有 SHA-256 校验并不证明可恢复。',
    }
  }
  return {
    state: 'v2_historical_only',
    label: '已具备历史校验和隔离恢复演练证据，当前完整性仍未知',
    action: '这些证据只属于当时的快照和 Host 环境。正式恢复前必须重新验证目标快照，并保留恢复前安全备份；不能将历史结果标记为当前生产验收通过。',
  }
}
