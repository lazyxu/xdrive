import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import { Box } from '@mui/material'
import {
  type XDriveByteProgressHandler,
  type XDriveFileExplorerKeyboardProfile,
  xDriveFileExplorerCopyPath,
  xDriveFileExplorerPathLookupPageOptions,
  xDriveFileExplorerCaseInsensitiveNameLookupPageOptions,
  xDriveFileExplorerArchiveDownloadPlan,
  xDriveFileExplorerDesktopArchiveDownloadFeedback,
  xDriveFileExplorerLoadChildDirectoryPage,
  xDriveFileExplorerDesktopDownloadFeedback,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerDownloadPlan,
  xDriveFileExplorerEnsureUploadDirectory,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerResolveFolderUploadTargets,
  xDriveFileExplorerPropertiesRefs,
  xDriveFileExplorerAvailabilityError,
  xDriveFileExplorerAvailabilityFromSnapshot,
} from '@xdrive/shared'
import {
  XDriveFileExplorer,
  XDriveFileExplorerNavigationPane,
  XDriveFilePreviewSurface,
  XDriveOpenPreviewDialog,
  XDriveFileExplorerTabs,
  XDriveFileExplorerSearchFilters,
  XDriveFileNameDialog,
  XDriveFileExplorerTrashDeleteDialog,
  useXDriveFileExplorerTrash,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerWorkspace,
  useXDriveFileExplorerQuickAccess,
  useXDriveFileExplorerFavorites,
  useXDriveFileExplorerRecent,
  useXDriveFileExplorerOperationController,
  useXDriveFileExplorerExternalDropController,
  useXDriveFileExplorerUploadController,
  xDriveFileExplorerUploadGroupLabel,
  XDriveUploadConflictDialog,
  xDriveCaptureVideoPosterBlob,
  xDriveFileKind,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerMenuItem,
  XDriveFileExplorerNavigationState,
  XDriveFileExplorerSort,
  XDriveFileExplorerWorkspaceVirtualDirectory,
  XDriveTrashDialogAdapter,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerGrouping,
  XDriveFileExplorerSearchAvailabilityOption,
  XDriveFileExplorerSearchSourceOption,
} from '@xdrive/shared'

const DESKTOP_FILE_VIEW_KEY = 'xdrive.desktop.files.view_mode'
const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'
const DESKTOP_FILE_VIEW_PREFERENCES_KEY = 'xdrive.desktop.files.view_preferences'
const desktopFileAvailabilityBatchLimit = 2048

const desktopSearchAvailabilityOptions: readonly XDriveFileExplorerSearchAvailabilityOption[] = [
  { value: 'local', label: '本地可用' },
  { value: 'always-local', label: '始终保留在此设备上' },
  { value: 'online-only', label: '仅联机' },
  { value: 'cloud', label: '云端' },
  { value: 'mixed', label: '混合' },
  { value: 'syncing', label: '正在同步' },
]

let desktopFilePropertiesRequestSequence = 0

function nextDesktopFilePropertiesRequestID() {
  desktopFilePropertiesRequestSequence += 1
  return `file-properties-${Date.now()}-${desktopFilePropertiesRequestSequence}`
}

type DesktopFileAvailabilityEntry = {
  path: string
  state?: AgentFileAvailability
  error?: string
}

function desktopFileStatusLabel(state: AgentFileAvailability) {
  if (state.Syncing || state.Mode === 'syncing') return '正在同步'
  if (state.InSync) return '已同步'
  return '待同步'
}

