import { useCallback, useEffect, useRef, useState } from 'react'
import {
  xDriveBackgroundTaskKindLabel,
  xDriveBackgroundTaskStateLabel,
  xDriveFileOperationTypeLabel,
  xDriveTransferKindLabel,
  xDriveTransferRootTasks,
} from '../../ui/shared/src'
import type {
  Node,
  QuotaUsage,
  XDriveBackgroundTask,
  XDriveFileFavoriteItem,
  XDriveFileOperation,
  XDriveFileRecentItem,
  XDriveTransferTask,
} from '../../ui/shared/src'
import {
  XDriveHomePage,
  xDriveCaptureVideoPosterBlob,
  xDriveFileKind,
  xDriveResolveMediaVideoPoster,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerItem,
  XDriveHomeAlert,
  XDriveHomeListItem,
} from '@xdrive/ui/mui'
import type { XDriveApi } from './api'

function recentTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}

export default function WebOverviewPage({
  api,
  username,
  quota,
  activeTaskCount,
  transfers,
  fileOperations,
  backgroundTasks,
  activityRevision,
  uploadParentID,
  onUploadFiles,
  onUploadFolderFiles,
  onCreateFolder,
  onOpenFiles,
  onOpenDirectory,
  onOpenGallery,
  onOpenTransfers,
}: {
  api: XDriveApi
  username: string
  quota?: QuotaUsage | null
  activeTaskCount: number
  transfers: readonly XDriveTransferTask[]
  fileOperations: readonly XDriveFileOperation[]
  backgroundTasks: readonly XDriveBackgroundTask[]
  activityRevision: string
  uploadParentID?: number
  onUploadFiles: (parentID: number, files: FileList | null) => Promise<void>
  onUploadFolderFiles: (parentID: number, files: FileList | null) => Promise<void>
  onCreateFolder: () => void
  onOpenFiles: () => void
  onOpenDirectory: (id: number, crumbs: XDriveFileRecentItem<Node>['crumbs']) => void
  onOpenGallery: () => void
  onOpenTransfers: () => void
}) {
  // Only an accepted response from the current Server/account is allowed to
  // establish an empty Recent/Favorites list. Retain same-scope rows on refresh.
  const [listsSnapshot, setListsSnapshot] = useState<{
    source: XDriveApi
    scope: string
    recent: XDriveFileRecentItem<Node>[]
    favorites: XDriveFileFavoriteItem<Node>[]
  } | null>(null)
  const [readState, setReadState] = useState<{
    source: XDriveApi
    scope: string
    epoch: number
    pending: boolean
    failed: boolean
  } | null>(null)
  const readRequestRef = useRef(0)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadPickerParentIDRef = useRef<number | null>(null)
  const folderUploadPickerParentIDRef = useRef<number | null>(null)
  const lifecycleKey = `web:${username}`

  useEffect(() => {
    uploadPickerParentIDRef.current = null
    folderUploadPickerParentIDRef.current = null
  }, [lifecycleKey])

  useEffect(() => {
    let active = true
    const refreshLists = () => {
      const epoch = ++readRequestRef.current
      setReadState({ source: api, scope: lifecycleKey, epoch, pending: true, failed: false })
      void Promise.all([
        api.fileRecent(6),
        api.fileFavorites(),
      ]).then(([recent, favorites]) => {
        if (!active || readRequestRef.current !== epoch) return
        setListsSnapshot({
          source: api, scope: lifecycleKey,
          recent, favorites: favorites.slice(0, 6),
        })
      }).catch(() => {
        if (!active || readRequestRef.current !== epoch) return
        setReadState({ source: api, scope: lifecycleKey, epoch, pending: false, failed: true })
      }).finally(() => {
        if (!active || readRequestRef.current !== epoch) return
        setReadState((previous) => previous?.source === api &&
          previous.scope === lifecycleKey && previous.epoch === epoch
          ? { ...previous, pending: false } : previous)
      })
    }
    refreshLists()
    const timer = window.setInterval(refreshLists, 30_000)
    return () => {
      active = false
      readRequestRef.current += 1
      window.clearInterval(timer)
    }
  }, [activityRevision, api, lifecycleKey])

  const acceptedLists = listsSnapshot?.source === api && listsSnapshot.scope === lifecycleKey
    ? listsSnapshot : null
  const currentRead = readState?.source === api && readState.scope === lifecycleKey
    ? readState : null
  const recentItems = acceptedLists?.recent ?? []
  const favoriteItems = acceptedLists?.favorites ?? []
  const listsVerified = acceptedLists !== null
  const listsPending = !listsVerified && Boolean(currentRead?.pending)
  const listsFailed = !listsVerified && Boolean(currentRead?.failed)

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (item.kind !== 'file' || signal?.aborted) return null
    const nodeID = Number(item.id)
    const loadCached = async (id: number, requestSignal?: AbortSignal) => {
      const blob = await api.mediaThumbnail(id, requestSignal)
      if (requestSignal?.aborted) return null
      return URL.createObjectURL(blob)
    }
    if (xDriveFileKind(item.name, item.kind) !== 'video') {
      try {
        return await loadCached(nodeID, signal)
      } catch {
        return null
      }
    }
    return xDriveResolveMediaVideoPoster({
      nodeID,
      revision: Number(item.revision),
      signal,
      loadCached,
      capture: async (requestSignal) => {
        const source = await api.filePreviewURL(nodeID, requestSignal)
        if (requestSignal?.aborted) return null
        return xDriveCaptureVideoPosterBlob(source, 0, 0, 0, 512, requestSignal)
      },
      save: (id, revision, poster, requestSignal) =>
        api.mediaVideoPoster(id, revision, poster, requestSignal),
    })
  }, [api])

  const project = (
    entry: XDriveFileRecentItem<Node> | XDriveFileFavoriteItem<Node>,
  ): XDriveFileExplorerItem => ({
    id: entry.node.id,
    name: entry.node.name,
    kind: entry.node.type,
    size: entry.node.size,
    revision: entry.node.revision,
    updatedAt: entry.node.updated_at,
    path: entry.path.replace(/^\/+/, ''),
  })

  const openEntry = (
    entry: XDriveFileRecentItem<Node> | XDriveFileFavoriteItem<Node>,
  ) => {
    if (entry.node.type === 'dir') {
      onOpenDirectory(entry.node.id, entry.crumbs)
      return
    }
    if (entry.node.parent_id) {
      onOpenDirectory(entry.node.parent_id, entry.crumbs.slice(0, -1))
      return
    }
    onOpenFiles()
  }

  const recentHomeItems: XDriveHomeListItem[] = recentItems.map((entry) => ({
    item: project(entry),
    secondary: [entry.path, recentTime(entry.accessed_at)].filter(Boolean).join(' · '),
    onOpen: () => openEntry(entry),
  }))
  const favoriteHomeItems: XDriveHomeListItem[] = favoriteItems.map((entry) => ({
    item: project(entry),
    secondary: entry.path,
    onOpen: () => openEntry(entry),
  }))

  const failedTransfer = xDriveTransferRootTasks(transfers).find(
    (task) => task.state === 'failed' || task.state === 'partial',
  )
  const failedOperation = fileOperations.find((operation) => operation.status === 'failed')
  const failedBackgroundTask = backgroundTasks.find((task) => task.state === 'failed')
  const failedSync = backgroundTasks.find((task) => (
    (task.domain === 'sync_run' || task.kind === 'source.sync') &&
    (task.state === 'failed' || task.state === 'partial')
  ))
  const runningSync = backgroundTasks.find((task) => (
    (task.domain === 'sync_run' || task.kind === 'source.sync') &&
    (task.state === 'running' || task.state === 'queued' || task.state === 'cancelling')
  ))
  const recentSync = [...backgroundTasks]
    .filter((task) => (
      (task.domain === 'sync_run' || task.kind === 'source.sync') &&
      (task.state === 'completed' || task.state === 'partial')
    ))
    .sort((a, b) => Date.parse(b.finished_at || b.updated_at) - Date.parse(a.finished_at || a.updated_at))[0]

  const alerts: XDriveHomeAlert[] = []
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
    <>
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        multiple
        onChange={(event) => {
          const parentID = uploadPickerParentIDRef.current
          uploadPickerParentIDRef.current = null
          if (parentID !== null) void onUploadFiles(parentID, event.target.files)
          event.target.value = ''
        }}
      />
      <input
        ref={(element) => {
          folderUploadInputRef.current = element
          if (element) {
            element.setAttribute('webkitdirectory', '')
            element.setAttribute('directory', '')
          }
        }}
        hidden
        type="file"
        multiple
        onChange={(event) => {
          const parentID = folderUploadPickerParentIDRef.current
          folderUploadPickerParentIDRef.current = null
          if (parentID !== null) void onUploadFolderFiles(parentID, event.target.files)
          event.target.value = ''
        }}
      />
      <XDriveHomePage
        lifecycleKey={lifecycleKey}
        quota={quota ? {
          physicalUsedBytes: quota.physical_used_bytes,
          quotaBytes: quota.quota_bytes,
        } : null}
        sync={{
          value: failedSync ? '需要处理' : runningSync ? '同步中' : '正常',
          tone: failedSync ? 'bad' : runningSync ? 'busy' : 'good',
        }}
        activeTaskCount={activeTaskCount}
        alerts={alerts}
        recentActivity={recentActivity}
        recentItems={recentHomeItems}
        favoriteItems={favoriteHomeItems}
        recentVerified={listsVerified}
        favoritesVerified={listsVerified}
        recentLoading={listsPending}
        favoritesLoading={listsPending}
        listReadEpoch={currentRead?.epoch ?? 0}
        recentError={listsFailed ? '最近使用读取失败，请重新进入页面。' : undefined}
        favoritesError={listsFailed ? '收藏读取失败，请重新进入页面。' : undefined}
        loadThumbnail={loadThumbnail}
        onUploadFiles={() => {
          if (uploadParentID === undefined) {
            onOpenFiles()
            return
          }
          uploadPickerParentIDRef.current = uploadParentID
          uploadInputRef.current?.click()
        }}
        onUploadFolder={() => {
          if (uploadParentID === undefined) {
            onOpenFiles()
            return
          }
          folderUploadPickerParentIDRef.current = uploadParentID
          folderUploadInputRef.current?.click()
        }}
        onCreateFolder={onCreateFolder}
        onOpenFiles={onOpenFiles}
        onOpenGallery={onOpenGallery}
        onOpenTransfers={onOpenTransfers}
      />
    </>
  )
}
