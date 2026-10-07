import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerNavigationPane,
  XDriveFilePreviewSurface,
  XDriveOpenPreviewDialog,
  XDriveFileExplorerTabs,
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerTrashDeleteDialog,
  useXDriveFileExplorerTrash,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerWorkspace,
  useXDriveFileExplorerQuickAccess,
  useXDriveFileExplorerRecent,
  useXDriveFileExplorerOperationController,
  useXDriveFileExplorerExternalDropController,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
  XDriveFileExplorerWorkspaceVirtualDirectory,
  XDriveTrashDialogAdapter,
} from '@xdrive/ui/mui'
import {
  xDriveFileExplorerKeyboardProfileFromPlatform,
  xDriveFileExplorerCopyPath,
  xDriveFileExplorerPathLookupPageOptions,
  xDriveFileExplorerLoadChildDirectoryPage,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerPropertiesRefs,
  xDriveFileExplorerWebDownloadPlan,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerWebDownloadFeedback,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveCloudFilesSearchResult,
  XDriveFileOperation,
  XDriveFileExplorerGrouping,
  XDriveFileExplorerSearchSourceOption,
} from '../../ui/shared/src'
import type { XDriveApi } from './api'

type WebSearchResult = XDriveCloudFilesSearchResult<Node>

const FILE_VIEW_KEY = 'xdrive.files.view_mode'
const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'
const FILE_VIEW_PREFERENCES_KEY = 'xdrive.files.view_preferences'
const FILE_KEYBOARD_PROFILE = xDriveFileExplorerKeyboardProfileFromPlatform(
  typeof navigator === 'undefined'
    ? ''
    : `${navigator.platform} ${navigator.userAgent}`,
)

type Crumb = { id: number; name: string }