export default function DesktopFileExplorer({
  items,
  crumbs,
  virtualDirectory,
  loading,
  onLoadDirectory,
  onRefreshCurrentDirectoryIfIdle,
  navigationState,
  navigationSessionStorageKey,
  onNavigationStateChange,
  onOpenTrash,
  trashActive,
  trashAdapter,
  onCloseTrash,
  onTrashChanged,
  onOpenHistory,
  onOpenShares,
  onDelete,
  onDeleteMany,
  onOperationQueued,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
  onQuotaChanged,
  uploadConflictSupported = false,
  archiveDownloadSupported = false,
  folderTreeDownloadSupported = false,
  textPreviewSupported = false,
  previewStreamSupported = false,
  propertiesStatsSupported = false,
  fileAvailabilitySupported = false,
  openWithSupported = false,
  quickAccessSupported = false,
  favoritesSupported = false,
  recentSupported = false,
  transferLifecycleSupported = false,
  keyboardProfile = 'web',
  onError,
  onFeedback,
}: {
  items: AgentCloudNode[]
  crumbs: AgentCloudCrumb[]
  virtualDirectory?: XDriveFileExplorerWorkspaceVirtualDirectory<AgentCloudNode> | null
  loading: boolean
  onLoadDirectory: (
    id: number,
    crumbs: AgentCloudCrumb[],
    sort: XDriveFileExplorerSort,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<boolean | void>
  onRefreshCurrentDirectoryIfIdle: (
    expectedCurrentID: number | undefined,
  ) => Promise<boolean | void>
  navigationState?: XDriveFileExplorerNavigationState<AgentCloudCrumb>
  navigationSessionStorageKey?: string
  onNavigationStateChange?: (
    state: XDriveFileExplorerNavigationState<AgentCloudCrumb>,
  ) => void
  onOpenTrash: () => void
  trashActive: boolean
  trashAdapter: XDriveTrashDialogAdapter
  onCloseTrash: () => void
  onTrashChanged: () => void | Promise<void>
  onOpenHistory: (node: AgentCloudNode, crumbs: AgentCloudCrumb[]) => void
  onOpenShares: (node: AgentCloudNode) => void
  onDelete: (node: AgentCloudNode) => void
  onDeleteMany: (nodes: AgentCloudNode[]) => void
  onOperationQueued: (operation: AgentCloudFileOperation) => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  onQuotaChanged: () => Promise<unknown>
  uploadConflictSupported?: boolean
  archiveDownloadSupported?: boolean
  folderTreeDownloadSupported?: boolean
  textPreviewSupported?: boolean
  previewStreamSupported?: boolean
  propertiesStatsSupported?: boolean
  fileAvailabilitySupported?: boolean
  openWithSupported?: boolean
  quickAccessSupported?: boolean
  favoritesSupported?: boolean
  recentSupported?: boolean
  transferLifecycleSupported?: boolean
  keyboardProfile?: XDriveFileExplorerKeyboardProfile
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [openPreviewItem, setOpenPreviewItem] = useState<XDriveFileExplorerItem | null>(null)
  const [trashSort, setTrashSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const trash = useXDriveFileExplorerTrash({
    lifecycleKey: navigationSessionStorageKey ?? '',
    enabled: trashActive,
    adapter: trashAdapter,
    sort: trashSort,
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
    onFeedback: (message) => onFeedback('good', message),
    onChanged: onTrashChanged,
  })
  const [searchSourceOptions, setSearchSourceOptions] = useState<XDriveFileExplorerSearchSourceOption[]>([])
  useEffect(() => {
    let active = true
    void window.xdriveDesktop.agent.getSources().then((result) => {
      if (active && result.ok) {
        setSearchSourceOptions(result.data.map((source) => ({ id: source.id, name: source.name })))
      }
    })
    return () => {
      active = false
    }
  }, [])
  const [availabilityByID, setAvailabilityByID] = useState<Map<number, DesktopFileAvailabilityEntry>>(
    () => new Map(),
  )
  const [navigationAvailabilityItems, setNavigationAvailabilityItems] = useState<readonly XDriveFileExplorerItem[]>([])
  const [availabilityRefreshToken, setAvailabilityRefreshToken] = useState(0)
  const availabilityRequestRef = useRef(0)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const recent = useXDriveFileExplorerRecent<AgentCloudNode>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    enabled: recentSupported,
    loadItems: async () => {
      const result = await window.xdriveDesktop.agent.cloudFileRecent(16)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    touchItem: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.cloudTouchFileRecent(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    clearItems: async () => {
      const result = await window.xdriveDesktop.agent.cloudClearFileRecent()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })

  const {
    searchValue,
    searchFilters,
    searchLoading,
    changeSearchValue,
    changeSearchFilters,
    clearSearch,
    submitSearch,
    nodeByID,
    searchByID,
    explorerItems,
    explorerCrumbs,
    copyItems,
    cutItems,
    planPaste,
    completePaste,
    canPaste,
    current,
    pathValue,
    viewMode,
    setViewMode,
    sort,
    changeSort,
    grouping,
    changeGrouping,
    refresh,
    beginNavigationIntent,
    isNavigationIntentCurrent,
    navigateTo,
    navigateToCrumb,
    goBack,
    goForward,
    goUp,
    canGoBack,
    canGoForward,
    canGoUp,
    submitPath,
    openItem: openWorkspaceItem,
    openItemInNewTab,
    explorerVirtualCollection,
    externallySorted,
    searchStatusText,
    tabs,
    activeTabID,
    newTab,
    activateTab,
    closeTab,
    reorderTab,
    duplicateTab,
    closeOtherTabs,
    closeTabsToRight,
    restoreClosedTab,
    nextTab,
    previousTab,
    canNewTab,
    canCloseTab,
    canRestoreClosedTab,
  } = useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>({
    items,
    crumbs,
    directoryVirtualCollection: virtualDirectory,
    viewModeStorageKey: DESKTOP_FILE_VIEW_KEY,
    onLoadDirectory,
    initialNavigationState: navigationState,
    navigationSessionStorageKey,
    onNavigationStateChange,
    loadSearchRange: async (query, filters, searchGrouping, searchSort, offset, limit) => {
      const result = await window.xdriveDesktop.agent.cloudSearchRange(
        query,
        offset,
        limit,
        searchSort.key,
        searchSort.direction,
        filters,
        searchGrouping,
      )
      if (!result.ok) throw new Error(result.error.message)
      return {
        items: result.data.items,
        totalCount: result.data.total_count,
        offset: result.data.offset,
        limit: result.data.limit,
        groups: result.data.groups,
      }
    },
    loadRoot: async () => {
      const result = await window.xdriveDesktop.agent.cloudRoot()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    findChildDirectory: async (parentID, name) => {
      const result = await window.xdriveDesktop.agent.cloudChildrenPage(
        parentID,
        xDriveFileExplorerPathLookupPageOptions(name),
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data.items[0] ?? null
    },
    searchCrumbsForResult: (result) => result.crumbs,
    onDirectoryAccess: (nodeID) => { void recent.record(nodeID) },
    onFileAccess: (nodeID) => { void recent.record(nodeID) },
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })

  const refreshCurrentDirectoryIfCurrent = onRefreshCurrentDirectoryIfIdle

  const loadTreeDirectoryPage = useCallback(
    (parentID: number, cursor?: string) => xDriveFileExplorerLoadChildDirectoryPage({
      parentID,
      cursor,
      loadPage: async (id, options) => {
        const result = await window.xdriveDesktop.agent.cloudChildrenPage(id, options)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }),
    [],
  )

  const quickAccess = useXDriveFileExplorerQuickAccess<AgentCloudNode>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    enabled: quickAccessSupported,
    loadItems: async () => {
      const result = await window.xdriveDesktop.agent.cloudFileQuickAccess()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    pinItem: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.cloudPinFileQuickAccess(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    unpinItem: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.cloudUnpinFileQuickAccess(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })

  const favorites = useXDriveFileExplorerFavorites<AgentCloudNode>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    enabled: favoritesSupported,
    loadItems: async () => {
      const result = await window.xdriveDesktop.agent.cloudFileFavorites()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    favoriteItem: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.cloudFavoriteFile(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    unfavoriteItem: async (nodeID) => {
      const result = await window.xdriveDesktop.agent.cloudUnfavoriteFile(nodeID)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })

  const {
    busy: uploadBusy,
    busyAction: uploadBusyAction,
    runTargets: runUploadTargets,
    runGroup: runUploadGroup,
    dialogProps: uploadConflictDialogProps,
  } = useXDriveFileExplorerUploadController<File>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    disabled: Boolean(actionBusy),
    continueOnUploadError: true,
    fileName: (file) => file.name,
    fileSize: (file) => file.size,
    preflight: async (parentID, file) => {
      const result = await window.xdriveDesktop.agent.cloudUploadPreflight(parentID, file.name)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    preflightBatch: async (targets) => {
      const result = await window.xdriveDesktop.agent.cloudUploadPreflightBatch(
        targets.map((target) => ({ parent_id: target.parentID, name: target.file.name })),
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    upload: async (parentID, file, conflictPolicy, _onProgress, transferID) => {
      const result = await window.xdriveDesktop.agent.cloudUploadFile(
        parentID,
        file,
        conflictPolicy,
        transferID,
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    transferLifecycle: transferLifecycleSupported ? {
      startGroup: async (input) => {
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'start_group',
          file_name: input.fileName,
          path: input.path,
          kind: 'upload',
          direction: 'upload',
          bytes_total: input.bytesTotal,
          items_total: input.itemsTotal,
        })
        if (!result.ok || !result.data.id) throw new Error(result.ok ? '未创建传输父任务。' : result.error.message)
        return result.data.id
      },
      startChild: async (groupID, input) => {
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'start_child',
          parent_id: groupID,
          file_name: input.fileName,
          relative_path: input.relativePath,
          kind: 'upload',
          direction: 'upload',
          bytes_total: input.bytesTotal,
          items_total: 1,
        })
        if (!result.ok || !result.data.id) throw new Error(result.ok ? '未创建传输子任务。' : result.error.message)
        return result.data.id
      },
      begin: async (id, input) => {
        const group = input?.group
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'begin',
          id,
          ...(group ? {
            scan_complete: group.scanComplete,
            bytes_done: group.bytesDone,
            bytes_total: group.bytesTotal,
            items_total: group.itemsTotal,
            items_completed: group.itemsCompleted,
            items_failed: group.itemsFailed,
            items_running: group.itemsRunning,
            items_queued: group.itemsQueued,
          } : {}),
        })
        if (!result.ok) throw new Error(result.error.message)
      },
      progress: async (id, done, total) => {
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'progress',
          id,
          bytes_done: done,
          bytes_total: total,
        })
        if (!result.ok) throw new Error(result.error.message)
      },
      updateGroup: async (id, group) => {
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'update_group',
          id,
          scan_complete: group.scanComplete,
          bytes_done: group.bytesDone,
          bytes_total: group.bytesTotal,
          items_total: group.itemsTotal,
          items_completed: group.itemsCompleted,
          items_failed: group.itemsFailed,
          items_running: group.itemsRunning,
          items_queued: group.itemsQueued,
        })
        if (!result.ok) throw new Error(result.error.message)
      },
      finish: async (id, input) => {
        const result = await window.xdriveDesktop.agent.transferLifecycle({
          action: 'finish',
          id,
          state: input.state,
          error: input.error,
          skipped: input.skipped,
        })
        if (!result.ok) throw new Error(result.error.message)
      },
    } : undefined,
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
    onFeedback,
  })

  const {
    busy: fileOperationBusy,
    busyAction: fileOperationBusyAction,
    canPaste: fileOperationCanPaste,
    pasteClipboard,
    dropItemsToFolder,
    dropItemsToCrumb,
  } = useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    nodeByID,
    currentID: current?.id,
    disabled: Boolean(actionBusy) || uploadBusy,
    planPaste,
    completePaste,
    canPaste,
    clearSearch,
    submitOperation: async (plan) => {
      const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
        plan.operation,
        plan.items,
        plan.parentID,
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onQueued: onOperationQueued,
    onFeedback,
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })
  const explorerActionBusy = Boolean(actionBusy) || fileOperationBusy || uploadBusy

  const loadTextPreview = useCallback(async (item: XDriveFileExplorerItem) => {
    if (!textPreviewSupported || item.kind !== 'file') return null
    const result = await window.xdriveDesktop.agent.cloudTextPreview(Number(item.id))
    return result.ok ? result.data : null
  }, [textPreviewSupported])

  const loadPropertiesStats = useCallback(async (
    selected: readonly XDriveFileExplorerItem[],
    signal: AbortSignal,
  ) => {
    if (!propertiesStatsSupported) {
      throw new Error('当前 xdrive-agent 不支持文件夹属性统计，请更新客户端核心组件。')
    }
    const requestID = nextDesktopFilePropertiesRequestID()
    const refs = xDriveFileExplorerPropertiesRefs(selected)
    const cancel = () => {
      void window.xdriveDesktop.agent.cloudCancelFilePropertiesStats(requestID)
    }
    if (signal.aborted) {
      cancel()
      throw new Error('File Properties request was cancelled.')
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await window.xdriveDesktop.agent.cloudFilePropertiesStats(
        refs,
        requestID,
      )
      if (signal.aborted) {
        throw new Error('File Properties request was cancelled.')
      }
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }, [propertiesStatsSupported])

  const loadPreviewURL = useCallback(async (
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf',
  ) => {
    if (
      !previewStreamSupported ||
      item.kind !== 'file' ||
      !['pdf', 'video', 'audio', 'image'].includes(kind)
    ) return null
    const result = await window.xdriveDesktop.agent.cloudFilePreviewURL(Number(item.id))
    return result.ok ? result.data : null
  }, [previewStreamSupported])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    const result = await window.xdriveDesktop.agent.getMediaThumbnail(Number(item.id))
    if (result.ok) {
      const contentType = result.data.content_type || 'image/jpeg'
      const blob = new Blob([result.data.data], { type: contentType })
      return URL.createObjectURL(blob)
    }
    if (!previewStreamSupported || xDriveFileKind(item.name, item.kind) !== 'video') return null

    const preview = await window.xdriveDesktop.agent.cloudFilePreviewURL(Number(item.id))
    if (!preview.ok) return null
    const poster = await xDriveCaptureVideoPosterBlob(preview.data)
    if (!poster) return null
    const revision = Number(item.revision)
    if (Number.isSafeInteger(revision) && revision > 0) {
      try {
        await window.xdriveDesktop.agent.putMediaVideoPoster(
          Number(item.id),
          revision,
          await poster.arrayBuffer(),
        )
      } catch {
        // Keep the locally decoded poster even when the shared Server cache
        // loses a revision race or is temporarily unavailable.
      }
    }
    return URL.createObjectURL(poster)
  }, [previewStreamSupported])

  const loadLivePhotoMotion = useCallback(async (
    item: XDriveFileExplorerItem,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (
      item.kind !== 'file' ||
      !item.name.trim().toLowerCase().endsWith('.livp')
    ) return null
    const result = await window.xdriveDesktop.agent.getMediaLivePhotoMotion(Number(item.id), onProgress)
    if (!result.ok) return null
    const contentType = result.data.content_type || 'video/quicktime'
    return URL.createObjectURL(new Blob([result.data.data], { type: contentType }))
  }, [])

  const openPreviewNode = (node: AgentCloudNode) => {
    setOpenPreviewItem({
      id: node.id,
      name: node.name,
      kind: node.type,
      size: node.size,
      updatedAt: node.updated_at,
      revision: node.revision,
    })
  }

  const copyItemPaths = (selected: XDriveFileExplorerItem[]) => {
    if (selected.length === 0) return
    const text = selected
      .map((item) => xDriveFileExplorerCopyPath(item, explorerCrumbs))
      .join('\n')
    try {
      window.xdriveDesktop.copyText(text)
      onFeedback(
        'good',
        selected.length === 1
          ? `已复制路径：${text}`
          : `已复制 ${selected.length} 条路径。`,
      )
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const relativePathForNode = (node: AgentCloudNode) => {
    const searchResult = searchByID.get(node.id)
    if (searchResult?.path) return searchResult.path
    return [...crumbs.slice(1).map((crumb) => crumb.name), node.name].join('/')
  }

  const nativeDragOutSupported =
    keyboardProfile === 'windows' || keyboardProfile === 'macos'

  const startNativeDragOut = (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    window.xdriveDesktop.startNativeDragOut(relativePath)
  }

  const handleNavigationAvailabilityItemsChange = useCallback((
    items: readonly XDriveFileExplorerItem[],
  ) => {
    setNavigationAvailabilityItems((currentItems) => {
      if (
        currentItems.length === items.length &&
        currentItems.every((item, index) => (
          item.id === items[index]?.id &&
          item.path === items[index]?.path
        ))
      ) return currentItems
      return items
    })
  }, [])

  const availabilityRequests = useMemo(() => {
    const byNodeID = new Map<number, string>()
    for (const node of nodeByID.values()) {
      const searchResult = searchByID.get(node.id)
      const path = searchResult?.path ||
        [...crumbs.slice(1).map((crumb) => crumb.name), node.name].join('/')
      if (path) byNodeID.set(node.id, path)
    }
    for (const item of quickAccess.items) if (item.path) byNodeID.set(item.id, item.path)
    for (const item of favorites.items) if (item.path) byNodeID.set(item.id, item.path)
    for (const item of recent.items) if (item.path) byNodeID.set(item.id, item.path)
    for (const item of navigationAvailabilityItems) {
      if (item.path) byNodeID.set(Number(item.id), item.path)
    }
    return [...byNodeID].map(([nodeID, path]) => ({ nodeID, path }))
  }, [
    crumbs,
    favorites.items,
    navigationAvailabilityItems,
    nodeByID,
    quickAccess.items,
    recent.items,
    searchByID,
  ])

  useEffect(() => {
    const requestID = ++availabilityRequestRef.current
    if (!fileAvailabilitySupported) {
      setAvailabilityByID(new Map())
      return
    }

    const requests = availabilityRequests
    if (requests.length === 0) {
      setAvailabilityByID(new Map())
      return
    }

    const paths = [...new Set(requests.map((item) => item.path))]
    let cancelled = false
    void (async () => {
      const items: AgentFileAvailabilityBatchItem[] = []
      for (let offset = 0; offset < paths.length; offset += desktopFileAvailabilityBatchLimit) {
        const batchPaths = paths.slice(offset, offset + desktopFileAvailabilityBatchLimit)
        const result = await window.xdriveDesktop.agent.getFileAvailabilityBatch(batchPaths)
        if (cancelled || requestID !== availabilityRequestRef.current || !result.ok) return
        items.push(...result.data.items)
      }
      const byPath = new Map(items.map((item) => [item.path, item] as const))
      const next = new Map<number, DesktopFileAvailabilityEntry>()
      for (const request of requests) {
        const resolved = byPath.get(request.path)
        if (resolved?.availability) {
          next.set(request.nodeID, { path: request.path, state: resolved.availability })
        } else if (resolved?.error) {
          next.set(request.nodeID, { path: request.path, error: resolved.error })
        }
      }
      if (!cancelled && requestID === availabilityRequestRef.current) {
        setAvailabilityByID(next)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    availabilityRefreshToken,
    availabilityRequests,
    fileAvailabilitySupported,
  ])

  useEffect(() => {
    if (
      !fileAvailabilitySupported ||
      ![...availabilityByID.values()].some((entry) => entry.state?.Syncing)
    ) return
    const timer = window.setTimeout(
      () => setAvailabilityRefreshToken((value) => value + 1),
      1500,
    )
    return () => window.clearTimeout(timer)
  }, [availabilityByID, fileAvailabilitySupported])

  const getItemStatus = useCallback((item: XDriveFileExplorerItem) => {
    const entry = availabilityByID.get(Number(item.id))
    if (entry?.error) return '状态异常'
    return entry?.state ? desktopFileStatusLabel(entry.state) : undefined
  }, [availabilityByID])

  const getItemAvailability = useCallback((item: XDriveFileExplorerItem) => {
    const entry = availabilityByID.get(Number(item.id))
    if (entry?.error) return xDriveFileExplorerAvailabilityError()
    if (!entry?.state) return undefined
    return xDriveFileExplorerAvailabilityFromSnapshot({
      mode: entry.state.Mode,
      pinned: entry.state.Pinned,
      onlineOnly: entry.state.OnlineOnly,
      availableOffline: entry.state.AvailableOffline,
      mixed: entry.state.Mixed,
      syncing: entry.state.Syncing,
    })
  }, [availabilityByID])

  const setNodeAvailability = useCallback(async (
    node: AgentCloudNode,
    action: 'keep' | 'release',
  ) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    setActionBusy(`availability-${node.id}`)
    try {
      const result = await window.xdriveDesktop.agent.setFileAvailability(
        relativePath,
        action,
      )
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      const availability = result.data
      if ('Mode' in availability) {
        setAvailabilityByID((current) => {
          const next = new Map(current)
          next.set(node.id, { path: relativePath, state: availability })
          return next
        })
      } else {
        setAvailabilityRefreshToken((value) => value + 1)
      }
      onFeedback(
        'good',
        action === 'keep'
          ? '已设置为始终保留在此设备上。'
          : '已释放本地空间。',
      )
    } finally {
      setActionBusy('')
    }
  }, [crumbs, onError, onFeedback, searchByID])

  const openLocalNode = async (node: AgentCloudNode, reveal = false) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    setActionBusy(`${reveal ? 'reveal' : 'open'}-${node.id}`)
    try {
      const result = await window.xdriveDesktop.agent.openPath(relativePath, reveal)
      if (!result.ok) {
        onError(result.error.message)
      }
    } finally {
      setActionBusy('')
    }
  }

  const openLocalNodeWith = async (node: AgentCloudNode) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    setActionBusy(`open-with-${node.id}`)
    try {
      const result = await window.xdriveDesktop.agent.openWith(relativePath)
      if (!result.ok) {
        onError(result.error.message)
      }
    } finally {
      setActionBusy('')
    }
  }

  const downloadNode = async (node: AgentCloudNode) => {
    setActionBusy(`download-${node.id}`)
    try {
      const result = await window.xdriveDesktop.agent.cloudDownload(node.id, node.name)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.saved) onFeedback('good', `${node.name} 已保存。`)
    } finally {
      setActionBusy('')
    }
  }

  type DesktopUploadTarget = { parentID: number; file: File; relativePath?: string }

  const uploadConflictAwareTargets = async (
    resolveTargets: () => Promise<readonly DesktopUploadTarget[]>,
    busyState: 'upload' | 'drop-upload' | 'upload-folder',
    refreshEvenWithoutUploads = false,
    refreshCurrentDirectory = true,
  ) => {
    if (explorerActionBusy) return false
    const expectedCurrentID = current?.id
    try {
      const targets = await resolveTargets()
      const result = await runUploadTargets(targets, busyState)
      const shouldRefresh = result.uploaded > 0 || refreshEvenWithoutUploads
      if (refreshCurrentDirectory && shouldRefresh) {
        await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
      }
      if (result.uploaded > 0) await onQuotaChanged()
      return shouldRefresh
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const uploadConflictAwareFiles = async (
    parentID: number,
    files: File[],
    busyState: 'upload' | 'drop-upload',
    refreshCurrentDirectory = true,
  ) => {
    if (files.length === 0) return false
    return uploadConflictAwareTargets(
      async () => files.map((file) => ({ parentID, file })),
      busyState,
      false,
      refreshCurrentDirectory,
    )
  }

  const resolveFolderUploadTargets = (
    rootParentID: number,
    entries: XDriveFileExplorerExternalDropPayload['files'],
    directoryPaths: readonly string[] = [],
  ) => xDriveFileExplorerResolveFolderUploadTargets({
    rootParentID,
    entries,
    directoryPaths,
    ensureDirectory: (parentID, name) => xDriveFileExplorerEnsureUploadDirectory({
      parentID,
      name,
      createDirectory: async (id, directoryName) => {
        const result = await window.xdriveDesktop.agent.cloudCreateDirectory(id, directoryName)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
      findExistingDirectory: async (id, directoryName) => {
        const result = await window.xdriveDesktop.agent.cloudChildrenPage(
          id,
          xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(directoryName),
        )
        if (!result.ok) throw new Error(result.error.message)
        return result.data.items[0] ?? null
      },
    }),
  })

  const uploadFolderFiles = async (files: File[]) => {
    if (!current || files.length === 0 || !uploadConflictSupported) return
    const expectedCurrentID = current.id
    const entries = files.map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }))
    const label = xDriveFileExplorerUploadGroupLabel(
      entries,
      (file) => file.name,
    )
    const result = await runUploadGroup({
      label,
      path: label,
      action: 'upload-folder',
      itemsTotal: entries.length,
      bytesTotal: entries.reduce((sum, entry) => sum + Math.max(0, entry.file.size), 0),
      resolveTargets: async () => {
        const targets = await resolveFolderUploadTargets(expectedCurrentID, entries)
        return targets.map(({ parentID, file, relativePath }) => ({
          parentID,
          file,
          relativePath,
        }))
      },
    })
    if (result.uploaded > 0 || result.skipped > 0) {
      await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
    }
    if (result.uploaded > 0) await onQuotaChanged()
  }

  const uploadFiles = async () => {
    if (!current || explorerActionBusy) return
    const expectedCurrentID = current.id
    if (uploadConflictSupported) {
      uploadInputRef.current?.click()
      return
    }
    setActionBusy('upload')
    try {
      const result = await window.xdriveDesktop.agent.cloudUploadFiles(expectedCurrentID)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.canceled) return
      if (result.data.uploaded.length > 0) {
        await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
        await onQuotaChanged()
      }
      if (result.data.failures.length > 0) {
        const names = result.data.failures.slice(0, 3).map((failure) => failure.name).join('、')
        const more = result.data.failures.length > 3 ? ' 等' : ''
        onFeedback(
          'warning',
          `已上传 ${result.data.uploaded.length} 个文件，${result.data.failures.length} 个失败：${names}${more}`,
        )
      } else if (result.data.uploaded.length > 0) {
        onFeedback('good', `已上传 ${result.data.uploaded.length} 个文件。`)
      }
    } finally {
      setActionBusy('')
    }
  }

  const createFolder = async (name: string) => {
    if (!current || explorerActionBusy) return
    const expectedCurrentID = current.id
    setActionBusy('create-folder')
    try {
      const result = await window.xdriveDesktop.agent.cloudCreateDirectory(expectedCurrentID, name)
      if (!result.ok) throw new Error(result.error.message)
      await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
      onFeedback('good', '文件夹已创建。')
    } finally {
      setActionBusy('')
    }
  }

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    if (explorerActionBusy) throw new Error('当前有文件操作正在进行，请稍后重试。')
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    const expectedCurrentID = current.id
    setActionBusy('rename-' + node.id)
    try {
      const result = await window.xdriveDesktop.agent.cloudRename(node.id, node.revision, name)
      if (!result.ok) throw new Error(result.error.message)
      clearSearch()
      await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
      onFeedback('good', '已重命名。')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setActionBusy('')
    }
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node) return []

    const standardItems = xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      primaryDisabled: explorerActionBusy,
      onOpen: () => { void openWorkspaceItem(item, openPreviewNode) },
      onOpenInNewTab: node.type === 'dir' && canNewTab
        ? () => { void openItemInNewTab(item) }
        : undefined,
      onToggleQuickAccess: node.type === 'dir' && quickAccessSupported
        ? () => { void quickAccess.toggle(node.id) }
        : undefined,
      quickAccessPinned: quickAccess.pinnedIDs.has(node.id),
      quickAccessDisabled: quickAccess.busyID !== null,
      onToggleFavorite: node.type === 'file' && favoritesSupported
        ? () => { void favorites.toggle(node.id) }
        : undefined,
      favorite: favorites.favoriteIDs.has(node.id),
      favoriteDisabled: favorites.busyID !== null,
      onSystemOpen: node.type === 'file'
        ? () => { void openLocalNode(node) }
        : undefined,
      onDownload: node.type === 'file'
        ? () => { void downloadNode(node) }
        : (folderTreeDownloadSupported || archiveDownloadSupported)
          ? () => { void downloadSelected([item]) }
          : undefined,
      downloadLabel: node.type === 'file' ? '另存为…' : '下载到…',
      onReveal: () => { void openLocalNode(node, true) },
      onShare: node.type === 'file' ? () => onOpenShares(node) : undefined,
      onHistory: node.type === 'file'
        ? () => onOpenHistory(node, searchByID.get(node.id)?.crumbs ?? crumbs)
        : undefined,
      onDelete: () => onDelete(node),
    })
    const desktopItems = node.type === 'file' && openWithSupported
      ? [
          ...standardItems,
          {
            id: 'open-with',
            label: '打开方式…',
            icon: <AppsRoundedIcon fontSize="small" />,
            disabled: explorerActionBusy,
            onSelect: () => { void openLocalNodeWith(node) },
          } satisfies XDriveFileExplorerMenuItem,
        ]
      : standardItems

    if (!fileAvailabilitySupported) return desktopItems

    const state = availabilityByID.get(node.id)?.state
    if (!state) return desktopItems

    const availabilityItems: XDriveFileExplorerMenuItem[] = []
    if (!state.Syncing && !state.Pinned && state.Mode !== 'always-local') {
      availabilityItems.push({
        id: 'availability-keep',
        label: '始终保留在此设备上',
        icon: <CheckCircleRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />,
        dividerBefore: true,
        disabled: explorerActionBusy,
        onSelect: () => { void setNodeAvailability(node, 'keep') },
      })
    }
    if (
      !state.Syncing &&
      state.Placeholder &&
      state.InSync &&
      !state.OnlineOnly &&
      state.Mode !== 'cloud'
    ) {
      availabilityItems.push({
        id: 'availability-release',
        label: '释放空间',
        icon: <CloudOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} />,
        dividerBefore: availabilityItems.length === 0,
        disabled: explorerActionBusy,
        onSelect: () => { void setNodeAvailability(node, 'release') },
      })
    }
    return [...desktopItems, ...availabilityItems]
  }

  async function downloadSelected(selected: XDriveFileExplorerItem[]) {
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    if (nodes.length === 0 || explorerActionBusy) return

    if (
      folderTreeDownloadSupported &&
      nodes.length === 1 &&
      nodes[0].type === 'dir'
    ) {
      const folder = nodes[0]
      if (!folder.parent_id) {
        onError('无法确定文件夹父目录。')
        return
      }
      setActionBusy('download-folder')
      try {
        const result = await window.xdriveDesktop.agent.cloudDownloadFolder(
          folder.id,
          folder.parent_id,
        )
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        if (result.data.canceled) return
        if (result.data.failed > 0) {
          onFeedback('warning', `已下载 ${result.data.downloaded} 个文件，${result.data.failed} 个失败。`)
        } else {
          onFeedback('good', `${result.data.root || folder.name} 下载完成，共 ${result.data.downloaded} 个文件。`)
        }
      } finally {
        setActionBusy('')
      }
      return
    }

    if (archiveDownloadSupported) {
      const archivePlan = xDriveFileExplorerArchiveDownloadPlan(nodes)
      if (archivePlan.kind === 'none') return
      if (archivePlan.kind === 'file') {
        await downloadNode(archivePlan.file)
        return
      }
      setActionBusy('download-archive')
      try {
        const result = await window.xdriveDesktop.agent.cloudDownloadArchive(archivePlan.ids)
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        if (result.data.canceled) return
        const feedback = xDriveFileExplorerDesktopArchiveDownloadFeedback(result.data.downloaded.length)
        onFeedback(feedback.tone, feedback.message)
      } finally {
        setActionBusy('')
      }
      return
    }

    const plan = xDriveFileExplorerDownloadPlan(nodes)
    if (plan.files.length === 0) return
    setActionBusy('download-many')
    try {
      const result = await window.xdriveDesktop.agent.cloudDownloadFiles(plan.items)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.canceled) return
      const feedback = xDriveFileExplorerDesktopDownloadFeedback({
        downloaded: result.data.downloaded.length,
        failed: result.data.failures.length,
        skippedFolders: plan.skippedFolders,
      })
      onFeedback(feedback.tone, feedback.message)
    } finally {
      setActionBusy('')
    }
  }

  const {
    dropFiles: dropExternalFiles,
    dropFilesToCrumb: dropExternalFilesToCrumb,
    dropFolderEntries: dropExternalFolderEntries,
    dropFolderEntriesToCrumb: dropExternalFolderEntriesToCrumb,
  } = useXDriveFileExplorerExternalDropController<
    AgentCloudNode,
    AgentCloudCrumb,
    XDriveFileExplorerSort
  >({
    currentID: current?.id,
    currentCrumbs: crumbs,
    sort,
    currentGrouping: grouping,
    nodeByID,
    disabled: explorerActionBusy,
    folderDropEnabled: uploadConflictSupported,
    uploadFilesToParent: async (parentID, files) => {
      if (uploadConflictSupported) {
        return uploadConflictAwareFiles(parentID, files, 'drop-upload', false)
      }
      setActionBusy('drop-upload')
      try {
        const result = await window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)
        if (!result.ok) {
          onError(result.error.message)
          return false
        }
        if (result.data.failures.length > 0) {
          onFeedback('warning', `已上传 ${result.data.uploaded.length} 个文件，${result.data.failures.length} 个失败。`)
        } else {
          onFeedback('good', `已上传 ${result.data.uploaded.length} 个文件。`)
        }
        await onQuotaChanged()
        return true
      } finally {
        setActionBusy('')
      }
    },
    uploadFolderEntriesToParent: async (parentID, payload) => {
      const label = xDriveFileExplorerUploadGroupLabel(
        payload.files,
        (file) => file.name,
      )
      const result = await runUploadGroup({
        label,
        path: label,
        action: 'drop-upload',
        itemsTotal: payload.files.length,
        bytesTotal: payload.files.reduce((sum, entry) => sum + Math.max(0, entry.file.size), 0),
        resolveTargets: async () => {
          const targets = await resolveFolderUploadTargets(
            parentID,
            payload.files,
            payload.directories,
          )
          return targets.map(({ parentID: targetParentID, file, relativePath }) => ({
            parentID: targetParentID,
            file,
            relativePath,
          }))
        },
      })
      if (result.uploaded > 0) await onQuotaChanged()
      return result.uploaded > 0 || result.skipped > 0
    },
    refreshCurrentDirectoryIfIdle: onRefreshCurrentDirectoryIfIdle,
  })

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder: () => setCreateOpen(true),
    onUpload: () => { void uploadFiles() },
    onUploadFolder: uploadConflictSupported
      ? () => folderUploadInputRef.current?.click()
      : undefined,
    uploadDisabled: explorerActionBusy,
    onRefresh: refresh,
  })

  return (
    <>
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (current) void uploadConflictAwareFiles(current.id, files, 'upload')
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
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void uploadFolderFiles(files)
        }}
      />

      <XDriveFileExplorer
        presentation="workspace"
        keyboardProfile={keyboardProfile}
        items={trashActive ? trash.items : explorerItems}
        crumbs={trashActive ? trash.crumbs : explorerCrumbs}
        virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}
        loading={trashActive ? trash.loading : loading || searchLoading || explorerActionBusy}
        emptyMessage={trashActive ? '回收站为空' : undefined}
        loadThumbnail={loadThumbnail}
        loadTextPreview={textPreviewSupported ? loadTextPreview : undefined}
        loadPreviewURL={previewStreamSupported ? loadPreviewURL : undefined}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPropertiesStats={propertiesStatsSupported ? loadPropertiesStats : undefined}
        getItemStatus={fileAvailabilitySupported ? getItemStatus : undefined}
        getItemAvailability={fileAvailabilitySupported ? getItemAvailability : undefined}
        pathValue={trashActive ? '回收站' : pathValue}
        onPathSubmit={trashActive ? undefined : (path) => { void submitPath(path) }}
        searchEnabled={!trashActive}
        searchValue={trashActive ? '' : searchValue}
        onSearchValueChange={changeSearchValue}
        onSearch={(query) => { void submitSearch(query) }}
        canGoBack={!trashActive && canGoBack}
        canGoForward={!trashActive && canGoForward}
        canGoUp={!trashActive && canGoUp}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={trashActive ? () => { void trash.refresh() } : refresh}
        onCrumbClick={trashActive ? undefined : (_crumb, index) => { void navigateToCrumb(index) }}
        onCreateFolder={trashActive ? undefined : () => setCreateOpen(true)}
        onUpload={trashActive ? undefined : () => { void uploadFiles() }}
        onUploadFolder={!trashActive && uploadConflictSupported
          ? () => folderUploadInputRef.current?.click()
          : undefined}
        onOpenItem={trashActive ? undefined : (item) => { void openWorkspaceItem(item, openPreviewNode) }}
        onOpenItemInNewTab={!trashActive && canNewTab
          ? (item) => { void openItemInNewTab(item) }
          : undefined}
        onPreviewItem={trashActive ? undefined : (item) => { void recent.record(Number(item.id)) }}
        onNativeDragOutItem={!trashActive && nativeDragOutSupported
          ? startNativeDragOut
          : undefined}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={trashActive ? trashSort : sort}
        onSortChange={trashActive ? setTrashSort : changeSort}
        grouping={trashActive ? undefined : grouping}
        onGroupingChange={trashActive ? undefined : changeGrouping}
        groupingEnabled={!trashActive}
        externallySorted={trashActive ? Boolean(trash.virtualCollection) : externallySorted}
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={DESKTOP_FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={trashActive ? undefined : copyItems}
        onCopyPaths={trashActive ? undefined : copyItemPaths}
        onCutItems={trashActive ? undefined : cutItems}
        onPaste={trashActive ? undefined : () => { void pasteClipboard() }}
        canPaste={!trashActive && fileOperationCanPaste}
        canUndo={!trashActive && canUndo}
        onUndo={trashActive ? undefined : onUndo}
        canRedo={!trashActive && canRedo}
        onRedo={trashActive ? undefined : onRedo}
        onDownloadItems={trashActive ? undefined : (selected) => { void downloadSelected(selected) }}
        folderDownloadSupported={!trashActive && (folderTreeDownloadSupported || archiveDownloadSupported)}
        onDeleteItems={trashActive ? undefined : (selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onDeleteMany(nodes)
        }}
        onRenameItem={trashActive ? undefined : renameItem}
        renameDisabled={trashActive || explorerActionBusy}
        onDropItemsToFolder={trashActive ? undefined : (selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onDropItemsToCrumb={trashActive ? undefined : (selected, crumb, operation) => { void dropItemsToCrumb(selected, crumb, operation) }}
        onExternalFilesDrop={trashActive ? undefined : (files, target) => { void dropExternalFiles(files, target) }}
        onExternalFilesDropToCrumb={trashActive ? undefined : (files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
        onExternalFolderDrop={!trashActive && uploadConflictSupported
          ? (payload, target) => { void dropExternalFolderEntries(payload, target) }
          : undefined}
        onExternalFolderDropToCrumb={!trashActive && uploadConflictSupported
          ? (payload, crumb) => { void dropExternalFolderEntriesToCrumb(payload, crumb) }
          : undefined}
        getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}
        backgroundMenuItems={trashActive ? [] : backgroundMenuItems}
        tabBar={trashActive ? undefined : (
          <XDriveFileExplorerTabs
            tabs={tabs}
            activeTabID={activeTabID}
            canNewTab={canNewTab}
            canCloseTab={canCloseTab}
            canRestoreClosedTab={canRestoreClosedTab}
            onActivate={(id) => { void activateTab(id) }}
            onNewTab={() => { void newTab() }}
            onCloseTab={(id) => { void closeTab(id) }}
            onReorderTab={(sourceID, targetID, position) => {
              reorderTab(sourceID, targetID, position)
            }}
            onDuplicateTab={(id) => { void duplicateTab(id) }}
            onCloseOtherTabs={(id) => { void closeOtherTabs(id) }}
            onCloseTabsToRight={(id) => { void closeTabsToRight(id) }}
            onRestoreClosedTab={() => { void restoreClosedTab() }}
          />
        )}
        onNewTab={!trashActive && canNewTab ? () => { void newTab() } : undefined}
        onCloseTab={!trashActive && canCloseTab ? () => { void closeTab() } : undefined}
        onRestoreClosedTab={!trashActive && canRestoreClosedTab
          ? () => { void restoreClosedTab() }
          : undefined}
        onActivateTabAtIndex={!trashActive
          ? (index) => {
              const tab = tabs[index]
              if (tab) void activateTab(tab.id)
            }
          : undefined}
        onNextTab={!trashActive && tabs.length > 1 ? () => { void nextTab() } : undefined}
        onPreviousTab={!trashActive && tabs.length > 1 ? () => { void previousTab() } : undefined}
        commandBarEnd={trashActive ? undefined : (
          <XDriveFileExplorerSearchFilters
            filters={searchFilters}
            sourceOptions={searchSourceOptions}
            availabilityOptions={fileAvailabilitySupported ? desktopSearchAvailabilityOptions : []}
            onChange={changeSearchFilters}
          />
        )}
        navigationPane={(
          <XDriveFileExplorerNavigationPane
            currentCrumbs={crumbs}
            trashActive={trashActive}
            onNavigateTrash={onOpenTrash}
            loadDirectoryPage={loadTreeDirectoryPage}
            onNavigate={(nextCrumbs) => {
              onCloseTrash()
              void navigateTo(nextCrumbs)
            }}
            dropDisabled={trashActive || explorerActionBusy}
            onDropInternalItems={(itemIDs, target, operation) => {
              void dropItemsToCrumb(
                itemIDs.map((id) => ({ id })),
                target,
                operation,
              )
            }}
            onExternalFilesDrop={(files, target) => {
              void dropExternalFilesToCrumb(files, target)
            }}
            onExternalFolderDrop={uploadConflictSupported
              ? (payload, target) => {
                  void dropExternalFolderEntriesToCrumb(payload, target)
                }
              : undefined}
            quickAccessEnabled={quickAccessSupported}
            quickAccessItems={quickAccess.items}
            quickAccessLoading={quickAccess.loading}
            quickAccessBusyID={quickAccess.busyID}
            currentQuickAccessPinned={Boolean(current && quickAccess.pinnedIDs.has(current.id))}
            onNavigateQuickAccess={(nodeID) => {
              onCloseTrash()
              const navigationIntentID = beginNavigationIntent()
              void quickAccess.navigate(
                nodeID,
                (nextCrumbs) => navigateTo(nextCrumbs, true, navigationIntentID),
              )
            }}
            onToggleCurrentQuickAccess={() => {
              if (current) void quickAccess.toggle(current.id)
            }}
            onUnpinQuickAccess={(nodeID) => { void quickAccess.unpin(nodeID) }}
            favoritesEnabled={favoritesSupported}
            favoriteItems={favorites.items}
            favoritesLoading={favorites.loading}
            favoriteBusyID={favorites.busyID}
            onActivateFavorite={(nodeID) => {
              onCloseTrash()
              const navigationIntentID = beginNavigationIntent()
              void favorites.activate(nodeID, (node) => (
                isNavigationIntentCurrent(navigationIntentID)
                  ? openLocalNode(node)
                  : undefined
              ))
            }}
            onUnfavorite={(nodeID) => { void favorites.unfavorite(nodeID) }}
            recentEnabled={recentSupported}
            recentItems={recent.items}
            recentLoading={recent.loading}
            onActivateRecent={(nodeID) => {
              onCloseTrash()
              const navigationIntentID = beginNavigationIntent()
              void recent.activate(nodeID, {
                onDirectory: (nextCrumbs) => (
                  navigateTo(nextCrumbs, true, navigationIntentID)
                ),
                onFile: (item) => {
                  if (!isNavigationIntentCurrent(navigationIntentID)) return false
                  openLocalNode(item.node)
                  return true
                },
              })
            }}
            onClearRecent={() => { void recent.clear() }}
            getItemAvailability={fileAvailabilitySupported ? getItemAvailability : undefined}
            onAvailabilityItemsChange={
              fileAvailabilitySupported ? handleNavigationAvailabilityItemsChange : undefined
            }
            onError={(error) => onError(error instanceof Error ? error.message : String(error))}
          />
        )}
        statusText={trashActive
          ? (trash.working ? '正在处理回收站项目…' : `${trash.itemCount} 个回收站项目`)
          : searchStatusText ?? (
          (actionBusy === 'upload' || uploadBusyAction === 'upload')
            ? '正在上传…'
            : fileOperationBusyAction === 'paste'
              ? '正在粘贴…'
              : actionBusy === 'download-many'
                ? '正在批量下载…'
                : actionBusy === 'download-folder'
                  ? '正在下载文件夹…'
                : actionBusy === 'download-archive'
                  ? '正在下载归档…'
                : fileOperationBusyAction === 'drop-items'
                  ? '正在处理拖拽项目…'
                  : uploadBusyAction === 'drop-upload'
                    ? '正在上传拖入文件…'
                  : uploadBusyAction === 'upload-folder'
                    ? '正在上传文件夹…'
                  : actionBusy.startsWith('rename-')
                    ? '正在重命名…'
              : actionBusy.startsWith('download-')
              ? '正在另存为…'
              : actionBusy.startsWith('open-')
                ? '正在打开…'
                : actionBusy.startsWith('reveal-')
                  ? '正在定位…'
                  : undefined
        )}
      />

      <XDriveFileExplorerTrashDeleteDialog
        target={trash.deleteTarget}
        loading={trash.workingKey.startsWith('delete:')}
        onCancel={trash.cancelPermanentDelete}
        onConfirm={() => { void trash.confirmPermanentDelete() }}
      />
      <XDriveOpenPreviewDialog
        open={Boolean(openPreviewItem)}
        title={openPreviewItem?.name ?? ''}
        onClose={() => setOpenPreviewItem(null)}
      >
        <XDriveFilePreviewSurface
          target={openPreviewItem}
          loadTextPreview={loadTextPreview}
          loadImagePreview={loadThumbnail}
          loadPreviewURL={loadPreviewURL}
          loadLivePhotoMotion={loadLivePhotoMotion}
          fallback={(
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
              此文件暂无可用预览
            </Box>
          )}
          minHeight={320}
          maxHeight={760}
        />
      </XDriveOpenPreviewDialog>

      <XDriveUploadConflictDialog {...uploadConflictDialogProps} />

      <XDriveFileNameDialog
        open={createOpen}
        mode="create-folder"
        onClose={() => setCreateOpen(false)}
        onSubmit={createFolder}
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
      />

    </>
  )
}
