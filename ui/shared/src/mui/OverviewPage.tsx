import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../format'
import { xDriveBackgroundTaskKindLabel, xDriveBackgroundTaskStateLabel } from '../background-tasks'
import { xDriveFileExplorerAvailabilityError, xDriveFileExplorerAvailabilityFromSnapshot } from '../file-explorer-availability'
import { xDriveFileOperationTypeLabel } from '../file-operations'
import { xDriveTransferKindLabel, xDriveTransferRootTasks } from '../transfers'
import { XDriveHomePage } from './HomePage'
import type { XDriveHomeAlert, XDriveHomeListItem } from './HomePage'
import type { XDriveFileExplorerItem } from './FileExplorer'
import type { Node, QuotaUsage } from '../models'
import type { XDriveFileRecentItem, XDriveFileFavoriteItem } from '../cloud-files'
import type { XDriveTransferTask } from '../transfers'
import type { XDriveFileOperation } from '../file-operations'
import type { XDriveBackgroundTask } from '../background-tasks'

export type XDriveOverviewStatus = {
  server?: string
  username?: string
  paused?: boolean
  sync_status?: string
  last_error?: string
  has_conflict?: boolean
  conflict_count?: number
}
export type XDriveOverviewFileAvailability = {
  Mode: string
  Pinned: boolean
  OnlineOnly: boolean
  AvailableOffline: boolean
  Mixed: boolean
  Syncing: boolean
}
export type XDriveOverviewDiskSpace = {
  supported: boolean
  status: string
  free_bytes: number
  total_bytes: number
}
export type XDriveOverviewPort = {
  cloudFileRecent(limit: number): Promise<XDriveFileRecentItem<Node>[]>
  cloudFileFavorites(): Promise<XDriveFileFavoriteItem<Node>[]>
  getFileAvailabilityBatch(paths: string[]): Promise<Array<{
    path: string
    availability?: XDriveOverviewFileAvailability
    error?: string
  }>>
  getLocalDiskSpace(): Promise<XDriveOverviewDiskSpace>
  openPath(relativePath: string): Promise<void>
  loadThumbnail(item: XDriveFileExplorerItem, signal?: AbortSignal): Promise<string | null | undefined>
}
export type XDriveOverviewPageProps = {
  port: XDriveOverviewPort
  status?: XDriveOverviewStatus
  quota?: Pick<QuotaUsage, 'physical_used_bytes' | 'quota_bytes'> | null
  activeTaskCount: number
  transfers: readonly XDriveTransferTask[]
  fileOperations: readonly XDriveFileOperation[]
  backgroundTasks: readonly XDriveBackgroundTask[]
  activityRevision: string
  recentSupported: boolean
  favoritesSupported: boolean
  fileAvailabilitySupported: boolean
  localDiskSpaceSupported: boolean
  folderUploadSupported: boolean
  openFolderLoading: boolean
  onOpenFolder: () => void
  onOpenFiles: () => void
  onRequestFileAction: (action: 'upload-files' | 'upload-folder' | 'create-folder') => void
  onOpenGallery: () => void
  onOpenTransfers: () => void
  onOpenConflicts: () => void
  onError: (message: string) => void
}

/** Same lazy, Owner-scoped Overview controller for all Host platforms.
 * Only the active page mounts: background reads and thumbnails cannot
 * consume resources while Gallery/Viewer or FileExplorer owns the viewport.
 */
function recentTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}

