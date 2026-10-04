import { Paper } from '@mui/material'
import {
  XDriveActionButton,
  XDriveDescriptionGrid,
  XDriveDescriptionItem,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveWorkspaceSurface,
} from '@xdrive/ui/mui'

export function DesktopOverviewPage({
  status,
  hello,
  openFolderLoading,
  onOpenFolder,
}: {
  status?: AgentStatus
  hello?: AgentHello
  openFolderLoading: boolean
  onOpenFolder: () => void
}) {
  return (
    <XDriveWorkspaceSurface presentation="page" title="概览">
      <XDriveMetricGrid sx={{ mt: 1.5 }}>
        <XDriveMetricCard
          title="同步"
          value={status?.paused ? '已暂停' : status?.sync_status || '未知'}
          tone={status?.paused ? 'warning' : 'good'}
        />
        <XDriveMetricCard
          title="冲突"
          value={status?.conflict_count || 0}
          suffix="个未解决"
          tone={status?.has_conflict ? 'warning' : 'good'}
        />
        <XDriveMetricCard
          title="Agent"
          value={status?.auth_status || '未知'}
          suffix={`v${hello?.agent_version || status?.version || '?'} · IPC ${hello?.protocol_min ?? '?'}-${hello?.protocol_max ?? '?'}`}
          tone="good"
        />
        <XDriveMetricCard
          title="桌面桥接"
          value="已连接"
          suffix="已通过受保护的本地 IPC 连接。"
          tone="good"
        />
      </XDriveMetricGrid>

      <Paper variant="outlined" sx={{ mt: 2.25, p: 2.75, borderRadius: 2 }}>
        <XDriveSectionHeader
          eyebrow="同步位置"
          title={status?.mount_path || '默认 xDrive 文件夹'}
          actions={(
            <XDriveActionButton
              loading={openFolderLoading}
              loadingLabel="正在打开…"
              onClick={onOpenFolder}
            >
              打开
            </XDriveActionButton>
          )}
        />
        <XDriveDescriptionGrid columns={4} sx={{ mt: 2.5 }}>
          <XDriveDescriptionItem label="服务器">{status?.server}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="用户">{status?.username}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="状态">{status?.paused ? '已暂停' : status?.sync_status}</XDriveDescriptionItem>
          <XDriveDescriptionItem label="修订号">{status?.revision}</XDriveDescriptionItem>
        </XDriveDescriptionGrid>
      </Paper>
    </XDriveWorkspaceSurface>
  )
}
