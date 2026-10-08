import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerNavigationPane,
  XDriveFilePreviewSurface,
  XDriveOpenPreviewDialog,
  XDriveFileExplorerTabs,
  XDriveFileExplorerSearchFilters,
  XDriveFileTagDialog,
  XDriveFileNameDialog,
  XDriveFileExplorerTrashDeleteDialog,
  useXDriveFileExplorerTrash,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerWorkspace,
  useXDriveFileExplorerQuickAccess,
  useXDriveFileExplorerOrganization,
  xDriveProjectFileExplorerNode,
  useXDriveFileExplorerFavorites,
  useXDriveFileExplorerRecent,
  useXDriveFileExplorerOperationController,
  useXDriveFileExplorerExternalDropController,
  xDriveCaptureVideoPosterBlob,
  xDriveFileKind,
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
  xDriveFileExplorerPersistedSearchFilters,
  xDriveFileExplorerSearchFiltersActive,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveCloudFilesSearchResult,
  XDriveFileOperation,
  XDriveFileExplorerGrouping,
  XDriveFileExplorerSearchSourceOption,
  XDriveByteProgressHandler,
  XDriveFileExplorerMediaDetailsRef,
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
  navigationSessionStorageKey,
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
  navigationSessionStorageKey?: string
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
    lifecycleKey: navigationSessionStorageKey ?? '',
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
    applySearch,
    searchState,
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
  } = useXDriveFileExplorerWorkspace<Node, WebSearchResult>({
    items,
    crumbs,
    directoryVirtualCollection: virtualDirectory,
    viewModeStorageKey: FILE_VIEW_KEY,
    navigationSessionStorageKey,
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
    lifecycleKey: navigationSessionStorageKey ?? '',
    loadItems: () => api.fileQuickAccess(),
    pinItem: (nodeID) => api.pinFileQuickAccess(nodeID),
    unpinItem: (nodeID) => api.unpinFileQuickAccess(nodeID),
    reorderItems: (nodeIDs) => api.reorderFileQuickAccess(nodeIDs),
    onError,
  })

  const organizationAdapter = useMemo(() => ({
    listTags: () => api.fileTags(),
    createTag: (name: string, color: string) => api.createFileTag(name, color),
    updateTag: (id: number, input: { name?: string; color?: string }) => api.updateFileTag(id, input),
    deleteTag: (id: number) => api.deleteFileTag(id),
    queryNodeTags: (nodeIDs: number[]) => api.fileNodeTags(nodeIDs),
    addTagNodes: (tagID: number, nodeIDs: number[]) => api.setFileTagNodes(tagID, nodeIDs, true),
    removeTagNodes: (tagID: number, nodeIDs: number[]) => api.setFileTagNodes(tagID, nodeIDs, false),
    listSavedSearches: () => api.fileSavedSearches(),
    createSavedSearch: (input: Parameters<XDriveApi['createFileSavedSearch']>[0]) => api.createFileSavedSearch(input),
    updateSavedSearch: (id: number, input: Parameters<XDriveApi['updateFileSavedSearch']>[1]) => api.updateFileSavedSearch(id, input),
    deleteSavedSearch: (id: number) => api.deleteFileSavedSearch(id),
    reorderSavedSearches: (ids: number[]) => api.reorderFileSavedSearches(ids),
  }), [api])
  const organization = useXDriveFileExplorerOrganization({
    lifecycleKey: navigationSessionStorageKey ?? '',
    adapter: organizationAdapter,
    onError,
  })
  const [tagDialogItems, setTagDialogItems] = useState<XDriveFileExplorerItem[]>([])
  const [saveSearchOpen, setSaveSearchOpen] = useState(false)
  const [renameSavedSearch, setRenameSavedSearch] = useState<(typeof organization.savedSearches)[number] | null>(null)
  const [activeSavedSearchID, setActiveSavedSearchID] = useState<number | null>(null)
  const [activeTagID, setActiveTagID] = useState<number | null>(null)
  const persistedSearchFilters = xDriveFileExplorerPersistedSearchFilters(searchFilters)
  const canSaveSmartFolder = Boolean(
    searchState.query || xDriveFileExplorerSearchFiltersActive(persistedSearchFilters),
  )

  const favorites = useXDriveFileExplorerFavorites<Node>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    loadItems: () => api.fileFavorites(),
    favoriteItem: (nodeID) => api.favoriteFile(nodeID),
    unfavoriteItem: (nodeID) => api.unfavoriteFile(nodeID),
    onError,
  })

  const [openPreviewItem, setOpenPreviewItem] = useState<XDriveFileExplorerItem | null>(null)

  const loadColumnPage = useCallback(async (
    parentID: string | number,
    cursor: string,
    signal: AbortSignal,
  ) => {
    const page = await api.listPageAbortable(Number(parentID), {
      cursor: cursor || undefined,
      limit: 200,
      sort: 'name',
      order: 'asc',
    }, signal)
    return {
      items: page.items.map((node) => xDriveProjectFileExplorerNode(node, '')),
      nextCursor: page.next_cursor,
    }
  }, [api])
  const [trashSort, setTrashSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const trash = useXDriveFileExplorerTrash({
    lifecycleKey: navigationSessionStorageKey ?? '',
    enabled: trashActive,
    adapter: trashAdapter,
    sort: trashSort,
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
    lifecycleKey: navigationSessionStorageKey ?? '',
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
      if (xDriveFileKind(item.name, item.kind) !== 'video') return null
    }

    try {
      const source = await api.filePreviewURL(Number(item.id))
      const poster = await xDriveCaptureVideoPosterBlob(source)
      if (!poster) return null
      const revision = Number(item.revision)
      if (Number.isSafeInteger(revision) && revision > 0) {
        try {
          await api.mediaVideoPoster(Number(item.id), revision, poster)
        } catch {
          // The locally decoded poster is still useful when cache backfill races
          // with a file revision change or the Server becomes temporarily unavailable.
        }
      }
      return URL.createObjectURL(poster)
    } catch {
      return null
    }
  }, [api])

  const loadLivePhotoMotion = useCallback(async (
    item: XDriveFileExplorerItem,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (
      item.kind !== 'file' ||
      !item.name.trim().toLowerCase().endsWith('.livp')
    ) return null
    try {
      const blob = await api.mediaLivePhotoMotion(Number(item.id), onProgress)
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

  const loadMediaDetails = useCallback((
    refs: readonly XDriveFileExplorerMediaDetailsRef[],
    signal: AbortSignal,
  ) => api.fileMediaDetails(refs, signal), [api])

  const loadPreviewURL = useCallback(async (
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo',
  ) => {
    if (item.kind !== 'file') return null
    try {
      if (kind === 'live_photo') {
        return await api.mediaLivePhotoStillURL(Number(item.id))
      }
      if (!['pdf', 'video', 'audio', 'image'].includes(kind)) return null
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
        const saved = await api.download(plan.file)
        if (!saved) return
      } else {
        const saved = await api.downloadArchive(plan.ids, plan.filename)
        if (!saved) return
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
      onToggleFavorite: node.type === 'file'
        ? () => { void favorites.toggle(node.id) }
        : undefined,
      favorite: favorites.favoriteIDs.has(node.id),
      favoriteDisabled: favorites.busyID !== null,
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
    refreshCurrentDirectoryIfIdle: onRefreshCurrentDirectoryIfIdle,
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
        virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}
        loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}
        emptyMessage={trashActive ? '回收站为空' : undefined}
        loadThumbnail={loadThumbnail}
        loadTextPreview={loadTextPreview}
        loadPreviewURL={loadPreviewURL}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPropertiesStats={loadPropertiesStats}
        loadMediaDetails={loadMediaDetails}
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
        onOpenItemInNewTab={!trashActive && canNewTab
          ? (item) => { void openItemInNewTab(item) }
          : undefined}
        onPreviewItem={trashActive ? undefined : (item) => { void recent.record(Number(item.id)) }}
        loadColumnPage={trashActive || searchStatusText ? undefined : loadColumnPage}
        onColumnNavigate={trashActive || searchStatusText ? undefined : (nextCrumbs) => {
          onCloseTrash()
          void navigateTo(nextCrumbs.map((crumb) => ({ id: Number(crumb.id), name: crumb.name })))
        }}
        onColumnOpenItem={trashActive ? undefined : (item) => { void openItem(item, openWebNode) }}
        onManageTags={trashActive ? undefined : (selected) => setTagDialogItems(selected)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={trashActive ? trashSort : sort}
        onSortChange={trashActive ? setTrashSort : changeSort}
        grouping={trashActive ? undefined : grouping}
        onGroupingChange={trashActive ? undefined : changeGrouping}
        groupingEnabled={!trashActive}
        externallySorted={trashActive ? Boolean(trash.virtualCollection) : externallySorted}
        detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={trashActive ? undefined : copyItems}
        onCopyPaths={trashActive ? undefined : (selected) => { void copyItemPaths(selected) }}
        onCutItems={trashActive ? undefined : cutItems}
        onPaste={trashActive ? undefined : (operationOverride) => { void pasteClipboard(operationOverride) }}
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
        onNextTab={!trashActive && tabs.length > 1 ? () => { void nextTab() } : undefined}
        onPreviousTab={!trashActive && tabs.length > 1 ? () => { void previousTab() } : undefined}
        commandBarEnd={trashActive ? undefined : (
          <XDriveFileExplorerSearchFilters
            filters={searchFilters}
            sourceOptions={searchSourceOptions}
            tagOptions={organization.tagOptions}
            canSaveSearch={canSaveSmartFolder}
            onSaveSearch={() => setSaveSearchOpen(true)}
            onChange={(next) => {
              setActiveSavedSearchID(null)
              setActiveTagID(next.tagID ?? null)
              changeSearchFilters(next)
            }}
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
            onReorderQuickAccess={(nodeIDs) => { void quickAccess.reorder(nodeIDs) }}
            savedSearchesEnabled
            savedSearches={organization.savedSearches}
            activeSavedSearchID={activeSavedSearchID}
            onActivateSavedSearch={(savedSearch) => {
              onCloseTrash()
              setActiveSavedSearchID(savedSearch.id)
              setActiveTagID(savedSearch.filters.tagID ?? null)
              void applySearch(savedSearch.query, savedSearch.filters)
            }}
            onRenameSavedSearch={(savedSearch) => setRenameSavedSearch(savedSearch)}
            onReplaceSavedSearch={(savedSearch) => {
              if (!canSaveSmartFolder) return
              void organization.updateSavedSearch(savedSearch.id, {
                name: savedSearch.name,
                query: searchState.query,
                filters: persistedSearchFilters,
              }).then(() => {
                setActiveSavedSearchID(savedSearch.id)
                onFeedback('good', '智能文件夹已更新。')
              })
            }}
            canReplaceSavedSearch={canSaveSmartFolder}
            onDeleteSavedSearch={(id) => {
              if (activeSavedSearchID === id) setActiveSavedSearchID(null)
              void organization.deleteSavedSearch(id)
            }}
            onReorderSavedSearches={(ids) => { void organization.reorderSavedSearches(ids) }}
            tagsEnabled
            tags={organization.tags}
            activeTagID={activeTagID}
            onActivateTag={(tag) => {
              onCloseTrash()
              setActiveSavedSearchID(null)
              setActiveTagID(tag.id)
              void applySearch('', { tagID: tag.id })
            }}
            favoritesEnabled
            favoriteItems={favorites.items}
            favoritesLoading={favorites.loading}
            favoriteBusyID={favorites.busyID}
            onActivateFavorite={(nodeID) => {
              onCloseTrash()
              const navigationIntentID = beginNavigationIntent()
              void favorites.activate(nodeID, (node) => {
                if (!isNavigationIntentCurrent(navigationIntentID)) return
                void recent.record(node.id)
                openWebNode(node)
              })
            }}
            onUnfavorite={(nodeID) => { void favorites.unfavorite(nodeID) }}
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
                onFile: (item) => {
                  if (!isNavigationIntentCurrent(navigationIntentID)) return false
                  openWebNode(item.node)
                  return true
                },
              })
            }}
            onClearRecent={() => { void recent.clear() }}
            onError={onError}
          />
        )}
        statusText={trashActive
          ? (trash.working ? '正在处理回收站项目…' : `${trash.itemCount} 个回收站项目`)
          : searchStatusText ?? (
              uploadProgress !== null
                ? `上传中 ${Math.round(uploadProgress)}%`
                : undefined
            )}
      />
      <XDriveFileTagDialog
        open={tagDialogItems.length > 0}
        nodeIDs={tagDialogItems.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0)}
        tags={organization.tags}
        busy={Boolean(organization.busyKey)}
        queryNodeTags={organization.queryNodeTags}
        onSetTag={async (tagID, nodeIDs, assigned) => {
          await organization.setTagNodes(tagID, nodeIDs, assigned)
          if (searchFilters.tagID === tagID) {
            await applySearch(searchState.query, searchFilters)
          }
        }}
        onCreateTag={organization.createTag}
        onUpdateTag={organization.updateTag}
        onDeleteTag={async (tagID) => {
          await organization.deleteTag(tagID)
          if (searchFilters.tagID === tagID) {
            setActiveTagID(null)
            clearSearch()
          }
        }}
        onClose={() => setTagDialogItems([])}
      />
      <XDriveFileNameDialog
        open={saveSearchOpen}
        mode="saved-search"
        onClose={() => setSaveSearchOpen(false)}
        onError={onError}
        onSubmit={async (name) => {
          const created = await organization.createSavedSearch({
            name,
            query: searchState.query,
            filters: persistedSearchFilters,
          })
          setActiveSavedSearchID(created.id)
          if (searchFilters.availability) {
            onFeedback('warning', '智能文件夹已保存；设备可用性筛选不会跨设备保存。')
          } else {
            onFeedback('good', '智能文件夹已保存。')
          }
        }}
      />
      <XDriveFileNameDialog
        open={Boolean(renameSavedSearch)}
        mode="saved-search"
        initialValue={renameSavedSearch?.name ?? ''}
        onClose={() => setRenameSavedSearch(null)}
        onError={onError}
        onSubmit={async (name) => {
          if (!renameSavedSearch) return
          await organization.updateSavedSearch(renameSavedSearch.id, {
            name,
            query: renameSavedSearch.query,
            filters: renameSavedSearch.filters,
          })
          onFeedback('good', '智能文件夹已重命名。')
        }}
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
    </Box>
  )
}
