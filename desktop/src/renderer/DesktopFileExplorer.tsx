import { useCallback, useRef, useState } from 'react'
import { Box } from '@mui/material'
import {
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
} from '@xdrive/shared'
import {
  XDriveFileExplorer,
  XDriveFileExplorerNavigationPane,
  XDriveFilePreviewSurface,
  XDriveOpenPreviewDialog,
  XDriveFileExplorerTabs,
  XDriveFileNameDialog,
  XDriveFileExplorerTrashCommandButton,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerWorkspace,
  useXDriveFileExplorerQuickAccess,
  useXDriveFileExplorerRecent,
  useXDriveFileExplorerOperationController,
  useXDriveFileExplorerExternalDropController,
  useXDriveFileExplorerUploadController,
  xDriveFileExplorerUploadGroupLabel,
  XDriveUploadConflictDialog,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
  XDriveFileExplorerWorkspaceVirtualDirectory,
} from '@xdrive/ui/mui'

const DESKTOP_FILE_VIEW_KEY = 'xdrive.desktop.files.view_mode'
const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'
const DESKTOP_FILE_VIEW_PREFERENCES_KEY = 'xdrive.desktop.files.view_preferences'

export default function DesktopFileExplorer({
  items,
  crumbs,
  virtualDirectory,
  loading,
  loadingMore,
  hasMore,
  onLoadDirectory,
  onLoadMore,
  onOpenTrash,
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
  quickAccessSupported = false,
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
  loadingMore: boolean
  hasMore: boolean
  onLoadDirectory: (id: number, crumbs: AgentCloudCrumb[], sort: XDriveFileExplorerSort) => Promise<void>
  onLoadMore: (id: number, sort: XDriveFileExplorerSort) => Promise<void>
  onOpenTrash: () => void
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
  quickAccessSupported?: boolean
  recentSupported?: boolean
  transferLifecycleSupported?: boolean
  keyboardProfile?: XDriveFileExplorerKeyboardProfile
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [openPreviewItem, setOpenPreviewItem] = useState<XDriveFileExplorerItem | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const recent = useXDriveFileExplorerRecent<AgentCloudNode>({
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
    searchLoading,
    changeSearchValue,
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
    explorerPagination,
    explorerVirtualCollection,
    externallySorted,
    searchStatusText,
    tabs,
    activeTabID,
    newTab,
    activateTab,
    closeTab,
    nextTab,
    previousTab,
    canNewTab,
    canCloseTab,
  } = useXDriveFileExplorerWorkspace<AgentCloudNode, AgentCloudSearchResult>({
    items,
    crumbs,
    directoryVirtualCollection: virtualDirectory,
    viewModeStorageKey: DESKTOP_FILE_VIEW_KEY,
    directoryHasMore: hasMore,
    directoryLoadingMore: loadingMore,
    onLoadDirectory,
    onLoadMoreDirectory: onLoadMore,
    loadSearchRange: async (query, searchSort, offset, limit) => {
      const result = await window.xdriveDesktop.agent.cloudSearchRange(
        query,
        offset,
        limit,
        searchSort.key,
        searchSort.direction,
      )
      if (!result.ok) throw new Error(result.error.message)
      return {
        items: result.data.items,
        totalCount: result.data.total_count,
        offset: result.data.offset,
        limit: result.data.limit,
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

  const {
    busy: uploadBusy,
    busyAction: uploadBusyAction,
    runTargets: runUploadTargets,
    runGroup: runUploadGroup,
    dialogProps: uploadConflictDialogProps,
  } = useXDriveFileExplorerUploadController<File>({
    disabled: Boolean(actionBusy),
    continueOnUploadError: true,
    fileName: (file) => file.name,
    fileSize: (file) => file.size,
    preflight: async (parentID, file) => {
      const result = await window.xdriveDesktop.agent.cloudUploadPreflight(parentID, file.name)
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
    if (!result.ok) return null
    const contentType = result.data.content_type || 'image/jpeg'
    const blob = new Blob([result.data.data], { type: contentType })
    return URL.createObjectURL(blob)
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
    try {
      const targets = await resolveTargets()
      const result = await runUploadTargets(targets, busyState)
      const shouldRefresh = result.uploaded > 0 || refreshEvenWithoutUploads
      if (refreshCurrentDirectory && shouldRefresh && current) {
        await onLoadDirectory(current.id, crumbs, sort)
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
        const targets = await resolveFolderUploadTargets(current.id, entries)
        return targets.map(({ parentID, file, relativePath }) => ({
          parentID,
          file,
          relativePath,
        }))
      },
    })
    if ((result.uploaded > 0 || result.skipped > 0) && current) {
      await onLoadDirectory(current.id, crumbs, sort)
    }
    if (result.uploaded > 0) await onQuotaChanged()
  }

  const uploadFiles = async () => {
    if (!current || explorerActionBusy) return
    if (uploadConflictSupported) {
      uploadInputRef.current?.click()
      return
    }
    setActionBusy('upload')
    try {
      const result = await window.xdriveDesktop.agent.cloudUploadFiles(current.id)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.canceled) return
      if (result.data.uploaded.length > 0) {
        await onLoadDirectory(current.id, crumbs, sort)
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
    setActionBusy('create-folder')
    try {
      const result = await window.xdriveDesktop.agent.cloudCreateDirectory(current.id, name)
      if (!result.ok) throw new Error(result.error.message)
      await onLoadDirectory(current.id, crumbs, sort)
      onFeedback('good', '文件夹已创建。')
    } finally {
      setActionBusy('')
    }
  }

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    if (explorerActionBusy) throw new Error('当前有文件操作正在进行，请稍后重试。')
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    setActionBusy('rename-' + node.id)
    try {
      const result = await window.xdriveDesktop.agent.cloudRename(node.id, node.revision, name)
      if (!result.ok) throw new Error(result.error.message)
      clearSearch()
      await onLoadDirectory(current.id, crumbs, sort)
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

    return xDriveFileExplorerStandardItemMenuItems({
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
    refreshDirectory: onLoadDirectory,
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
        items={explorerItems}
        crumbs={explorerCrumbs}
        virtualCollection={explorerVirtualCollection}
        loading={loading || searchLoading || explorerActionBusy}
        loadThumbnail={loadThumbnail}
        loadTextPreview={textPreviewSupported ? loadTextPreview : undefined}
        loadPreviewURL={previewStreamSupported ? loadPreviewURL : undefined}
        pathValue={pathValue}
        onPathSubmit={(path) => { void submitPath(path) }}
        searchValue={searchValue}
        onSearchValueChange={changeSearchValue}
        onSearch={(query) => { void submitSearch(query) }}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canGoUp={canGoUp}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={refresh}
        onCrumbClick={(_crumb, index) => { void navigateToCrumb(index) }}
        onCreateFolder={() => setCreateOpen(true)}
        onUpload={() => { void uploadFiles() }}
        onUploadFolder={uploadConflictSupported
          ? () => folderUploadInputRef.current?.click()
          : undefined}
        onOpenItem={(item) => { void openWorkspaceItem(item, openPreviewNode) }}
        onPreviewItem={(item) => { void recent.record(Number(item.id)) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={externallySorted}
        hasMore={explorerPagination.hasMore}
        loadingMore={explorerPagination.loadingMore}
        onLoadMore={explorerPagination.onLoadMore}
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={DESKTOP_FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={copyItems}
        onCopyPaths={copyItemPaths}
        onCutItems={cutItems}
        onPaste={() => { void pasteClipboard() }}
        canPaste={fileOperationCanPaste}
        canUndo={canUndo}
        onUndo={onUndo}
        canRedo={canRedo}
        onRedo={onRedo}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        folderDownloadSupported={folderTreeDownloadSupported || archiveDownloadSupported}
        onDeleteItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onDeleteMany(nodes)
        }}
        onRenameItem={renameItem}
        renameDisabled={explorerActionBusy}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onDropItemsToCrumb={(selected, crumb, operation) => { void dropItemsToCrumb(selected, crumb, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        onExternalFilesDropToCrumb={(files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
        onExternalFolderDrop={uploadConflictSupported
          ? (payload, target) => { void dropExternalFolderEntries(payload, target) }
          : undefined}
        onExternalFolderDropToCrumb={uploadConflictSupported
          ? (payload, crumb) => { void dropExternalFolderEntriesToCrumb(payload, crumb) }
          : undefined}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        tabBar={(
          <XDriveFileExplorerTabs
            tabs={tabs}
            activeTabID={activeTabID}
            canNewTab={canNewTab}
            canCloseTab={canCloseTab}
            onActivate={(id) => { void activateTab(id) }}
            onNewTab={() => { void newTab() }}
            onCloseTab={(id) => { void closeTab(id) }}
          />
        )}
        onNewTab={canNewTab ? () => { void newTab() } : undefined}
        onCloseTab={canCloseTab ? () => { void closeTab() } : undefined}
        onNextTab={tabs.length > 1 ? () => { void nextTab() } : undefined}
        onPreviousTab={tabs.length > 1 ? () => { void previousTab() } : undefined}
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        navigationPane={(
          <XDriveFileExplorerNavigationPane
            currentCrumbs={crumbs}
            loadDirectoryPage={loadTreeDirectoryPage}
            onNavigate={(nextCrumbs) => { void navigateTo(nextCrumbs) }}
            quickAccessEnabled={quickAccessSupported}
            quickAccessItems={quickAccess.items}
            quickAccessLoading={quickAccess.loading}
            quickAccessBusyID={quickAccess.busyID}
            currentQuickAccessPinned={Boolean(current && quickAccess.pinnedIDs.has(current.id))}
            onNavigateQuickAccess={(nodeID) => {
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
            recentEnabled={recentSupported}
            recentItems={recent.items}
            recentLoading={recent.loading}
            onActivateRecent={(nodeID) => {
              const navigationIntentID = beginNavigationIntent()
              void recent.activate(nodeID, {
                onDirectory: (nextCrumbs) => (
                  navigateTo(nextCrumbs, true, navigationIntentID)
                ),
                onFile: (item) => (
                  isNavigationIntentCurrent(navigationIntentID)
                    ? openLocalNode(item.node)
                    : undefined
                ),
              })
            }}
            onClearRecent={() => { void recent.clear() }}
            onError={(error) => onError(error instanceof Error ? error.message : String(error))}
          />
        )}
        statusText={searchStatusText ?? (
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
