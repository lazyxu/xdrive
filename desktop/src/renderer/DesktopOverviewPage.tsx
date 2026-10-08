import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { Box, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  formatBytes,
  xDriveBackgroundTaskKindLabel,
  xDriveBackgroundTaskStateLabel,
  xDriveFileExplorerAvailabilityError,
  xDriveFileExplorerAvailabilityFromSnapshot,
  xDriveFileOperationTypeLabel,
  xDriveTransferKindLabel,
  xDriveTransferRootTasks,
} from '@xdrive/shared'
import {
  XDriveActionButton,
  XDriveMetricCard,
  XDriveMetricGrid,
  XDriveSectionHeader,
  XDriveStatusAlert,
  XDriveWorkspaceSurface,
  XDriveFileExplorerAvailabilityBadge,
  XDriveFileExplorerItemIcon,
  XDriveFileExplorerThumbnail,
  XDriveFileExplorerThumbnailProvider,
  xDriveFileSupportsThumbnail,
} from '@xdrive/ui/mui'
import type { XDriveFileExplorerItem } from '@xdrive/ui/mui'
import type { DesktopFileExplorerAction } from './DesktopFileExplorer'

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
  transfers,
  fileOperations,
  backgroundTasks,
  activityRevision,
  recentSupported,
  favoritesSupported,
  fileAvailabilitySupported,
  localDiskSpaceSupported,
  folderUploadSupported,
  openFolderLoading,
  onOpenFolder,
  onOpenFiles,
  onRequestFileAction,
  onOpenGallery,
  onOpenTransfers,
  onOpenConflicts,
  onError,
}: {
  status?: AgentStatus
  quota?: AgentCloudQuota | null
  activeTaskCount: number
  transfers: readonly AgentTransfer[]
  fileOperations: readonly AgentCloudFileOperation[]
  backgroundTasks: readonly AgentBackgroundTask[]
  activityRevision: string
  recentSupported: boolean
  favoritesSupported: boolean
  fileAvailabilitySupported: boolean
  localDiskSpaceSupported: boolean
  folderUploadSupported: boolean
  openFolderLoading: boolean
  onOpenFolder: () => void
  onOpenFiles: () => void
  onRequestFileAction: (action: DesktopFileExplorerAction) => void
  onOpenGallery: () => void
  onOpenTransfers: () => void
  onOpenConflicts: () => void
  onError: (message: string) => void
}) {
  const [recentItems, setRecentItems] = useState<AgentCloudRecentItem[]>([])
  const [favoriteItems, setFavoriteItems] = useState<AgentCloudFavoriteItem[]>([])
  const [availabilityByID, setAvailabilityByID] = useState<Map<number, AgentFileAvailability | null>>(
    () => new Map(),
  )
  const [localDiskSpace, setLocalDiskSpace] = useState<AgentLocalDiskSpace | null>(null)
  const overviewLifecycleKey = `${status?.server ?? ''}\n${status?.username ?? ''}`

  useEffect(() => {
    setRecentItems([])
    setFavoriteItems([])
    setAvailabilityByID(new Map())
  }, [overviewLifecycleKey])

  useEffect(() => {
    let active = true
    const refreshLists = () => {
      if (recentSupported) {
        void window.xdriveDesktop.agent.cloudFileRecent(6).then((result) => {
          if (active && result.ok) setRecentItems(result.data)
        })
      } else {
        setRecentItems([])
      }
      if (favoritesSupported) {
        void window.xdriveDesktop.agent.cloudFileFavorites().then((result) => {
          if (active && result.ok) setFavoriteItems(result.data.slice(0, 6))
        })
      } else {
        setFavoriteItems([])
      }
    }
    refreshLists()
    const timer = window.setInterval(refreshLists, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [activityRevision, favoritesSupported, overviewLifecycleKey, recentSupported])

  useEffect(() => {
    let active = true
    if (!localDiskSpaceSupported) {
      setLocalDiskSpace(null)
      return () => { active = false }
    }
    const refreshDisk = () => {
      void window.xdriveDesktop.agent.getLocalDiskSpace().then((result) => {
        if (!active) return
        setLocalDiskSpace(result.ok ? result.data : null)
      })
    }
    refreshDisk()
    const timer = window.setInterval(refreshDisk, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [localDiskSpaceSupported])

  const overviewItems = useMemo(() => {
    const byID = new Map<number, { node: AgentCloudNode; path: string }>()
    for (const item of recentItems) {
      const path = item.path.replace(/^\/+/, '')
      if (path) byID.set(item.node.id, { node: item.node, path })
    }
    for (const item of favoriteItems) {
      const path = item.path.replace(/^\/+/, '')
      if (path) byID.set(item.node.id, { node: item.node, path })
    }
    return [...byID.values()]
  }, [favoriteItems, recentItems])

  useEffect(() => {
    let active = true
    if (!fileAvailabilitySupported || overviewItems.length === 0) {
      setAvailabilityByID(new Map())
      return () => { active = false }
    }
    const paths = overviewItems.map((item) => item.path)
    void window.xdriveDesktop.agent.getFileAvailabilityBatch(paths).then((result) => {
      if (!active || !result.ok) return
      const byPath = new Map(result.data.items.map((item) => [item.path, item] as const))
      const next = new Map<number, AgentFileAvailability | null>()
      for (const item of overviewItems) {
        const resolved = byPath.get(item.path)
        if (resolved?.availability) next.set(item.node.id, resolved.availability)
        else if (resolved?.error) next.set(item.node.id, null)
      }
      setAvailabilityByID(next)
    })
    return () => { active = false }
  }, [fileAvailabilitySupported, overviewItems, overviewLifecycleKey])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    const result = await window.xdriveDesktop.agent.getMediaThumbnail(Number(item.id))
    if (!result.ok) return null
    const contentType = result.data.content_type || 'image/jpeg'
    return URL.createObjectURL(new Blob([result.data.data], { type: contentType }))
  }, [])

  const overviewExplorerItem = (
    item: AgentCloudRecentItem | AgentCloudFavoriteItem,
  ): XDriveFileExplorerItem => ({
    id: item.node.id,
    name: item.node.name,
    kind: item.node.type === 'dir' ? 'dir' : 'file',
    size: item.node.size,
    revision: item.node.revision,
    updatedAt: item.node.updated_at,
    path: item.path.replace(/^\/+/, ''),
  })

  const overviewAvailability = (item: XDriveFileExplorerItem) => {
    if (!fileAvailabilitySupported) return undefined
    const state = availabilityByID.get(Number(item.id))
    if (state === null) return xDriveFileExplorerAvailabilityError()
    if (!state) return undefined
    return xDriveFileExplorerAvailabilityFromSnapshot({
      mode: state.Mode,
      pinned: state.Pinned,
      onlineOnly: state.OnlineOnly,
      availableOffline: state.AvailableOffline,
      mixed: state.Mixed,
      syncing: state.Syncing,
    })
  }

  const overviewItemVisual = (
    item: AgentCloudRecentItem | AgentCloudFavoriteItem,
  ) => {
    const explorerItem = overviewExplorerItem(item)
    const availability = overviewAvailability(explorerItem)
    return (
      <Box sx={{ width: 34, height: 34, mr: 1.25, flex: '0 0 34px', position: 'relative', overflow: 'visible' }}>
        <XDriveFileExplorerThumbnail
          item={explorerItem}
          eligible={explorerItem.kind === 'file' && xDriveFileSupportsThumbnail(explorerItem.name, 'file')}
          fallback={<XDriveFileExplorerItemIcon item={explorerItem} size={24} folderSize={25} />}
        />
        {availability ? (
          <XDriveFileExplorerAvailabilityBadge availability={availability} overlay compact />
        ) : null}
      </Box>
    )
  }

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

  const failedTransfer = xDriveTransferRootTasks(transfers).find(
    (task) => task.state === 'failed' || task.state === 'partial',
  )
  const failedOperation = fileOperations.find((operation) => operation.status === 'failed')
  const failedBackgroundTask = backgroundTasks.find((task) => task.state === 'failed')
  const recentSync = [...backgroundTasks]
    .filter((task) => (
      (task.domain === 'sync_run' || task.kind === 'source.sync') &&
      (task.state === 'completed' || task.state === 'partial')
    ))
    .sort((a, b) => Date.parse(b.finished_at || b.updated_at) - Date.parse(a.finished_at || a.updated_at))[0]
  const lowDisk = Boolean(
    localDiskSpace?.supported &&
    localDiskSpace.status !== 'PASS',
  )
  const needsAttention = Boolean(
    status?.last_error ||
    status?.paused ||
    status?.has_conflict ||
    failedTransfer ||
    failedOperation ||
    failedBackgroundTask ||
    lowDisk
  )

  return (
    <XDriveFileExplorerThumbnailProvider
      lifecycleKey={overviewLifecycleKey}
      loadThumbnail={loadThumbnail}
    >
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
            {lowDisk && localDiskSpace ? (
              <XDriveStatusAlert tone="warning" title="本地磁盘空间不足">
                剩余 {formatBytes(localDiskSpace.free_bytes)} / {formatBytes(localDiskSpace.total_bytes)}。释放本地缓存或清理磁盘后可避免下载与同步失败。
              </XDriveStatusAlert>
            ) : null}
            {failedTransfer ? (
              <XDriveStatusAlert tone="bad" title="传输失败">
                {xDriveTransferKindLabel(failedTransfer.kind)} · {failedTransfer.file_name}
                {failedTransfer.error ? ' · ' + failedTransfer.error : ''}
              </XDriveStatusAlert>
            ) : null}
            {failedOperation ? (
              <XDriveStatusAlert tone="bad" title="文件操作失败">
                {xDriveFileOperationTypeLabel(failedOperation.type)}
                {failedOperation.error ? ' · ' + failedOperation.error : ''}
              </XDriveStatusAlert>
            ) : null}
            {failedBackgroundTask ? (
              <XDriveStatusAlert
                tone="bad"
                title={failedBackgroundTask.kind === 'source.sync' || failedBackgroundTask.domain === 'sync_run'
                  ? '同步任务失败'
                  : '后台任务失败'}
              >
                {xDriveBackgroundTaskKindLabel(failedBackgroundTask.kind)}
                {failedBackgroundTask.source_name ? ' · ' + failedBackgroundTask.source_name : ''}
                {failedBackgroundTask.error ? ' · ' + failedBackgroundTask.error : ''}
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
            <XDriveActionButton startIcon={<UploadFileRoundedIcon />} onClick={() => onRequestFileAction('upload-files')}>
              上传文件
            </XDriveActionButton>
            {folderUploadSupported ? (
              <XDriveActionButton startIcon={<DriveFolderUploadRoundedIcon />} onClick={() => onRequestFileAction('upload-folder')}>
                上传文件夹
              </XDriveActionButton>
            ) : null}
            <XDriveActionButton startIcon={<CreateNewFolderRoundedIcon />} onClick={() => onRequestFileAction('create-folder')}>
              新建文件夹
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

        {recentSync ? (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <XDriveSectionHeader level="h3" title="最近活动" />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {xDriveBackgroundTaskKindLabel(recentSync.kind)}
              {recentSync.source_name ? ' · ' + recentSync.source_name : ''}
              {' · '}
              {xDriveBackgroundTaskStateLabel(recentSync.state)}
              {' · '}
              {recentTime(recentSync.finished_at || recentSync.updated_at)}
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
                  {overviewItemVisual(item)}
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
                  {overviewItemVisual(item)}
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
    </XDriveFileExplorerThumbnailProvider>
  )
}
