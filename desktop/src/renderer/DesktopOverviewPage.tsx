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
  XDriveHomePage,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerItem,
  XDriveHomeAlert,
  XDriveHomeListItem,
} from '@xdrive/ui/mui'
import type { DesktopFileExplorerAction } from './DesktopFileExplorer'

function recentTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
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

  const explorerItem = (
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

  const availability = (item: XDriveFileExplorerItem) => {
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

  const recentHomeItems: XDriveHomeListItem[] = recentItems.map((item) => {
    const projected = explorerItem(item)
    return {
      item: projected,
      secondary: [item.path, recentTime(item.accessed_at)].filter(Boolean).join(' · '),
      availability: availability(projected),
      onOpen: () => { void openCloudItem(item) },
    }
  })
  const favoriteHomeItems: XDriveHomeListItem[] = favoriteItems.map((item) => {
    const projected = explorerItem(item)
    return {
      item: projected,
      secondary: item.path,
      availability: availability(projected),
      onOpen: () => { void openCloudItem(item) },
    }
  })

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

  const alerts: XDriveHomeAlert[] = []
  if (status?.last_error) {
    alerts.push({ key: 'sync-error', tone: 'bad', title: '同步异常', message: status.last_error })
  }
  if (status?.paused) {
    alerts.push({ key: 'sync-paused', tone: 'warning', title: '同步已暂停', message: '此设备当前不会继续后台同步。' })
  }
  if (status?.has_conflict) {
    alerts.push({
      key: 'conflicts',
      tone: 'warning',
      title: '有冲突需要处理',
      message: `${status.conflict_count || 0} 个同步冲突等待处理。`,
    })
  }
  if (lowDisk && localDiskSpace) {
    alerts.push({
      key: 'low-disk',
      tone: 'warning',
      title: '本地磁盘空间不足',
      message: `剩余 ${formatBytes(localDiskSpace.free_bytes)} / ${formatBytes(localDiskSpace.total_bytes)}。释放本地缓存或清理磁盘后可避免下载与同步失败。`,
    })
  }
  if (failedTransfer) {
    alerts.push({
      key: 'transfer-failed',
      tone: 'bad',
      title: '传输失败',
      message: `${xDriveTransferKindLabel(failedTransfer.kind)} · ${failedTransfer.file_name}${failedTransfer.error ? ' · ' + failedTransfer.error : ''}`,
    })
  }
  if (failedOperation) {
    alerts.push({
      key: 'operation-failed',
      tone: 'bad',
      title: '文件操作失败',
      message: `${xDriveFileOperationTypeLabel(failedOperation.type)}${failedOperation.error ? ' · ' + failedOperation.error : ''}`,
    })
  }
  if (failedBackgroundTask) {
    alerts.push({
      key: 'background-failed',
      tone: 'bad',
      title: failedBackgroundTask.kind === 'source.sync' || failedBackgroundTask.domain === 'sync_run'
        ? '同步任务失败'
        : '后台任务失败',
      message: `${xDriveBackgroundTaskKindLabel(failedBackgroundTask.kind)}${failedBackgroundTask.source_name ? ' · ' + failedBackgroundTask.source_name : ''}${failedBackgroundTask.error ? ' · ' + failedBackgroundTask.error : ''}`,
    })
  }

  const recentActivity = recentSync
    ? [
        xDriveBackgroundTaskKindLabel(recentSync.kind),
        recentSync.source_name,
        xDriveBackgroundTaskStateLabel(recentSync.state),
        recentTime(recentSync.finished_at || recentSync.updated_at),
      ].filter(Boolean).join(' · ')
    : undefined

  return (
    <XDriveHomePage
      lifecycleKey={overviewLifecycleKey}
      quota={quota ? {
        physicalUsedBytes: quota.physical_used_bytes,
        quotaBytes: quota.quota_bytes,
      } : null}
      sync={{
        value: status?.paused ? '已暂停' : status?.sync_status || '正常',
        tone: status?.last_error ? 'bad' : status?.paused ? 'warning' : 'good',
      }}
      activeTaskCount={activeTaskCount}
      conflictCount={status?.conflict_count || 0}
      conflictTone={status?.has_conflict ? 'warning' : 'good'}
      alerts={alerts}
      recentActivity={recentActivity}
      recentItems={recentHomeItems}
      favoriteItems={favoriteHomeItems}
      recentAvailable={recentSupported}
      favoritesAvailable={favoritesSupported}
      loadThumbnail={loadThumbnail}
      openLocalFolderLoading={openFolderLoading}
      onOpenLocalFolder={onOpenFolder}
      onUploadFiles={() => onRequestFileAction('upload-files')}
      onUploadFolder={folderUploadSupported ? () => onRequestFileAction('upload-folder') : undefined}
      onCreateFolder={() => onRequestFileAction('create-folder')}
      onOpenFiles={onOpenFiles}
      onOpenGallery={onOpenGallery}
      onOpenTransfers={onOpenTransfers}
      onOpenConflicts={onOpenConflicts}
    />
  )
}
