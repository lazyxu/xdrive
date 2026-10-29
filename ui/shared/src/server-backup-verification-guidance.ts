import type { XDriveServerBackupHistoryEntry } from './server-backup-admin'

export type XDriveBackupVerificationGuidance = {
  scope: string
  nextAction: string
  needsAttention: boolean
}

const reasons: Record<string, string> = {
  missing_object: '备份仓库存在缺失对象。先停止针对该仓库的清理操作，保留现场并检查其他已验证恢复点。',
  object_sha256_mismatch: '备份对象内容与 SHA-256 不符。不要把该快照作为可靠恢复点；保留证据并检查独立的有效备份。',
  object_size_mismatch: '备份对象大小不一致。保留当前快照和仓库，核实原始备份及其他完整恢复点。',
  unsafe_repository: '备份仓库路径结构不安全。仅由宿主机管理员检查目录和符号链接，不能在浏览器直接修改路径。',
  unsafe_snapshot: '快照目录结构不安全。禁止恢复或清理该代，先由宿主机管理员检查。',
  unsafe_object_bucket: 'CAS 对象分桶路径不安全。停止操作该仓库，并在宿主机检查目录结构。',
  unreadable_or_unsafe_object: '备份对象无法读取或文件类型不安全。由宿主机管理员核对权限和真实对象，不要自动重建原始内容。',
  object_read_failed: '备份对象读取中断。检查磁盘、权限和宿主机日志，再重新执行只读校验。',
  measurement_overflow: '校验计数超过安全范围。不要采用该报告评估恢复能力，检查宿主机版本与数据规模。',
  invalid_object_index: 'CAS 对象索引不合法。该代不能视作可靠恢复点，应检查 Manifest 和独立恢复点。',
  invalid_legacy_archive: '归档路径或结构不可信。先检查备份生成过程，不要执行破坏性恢复。',
  snapshot_outside_repository: '快照不属于受信任的备份仓库。不要从浏览器传入宿主机路径或尝试恢复。',
  invalid_cas_report: 'CAS 校验报告结构无效。不能根据这次操作声称数据完整，应检查宿主机版本。',
  snapshot_verification_failed: '快照校验失败。查看宿主机私有日志并重新校验，不应将本代作为可靠恢复点。',
}

/** Only fixed, public diagnostic categories. Do not echo private Host paths,
 * raw error messages, object digests or untrusted arbitrary strings. */
export function backupVerificationGuidance(
  entry: XDriveServerBackupHistoryEntry,
): XDriveBackupVerificationGuidance {
  const receipt = entry.verification
  if (!receipt) return {
    scope: '旧版记录没有可信的结构化范围凭据。',
    nextAction: '重新对选中快照运行校验；历史成功文字不能证明当前内容完整。',
    needsAttention: entry.state === 'failed',
  }
  const scope = receipt.format === 'v1'
    ? 'v1 快照归档与 SHA256SUMS（没有独立的 CAS 引用计数）。'
    : entry.mode === 'deep'
      ? 'v2 快照及引用的 CAS 完整字节，额外请求独立仓库对象深查；实际完成范围以结果为准。'
      : entry.mode === 'fast'
        ? 'v2 快照及其引用 CAS 的字节校验；不声称已覆盖未引用的仓库 CAS。'
        : 'v2 校验级别未知；不能推断是否深查仓库未引用对象。'
  if (receipt.state === 'failed') {
    return {
      scope,
      nextAction: reasons[receipt.failure_category || ''] ||
        '校验失败且没有已知安全分类。暂停依赖该快照恢复，查看宿主机私有日志。',
      needsAttention: true,
    }
  }
  if (entry.state !== 'success') return {
    scope,
    nextAction: '快照/引用 CAS 阶段虽有成功凭据，但管理员操作整体失败；检查后续步骤，不能宣称验证通过。',
    needsAttention: true,
  }
  return {
    scope,
    nextAction: '当前展示的是历史只读检查。恢复前必须重新验证所选快照，并实际演练 PostgreSQL 与文件恢复。',
    needsAttention: false,
  }
}
