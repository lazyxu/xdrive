import { Box, Stack, Typography } from '@mui/material'
import type { XDriveStorageIntegrityEvidence } from '../background-tasks'
import { formatBytes } from '../format'

const count = (value: number): string =>
  Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '未知'

/** Authenticated administrator task payload contains counters only; no file
 * identity, SHA, private Host paths or user data are displayed. */
export function XDriveStorageIntegrityReceipt({
  report,
}: {
  report: XDriveStorageIntegrityEvidence
}) {
  const entries = [
    ['缺失对象', report.missing_objects],
    ['大小不匹配', report.size_mismatches],
    ['重复引用异常', report.duplicate_references],
    ['引用/状态漂移', report.reference_drifts],
    ['孤儿对象', report.orphan_objects],
    ['哈希不匹配', report.hash_mismatches],
  ] as const
  return (
    <Box data-xdrive-admin-storage-integrity-receipt>
      <Typography variant="caption" color="text.secondary">
        历史在线存储校验 · {report.mode} · 文件引用 {count(report.referenced_files)} ·
        版本引用 {count(report.referenced_versions)} · 物理对象 {count(report.physical_objects)} ·
        完整 SHA-256 {count(report.hashed_objects)} 个 / {formatBytes(report.hashed_bytes)}
      </Typography>
      <Stack direction="row" gap={1} useFlexGap flexWrap="wrap">
        {entries.map(([label, amount]) => (
          <Typography key={label} variant="caption" color={amount > 0 ? 'error' : 'text.secondary'}>
            {label} {count(amount)}
          </Typography>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        问题合计 {count(report.issue_count)}。这些仅是本次维护任务的分类计数：
        fast 不检测同大小内容篡改；deep 仅对有 SHA-256 引用的原始字节哈希。
        不代表备份仓库验证、PostgreSQL 恢复或当前时刻仍然完整。
      </Typography>
    </Box>
  )
}
