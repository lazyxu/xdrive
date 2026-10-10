import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { Box, LinearProgress, useMediaQuery } from '@mui/material'
import MobileFiles from './MobileFiles'
import {
  XDriveFileExplorer,
  XDriveFileExplorerNavigationPane,
  XDriveFileExplorerTabs,
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerDestinationDialog,
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
  XDriveFileExplorerSelectionAction,
  XDriveFileExplorerQuickLookRequest,
  XDriveFileExplorerSort,
  XDriveMediaLoadStage,
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
  xDriveFileExplorerResolveSelectionNodes,
  xDriveFileExplorerSelectionActionDisabledReason,
  xDriveFileExplorerWebDownloadFeedback,
  XDriveFileExplorerInlineRangeStore,
  xDriveFileExplorerPersistedSearchFilters,
  xDriveFileExplorerOrganizationSearchState,
  xDriveFileExplorerSavedSearchRuleLabels,
  xDriveFileExplorerSearchFiltersActive,
  xDriveFileExplorerSearchFiltersSignature,
  xDriveFileExplorerSearchFilterLabels,
  xDriveFileUsesRawCompatibilityPreview,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveCloudFilesSearchResult,
  XDriveFileOperation,
  XDriveFileExplorerGrouping,
  XDriveFileExplorerSearchSourceOption,
  XDriveByteProgressHandler,
  XDriveFileExplorerMediaDetailsRef,
  XDriveWebAppBrowseContext,
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
  initialDirectoryID,
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
  actionFeedback,
  canUndo = false,
  onUndo,
  canRedo = false,
  onRedo,
  onFeedback,
  onShare,
  onHistory,
  onOpenFile,
  onOpenQuickLook,
  onOpenNodeInBrowserTab,
  onDirectoryChange,
  onError,
}: {
  api: XDriveApi
  items: Node[]
  crumbs: Crumb[]
  virtualDirectory?: XDriveFileExplorerWorkspaceVirtualDirectory<Node> | null
  loading: boolean
  navigationSessionStorageKey?: string
  initialDirectoryID?: number
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
  onUploadFiles: (parentID: number, files: FileList | null) => Promise<void>
  onUploadFolderFiles: (parentID: number, files: FileList | null) => Promise<void>
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
  actionFeedback?: ReactNode
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
  onShare: (node: Node) => void
  onHistory: (node: Node) => void
  onOpenFile: (node: Node, context: XDriveWebAppBrowseContext) => void
  onOpenQuickLook: (node: Node, context: XDriveWebAppBrowseContext) => void
  onOpenNodeInBrowserTab: (node: Node) => void
  onDirectoryChange?: (nodeID: number) => void
  onError: (error: unknown) => void
}) {
  const compactMobile = useMediaQuery('(max-width:899.95px)')
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadPickerParentIDRef = useRef<number | null>(null)
  const folderUploadPickerParentIDRef = useRef<number | null>(null)
  const renameLifecycleKeyRef = useRef(navigationSessionStorageKey ?? '')
  renameLifecycleKeyRef.current = navigationSessionStorageKey ?? ''

  useEffect(() => {
    uploadPickerParentIDRef.current = null
    folderUploadPickerParentIDRef.current = null
    setTagDialogItems([])
    setTagDialogMode(null)
  }, [navigationSessionStorageKey])
  const [searchSourceOptions, setSearchSourceOptions] = useState<XDriveFileExplorerSearchSourceOption[]>([])
  useEffect(() => {
    let active = true
    setSearchSourceOptions([])
    void api.sources().then((sources) => {
      if (active) setSearchSourceOptions(sources.map((source) => ({ id: source.id, name: source.name })))
    }).catch((error) => {
      if (active) onError(error)
    })
    return () => {
      active = false
    }
  }, [api, navigationSessionStorageKey, onError])

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
    searchReady,
    searchError,
    retrySearch,
    searchVirtualCollection,
    changeSearchValue,
    changeSearchFilters,
    clearSearch,
    submitSearch,
    applySearch,
    searchState,
    nodeByID,
    explorerItems,
    explorerCrumbs,
    copyItems: copyWorkspaceItems,
    cutItems: cutWorkspaceItems,
    copyNodes: copyWorkspaceNodes,
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
    showItemInContainingFolder,
    explorerViewState,
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

  const routedDirectoryRef = useRef<{
    directoryID: number
    lifecycleKey: string
  } | null>(null)
  useEffect(() => {
    if (!initialDirectoryID || current?.id === initialDirectoryID) return
    const lifecycleKey = navigationSessionStorageKey ?? ''
    if (
      routedDirectoryRef.current?.directoryID === initialDirectoryID &&
      routedDirectoryRef.current.lifecycleKey === lifecycleKey
    ) return
    routedDirectoryRef.current = {
      directoryID: initialDirectoryID,
      lifecycleKey,
    }
    const navigationIntentID = beginNavigationIntent()
    let active = true
    void (async () => {
      const chain: Crumb[] = []
      let cursor = initialDirectoryID
      for (let depth = 0; depth < 256; depth += 1) {
        const node = await api.node(cursor)
        if (node.type !== 'dir') throw new Error('目标不是文件夹。')
        chain.push({ id: node.id, name: node.name })
        if (!node.parent_id) break
        cursor = node.parent_id
      }
      if (!active || !isNavigationIntentCurrent(navigationIntentID)) return
      chain.reverse()
      await navigateTo(chain, true, navigationIntentID)
    })().catch((error) => {
      if (active && isNavigationIntentCurrent(navigationIntentID)) onError(error)
    })
    return () => {
      active = false
    }
  }, [
    api,
    beginNavigationIntent,
    current?.id,
    initialDirectoryID,
    isNavigationIntentCurrent,
    navigateTo,
    navigationSessionStorageKey,
    onError,
  ])

  useEffect(() => {
    if (!trashActive && current?.id) onDirectoryChange?.(current.id)
  }, [current?.id, onDirectoryChange, trashActive])

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
  const [tagDialogMode, setTagDialogMode] = useState<'manage' | 'assign' | null>(null)
  const [saveSearchOpen, setSaveSearchOpen] = useState(false)
  const [renameSavedSearch, setRenameSavedSearch] = useState<(typeof organization.savedSearches)[number] | null>(null)
  const organizationSearchState = xDriveFileExplorerOrganizationSearchState({
    active: !trashActive && searchState.results !== null,
    query: searchState.query,
    filters: searchFilters,
    savedSearches: organization.savedSearches,
  })
  const { activeSavedSearchID, activeTagID } = organizationSearchState
  const organizationLifecycleKeyRef = useRef(navigationSessionStorageKey ?? '')
  organizationLifecycleKeyRef.current = navigationSessionStorageKey ?? ''
  const persistedSearchFilters = xDriveFileExplorerPersistedSearchFilters(searchFilters)
  const organizationSearchScopeKey = `${searchState.query}\n${xDriveFileExplorerSearchFiltersSignature(searchFilters)}`
  const organizationSearchScopeKeyRef = useRef(organizationSearchScopeKey)
  organizationSearchScopeKeyRef.current = organizationSearchScopeKey
  const canSaveSmartFolder = organizationSearchState.canSaveCurrentSearch

  const logicalIndexForItem = useCallback((item: XDriveFileExplorerItem) => {
    if (explorerVirtualCollection) {
      for (const [index, candidate] of explorerVirtualCollection.loadedItems) {
        if (Number(candidate.id) === Number(item.id)) return index
      }
    }
    const index = explorerItems.findIndex((candidate) => Number(candidate.id) === Number(item.id))
    return index >= 0 ? index : 0
  }, [explorerItems, explorerVirtualCollection])

  const browseContextForItem = useCallback((
    item: XDriveFileExplorerItem,
    sessionIDs?: readonly (string | number)[],
    explicitIndex?: number,
  ): XDriveWebAppBrowseContext => {
    if (sessionIDs && sessionIDs.length > 1) {
      const nodeIDs = sessionIDs.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0)
      const activeIndex = Math.max(0, nodeIDs.findIndex((id) => id === Number(item.id)))
      return { kind: 'selection', nodeIDs, activeIndex }
    }
    const activeIndex = explicitIndex ?? logicalIndexForItem(item)
    if (searchState.query || xDriveFileExplorerSearchFiltersActive(persistedSearchFilters)) {
      return {
        kind: 'search',
        query: searchState.query,
        filters: persistedSearchFilters,
        sort,
        grouping,
        activeIndex,
      }
    }
    return {
      kind: 'directory',
      directoryID: current?.id ?? Number(explorerCrumbs.at(-1)?.id ?? 0),
      sort,
      grouping,
      activeIndex,
    }
  }, [
    current?.id,
    explorerCrumbs,
    grouping,
    logicalIndexForItem,
    persistedSearchFilters,
    searchState.query,
    sort,
  ])

  const favorites = useXDriveFileExplorerFavorites<Node>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    loadItems: () => api.fileFavorites(),
    favoriteItem: (nodeID) => api.favoriteFile(nodeID),
    unfavoriteItem: (nodeID) => api.unfavoriteFile(nodeID),
    onError,
  })

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

  // Expanded List rows use the same authenticated Server range contract as
  // the root virtual collection. Scope every child page to this one workspace,
  // sort, grouping, account and presentation; never start Mobile-specific REST.
  const inlineScopeKey = [
    navigationSessionStorageKey ?? '', current?.id ?? 0,
    sort.key, sort.direction, grouping.groupBy, grouping.foldersFirst,
    trashActive, searchState.results !== null, compactMobile,
  ].join(':')
  const inlineLoaderRef = useRef((
    parentID: number, offset: number, limit: number, signal: AbortSignal,
  ) => api.listRange(parentID, offset, limit, sort.key, sort.direction, true, grouping, signal)
    .then(page => ({
      items: page.items, offset: page.offset, limit: page.limit,
      totalCount: page.total_count,
    })))
  inlineLoaderRef.current = (
    parentID: number, offset: number, limit: number, signal: AbortSignal,
  ) => api.listRange(parentID, offset, limit, sort.key, sort.direction, true, grouping, signal)
    .then(page => ({
      items: page.items, offset: page.offset, limit: page.limit,
      totalCount: page.total_count,
    }))
  const inlineErrorRef = useRef(onError)
  inlineErrorRef.current = onError
  const inlineStore = useMemo(() => new XDriveFileExplorerInlineRangeStore<Node>(
    (parentID, offset, limit, signal) => inlineLoaderRef.current(parentID, offset, limit, signal),
    error => inlineErrorRef.current(error),
  ), [inlineScopeKey])
  const inlineSnapshot = useSyncExternalStore(
    inlineStore.subscribe, inlineStore.getSnapshot, inlineStore.getSnapshot,
  )
  useEffect(() => () => inlineStore.destroy(), [inlineStore])

  // Shared FileExplorer operations resolve real Node IDs/revisions through
  // nodeByID. Register sparse child Node pages before operation hooks/menus
  // read the projection; projected display items alone are not sufficient.
  // Keep at most the user's selected Node identities independently from
  // sparse page retention, while one authenticated Files scope is active.
  // A selected file may scroll out of a 100k parent/child virtual range, but
  // selection actions still need its original Server ID + revision.
  const selectedMobileNodesRef = useRef(new Map<number, {
    node: Node; ownerID: number; crumbs: Crumb[]
  }>())
  const selectedMobileScopeRef = useRef(inlineScopeKey)
  if (selectedMobileScopeRef.current !== inlineScopeKey) {
    selectedMobileScopeRef.current = inlineScopeKey
    selectedMobileNodesRef.current.clear()
  }
  const inlineOwnerByNodeID = new Map<number, number>()
  const priorInlineNodesRef = useRef(new Map<number, Node>())
  const liveInlineNodes = new Map<number, Node>()
  for (const branch of inlineSnapshot.branches) {
    for (const node of branch.items.values()) {
      liveInlineNodes.set(node.id, node)
      inlineOwnerByNodeID.set(node.id, branch.ownerID)
    }
  }
  for (const [id, previous] of priorInlineNodesRef.current) {
    if (!liveInlineNodes.has(id) && nodeByID.get(id) === previous &&
        !selectedMobileNodesRef.current.has(id)) nodeByID.delete(id)
  }
  for (const node of liveInlineNodes.values()) nodeByID.set(node.id, node)
  priorInlineNodesRef.current = liveInlineNodes
  // The shared Web action map, not a Mobile-only mutation controller, owns
  // selected objects. Pin only IDs: never hold an evicted 100-item page.
  for (const [id, record] of selectedMobileNodesRef.current) {
    if (!nodeByID.has(id)) nodeByID.set(id, record.node)
    if (record.ownerID !== current?.id) inlineOwnerByNodeID.set(id, record.ownerID)
  }
  const inlineParentCrumbs = (ownerID: number): Crumb[] => {
    if (!current || ownerID === current.id) return crumbs
    const trail: Crumb[] = []
    const seen = new Set<number>()
    let id = ownerID
    while (id !== current.id && !seen.has(id)) {
      seen.add(id)
      const branch = inlineSnapshot.branches.find(entry => entry.ownerID === id)
      if (!branch) return crumbs
      trail.unshift({ id, name: branch.name || nodeByID.get(id)?.name || String(id) })
      id = branch.parentID
    }
    return id === current.id ? [...crumbs, ...trail] : crumbs
  }
  const inlineCrumbsForItem = (item: XDriveFileExplorerItem) => {
    const retained = selectedMobileNodesRef.current.get(Number(item.id))
    return retained?.crumbs ?? inlineParentCrumbs(
      inlineOwnerByNodeID.get(Number(item.id)) ?? current?.id ?? 0)
  }
  const retainMobileSelection = (items: readonly XDriveFileExplorerItem[]) => {
    const next = new Map<number, { node: Node; ownerID: number; crumbs: Crumb[] }>()
    // Mutations have a 200-item limit, but the existing shared download
    // action permits up to 1000. Retain exactly that bounded identity set
    // when actionable; for a 10k/100k Select All retain only a small
    // representative prefix, never the entire virtual collection.
    const pinCount = items.length <= 1000 ? items.length : 200
    for (const item of items.slice(0, pinCount)) {
      const id = Number(item.id)
      if (!Number.isSafeInteger(id) || id <= 0) continue
      const previous = selectedMobileNodesRef.current.get(id)
      const node = nodeByID.get(id) ?? previous?.node
      if (!node || node.id !== id || node.type !== item.kind ||
          (item.revision !== undefined && node.revision !== Number(item.revision))) continue
      const ownerID = inlineOwnerByNodeID.get(id) ?? previous?.ownerID ?? current?.id ?? 0
      const parentCrumbs = previous?.crumbs ?? inlineParentCrumbs(ownerID)
      next.set(id, { node, ownerID, crumbs: parentCrumbs })
    }
    selectedMobileNodesRef.current = next
    for (const [id, record] of next) {
      if (!nodeByID.has(id)) nodeByID.set(id, record.node)
    }
    // Existing shared workspace retention handles root/Search selections.
    explorerVirtualCollection?.retainInteractionIDs?.([...next.keys()])
  }
  const inlineMobileBranches = inlineSnapshot.branches.map(branch => {
    const parentPath = inlineParentCrumbs(branch.ownerID).map(crumb => crumb.name).join('/')
    const prefix = parentPath ? parentPath + '/' : ''
    return {
      ...branch,
      items: new Map([...branch.items].map(([index, node]) =>
        [index, xDriveProjectFileExplorerNode(node, prefix)] as const)),
    }
  })

  const {
    busy: fileOperationBusy,
    canPaste: fileOperationCanPaste,
    pasteClipboard,
    dropItemsToFolder,
    dropItemsToCrumb,
    destinationRequest,
    openDestination,
    closeDestination,
    submitDestination,
  } = useXDriveFileExplorerOperationController<Node, XDriveFileOperation>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    maxItems: 200,
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

  const getSelectionActionDisabledReason = (
    action: XDriveFileExplorerSelectionAction,
    selected: readonly XDriveFileExplorerItem[],
    selectedCount: number,
  ) => {
    const mutation = ['copy', 'cut', 'delete', 'move-to', 'copy-to'].includes(action)
    return xDriveFileExplorerSelectionActionDisabledReason({
      selected,
      selectedCount,
      nodeByID,
      maxItems: mutation ? 200 : action === 'manage-tags' ? 500 : action === 'download' ? 1000 : undefined,
      requireRevision: mutation,
    })
  }
  const allowSelectionAction = (
    action: XDriveFileExplorerSelectionAction,
    selected: readonly XDriveFileExplorerItem[],
  ) => {
    const reason = getSelectionActionDisabledReason(action, selected, new Set(selected.map((item) => Number(item.id))).size)
    if (reason) onError(new Error(reason))
    return !reason
  }
  const copyItems = (selected: XDriveFileExplorerItem[]) => {
    if (allowSelectionAction('copy', selected)) copyWorkspaceItems(selected)
  }
  const cutItems = (selected: XDriveFileExplorerItem[]) => {
    if (allowSelectionAction('cut', selected)) cutWorkspaceItems(selected)
  }

  const loadTextPreview = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    try {
      return await api.fileTextPreview(Number(item.id))
    } catch {
      return null
    }
  }, [api])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem, signal?: AbortSignal, onProgress?: XDriveByteProgressHandler, onStage?: (stage: XDriveMediaLoadStage) => void) => {
    if (item.kind !== 'file' || signal?.aborted) return null
    try {
      const blob = await api.mediaThumbnail(Number(item.id), signal, Number(item.revision), onProgress)
      if (signal?.aborted) return null
      return URL.createObjectURL(blob)
    } catch {
      if (signal?.aborted || xDriveFileKind(item.name, item.kind) !== 'video') return null
      onStage?.('video_read')
    }

    try {
      const source = await api.filePreviewURL(Number(item.id), signal)
      if (signal?.aborted) return null
      onStage?.('poster_capture')
      const poster = await xDriveCaptureVideoPosterBlob(source, 0, 0, 0, 512, signal)
      if (!poster || signal?.aborted) return null
      const revision = Number(item.revision)
      if (Number.isSafeInteger(revision) && revision > 0) {
        try {
          await api.mediaVideoPoster(Number(item.id), revision, poster, signal)
        } catch {
          // Backfill failure does not discard the already decoded local poster.
        }
      }
      if (signal?.aborted) return null
      return URL.createObjectURL(poster)
    } catch {
      return null
    }
  }, [api])

  const loadLivePhotoMotion = useCallback(async (
    item: XDriveFileExplorerItem,
    _onProgress?: XDriveByteProgressHandler,
  ) => {
    if (
      item.kind !== 'file' ||
      !item.name.trim().toLowerCase().endsWith('.livp')
    ) return null
    try {
      return await api.mediaLivePhotoMotionURL(Number(item.id))
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

  const loadMediaItem = useCallback((
    item: XDriveFileExplorerItem,
    signal: AbortSignal,
  ) => api.mediaItem(Number(item.id), signal), [api])

  const loadNodeLocation = useCallback((
    nodeID: number,
    signal?: AbortSignal,
  ) => api.nodeLocation(nodeID, signal), [api])

  const loadPreviewURL = useCallback(async (
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo',
    signal?: AbortSignal,
    onProgress?: XDriveByteProgressHandler,
  ) => {
    if (item.kind !== 'file') return null
    try {
      if (kind === 'live_photo') {
        return await api.mediaLivePhotoStillURL(Number(item.id))
      }
      if (kind === 'image' && xDriveFileUsesRawCompatibilityPreview(item.name)) {
        return await api.mediaAnalysisPreviewURL(Number(item.id), signal, Number(item.revision), onProgress)
      }
      if (!['pdf', 'video', 'audio', 'image'].includes(kind)) return null
      return await api.filePreviewURL(Number(item.id), signal)
    } catch {
      return null
    }
  }, [api])

  const openWebNode = (node: Node, item?: XDriveFileExplorerItem) => {
    onOpenFile(
      node,
      item && !inlineOwnerByNodeID.has(node.id)
        ? browseContextForItem(item)
        : { kind: 'selection', nodeIDs: [node.id], activeIndex: 0 },
    )
  }

  const openWebQuickLook = (request: XDriveFileExplorerQuickLookRequest) => {
    const node = nodeByID.get(Number(request.item.id))
    if (!node) return
    onOpenQuickLook(
      node,
      inlineOwnerByNodeID.has(node.id)
        ? { kind: 'selection', nodeIDs: [node.id], activeIndex: 0 }
        : browseContextForItem(request.item, request.sessionIDs, request.logicalIndex),
    )
  }

  const copyItemPaths = async (selected: XDriveFileExplorerItem[]) => {
    if (selected.length === 0) return
    const text = selected
      .map((item) => xDriveFileExplorerCopyPath(item, inlineCrumbsForItem(item)))
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
    if (!allowSelectionAction('download', selected)) return
    const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)
    if (!nodes) return
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

    const standardItems = xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      onOpen: () => { void openItem(item, (opened) => openWebNode(opened, item), inlineCrumbsForItem(item)) },
      onShowContainingFolder: searchState.results !== null
        ? () => { void showItemInContainingFolder(item) }
        : undefined,
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
    const browserTabItem = {
      id: 'open-browser-tab',
      label: '在新浏览器标签页打开',
      icon: <OpenInNewRoundedIcon fontSize="small" />,
      onSelect: () => onOpenNodeInBrowserTab(node),
    }
    const insertionIndex = standardItems.findIndex((entry) => (
      entry.id !== 'open' && entry.id !== 'open-new-tab'
    ))
    const index = insertionIndex >= 0 ? insertionIndex : standardItems.length
    return [
      ...standardItems.slice(0, index),
      browserTabItem,
      ...standardItems.slice(index),
    ]
  }

  // Recent/Favorites nodes are not guaranteed to be in the active directory
  // projection. Resolve current authenticated metadata before any operation.
  const collectionAction = async (
    entry: { id: number; kind: 'dir' | 'file' },
    action: 'copy' | 'download' | 'share',
  ) => {
    const lifecycle = renameLifecycleKeyRef.current
    const node = await api.node(entry.id)
    if (renameLifecycleKeyRef.current !== lifecycle) return
    if (node.id !== entry.id || node.type !== entry.kind) {
      throw new Error('文件已变化，请刷新最近或收藏列表后重试。')
    }
    if (action === 'copy') {
      copyWorkspaceNodes([node])
      onFeedback('good', '已复制，可在目标文件夹中粘贴。')
    } else if (action === 'download') {
      const plan = xDriveFileExplorerWebDownloadPlan([node])
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
    } else if (node.type === 'file') {
      onShare(node)
    }
  }

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    const expectedCurrentID = current.id
    const lifecycleKey = renameLifecycleKeyRef.current
    try {
      await api.rename(node.id, node.revision, name)
      if (renameLifecycleKeyRef.current !== lifecycleKey) return
      clearSearch()
      await refreshCurrentDirectory(expectedCurrentID)
      if (renameLifecycleKeyRef.current !== lifecycleKey) return
      onFeedback('good', '已重命名。')
    } catch (error) {
      if (renameLifecycleKeyRef.current !== lifecycleKey) return
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
    lifecycleKey: navigationSessionStorageKey ?? '',
    currentID: current?.id,
    currentCrumbs: crumbs,
    sort,
    currentGrouping: grouping,
    nodeByID,
    uploadFilesToParent: onUploadDroppedFiles,
    uploadFolderEntriesToParent: onUploadDroppedFolderEntries,
    refreshCurrentDirectoryIfIdle: onRefreshCurrentDirectoryIfIdle,
  })

  const openUploadPicker = () => {
    if (!current) return
    uploadPickerParentIDRef.current = current.id
    uploadInputRef.current?.click()
  }

  const openFolderUploadPicker = () => {
    if (!current) return
    folderUploadPickerParentIDRef.current = current.id
    folderUploadInputRef.current?.click()
  }

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder,
    onUpload: openUploadPicker,
    onUploadFolder: openFolderUploadPicker,
    onRefresh: refresh,
  })

  // The Mobile Files surface owns only presentation. REST, Server ranges,
  // operations, favorites, recent, search and Viewer remain this Web adapter's.
  const restoreMobileDirectory = useCallback(async (directoryID: number) => {
    const navigationIntentID = beginNavigationIntent()
    const chain: Crumb[] = []
    let nodeID = directoryID
    for (let depth = 0; depth < 256; depth += 1) {
      const node = await api.node(nodeID)
      if (node.type !== 'dir') throw new Error('目标不是文件夹。')
      chain.push({ id: node.id, name: node.name })
      if (!node.parent_id) break
      nodeID = node.parent_id
    }
    if (!chain.length || !isNavigationIntentCurrent(navigationIntentID)) return
    chain.reverse()
    await navigateTo(chain, true, navigationIntentID)
  }, [api, beginNavigationIntent, isNavigationIntentCurrent, navigateTo])

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
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
      {uploadProgress !== null ? (
        <LinearProgress
          variant="determinate"
          value={Math.max(0, Math.min(100, uploadProgress))}
          sx={{ position: 'absolute', inset: '0 0 auto', zIndex: 3 }}
        />
      ) : null}

      {compactMobile ? (
        <MobileFiles
          key={navigationSessionStorageKey ?? ''}
          lifecycleKey={navigationSessionStorageKey ?? ''}
          requestedDirectoryID={initialDirectoryID}
          items={trashActive ? trash.items : explorerItems}
          virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}
          inlineBranches={inlineMobileBranches}
          onToggleInlineFolder={(item, ownerID, parentIndex) => {
            inlineStore.toggle(Number(item.id), ownerID, parentIndex, item.name)
          }}
          onRetryInlineFolder={ownerID => inlineStore.retry(ownerID)}
          onInlineViewport={ranges => inlineStore.ensureViewport(ranges)}
          onClearInline={() => inlineStore.clear()}
          onSelectedItemsChange={retainMobileSelection}
          crumbs={trashActive ? trash.crumbs : explorerCrumbs}
          loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}
          trashActive={trashActive}
          onOpenTrash={() => { beginNavigationIntent(); onOpenTrash() }}
          onCloseTrash={onCloseTrash}
          onBrowseRoot={() => {
            onCloseTrash()
            void navigateTo(explorerCrumbs.slice(0, 1).map(crumb => ({ id: Number(crumb.id), name: crumb.name })))
          }}
          onGoUp={() => { void goUp() }}
          onCrumbClick={index => { void navigateToCrumb(index) }}
          pathValue={trashActive ? undefined : pathValue}
          onPathSubmit={trashActive ? undefined : (path) => { void submitPath(path) }}
          onRestoreFolder={restoreMobileDirectory}
          onOpenItem={(item, ownerID) => {
            if (trashActive) return false
            return openItem(item, node => openWebNode(node, item),
              inlineParentCrumbs(ownerID ?? current?.id ?? 0))
          }}
          onQuickLookItem={trashActive ? undefined : item => {
            void recent.record(Number(item.id))
            openWebQuickLook({ item, logicalIndex: logicalIndexForItem(item) })
          }}
          onOpenError={onError}
          recentItems={recent.items.map(item => ({
            id: item.id, name: item.name, kind: item.kind, subtitle: item.path,
            size: item.size, revision: typeof item.revision === 'number' ? item.revision : undefined,
            updatedAt: item.updatedAt,
          }))}
          favorites={favorites.items.map(item => ({
            id: item.id, name: item.name, kind: 'file' as const,
            subtitle: item.path, size: item.size, revision: item.revision,
            updatedAt: item.updatedAt,
          }))}
          quickAccess={quickAccess.items.map(item => ({ id: item.id, name: item.name, kind: 'dir' as const, subtitle: item.path }))}
          savedSearches={organization.savedSearches.map(item => ({
            id: item.id, name: item.name,
            subtitle: xDriveFileExplorerSavedSearchRuleLabels(item, {
              sourceOptions: searchSourceOptions, tagOptions: organization.tagOptions,
            }).join(' · '),
          }))}
          organizationLoading={organization.loading}
          organizationError={organization.error}
          onRetryOrganization={() => { void organization.refresh() }}
          organizationBusyKey={organization.busyKey}
          onRenameSavedSearch={id => {
            const saved = organization.savedSearches.find(item => item.id === id)
            if (saved) setRenameSavedSearch(saved)
          }}
          canReplaceSavedSearch={canSaveSmartFolder}
          onReplaceSavedSearch={id => {
            const saved = organization.savedSearches.find(item => item.id === id)
            if (!saved || !canSaveSmartFolder) return
            const lifecycleKey = organizationLifecycleKeyRef.current
            void organization.updateSavedSearch(saved.id, {
              name: saved.name,
              query: searchState.query,
              filters: persistedSearchFilters,
            }).then(() => {
              if (organizationLifecycleKeyRef.current !== lifecycleKey) return
              onFeedback('good', '智能文件夹已更新。')
            }, () => undefined)
          }}
          onDeleteSavedSearch={id => organization.deleteSavedSearch(id)}
          tags={organization.tags.map(item => ({ id: item.id, name: item.name }))}
          onOpenRecent={id => {
            onCloseTrash()
            const intent = beginNavigationIntent()
            return recent.activate(id, {
              onDirectory: next => navigateTo(next, true, intent),
              onFile: item => {
                if (!isNavigationIntentCurrent(intent)) return false
                openWebNode(item.node)
                return true
              },
            })
          }}
          onOpenFavorite={id => {
            onCloseTrash()
            const intent = beginNavigationIntent()
            return favorites.activate(id, node => {
              if (isNavigationIntentCurrent(intent)) openWebNode(node)
            })
          }}
          onOpenQuickAccess={id => {
            onCloseTrash()
            const intent = beginNavigationIntent()
            return quickAccess.navigate(id, next => navigateTo(next, true, intent))
          }}
          onReorderQuickAccess={ids => quickAccess.reorder(ids)}
          onReorderSavedSearches={ids => organization.reorderSavedSearches(ids)}
          onClearRecent={() => recent.clear()}
          onUnfavorite={id => favorites.unfavorite(id)}
          onCollectionAction={collectionAction}
          onPrepareNativeShareFile={(entry, signal) => api.prepareNativeShareFile(Number(entry.id), signal)}
          onOpenSavedSearch={id => {
            onCloseTrash()
            const saved = organization.savedSearches.find(item => item.id === id)
            if (saved) void applySearch(saved.query, saved.filters)
          }}
          onOpenTag={id => { onCloseTrash(); void applySearch('', { tagID: id }) }}
          onManageTags={(selected = []) => {
            if (selected.length > 0 && !allowSelectionAction('manage-tags', selected)) return
            setTagDialogItems(selected)
            setTagDialogMode(selected.length > 0 ? 'assign' : 'manage')
          }}
          searchValue={searchValue}
          onSearchValueChange={changeSearchValue}
          onSearch={query => { if (trashActive) onCloseTrash(); void submitSearch(query) }}
          onClearSearch={() => { clearSearch() }}
          searchActive={!trashActive && searchState.results !== null}
          searchSummary={!trashActive && searchState.results !== null ? {
            query: searchState.query,
            conditions: xDriveFileExplorerSearchFilterLabels(searchFilters, {
              sourceOptions: searchSourceOptions, tagOptions: organization.tagOptions,
            }),
            resultCount: searchReady ? searchVirtualCollection?.itemCount ?? 0 : null,
            loading: searchLoading,
            error: searchError,
            onClear: () => clearSearch(),
            onRetry: () => { void retrySearch() },
          } : undefined}
          filtersControl={!trashActive ? (
            <XDriveFileExplorerSearchFilters
              filters={searchFilters}
              sourceOptions={searchSourceOptions}
              tagOptions={organization.tagOptions}
              canSaveSearch={canSaveSmartFolder}
              onSaveSearch={() => setSaveSearchOpen(true)}
              onChange={changeSearchFilters}
            />
          ) : undefined}
          sort={trashActive ? trashSort : sort}
          onSortChange={trashActive ? setTrashSort : changeSort}
          grouping={trashActive ? undefined : grouping}
          onGroupingChange={trashActive ? undefined : changeGrouping}
          actionFeedback={actionFeedback}
          viewMode={viewMode}
          onViewModeChange={view => {
            if (view === 'grid') inlineStore.clear()
            setViewMode(view)
          }}
          onCreateFolder={onCreateFolder}
          onUpload={openUploadPicker}
          onUploadFolder={openFolderUploadPicker}
          onRefresh={trashActive ? () => { void trash.refresh() } : refresh}
          onRefreshRecent={() => { void recent.refresh() }}
          onRefreshFavorites={() => { void favorites.refresh() }}
          canPaste={!trashActive && fileOperationCanPaste}
          onPaste={() => { void pasteClipboard() }}
          canUndo={!trashActive && canUndo}
          onUndo={trashActive ? undefined : onUndo}
          canRedo={!trashActive && canRedo}
          onRedo={trashActive ? undefined : onRedo}
          canHistoryBack={!trashActive && canGoBack}
          onHistoryBack={() => { void goBack() }}
          canHistoryForward={!trashActive && canGoForward}
          onHistoryForward={() => { void goForward() }}
          onCopyPaths={selected => { void copyItemPaths(selected) }}
          onRename={renameItem}
          onCopy={copyItems}
          onCut={cutItems}
          onMove={selected => openDestination('move', selected, crumbs)}
          onCopyTo={selected => openDestination('copy', selected, crumbs)}
          onDownload={selected => { void downloadSelected(selected) }}
          onDelete={selected => {
            if (!allowSelectionAction('delete', selected)) return
            const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)
            if (nodes?.length) onRemoveMany(nodes)
          }}
          onDropToFolder={(selected, target) => { void dropItemsToFolder(selected, target, 'move') }}
          onDropToCrumb={(selected, target) => { void dropItemsToCrumb(selected, target, 'move') }}
          onExternalFilesDrop={trashActive ? undefined : (files, target) => { void dropExternalFiles(files, target) }}
          onExternalFilesDropToCrumb={trashActive ? undefined : (files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
          onExternalFolderDrop={trashActive ? undefined : (payload, target) => { void dropExternalFolderEntries(payload, target) }}
          onExternalFolderDropToCrumb={trashActive ? undefined : (payload, crumb) => { void dropExternalFolderEntriesToCrumb(payload, crumb) }}
          getItemMenuItems={trashActive ? trash.getItemMenuItems : getItemMenuItems}
          loadThumbnail={loadThumbnail}
          loadMediaItem={loadMediaItem}
          loadPropertiesStats={loadPropertiesStats}
          loadNodeLocation={loadNodeLocation}
          onShowInFolder={location => {
            if (!location.parent_id) return false
            const chain = location.breadcrumbs
              .filter(crumb => crumb.id !== location.node_id)
              .map(crumb => ({ id: crumb.id, name: crumb.name }))
            if (!chain.length || chain.at(-1)?.id !== location.parent_id) return false
            onCloseTrash()
            return navigateTo(chain).then(() => true).catch(error => {
              onError(error)
              return false
            })
          }}
        />
      ) : (
      <XDriveFileExplorer
        interactionLifecycleKey={navigationSessionStorageKey ?? ''}
        presentation="workspace"
        keyboardProfile={FILE_KEYBOARD_PROFILE}
        items={trashActive ? trash.items : explorerItems}
        crumbs={trashActive ? trash.crumbs : explorerCrumbs}
        virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}
        loading={trashActive ? trash.loading : loading || searchLoading || fileOperationBusy}
        emptyMessage={trashActive ? '回收站为空' : searchState.results !== null
          ? searchError ? '搜索未完成，请重试' : searchReady ? '未找到匹配的文件或文件夹' : '正在搜索…'
          : undefined}
        loadThumbnail={loadThumbnail}
        loadTextPreview={loadTextPreview}
        loadPreviewURL={loadPreviewURL}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPropertiesStats={loadPropertiesStats}
        loadMediaDetails={loadMediaDetails}
        loadMediaItem={trashActive ? undefined : loadMediaItem}
        loadNodeLocation={trashActive ? undefined : loadNodeLocation}
        onShowInFolder={trashActive ? undefined : (location) => {
          if (!location.parent_id) return
          const ancestry = location.breadcrumbs
            .filter((crumb) => crumb.id !== location.node_id)
            .map((crumb) => ({ id: crumb.id, name: crumb.name }))
          if (!ancestry.length || ancestry[ancestry.length - 1].id !== location.parent_id) return
          onCloseTrash()
          void navigateTo(ancestry).catch(onError)
        }}
        pathValue={trashActive ? '回收站' : pathValue}
        onPathSubmit={trashActive ? undefined : (path) => { void submitPath(path) }}
        searchEnabled={!trashActive}
        searchValue={trashActive ? '' : searchValue}
        onSearchValueChange={changeSearchValue}
        onSearch={(query) => { void submitSearch(query) }}
        viewState={trashActive ? undefined : explorerViewState}
        searchSummary={!trashActive && searchState.results !== null ? {
          query: searchState.query,
          conditions: xDriveFileExplorerSearchFilterLabels(searchFilters, {
            sourceOptions: searchSourceOptions, tagOptions: organization.tagOptions,
          }),
          resultCount: searchReady ? searchVirtualCollection?.itemCount ?? 0 : null,
          loading: searchLoading,
          error: searchError,
          onClear: () => { clearSearch() },
          onRetry: () => { void retrySearch() },
        } : undefined}
        canGoBack={!trashActive && canGoBack}
        canGoForward={!trashActive && canGoForward}
        canGoUp={!trashActive && canGoUp}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={trashActive ? () => { void trash.refresh() } : refresh}
        onCrumbClick={trashActive ? undefined : (_crumb, index) => { void navigateToCrumb(index) }}
        onCreateFolder={trashActive ? undefined : onCreateFolder}
        onUpload={trashActive ? undefined : openUploadPicker}
        onUploadFolder={trashActive ? undefined : openFolderUploadPicker}
        onOpenItem={trashActive ? undefined : (item) => { void openItem(item, (node) => openWebNode(node, item)) }}
        onOpenItemInNewTab={!trashActive && canNewTab
          ? (item) => { void openItemInNewTab(item) }
          : undefined}
        onPreviewItem={trashActive ? undefined : (item) => { void recent.record(Number(item.id)) }}
        onOpenQuickLook={trashActive ? undefined : openWebQuickLook}
        loadColumnPage={trashActive || searchStatusText ? undefined : loadColumnPage}
        onColumnNavigate={trashActive || searchStatusText ? undefined : (nextCrumbs) => {
          onCloseTrash()
          void navigateTo(nextCrumbs.map((crumb) => ({ id: Number(crumb.id), name: crumb.name })))
        }}
        onColumnOpenItem={trashActive ? undefined : (item) => { void openItem(item, (node) => openWebNode(node, item)) }}
        onManageTags={trashActive ? undefined : (selected) => {
          if (!allowSelectionAction('manage-tags', selected)) return
          setTagDialogItems(selected)
          setTagDialogMode('assign')
        }}
        getSelectionActionDisabledReason={getSelectionActionDisabledReason}
        actionFeedback={actionFeedback}
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
        onMoveItemsTo={trashActive ? undefined : (selected) => openDestination('move', selected, crumbs)}
        onCopyItemsTo={trashActive ? undefined : (selected) => openDestination('copy', selected, crumbs)}
        onPaste={trashActive ? undefined : (operationOverride) => { void pasteClipboard(operationOverride) }}
        canPaste={!trashActive && fileOperationCanPaste}
        canUndo={!trashActive && canUndo}
        onUndo={trashActive ? undefined : onUndo}
        canRedo={!trashActive && canRedo}
        onRedo={trashActive ? undefined : onRedo}
        onDownloadItems={trashActive ? undefined : (selected) => { void downloadSelected(selected) }}
        folderDownloadSupported={!trashActive}
        onDeleteItems={trashActive ? undefined : (selected) => {
          if (!allowSelectionAction('delete', selected)) return
          const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)
          if (nodes?.length) onRemoveMany(nodes)
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
            onChange={changeSearchFilters}
          />
        )}
        navigationPane={(
          <XDriveFileExplorerNavigationPane
            lifecycleKey={navigationSessionStorageKey ?? ''}
            currentCrumbs={crumbs}
            trashActive={trashActive}
            onNavigateTrash={() => {
              beginNavigationIntent()
              onOpenTrash()
            }}
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
            organizationLoading={organization.loading}
            organizationError={organization.error}
            onRetryOrganization={() => { void organization.refresh() }}
            onManageTags={() => {
              setTagDialogItems([])
              setTagDialogMode('manage')
            }}
            onSaveCurrentSearch={() => setSaveSearchOpen(true)}
            canSaveCurrentSearch={canSaveSmartFolder}
            savedSearchRuleLabels={(saved) => xDriveFileExplorerSavedSearchRuleLabels(saved, {
              sourceOptions: searchSourceOptions,
              tagOptions: organization.tagOptions,
            })}
            currentSearchNotice={organizationSearchState.currentSearchNotice}
            savedSearchesEnabled
            savedSearches={organization.savedSearches}
            activeSavedSearchID={activeSavedSearchID}
            matchingSavedSearchIDs={organizationSearchState.matchingSavedSearchIDs}
            onActivateSavedSearch={(savedSearch) => {
              onCloseTrash()
              void applySearch(savedSearch.query, savedSearch.filters)
            }}
            onRenameSavedSearch={(savedSearch) => setRenameSavedSearch(savedSearch)}
            onReplaceSavedSearch={(savedSearch) => {
              if (!canSaveSmartFolder) return
              const lifecycleKey = organizationLifecycleKeyRef.current
              void organization.updateSavedSearch(savedSearch.id, {
                name: savedSearch.name,
                query: searchState.query,
                filters: persistedSearchFilters,
              }).then(() => {
                if (organizationLifecycleKeyRef.current !== lifecycleKey) return
                onFeedback('good', '智能文件夹已更新。')
              }, () => undefined)
            }}
            canReplaceSavedSearch={canSaveSmartFolder}
            onDeleteSavedSearch={(id) => {
              void organization.deleteSavedSearch(id).catch(() => undefined)
            }}
            onReorderSavedSearches={(ids) => { void organization.reorderSavedSearches(ids) }}
            tagsEnabled
            tags={organization.tags}
            activeTagID={activeTagID}
            onActivateTag={(tag) => {
              onCloseTrash()
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
      )}
      {destinationRequest && (
        <XDriveFileExplorerDestinationDialog
          open
          lifecycleKey={navigationSessionStorageKey ?? ''}
          operation={destinationRequest.operation}
          sources={destinationRequest.sources}
          initialCrumbs={destinationRequest.initialCrumbs}
          loadDirectoryPage={loadTreeDirectoryPage}
          onSubmit={submitDestination}
          onClose={closeDestination}
        />
      )}
      <XDriveFileTagDialog
        open={tagDialogMode !== null}
        mode={tagDialogMode ?? 'assign'}
        nodeIDs={tagDialogItems.map((item) => Number(item.id))}
        tags={organization.tags}
        tagsLoading={organization.loading}
        tagsError={organization.error}
        onRetryTags={() => { void organization.refresh() }}
        busy={Boolean(organization.busyKey)}
        queryNodeTags={organization.queryNodeTags}
        onSetTag={async (tagID, nodeIDs, assigned) => {
          const lifecycleKey = organizationLifecycleKeyRef.current
          const searchScopeKey = organizationSearchScopeKeyRef.current
          await organization.setTagNodes(tagID, nodeIDs, assigned)
          if (
            organizationLifecycleKeyRef.current !== lifecycleKey ||
            organizationSearchScopeKeyRef.current !== searchScopeKey
          ) return
          if (searchFilters.tagID === tagID) {
            await applySearch(searchState.query, searchFilters)
          }
        }}
        onCreateTag={organization.createTag}
        onUpdateTag={organization.updateTag}
        onDeleteTag={async (tagID) => {
          const lifecycleKey = organizationLifecycleKeyRef.current
          const searchScopeKey = organizationSearchScopeKeyRef.current
          await organization.deleteTag(tagID)
          if (
            organizationLifecycleKeyRef.current !== lifecycleKey ||
            organizationSearchScopeKeyRef.current !== searchScopeKey
          ) return
          if (searchFilters.tagID === tagID) {
            clearSearch()
          }
        }}
        onClose={() => {
          setTagDialogItems([])
          setTagDialogMode(null)
        }}
      />
      <XDriveFileNameDialog
        open={saveSearchOpen}
        mode="saved-search"
        onClose={() => setSaveSearchOpen(false)}
        onError={onError}
        onSubmit={async (name) => {
          const lifecycleKey = organizationLifecycleKeyRef.current
          await organization.createSavedSearch({
            name,
            query: searchState.query,
            filters: persistedSearchFilters,
          })
          if (organizationLifecycleKeyRef.current !== lifecycleKey) return
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
          const lifecycleKey = organizationLifecycleKeyRef.current
          await organization.updateSavedSearch(renameSavedSearch.id, {
            name,
            query: renameSavedSearch.query,
            filters: renameSavedSearch.filters,
          })
          if (organizationLifecycleKeyRef.current !== lifecycleKey) return
          onFeedback('good', '智能文件夹已重命名。')
        }}
      />
      <XDriveFileExplorerTrashDeleteDialog
        target={trash.deleteTarget}
        loading={trash.workingKey.startsWith('delete:')}
        onCancel={trash.cancelPermanentDelete}
        onConfirm={() => { void trash.confirmPermanentDelete() }}
      />
    </Box>
  )
}
