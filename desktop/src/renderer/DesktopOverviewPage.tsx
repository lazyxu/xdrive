import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import { Box, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { formatBytes } from '@xdrive/shared'
import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatusAlert,
  XDriveWorkspaceSurface,
} from '@xdrive/ui/mui'

function recentTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}

function cloudUsageLabel(quota?: AgentCloudQuota | null) {
  if (!quota) return '—'
  if (quota.quota_bytes > 0) {
    return `${formatBytes(quota.physical_used_bytes)} / ${formatBytes(quota.quota_bytes)}`
  }
  return formatBytes(quota.physical_used_bytes)
}

export function DesktopOverviewPage({
  status,
  quota,
  activeTaskCount,
  recentSupported,
  favoritesSupported,
  openFolderLoading,
  onOpenFolder,
  onOpenFiles,
  onOpenGallery,
  onOpenTransfers,
  onOpenConflicts,
  onError,
}: {
  status?: AgentStatus
  quota?: AgentCloudQuota | null
  activeTaskCount: number
  recentSupported: boolean
  favoritesSupported: boolean
  openFolderLoading: boolean
  onOpenFolder: () => void
  onOpenFiles: () => void
  onOpenGallery: () => void
  onOpenTransfers: () => void
  onOpenConflicts: () => void
  onError: (message: string) => void
}) {
  const [recentItems, setRecentItems] = useState<AgentCloudRecentItem[]>([])
  const [favoriteItems, setFavoriteItems] = useState<AgentCloudFavoriteItem[]>([])

  useEffect(() => {
    let active = true
    if (recentSupported) {
      void window.xdriveDesktop.agent.cloudFileRecent(6).then((result) => {
        if (!active) return
        if (result.ok) setRecentItems(result.data)
      })
    } else {
      setRecentItems([])
    }
    if (favoritesSupported) {
      void window.xdriveDesktop.agent.cloudFileFavorites().then((result) => {
        if (!active) return
        if (result.ok) setFavoriteItems(result.data.slice(0, 6))
      })
    } else {
      setFavoriteItems([])
    }
    return () => {
      active = false
    }
  }, [favoritesSupported, recentSupported])

  const openCloudItem = async (
    item: AgentCloudRecentItem | AgentCloudFavoriteItem,
  ) => {
    const relativePath = item.path.replace(/^\/+/, '')
    if (!relativePath) {
      onOpenFiles()
      return
    }
    const result = await window.xdriveDesktop.agent.openPath(relativePath)
    if (!result.ok) onError(result.error.message)
  }

  const needsAttention = Boolean(status?.last_error || status?.paused || status?.has_conflict)

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="主页"
      subtitle="继续最近工作，查看同步状态与需要处理的事项。"
    >
      <Stack spacing={2.25}>
        {needsAttention ? (
          <Stack spacing={1}>
            {status?.last_error ? (
              <XDriveStatusAlert tone="bad" title="同步异常">
                {status.last_error}
              </XDriveStatusAlert>
            ) : null}
            {status?.paused ? (
              <XDriveStatusAlert tone="warning" title="同步已暂停">
                此设备当前不会继续后台同步。
              </XDriveStatusAlert>
            ) : null}
            {status?.has_conflict ? (
              <XDriveStatusAlert tone="warning" title="有冲突需要处理">
                {status.conflict_count || 0} 个同步冲突等待处理。
              </XDriveStatusAlert>
            ) : null}
          </Stack>
        ) : null}

        <XDriveMetricGrid>
          <XDriveMetricCard
            title="云端存储"
            value={cloudUsageLabel(quota)}
            suffix={quota?.quota_bytes ? '当前账号' : '不限配额'}
          />
          <XDriveMetricCard
            title="同步"
            value={status?.paused ? '已暂停' : status?.sync_status || '正常'}
            tone={status?.last_error ? 'bad' : status?.paused ? 'warning' : 'good'}
          />
          <XDriveMetricCard
            title="活动任务"
            value={activeTaskCount.toLocaleString()}
            suffix={activeTaskCount > 0 ? '正在进行' : '当前空闲'}
            tone={activeTaskCount > 0 ? 'busy' : 'good'}
          />
          <XDriveMetricCard
            title="冲突"
            value={(status?.conflict_count || 0).toLocaleString()}
            suffix="个未解决"
            tone={status?.has_conflict ? 'warning' : 'good'}
          />
        </XDriveMetricGrid>

        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <XDriveSectionHeader level="h3" title="快捷操作" />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            <XDriveActionButton
              startIcon={<FolderOpenRoundedIcon />}
              loading={openFolderLoading}
              loadingLabel="正在打开…"
              onClick={onOpenFolder}
            >
              打开 xDrive 文件夹
            </XDriveActionButton>
            <XDriveActionButton startIcon={<InsertDriveFileRoundedIcon />} onClick={onOpenFiles}>
              云端文件
            </XDriveActionButton>
            <XDriveActionButton startIcon={<PhotoLibraryRoundedIcon />} onClick={onOpenGallery}>
              图库
            </XDriveActionButton>
            <XDriveActionButton startIcon={<SwapVertRoundedIcon />} onClick={onOpenTransfers}>
              传输
            </XDriveActionButton>
            {status?.has_conflict ? (
              <XDriveActionButton intent="warning" onClick={onOpenConflicts}>
                处理冲突
              </XDriveActionButton>
            ) : null}
          </Stack>
        </Paper>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
            <XDriveSectionHeader
              level="h3"
              title="最近使用"
              actions={<XDriveActionButton compact onClick={onOpenFiles}>查看全部</XDriveActionButton>}
            />
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {recentSupported && recentItems.length > 0 ? recentItems.map((item) => (
                <ListItemButton
                  key={item.node.id}
                  onClick={() => { void openCloudItem(item) }}
                  sx={{ borderRadius: 1, px: 1 }}
                >
                  <ListItemText
                    primary={item.node.name}
                    secondary={[item.path, recentTime(item.accessed_at)].filter(Boolean).join(' · ')}
                    slotProps={{
                      primary: { noWrap: true },
                      secondary: { noWrap: true },
                    }}
                  />
                </ListItemButton>
              )) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  暂无最近访问文件。
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
            <XDriveSectionHeader
              level="h3"
              title="收藏"
              actions={<XDriveActionButton compact onClick={onOpenFiles}>查看全部</XDriveActionButton>}
            />
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {favoritesSupported && favoriteItems.length > 0 ? favoriteItems.map((item) => (
                <ListItemButton
                  key={item.node.id}
                  onClick={() => { void openCloudItem(item) }}
                  sx={{ borderRadius: 1, px: 1 }}
                >
                  <StarRoundedIcon sx={{ mr: 1, fontSize: 18, color: 'text.secondary' }} />
                  <ListItemText
                    primary={item.node.name}
                    secondary={item.path}
                    slotProps={{
                      primary: { noWrap: true },
                      secondary: { noWrap: true },
                    }}
                  />
                </ListItemButton>
              )) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  暂无收藏文件。
                </Typography>
              )}
            </Stack>
          </Paper>
        </Box>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
