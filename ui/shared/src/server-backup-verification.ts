import type { XDriveServerBackupHistoryEntry } from './server-backup-admin'

/** The Host/Server contract contains only bounded physical counts, never paths. */
export function backupVerificationSummary(entry: XDriveServerBackupHistoryEntry): {
  available: boolean
  title: string
  count: number | null
  hashedBytes: number | null
  category: string
  note: string
} {
  const receipt = entry.verification
  if (!receipt) return {
    available: false, title: '该历史操作没有结构化校验证据',
    count: null, hashedBytes: null, category: '',
    note: '较早记录或旧版宿主机可能只包含结果与时间，不能推断对象数量。',
  }
  const classes: Record<string, string> = {
    missing_object: 'CAS 对象缺失',
    object_sha256_mismatch: 'CAS SHA-256 校验失败',
    object_size_mismatch: 'CAS 对象大小不匹配',
    unsafe_repository: '备份仓库目录不安全',
    unsafe_snapshot: '快照目录不安全',
    unsafe_object_bucket: 'CAS 对象目录不安全',
    unreadable_or_unsafe_object: '对象不可读取或类型不安全',
    object_read_failed: 'CAS 读取失败',
    measurement_overflow: '计数超出安全范围',
    invalid_object_index: '对象索引无效',
    invalid_legacy_archive: '旧格式归档无效',
    snapshot_outside_repository: '快照不属于备份仓库',
    invalid_cas_report: 'CAS 报告无效',
    snapshot_verification_failed: '快照元数据或校验失败',
  }
  const count = Number.isSafeInteger(receipt.cas_objects_checked) &&
    receipt.cas_objects_checked >= 0 ? receipt.cas_objects_checked : null
  const hashedBytes = Number.isSafeInteger(receipt.cas_bytes_hashed) &&
    receipt.cas_bytes_hashed >= 0 ? receipt.cas_bytes_hashed : null
  return {
    available: count !== null && hashedBytes !== null,
    title: receipt.state === 'success'
      ? '快照与其引用 CAS 的本次校验通过（历史）'
      : '快照或其引用 CAS 的本次校验失败（历史）',
    count, hashedBytes,
    category: receipt.failure_category
      ? classes[receipt.failure_category] || '未识别的失败类别' : '',
    note: receipt.format === 'v1'
      ? 'v1 使用独立 SHA256SUMS 校验备份文件；CAS 对象数为零不代表没有检查文件。'
      : 'v2 数值为本次引用 CAS 检查的真实计数；失败时为部分计数。deep 模式可能额外审计仓库孤儿对象。',
  }
}
