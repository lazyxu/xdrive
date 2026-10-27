import { Box, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveDeviceBackupRun, XDriveLocalBackupCommonBatchHistoryItem } from '../device-backups'
import { xDriveDeviceBackupRunLabel } from './DeviceBackupFolderSummary'

// Distinct, honest source models share ONE presentation. Local Agent receipts
// are not Server SyncRuns, CAS proofs or remote-device authorizations.
export type XDriveDeviceBackupHistoryEntry =
  | { kind: 'server'; run: XDriveDeviceBackupRun }
  | { kind: 'local-receipt'; run: XDriveLocalBackupCommonBatchHistoryItem }

function historyTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')
}

export function XDriveDeviceBackupHistoryList({
  sourceID, entries, loading = false, verified = false, error,
  emptyMessage = '暂无历史记录。',
}: {
  sourceID: number
  entries: readonly XDriveDeviceBackupHistoryEntry[]
  loading?: boolean
  verified?: boolean
  error?: string
  emptyMessage?: string
}) {
  return (
    <Box data-xdrive-device-backup-history-list={sourceID}
      aria-busy={loading || undefined} sx={{ minHeight: 72 }}>
      {entries.map((entry) => {
        if (entry.kind === 'server') {
          const run = entry.run
          return (
            <Box key={`server:${run.id}`} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="body2">
                {xDriveDeviceBackupRunLabel(run.status)} · {historyTime(run.started_at)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                扫描 {run.scanned_items} 项
                {' · '}传输 {run.transferred_items} 项 / {formatBytes(run.transferred_bytes)}
                {' · '}失败 {run.failed_items} 项
              </Typography>
            </Box>
          )
        }
        const run = entry.run
        return (
          <Box key={`receipt:${run.run_id}`} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="body2">
              {xDriveDeviceBackupRunLabel(run.state)} · {historyTime(run.finished_at)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              已上传 {run.confirmed_files} · 已跳过 {run.skipped_files} ·
              待核对 {run.uncertain_files} · {formatBytes(run.confirmed_bytes)}
            </Typography>
          </Box>
        )
      })}
      {!loading && entries.length === 0 && verified && !error ? (
        <Typography variant="body2" color="text.secondary">{emptyMessage}</Typography>
      ) : null}
      {error ? (
        <Typography variant="caption" color="error">{error}</Typography>
      ) : null}
    </Box>
  )
}
