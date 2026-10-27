import { Box, Typography } from '@mui/material'
import { formatBytes } from '../format'
import type { XDriveDeviceBackupFolder } from '../device-backups'

// Desktop and DSM use the same folder heading. The DSM adapter never invents
// a cloud destination or an earlier run when those fields are unavailable.
type FolderHeader = Pick<XDriveDeviceBackupFolder, 'name' | 'sync_mode'> &
  Partial<Pick<XDriveDeviceBackupFolder, 'target_path' | 'latest_run'>>

export function xDriveDeviceBackupRunLabel(status: string): string {
  const labels: Record<string, string> = {
    running: '运行中', completed: '已完成', partial: '部分完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
    uncertain: '结果待核对',
  }
  return labels[status] ?? '未知状态'
}

export function XDriveDeviceBackupFolderSummary({
  folder, targetUnavailableLabel = '尚未配置',
  historyUnavailableLabel = '尚无运行记录',
}: {
  folder: FolderHeader
  targetUnavailableLabel?: string
  historyUnavailableLabel?: string
}) {
  const run = folder.latest_run
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" fontWeight={700}>{folder.name}</Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        云端目标：{folder.target_path || targetUnavailableLabel} ·
        {' '}{folder.sync_mode === 'mirror' ? '镜像' : '备份'}
      </Typography>
      {run ? (
        <Typography variant="caption" color="text.secondary" display="block">
          {xDriveDeviceBackupRunLabel(run.status)}
          {' · '}扫描 {run.scanned_items.toLocaleString('zh-CN')} 项
          {' · '}传输 {formatBytes(run.transferred_bytes)}
          {' · '}失败 {run.failed_items} 项
        </Typography>
      ) : <Typography variant="caption" color="text.secondary">{historyUnavailableLabel}</Typography>}
      {run?.status === 'running' && run.active_transfer_total_bytes > 0 ? (
        <Typography variant="caption" color="text.secondary" display="block">
          当前传输 {formatBytes(run.active_transfer_bytes)}
          {' / '}{formatBytes(run.active_transfer_total_bytes)}
        </Typography>
      ) : null}
    </Box>
  )
}
