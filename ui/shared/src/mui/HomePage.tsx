import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { Box, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { formatBytes } from '../format'
import type { XDriveFileExplorerAvailability } from '../file-explorer-availability'
import { XDriveActionButton } from './ActionButton'
import {
  XDriveFileExplorerAvailabilityBadge,
  XDriveFileExplorerItemIcon,
  xDriveFileSupportsThumbnail,
} from './FileExplorer'
import type { XDriveFileExplorerItem } from './FileExplorer'
import {
  XDriveFileExplorerThumbnail,
  XDriveFileExplorerThumbnailProvider,
} from './FileExplorerThumbnail'
import { XDriveMetricCard, XDriveMetricGrid } from './MetricCards'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatusAlert } from './StatusAlert'
import type { XDriveStatusTone } from './StatusBadge'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export type XDriveHomeAlert = {
  key: string
  tone: XDriveStatusTone
  title: string
  message: ReactNode
}

export type XDriveHomeListItem = {
  item: XDriveFileExplorerItem
  secondary?: ReactNode
  availability?: XDriveFileExplorerAvailability
  onOpen?: () => void
}

export type XDriveHomeQuota = {
  physicalUsedBytes: number
  quotaBytes: number
}

export type XDriveHomeSyncMetric = {
  value: ReactNode
  tone: XDriveStatusTone
}