export default function WebFileExplorer({
  api,
  items,
  crumbs,
  virtualDirectory,
  loading,
  uploadProgress,
  onLoadDirectory,
  onRefreshCurrentDirectoryIfIdle,
  onUploadFiles,
  onUploadFolderFiles,
  onUploadDroppedFiles,
  onUploadDroppedFolderEntries,
  onCreateFolder,
  onOpenTrash,
  trashActive,
  trashAdapter,
  onCloseTrash,
  onTrashChanged,
  onRemove,
  onRemoveMany,
  onOperationQueued,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
  onFeedback,
  onShare,
  onHistory,
  onError,
}: {
  api: XDriveApi
  items: Node[]
  crumbs: Crumb[]
  virtualDirectory?: XDriveFileExplorerWorkspaceVirtualDirectory<Node> | null
  loading: boolean
  uploadProgress: number | null
  onLoadDirectory: (
    id: number,
    crumbs: Crumb[],
    sort: XDriveFileExplorerSort,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<boolean | void>
  onRefreshCurrentDirectoryIfIdle: (
    expectedCurrentID: number | undefined,
  ) => Promise<boolean | void>
  onUploadFiles: (files: FileList | null) => Promise<void>
  onUploadFolderFiles: (files: FileList | null) => Promise<void>
  onUploadDroppedFiles: (parentID: number, files: File[]) => Promise<void>
  onUploadDroppedFolderEntries: (
    parentID: number,
    payload: XDriveFileExplorerExternalDropPayload,
  ) => Promise<void>
  onCreateFolder: () => void
  onOpenTrash: () => void
  trashActive: boolean
  trashAdapter: XDriveTrashDialogAdapter
  onCloseTrash: () => void
  onTrashChanged: () => void | Promise<void>
  onRemove: (node: Node) => void
  onRemoveMany: (nodes: Node[]) => void
  onOperationQueued: (operation: XDriveFileOperation) => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
  onShare: (node: Node) => void
  onHistory: (node: Node) => void
  onError: (error: unknown) => void
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [searchSourceOptions, setSearchSourceOptions] = useState<XDriveFileExplorerSearchSourceOption[]>([])
  useEffect(() => {
    let active = true
    void api.sources().then((sources) => {
      if (active) setSearchSourceOptions(sources.map((source) => ({ id: source.id, name: source.name })))
    }).catch(onError)
    return () => {
      active = false
    }
  }, [api, onError])

  const recent = useXDriveFileExplorerRecent<Node>({
    loadItems: () => api.fileRecent(16),
    touchItem: (nodeID) => api.touchFileRecent(nodeID),
    clearItems: () => api.clearFileRecent(),
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
    openItem,
    openItemInNewTab,
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
  } = useXDriveFileExplorerWorkspace<Node, WebSearchResult>({
    items,
    crumbs,
    directoryVirtualCollection: virtualDirectory,
    viewModeStorageKey: FILE_VIEW_KEY,
    onLoadDirectory,
    loadSearchRange: async (query, filters, searchGrouping, searchSort, offset, limit) => {
      const page = await api.searchRange(
        query,
        filters,
        offset,
        limit,
        searchSort.key,
        searchSort.direction,
        searchGrouping,
      )
      return {
        items: page.items,
        totalCount: page.total_count,
        offset: page.offset,
        limit: page.limit,
        groups: page.groups,
      }
    },
    loadRoot: () => api.root(),
    findChildDirectory: async (parentID, name) => {
      const page = await api.listPage(
        parentID,
        xDriveFileExplorerPathLookupPageOptions(name),
      )
      return page.items[0] ?? null
    },
    searchCrumbsForResult: (result) => result.crumbs,
    onDirectoryAccess: (nodeID) => { void recent.record(nodeID) },
    onFileAccess: (nodeID) => { void recent.record(nodeID) },
    onError,
  })

  const refreshCurrentDirectory = onRefreshCurrentDirectoryIfIdle

  const loadTreeDirectoryPage = useCallback(
    (parentID: number, cursor?: string) => xDriveFileExplorerLoadChildDirectoryPage({
      parentID,
      cursor,
      loadPage: (id, options) => api.listPage(id, options),
    }),
    [api],
  )

  const quickAccess = useXDriveFileExplorerQuickAccess<Node>({
    loadItems: () => api.fileQuickAccess(),
    pinItem: (nodeID) => api.pinFileQuickAccess(nodeID),
    unpinItem: (nodeID) => api.unpinFileQuickAccess(nodeID),
    onError,
  })

  const [openPreviewItem, setOpenPreviewItem] = useState<XDriveFileExplorerItem | null>(null)
  const [trashSort, setTrashSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const trash = useXDriveFileExplorerTrash({
    enabled: trashActive,
    adapter: trashAdapter,
    onError,
    onFeedback: (message) => onFeedback('good', message),
    onChanged: onTrashChanged,
  })

  const {
    busy: fileOperationBusy,
    canPaste: fileOperationCanPaste,
    pasteClipboard,
    dropItemsToFolder,
    dropItemsToCrumb,
  } = useXDriveFileExplorerOperationController<Node, XDriveFileOperation>({
    nodeByID,
    currentID: current?.id,
    planPaste,
    completePaste,
    canPaste,
    clearSearch,
    submitOperation: (plan) => api.createFileOperation(
      plan.operation,
      plan.items,
      plan.parentID,
    ),
    onQueued: onOperationQueued,
    onFeedback,
    onError,
  })

  const loadTextPreview = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    try {
      return await api.fileTextPreview(Number(item.id))
    } catch {
      return null
    }
  }, [api])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    try {
      const blob = await api.mediaThumbnail(Number(item.id))
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [api])

  const loadPropertiesStats = useCallback((
    selected: readonly XDriveFileExplorerItem[],
    signal: AbortSignal,
  ) => api.filePropertiesStats(
    xDriveFileExplorerPropertiesRefs(selected),
    signal,
  ), [api])

  const loadPreviewURL = useCallback(async (
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf',
  ) => {
    if (
      item.kind !== 'file' ||
      !['pdf', 'video', 'audio', 'image'].includes(kind)
    ) return null
    try {
      return await api.filePreviewURL(Number(item.id))
    } catch {
      return null
    }
  }, [api])

  const openWebNode = (node: Node) => {
    setOpenPreviewItem({
      id: node.id,
      name: node.name,
      kind: node.type,
      size: node.size,
      updatedAt: node.updated_at,
      revision: node.revision,
    })
  }

  const copyItemPaths = async (selected: XDriveFileExplorerItem[]) => {
    if (selected.length === 0) return
    const text = selected
      .map((item) => xDriveFileExplorerCopyPath(item, explorerCrumbs))
      .join('\n')
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('当前浏览器不支持写入剪贴板。')
      }
      await navigator.clipboard.writeText(text)
      onFeedback(
        'good',
        selected.length === 1
          ? `已复制路径：${text}`
          : `已复制 ${selected.length} 条路径。`,
      )
    } catch (error) {
      onError(error)
    }
  }

  const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    const plan = xDriveFileExplorerWebDownloadPlan(nodes)
    if (plan.kind === 'none') return
    try {
      if (plan.kind === 'file') {
        await api.download(plan.file)
      } else {
        await api.downloadArchive(plan.ids, plan.filename)
      }
      const feedback = xDriveFileExplorerWebDownloadFeedback(plan)
      onFeedback(feedback.tone, feedback.message)
    } catch (error) {
      onError(error)
    }
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node) return []

    return xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      onOpen: () => { void openItem(item, openWebNode) },
      onOpenInNewTab: node.type === 'dir' && canNewTab
        ? () => { void openItemInNewTab(item) }
        : undefined,
      onToggleQuickAccess: node.type === 'dir'
        ? () => { void quickAccess.toggle(node.id) }
        : undefined,
      quickAccessPinned: quickAccess.pinnedIDs.has(node.id),
      quickAccessDisabled: quickAccess.busyID !== null,
      onDownload: () => { void downloadSelected([item]) },
      onShare: node.type === 'file' ? () => onShare(node) : undefined,
      onHistory: node.type === 'file' ? () => onHistory(node) : undefined,
      onDelete: () => onRemove(node),
    })
  }

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    const expectedCurrentID = current.id
    try {
      await api.rename(node.id, node.revision, name)
      clearSearch()
      await refreshCurrentDirectory(expectedCurrentID)
      onFeedback('good', '已重命名。')
    } catch (error) {
      onError(error)
      throw error
    }
  }

  const {
    dropFiles: dropExternalFiles,
    dropFilesToCrumb: dropExternalFilesToCrumb,
    dropFolderEntries: dropExternalFolderEntries,
    dropFolderEntriesToCrumb: dropExternalFolderEntriesToCrumb,
  } = useXDriveFileExplorerExternalDropController<Node, Crumb, XDriveFileExplorerSort>({
    currentID: current?.id,
    currentCrumbs: crumbs,
    sort,
    currentGrouping: grouping,
    nodeByID,
    uploadFilesToParent: onUploadDroppedFiles,
    uploadFolderEntriesToParent: onUploadDroppedFolderEntries,
    refreshDirectory: onLoadDirectory,
  })

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder,
    onUpload: () => uploadInputRef.current?.click(),
    onUploadFolder: () => folderUploadInputRef.current?.click(),
    onRefresh: refresh,
  })

  return (
    <Box sx={{ height: '100%', minHeight: 420, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <input
        ref={uploadInputRef}
        hidden
        type="file"
        multiple
        onChange={(event) => {
          void onUploadFiles(event.target.files)
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
          void onUploadFolderFiles(event.target.files)
          event.target.value = ''
        }}
      />
      {uploadProgress !== null ? (
        <LinearProgress
          variant="determinate"
          value={Math.max(0, Math.min(100, uploadProgress))}
          sx={{ position: 'absolute', inset: '0 0 auto', zIndex: 3 }}
        />
      ) : null}
      <XDriveFileExplorer
        presentation="workspace"
        keyboardProfile={FILE_KEYBOARD_PROFILE}
        items={trashActive ? trash.items : explorerItems}
        crumbs={trashActive ? trash.crumbs : explorerCrumbs}
        virtualCollection={trashActive ? undefined : explorerVirtualCollection}
        loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}
        emptyMessage={trashActive ? '回收站为空' : undefined}
        loadThumbnail={loadThumbnail}
        loadTextPreview={loadTextPreview}
        loadPreviewURL={loadPreviewURL}
        loadPropertiesStats={loadPropertiesStats}
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
        onCreateFolder={trashActive ? undefined : onCreateFolder}
        onUpload={trashActive ? undefined : () => uploadInputRef.current?.click()}
        onUploadFolder={trashActive ? undefined : () => folderUploadInputRef.current?.click()}
        onOpenItem={trashActive ? undefined : (item) => { void openItem(item, openWebNode) }}
        onPreviewItem={trashActive ? undefined : (item) => { void recent.record(Number(item.id)) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={trashActive ? trashSort : sort}
        onSortChange={trashActive ? setTrashSort : changeSort}
        grouping={trashActive ? undefined : grouping}
        onGroupingChange={trashActive ? undefined : changeGrouping}
        groupingEnabled={!trashActive}
        externallySorted={trashActive ? false : externallySorted}
        detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={trashActive ? undefined : copyItems}
        onCopyPaths={trashActive ? undefined : (selected) => { void copyItemPaths(selected) }}
        onCutItems={trashActive ? undefined : cutItems}
        onPaste={trashActive ? undefined : () => { void pasteClipboard() }}
        canPaste={!trashActive && fileOperationCanPaste}
        canUndo={!trashActive && canUndo}
        onUndo={trashActive ? undefined : onUndo}
        canRedo={!trashActive && canRedo}
        onRedo={trashActive ? undefined : onRedo}
        onDownloadItems={trashActive ? undefined : (selected) => { void downloadSelected(selected) }}
        folderDownloadSupported={!trashActive}
        onDeleteItems={trashActive ? undefined : (selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onRemoveMany(nodes)
        }}
        onRenameItem={trashActive ? undefined : renameItem}
        renameDisabled={trashActive || fileOperationBusy}
        onDropItemsToFolder={trashActive ? undefined : (selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onDropItemsToCrumb={trashActive ? undefined : (selected, crumb, operation) => { void dropItemsToCrumb(selected, crumb, operation) }}
        onExternalFilesDrop={trashActive ? undefined : (files, target) => { void dropExternalFiles(files, target) }}
        onExternalFilesDropToCrumb={trashActive ? undefined : (files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
        onExternalFolderDrop={trashActive ? undefined : (payload, target) => { void dropExternalFolderEntries(payload, target) }}
        onExternalFolderDropToCrumb={trashActive ? undefined : (payload, crumb) => { void dropExternalFolderEntriesToCrumb(payload, crumb) }}
        getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}
        backgroundMenuItems={trashActive ? [] : backgroundMenuItems}
        tabBar={trashActive ? undefined : (
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
        onNewTab={!trashActive && canNewTab ? () => { void newTab() } : undefined}
        onCloseTab={!trashActive && canCloseTab ? () => { void closeTab() } : undefined}
        onNextTab={!trashActive && tabs.length > 1 ? () => { void nextTab() } : undefined}
        onPreviousTab={!trashActive && tabs.length > 1 ? () => { void previousTab() } : undefined}
        commandBarEnd={trashActive ? undefined : (
          <XDriveFileExplorerSearchFilters
            filters={searchFilters}
            sourceOptions={searchSourceOptions}
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
            dropDisabled={fileOperationBusy}
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
            onExternalFolderDrop={(payload, target) => {
              void dropExternalFolderEntriesToCrumb(payload, target)
            }}
            quickAccessEnabled
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
            recentEnabled
            recentItems={recent.items}
            recentLoading={recent.loading}
            onActivateRecent={(nodeID) => {
              onCloseTrash()
              const navigationIntentID = beginNavigationIntent()
              void recent.activate(nodeID, {
                onDirectory: (nextCrumbs) => (
                  navigateTo(nextCrumbs, true, navigationIntentID)
                ),
                onFile: (item) => (
                  isNavigationIntentCurrent(navigationIntentID)
                    ? openWebNode(item.node)
                    : undefined
                ),
              })
            }}
            onClearRecent={() => { void recent.clear() }}
            onError={onError}
          />
        )}
        statusText={trashActive
          ? (trash.working ? '正在处理回收站项目…' : `${trash.items.length} 个回收站项目`)
          : searchStatusText ?? (
              uploadProgress !== null
                ? `上传中 ${Math.round(uploadProgress)}%`
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
          fallback={(
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
              此文件暂无可用预览
            </Box>
          )}
          minHeight={320}
          maxHeight={760}
        />
      </XDriveOpenPreviewDialog>
    </Box>
  )
}
