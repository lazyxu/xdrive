import { Stack, Typography } from '@mui/material'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatusAlert } from './StatusAlert'

// P0-A1: no unsafe generic Source API is allowed in this placeholder.
// A follow-up connects the owner-scoped redacted device-backup read API.
export function XDriveDeviceBackupPage() {
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="设备备份"
      subtitle="电脑主动备份与其他设备只读状态"
    >
      <Stack spacing={2}>
        <XDriveStatusAlert tone="neutral">
          设备和同步文件夹的只读视图正在接入安全接口。当前不能从 Web 或异机 Desktop 配置、启动、取消或删除 Push 备份。
        </XDriveStatusAlert>
        <Typography variant="subtitle2" fontWeight={700}>本机同步文件夹</Typography>
        <Typography variant="body2" color="text.secondary">
          本机目录授权与扫描基础已就绪，真正上传执行器、试扫描和自动调度尚未启用。
        </Typography>
        <Typography variant="subtitle2" fontWeight={700}>NAS 备份 · 待支持</Typography>
        <Typography variant="body2" color="text.secondary">
          NAS Push 由 NAS 本地配置和运行。本轮只预留 UI，不修改既有 NAS 来源、传输或历史。
        </Typography>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