export function XDriveHomePage({
  lifecycleKey,
  quota,
  sync,
  activeTaskCount,
  conflictCount = 0,
  conflictTone = 'good',
  alerts = [],
  recentActivity,
  recentItems = [],
  favoriteItems = [],
  recentAvailable = true,
  favoritesAvailable = true,
  loadThumbnail,
  openLocalFolderLoading = false,
  onOpenLocalFolder,
  onUploadFiles,
  onUploadFolder,
  onCreateFolder,
  onOpenFiles,
  onOpenGallery,
  onOpenTransfers,
  onOpenConflicts,
}: {
  lifecycleKey: string
  quota?: XDriveHomeQuota | null
  sync: XDriveHomeSyncMetric
  activeTaskCount: number
  conflictCount?: number
  conflictTone?: XDriveStatusTone
  alerts?: readonly XDriveHomeAlert[]
  recentActivity?: ReactNode
  recentItems?: readonly XDriveHomeListItem[]
  favoriteItems?: readonly XDriveHomeListItem[]
  recentAvailable?: boolean
  favoritesAvailable?: boolean
  loadThumbnail?: (item: XDriveFileExplorerItem) => Promise<string | null | undefined>
  openLocalFolderLoading?: boolean
  onOpenLocalFolder?: () => void
  onUploadFiles?: () => void
  onUploadFolder?: () => void
  onCreateFolder?: () => void
  onOpenFiles: () => void
  onOpenGallery: () => void
  onOpenTransfers: () => void
  onOpenConflicts?: () => void
}) {
  const cloudUsage = !quota
    ? '—'
    : quota.quotaBytes > 0
      ? `${formatBytes(quota.physicalUsedBytes)} / ${formatBytes(quota.quotaBytes)}`
      : formatBytes(quota.physicalUsedBytes)

  const itemVisual = (entry: XDriveHomeListItem) => (
    <Box sx={{ width: 34, height: 34, mr: 1.25, flex: '0 0 34px', position: 'relative', overflow: 'visible' }}>
      <XDriveFileExplorerThumbnail
        item={entry.item}
        eligible={entry.item.kind === 'file' && xDriveFileSupportsThumbnail(entry.item.name, 'file')}
        fallback={<XDriveFileExplorerItemIcon item={entry.item} size={24} folderSize={25} />}
      />
      {entry.availability ? (
        <XDriveFileExplorerAvailabilityBadge availability={entry.availability} overlay compact />
      ) : null}
    </Box>
  )

  const itemSection = (
    title: string,
    available: boolean,
    items: readonly XDriveHomeListItem[],
    empty: string,
  ) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
      <XDriveSectionHeader
        level="h3"
        title={title}
        actions={<XDriveActionButton compact onClick={onOpenFiles}>查看全部</XDriveActionButton>}
      />
      <Stack spacing={0.5} sx={{ mt: 1 }}>
        {available && items.length > 0 ? items.map((entry, index) => (
          <ListItemButton
            key={`${String(entry.item.id)}:${index}`}
            onClick={entry.onOpen}
            disabled={!entry.onOpen}
            sx={{ borderRadius: 1, px: 1 }}
          >
            {itemVisual(entry)}
            <ListItemText
              primary={entry.item.name}
              secondary={entry.secondary}
              slotProps={{
                primary: { noWrap: true },
                secondary: { noWrap: true },
              }}
            />
          </ListItemButton>
        )) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            {empty}
          </Typography>
        )}
      </Stack>
    </Paper>
  )

  return (
    <XDriveFileExplorerThumbnailProvider
      lifecycleKey={lifecycleKey}
      loadThumbnail={loadThumbnail}
    >
      <XDriveWorkspaceSurface
        presentation="page"
        title="主页"
        subtitle="继续最近工作，查看同步状态与需要处理的事项。"
      >
        <Stack spacing={2.25}>
          {alerts.length > 0 ? (
            <Stack spacing={1}>
              {alerts.map((alert) => (
                <XDriveStatusAlert key={alert.key} tone={alert.tone} title={alert.title}>
                  {alert.message}
                </XDriveStatusAlert>
              ))}
            </Stack>
          ) : null}

          <XDriveMetricGrid>
            <XDriveMetricCard
              title="云端存储"
              value={cloudUsage}
              suffix={quota?.quotaBytes ? '当前账号' : '不限配额'}
            />
            <XDriveMetricCard title="同步" value={sync.value} tone={sync.tone} />
            <XDriveMetricCard
              title="活动任务"
              value={activeTaskCount.toLocaleString()}
              suffix={activeTaskCount > 0 ? '正在进行' : '当前空闲'}
              tone={activeTaskCount > 0 ? 'busy' : 'good'}
            />
            <XDriveMetricCard
              title="冲突"
              value={conflictCount.toLocaleString()}
              suffix="个未解决"
              tone={conflictTone}
            />
          </XDriveMetricGrid>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <XDriveSectionHeader level="h3" title="快捷操作" />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
              {onOpenLocalFolder ? (
                <XDriveActionButton
                  startIcon={<FolderOpenRoundedIcon />}
                  loading={openLocalFolderLoading}
                  loadingLabel="正在打开…"
                  onClick={onOpenLocalFolder}
                >
                  打开 xDrive 文件夹
                </XDriveActionButton>
              ) : null}
              {onUploadFiles ? (
                <XDriveActionButton startIcon={<UploadFileRoundedIcon />} onClick={onUploadFiles}>
                  上传文件
                </XDriveActionButton>
              ) : null}
              {onUploadFolder ? (
                <XDriveActionButton startIcon={<DriveFolderUploadRoundedIcon />} onClick={onUploadFolder}>
                  上传文件夹
                </XDriveActionButton>
              ) : null}
              {onCreateFolder ? (
                <XDriveActionButton startIcon={<CreateNewFolderRoundedIcon />} onClick={onCreateFolder}>
                  新建文件夹
                </XDriveActionButton>
              ) : null}
              <XDriveActionButton startIcon={<InsertDriveFileRoundedIcon />} onClick={onOpenFiles}>
                云端文件
              </XDriveActionButton>
              <XDriveActionButton startIcon={<PhotoLibraryRoundedIcon />} onClick={onOpenGallery}>
                图库
              </XDriveActionButton>
              <XDriveActionButton startIcon={<TaskAltRoundedIcon />} onClick={onOpenTransfers}>
                任务
              </XDriveActionButton>
              {onOpenConflicts && conflictCount > 0 ? (
                <XDriveActionButton intent="warning" onClick={onOpenConflicts}>
                  处理冲突
                </XDriveActionButton>
              ) : null}
            </Stack>
          </Paper>

          {recentActivity ? (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <XDriveSectionHeader level="h3" title="最近活动" />
              <Typography variant="body2" component="div" sx={{ mt: 1 }}>
                {recentActivity}
              </Typography>
            </Paper>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 2,
            }}
          >
            {itemSection('最近使用', recentAvailable, recentItems, '暂无最近访问文件。')}
            {itemSection('收藏', favoritesAvailable, favoriteItems, '暂无收藏文件。')}
          </Box>
        </Stack>
      </XDriveWorkspaceSurface>
    </XDriveFileExplorerThumbnailProvider>
  )
}
