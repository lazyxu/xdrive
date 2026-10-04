import { useCallback, useRef, useState } from 'react'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerDesktopDownloadFeedback,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerDispatchOpenItem,
  xDriveFileExplorerDownloadPlan,
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerDropItemsToParentPlan,
  xDriveFileExplorerEnsureUploadDirectory,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerPaginationController,
  xDriveFileExplorerResolveFolderUploadTargets,
  xDriveFileExplorerRunQueuedOperation,
  xDriveFileExplorerSubmitPath,
  xDriveUploadBatchSummary,
  xDriveUploadConflictCanOverwrite,
} from '@xdrive/shared'
import {
  XDriveFileExplorer,
  XDriveFileNameDialog,
  useXDriveFileExplorerClipboard,
  XDriveFileExplorerTrashCommandButton,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerNavigation,
  useXDriveFileExplorerProjection,
  useXDriveFileExplorerSearch,
  XDriveUploadConflictDialog,
  useXDriveUploadConflictResolver,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerQueuedOperationPlan,
  XDriveUploadConflictPolicy,
} from '@xdrive/shared'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
} from '@xdrive/ui/mui'

const DESKTOP_FILE_VIEW_KEY = 'xdrive.desktop.files.view_mode'
const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'

export default function DesktopFileExplorer({
  items,
  crumbs,
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
  onQuotaChanged,
  uploadConflictSupported = false,
  onError,
  onFeedback,
}: {
  items: AgentCloudNode[]
  crumbs: AgentCloudCrumb[]
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
  onQuotaChanged: () => Promise<unknown>
  uploadConflictSupported?: boolean
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const {
    searchValue,
    searchState,
    searchResults,
    searchCursor,
    searchLoading,
    searchLoadingMore,
    changeSearchValue,
    clearSearch,
    submitSearch,
    loadMoreSearch,
  } = useXDriveFileExplorerSearch<AgentCloudSearchResult>({
    loadPage: async (query, cursor) => {
      const result = await window.xdriveDesktop.agent.cloudSearch(query, cursor)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadConflicts = useXDriveUploadConflictResolver()

  const {
    nodeByID,
    searchByID,
    explorerItems,
    explorerCrumbs,
  } = useXDriveFileExplorerProjection({
    items,
    crumbs,
    searchResults,
  })

  const {
    copyItems,
    cutItems,
    planPaste,
    completePaste,
    canPaste,
  } = useXDriveFileExplorerClipboard<AgentCloudNode>({
    nodeByID,
  })

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    const result = await window.xdriveDesktop.agent.getMediaThumbnail(Number(item.id))
    if (!result.ok) return null
    const contentType = result.data.content_type || 'image/jpeg'
    return `data:${contentType};base64,${result.data.data_base64}`
  }, [])

  const {
    current,
    pathValue,
    viewMode,
    setViewMode,
    sort,
    changeSort,
    refresh,
    navigateTo,
    navigateToCrumb,
    goBack,
    goForward,
    goUp,
    canGoBack,
    canGoForward,
    canGoUp,
  } = useXDriveFileExplorerNavigation({
    crumbs,
    viewModeStorageKey: DESKTOP_FILE_VIEW_KEY,
    searchActive: Boolean(searchResults),
    onLoadDirectory,
    onAfterNavigate: clearSearch,
  })

  const submitPath = async (rawPath: string) => {
    try {
      await xDriveFileExplorerSubmitPath({
        rawPath,
        currentCrumbs: crumbs,
        loadRoot: async () => {
          const result = await window.xdriveDesktop.agent.cloudRoot()
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        },
        listChildren: async (parentID) => {
          const result = await window.xdriveDesktop.agent.cloudChildren(parentID)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        },
        navigate: navigateTo,
      })
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

  type DesktopUploadTarget = { parentID: number; file: File }

  const uploadConflictAwareTargets = async (
    resolveTargets: () => Promise<readonly DesktopUploadTarget[]>,
    busyState: 'upload' | 'drop-upload' | 'upload-folder',
    refreshEvenWithoutUploads = false,
  ) => {
    if (actionBusy) return
    if (!uploadConflicts.beginBatch()) return
    setActionBusy(busyState)
    let uploaded = 0
    let skipped = 0
    let failed = 0
    let cancelled = false
    let fatalError = ''
    try {
      const targets = await resolveTargets()
      for (const target of targets) {
        const { parentID, file } = target
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'
        const preflight = await window.xdriveDesktop.agent.cloudUploadPreflight(parentID, file.name)
        if (!preflight.ok) {
          fatalError = preflight.error.message
          break
        }
        if (preflight.data.conflict) {
          const decision = await uploadConflicts.resolveConflict(file.name, {
            canOverwrite: xDriveUploadConflictCanOverwrite(preflight.data),
          })
          if (decision === 'cancel') {
            cancelled = true
            break
          }
          conflictPolicy = decision
        }
        if (conflictPolicy === 'skip') {
          skipped += 1
          continue
        }
        const result = await window.xdriveDesktop.agent.cloudUploadFile(
          parentID,
          file,
          conflictPolicy,
        )
        if (!result.ok) {
          failed += 1
          continue
        }
        if (result.data.skipped) skipped += 1
        else uploaded += 1
      }

      if ((uploaded > 0 || refreshEvenWithoutUploads) && current) {
        await onLoadDirectory(current.id, crumbs, sort)
      }
      if (uploaded > 0) await onQuotaChanged()
      if (fatalError) {
        onError(fatalError)
        return
      }
      const summary = xDriveUploadBatchSummary({ uploaded, skipped, failed, cancelled })
      if (summary) onFeedback(summary.tone, summary.message)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      uploadConflicts.endBatch()
      setActionBusy('')
    }
  }

  const uploadConflictAwareFiles = async (
    parentID: number,
    files: File[],
    busyState: 'upload' | 'drop-upload',
  ) => {
    if (files.length === 0) return
    await uploadConflictAwareTargets(
      async () => files.map((file) => ({ parentID, file })),
      busyState,
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
      listChildren: async (id) => {
        const result = await window.xdriveDesktop.agent.cloudChildren(id)
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      },
    }),
  })

  const uploadFolderFiles = async (files: File[]) => {
    if (!current || files.length === 0 || !uploadConflictSupported) return
    await uploadConflictAwareTargets(
      async () => {
        const targets = await resolveFolderUploadTargets(
          current.id,
          files.map((file) => ({
            file,
            relativePath: file.webkitRelativePath || file.name,
          })),
        )
        return targets.map(({ parentID, file }) => ({ parentID, file }))
      },
      'upload-folder',
      true,
    )
  }

  const uploadFiles = async () => {
    if (!current || actionBusy) return
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
    if (!current) return
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
    if (actionBusy) throw new Error('当前有文件操作正在进行，请稍后重试。')
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

  const openItem = async (item: XDriveFileExplorerItem) => {
    await xDriveFileExplorerDispatchOpenItem({
      item,
      nodeByID,
      currentCrumbs: crumbs,
      searchCrumbsForNode: (node) => searchByID.get(node.id)?.crumbs,
      openFile: openLocalNode,
      navigate: navigateTo,
    })
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node) return []

    return xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      primaryDisabled: Boolean(actionBusy),
      onOpen: node.type === 'dir'
        ? () => { void openItem(item) }
        : () => { void openLocalNode(node) },
      onDownload: node.type === 'file' ? () => { void downloadNode(node) } : undefined,
      downloadLabel: '另存为…',
      onReveal: () => { void openLocalNode(node, true) },
      onShare: node.type === 'file' ? () => onOpenShares(node) : undefined,
      onHistory: node.type === 'file'
        ? () => onOpenHistory(node, searchByID.get(node.id)?.crumbs ?? crumbs)
        : undefined,
      onDelete: () => onDelete(node),
    })
  }

  const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    const plan = xDriveFileExplorerDownloadPlan(nodes)
    if (plan.files.length === 0 || actionBusy) return
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

  const runQueuedOperation = (
    plan: XDriveFileExplorerQueuedOperationPlan,
    onComplete: () => void,
  ) => xDriveFileExplorerRunQueuedOperation({
    plan,
    submit: async () => {
      const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
        plan.operation,
        plan.items,
        plan.parentID,
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onQueued: (queued) => onOperationQueued(queued),
    onFeedback,
    onComplete,
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })

  const pasteClipboard = async () => {
    if (!current || actionBusy) return
    const plan = planPaste(current.id)
    if (!plan) return
    setActionBusy('paste')
    try {
      await runQueuedOperation(plan, () => {
        completePaste(plan)
        clearSearch()
      })
    } finally {
      setActionBusy('')
    }
  }

  const dropItemsToFolder = async (
    selected: XDriveFileExplorerItem[],
    target: XDriveFileExplorerItem,
    operation: 'move' | 'copy',
  ) => {
    if (actionBusy) return
    const plan = xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)
    if (!plan) return
    setActionBusy('drop-items')
    try {
      await runQueuedOperation(plan, clearSearch)
    } finally {
      setActionBusy('')
    }
  }

  const dropItemsToCrumb = async (
    selected: XDriveFileExplorerItem[],
    crumb: XDriveFileExplorerCrumb,
    operation: 'move' | 'copy',
  ) => {
    if (actionBusy) return
    const plan = xDriveFileExplorerDropItemsToParentPlan(
      operation,
      selected,
      Number(crumb.id),
      nodeByID,
    )
    if (!plan) return
    setActionBusy('drop-items')
    try {
      await runQueuedOperation(plan, clearSearch)
    } finally {
      setActionBusy('')
    }
  }

  const dropExternalFilesToParent = async (files: File[], parentID: number) => {
    if (files.length === 0 || actionBusy) return
    if (uploadConflictSupported) {
      await uploadConflictAwareFiles(parentID, files, 'drop-upload')
      return
    }
    setActionBusy('drop-upload')
    try {
      const result = await window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.failures.length > 0) {
        onFeedback('warning', `已上传 ${result.data.uploaded.length} 个文件，${result.data.failures.length} 个失败。`)
      } else {
        onFeedback('good', `已上传 ${result.data.uploaded.length} 个文件。`)
      }
      if (current) await onLoadDirectory(current.id, crumbs, sort)
      await onQuotaChanged()
    } finally {
      setActionBusy('')
    }
  }

  const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {
    if (!current || files.length === 0) return
    const parentID = xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)
    await dropExternalFilesToParent(files, parentID)
  }

  const dropExternalFolderEntriesToParent = async (
    payload: XDriveFileExplorerExternalDropPayload,
    parentID: number,
  ) => {
    if (!uploadConflictSupported || actionBusy) return
    await uploadConflictAwareTargets(
      async () => {
        const targets = await resolveFolderUploadTargets(
          parentID,
          payload.files,
          payload.directories,
        )
        return targets.map(({ parentID: targetParentID, file }) => ({
          parentID: targetParentID,
          file,
        }))
      },
      'drop-upload',
      true,
    )
  }

  const dropExternalFolderEntries = async (
    payload: XDriveFileExplorerExternalDropPayload,
    target?: XDriveFileExplorerItem,
  ) => {
    if (!current) return
    const parentID = xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)
    await dropExternalFolderEntriesToParent(payload, parentID)
  }

  const dropExternalFilesToCrumb = async (files: File[], crumb: XDriveFileExplorerCrumb) => {
    await dropExternalFilesToParent(files, Number(crumb.id))
  }

  const dropExternalFolderEntriesToCrumb = async (
    payload: XDriveFileExplorerExternalDropPayload,
    crumb: XDriveFileExplorerCrumb,
  ) => {
    await dropExternalFolderEntriesToParent(payload, Number(crumb.id))
  }

  const explorerPagination = xDriveFileExplorerPaginationController({
    searchActive: searchResults !== null,
    searchCursor,
    searchLoadingMore,
    directoryHasMore: hasMore,
    directoryLoadingMore: loadingMore,
    currentID: current?.id,
    sort,
    loadMoreSearch,
    loadMoreDirectory: onLoadMore,
  })

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder: () => setCreateOpen(true),
    onUpload: () => { void uploadFiles() },
    onUploadFolder: uploadConflictSupported
      ? () => folderUploadInputRef.current?.click()
      : undefined,
    uploadDisabled: Boolean(actionBusy),
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
        items={explorerItems}
        crumbs={explorerCrumbs}
        loading={loading || searchLoading || Boolean(actionBusy)}
        loadThumbnail={loadThumbnail}
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
        onOpenItem={(item) => { void openItem(item) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={!searchResults}
        hasMore={explorerPagination.hasMore}
        loadingMore={explorerPagination.loadingMore}
        onLoadMore={explorerPagination.onLoadMore}
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
        onCopyItems={copyItems}
        onCutItems={cutItems}
        onPaste={() => { void pasteClipboard() }}
        canPaste={canPaste(Boolean(actionBusy))}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        onDeleteItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onDeleteMany(nodes)
        }}
        onRenameItem={renameItem}
        renameDisabled={Boolean(actionBusy)}
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
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        statusText={searchResults
          ? `搜索“${searchState.query}”`
          : actionBusy === 'upload'
            ? '正在上传…'
            : actionBusy === 'paste'
              ? '正在粘贴…'
              : actionBusy === 'download-many'
                ? '正在批量下载…'
                : actionBusy === 'drop-items'
                  ? '正在处理拖拽项目…'
                  : actionBusy === 'drop-upload'
                    ? '正在上传拖入文件…'
                  : actionBusy === 'upload-folder'
                    ? '正在上传文件夹…'
                  : actionBusy.startsWith('rename-')
                    ? '正在重命名…'
              : actionBusy.startsWith('download-')
              ? '正在另存为…'
              : actionBusy.startsWith('open-')
                ? '正在打开…'
                : actionBusy.startsWith('reveal-')
                  ? '正在定位…'
                  : undefined}
      />

      <XDriveUploadConflictDialog {...uploadConflicts.dialogProps} />

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