export function XDriveOverviewPage({
  port,
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
}: XDriveOverviewPageProps) {
  const overviewLifecycleKey = `${status?.server ?? ''}\n${status?.username ?? ''}`
  type RecentSnapshot = { scope: string; rows: XDriveFileRecentItem<Node>[] }
  type FavoriteSnapshot = { scope: string; rows: XDriveFileFavoriteItem<Node>[] }
  const [recentSnapshot, setRecentSnapshot] = useState<RecentSnapshot | null>(null)
  const [favoriteSnapshot, setFavoriteSnapshot] = useState<FavoriteSnapshot | null>(null)
  const [recentFailure, setRecentFailure] = useState<{ scope: string; message: string } | null>(null)
  const [favoriteFailure, setFavoriteFailure] = useState<{ scope: string; message: string } | null>(null)
  const recentVerified = recentSnapshot?.scope === overviewLifecycleKey
  const favoritesVerified = favoriteSnapshot?.scope === overviewLifecycleKey
  const recentItems = recentVerified ? recentSnapshot.rows : []
  const favoriteItems = favoritesVerified ? favoriteSnapshot.rows : []
  // Error and accepted snapshots must always belong to the currently
  // authenticated Owner; old account A never paints during A -> B switching.
  const recentError = recentFailure?.scope === overviewLifecycleKey ? recentFailure.message : undefined
  const favoritesError = favoriteFailure?.scope === overviewLifecycleKey ? favoriteFailure.message : undefined

  const [availabilitySnapshot, setAvailabilitySnapshot] = useState<{
    scope: string
    values: Map<number, XDriveOverviewFileAvailability | null>
  } | null>(null)
  const availabilityByID = availabilitySnapshot?.scope === overviewLifecycleKey
    ? availabilitySnapshot.values : new Map<number, XDriveOverviewFileAvailability | null>()
  const [diskSnapshot, setDiskSnapshot] = useState<{
    scope: string
    value: XDriveOverviewDiskSpace | null
  } | null>(null)
  const localDiskSpace = diskSnapshot?.scope === overviewLifecycleKey ? diskSnapshot.value : null

  useEffect(() => {
    let active = true
    const refreshLists = () => {
      if (recentSupported) {
        void port.cloudFileRecent(6).then(rows => {
          if (!active) return
          setRecentSnapshot({ scope: overviewLifecycleKey, rows })
          setRecentFailure(null)
        }).catch(() => {
          if (active) setRecentFailure({ scope: overviewLifecycleKey, message: '最近使用读取失败，请刷新重试。' })
        })
      } else {
        setRecentSnapshot(null)
        setRecentFailure(null)
      }
      if (favoritesSupported) {
        void port.cloudFileFavorites().then(rows => {
          if (!active) return
          setFavoriteSnapshot({ scope: overviewLifecycleKey, rows: rows.slice(0, 6) })
          setFavoriteFailure(null)
        }).catch(() => {
          if (active) setFavoriteFailure({ scope: overviewLifecycleKey, message: '收藏读取失败，请刷新重试。' })
        })
      } else {
        setFavoriteSnapshot(null)
        setFavoriteFailure(null)
      }
    }
    refreshLists()
    const timer = setInterval(refreshLists, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [activityRevision, favoritesSupported, overviewLifecycleKey, port, recentSupported])

  useEffect(() => {
    let active = true
    if (!localDiskSpaceSupported) {
      setDiskSnapshot(null)
      return () => { active = false }
    }
    const refreshDisk = () => {
      void port.getLocalDiskSpace().then(value => {
        if (active) setDiskSnapshot({ scope: overviewLifecycleKey, value })
      }).catch(() => {
        if (active) setDiskSnapshot({ scope: overviewLifecycleKey, value: null })
      })
    }
    refreshDisk()
    const timer = setInterval(refreshDisk, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [localDiskSpaceSupported, overviewLifecycleKey, port])

  const overviewItems = useMemo(() => {
    const byID = new Map<number, { node: Node; path: string }>()
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
      setAvailabilitySnapshot({ scope: overviewLifecycleKey, values: new Map() })
      return () => { active = false }
    }
    const paths = overviewItems.map(item => item.path)
    void port.getFileAvailabilityBatch(paths).then(items => {
      if (!active) return
      const byPath = new Map(items.map(item => [item.path, item] as const))
      const next = new Map<number, XDriveOverviewFileAvailability | null>()
      for (const item of overviewItems) {
        const resolved = byPath.get(item.path)
        if (resolved?.availability) next.set(item.node.id, resolved.availability)
        else if (resolved?.error) next.set(item.node.id, null)
      }
      setAvailabilitySnapshot({ scope: overviewLifecycleKey, values: next })
    }).catch(() => {
      if (active) setAvailabilitySnapshot({ scope: overviewLifecycleKey, values: new Map() })
    })
    return () => { active = false }
  }, [fileAvailabilitySupported, overviewItems, overviewLifecycleKey, port])

  const loadThumbnail = useCallback(
    (item: XDriveFileExplorerItem, signal?: AbortSignal) =>
      port.loadThumbnail(item, signal),
    [port],
  )

  const explorerItem = (
    item: XDriveFileRecentItem<Node> | XDriveFileFavoriteItem<Node>,
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
    item: XDriveFileRecentItem<Node> | XDriveFileFavoriteItem<Node>,
  ) => {
    const relativePath = item.path.replace(/^\/+/, '')
    if (!relativePath) { onOpenFiles(); return }
    try { await port.openPath(relativePath) } catch {
      onError('无法打开当前文件，请刷新后重试。')
    }
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
      recentVerified={Boolean(recentVerified)}
      recentError={recentError}
      favoritesAvailable={favoritesSupported}
      favoritesVerified={Boolean(favoritesVerified)}
      favoritesError={favoritesError}
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
