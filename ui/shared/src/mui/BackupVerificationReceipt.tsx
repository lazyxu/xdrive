import { Alert, Stack, Typography } from '@mui/material'
import type { XDriveServerBackupHistoryEntry } from '../server-backup-admin'
import { backupVerificationSummary } from '../server-backup-verification'
import { backupVerificationGuidance } from '../server-backup-verification-guidance'
import { classifyServerBackupVerificationEvidence } from '../server-backup-integrity'

/** Historical Host evidence; never claim a backup has been physically restored. */
export function XDriveBackupVerificationReceipt({ entry }: {
  entry: XDriveServerBackupHistoryEntry
}) {
  const summary = backupVerificationSummary(entry)
  const guidance = backupVerificationGuidance(entry)
  const evidence = classifyServerBackupVerificationEvidence(entry)
  if (!summary.available || evidence === 'unattested') {
    return <Alert severity="info" data-xdrive-admin-backup-verification-report>
      {evidence === 'unattested' && summary.available
        ? '该历史操作没有可信的结构化校验凭据，不能推断对象数量或备份完整性。'
        : summary.note}
    </Alert>
  }
  const formatBytes = (value: number) =>
    value < 1024 ? value + ' B'
      : (value / 1024 ** Math.floor(Math.log(value) / Math.log(1024))).toFixed(1) +
        ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][
          Math.min(5, Math.floor(Math.log(value) / Math.log(1024)))]
  return <Stack spacing={1} data-xdrive-admin-backup-verification-report>
    <Alert severity={entry.state === 'failed' || entry.verification?.state === 'failed'
      ? 'warning' : 'info'}>
      {summary.title}。该历史凭据不代表当前仍完整，也不代表已完成 PostgreSQL 与文件恢复演练。
    </Alert>
    <Typography variant="body2">
      CAS 检查对象：{summary.count?.toLocaleString()} 个；实际 SHA-256 读取：
      {summary.hashedBytes === null ? '未知' : formatBytes(summary.hashedBytes)}。
    </Typography>
    {summary.category ? <Typography variant="body2" color="error">
      失败分类：{summary.category}
    </Typography> : null}
    <Typography variant="body2" data-xdrive-admin-backup-verification-scope>
      校验范围：{guidance.scope}
    </Typography>
    <Typography variant="body2" color={guidance.needsAttention ? 'error' : 'text.secondary'}
      data-xdrive-admin-backup-verification-next-action>
      {guidance.needsAttention ? '建议优先处理：' : '建议：'}{guidance.nextAction}
    </Typography>
    <Typography variant="caption" color="text.secondary">{summary.note}</Typography>
  </Stack>
}
