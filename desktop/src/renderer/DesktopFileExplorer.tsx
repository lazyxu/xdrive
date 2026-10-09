import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { xDriveDesktopViewportRequest } from './abortableViewportRequest'
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
  xDriveFileExplorerResolveSelectionNodes,
  xDriveFileExplorerSelectionActionDisabledReason,
  xDriveFileExplorerResolveFolderUploadTargets,
  xDriveFileExplorerPropertiesRefs,
  xDriveFileExplorerAvailabilityError,
  xDriveFileExplorerAvailabilityFromSnapshot,
  xDriveFileExplorerPersistedSearchFilters,
  xDriveFileExplorerOrganizationSearchState,
  xDriveFileExplorerSavedSearchRuleLabels,
  xDriveFileExplorerSearchFiltersSignature,
  xDriveFileExplorerSearchFilterLabels,
} from '@xdrive/shared'
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
  useXDriveFileExplorerUploadController,
  xDriveFileExplorerUploadGroupLabel,
  XDriveUploadConflictDialog,
  xDriveCaptureVideoPosterBlob,
  xDriveFileKind,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerSelectionAction,
  XDriveFileExplorerMenuItem,
  XDriveFileExplorerNavigationState,
  XDriveFileExplorerSort,
  XDriveFileExplorerWorkspaceVirtualDirectory,
  XDriveTrashDialogAdapter,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerGrouping,
  XDriveFileExplorerDownloadResult,
  XDriveFileExplorerSearchAvailabilityOption,
  XDriveFileExplorerSearchSourceOption,
  XDriveFileExplorerMediaDetailsRef,
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

export type DesktopFileExplorerAction =
  | 'upload-files'
  | 'upload-folder'
  | 'create-folder'

export type DesktopFileExplorerActionIntent = {
  id: number
  action: DesktopFileExplorerAction
  lifecycleKey: string
}

function desktopFileStatusLabel(state: AgentFileAvailability, syncing = false) {
  if (syncing || state.Syncing || state.Mode === 'syncing') return '正在同步'
  if (state.InSync) return '已同步'
  return '待同步'
}

function desktopFileAvailabilityPathKey(value?: string) {
  let normalized = (value ?? '').trim().replace(/\\/g, '/')
  if (normalized.toLowerCase().startsWith('//?/unc/')) {
    normalized = '//' + normalized.slice(8)
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice(4)
  }
  return normalized.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

function desktopActiveHydrationProgress(transfers: readonly AgentTransfer[]) {
  const byPath = new Map<string, number | null>()
  for (const transfer of transfers) {
    if (transfer.kind !== 'hydration' || transfer.state !== 'running') continue
    const key = desktopFileAvailabilityPathKey(transfer.path)
    if (!key || byPath.has(key)) continue
    const total = Math.max(0, transfer.bytes_total)
    const done = Math.max(0, transfer.bytes_done)
    byPath.set(
      key,
      total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : null,
    )
  }
  return byPath
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
  actionFeedback,
  onDownloadStart,
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
  mediaDetailsSupported = false,
  mediaPropertiesSupported = false,
  fileAvailabilitySupported = false,
  openWithSupported = false,
  quickAccessSupported = false,
  fileTagsSupported = false,
  savedSearchesSupported = false,
  favoritesSupported = false,
  recentSupported = false,
  transferLifecycleSupported = false,
  transferLifecycleBatchSupported = false,
  transfers = [],
  actionIntent,
  onActionIntentConsumed,
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
  actionFeedback?: ReactNode
  onDownloadStart?: () => (result: XDriveFileExplorerDownloadResult) => void
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
  mediaDetailsSupported?: boolean
  mediaPropertiesSupported?: boolean
  fileAvailabilitySupported?: boolean
  openWithSupported?: boolean
  quickAccessSupported?: boolean
  fileTagsSupported?: boolean
  savedSearchesSupported?: boolean
  favoritesSupported?: boolean
  recentSupported?: boolean
  transferLifecycleSupported?: boolean
  transferLifecycleBatchSupported?: boolean
  transfers?: readonly AgentTransfer[]
  actionIntent?: DesktopFileExplorerActionIntent | null
  onActionIntentConsumed?: (id: number) => void
  keyboardProfile?: XDriveFileExplorerKeyboardProfile
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const createFolderParentIDRef = useRef<number | null>(null)
  const uploadPickerParentIDRef = useRef<number | null>(null)
  const folderUploadPickerParentIDRef = useRef<number | null>(null)
  const [actionBusy, setActionBusy] = useState('')
  const actionBusyRef = useRef<{ key: string; generation: number } | null>(null)
  const actionGenerationRef = useRef(1)

  useEffect(() => {
    actionGenerationRef.current += 1
    actionBusyRef.current = null
    setActionBusy('')
    createFolderParentIDRef.current = null
    uploadPickerParentIDRef.current = null
    folderUploadPickerParentIDRef.current = null
    setCreateOpen(false)
    setTagDialogItems([])
    setTagDialogMode(null)
    setSaveSearchOpen(false)
    setRenameSavedSearch(null)
    return () => {
      actionGenerationRef.current += 1
      actionBusyRef.current = null
    }
  }, [navigationSessionStorageKey])

  const beginActionBusy = useCallback((key: string) => {
    if (actionBusyRef.current) return null
    const token = { key, generation: actionGenerationRef.current }
    actionBusyRef.current = token
    setActionBusy(key)
    return token
  }, [])

  const isActionBusyCurrent = useCallback((
    token: { key: string; generation: number },
  ) => (
    token.generation === actionGenerationRef.current &&
    actionBusyRef.current === token
  ), [])

  const finishActionBusy = useCallback((
    token: { key: string; generation: number },
  ) => {
    if (!isActionBusyCurrent(token)) return
    actionBusyRef.current = null
    setActionBusy('')
  }, [isActionBusyCurrent])

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
    setSearchSourceOptions([])
    void window.xdriveDesktop.agent.getSources().then((result) => {
      if (active && result.ok) {
        setSearchSourceOptions(result.data.map((source) => ({ id: source.id, name: source.name })))
      }
    })
    return () => {
      active = false
    }
  }, [navigationSessionStorageKey])
  const [availabilityByID, setAvailabilityByID] = useState<Map<number, DesktopFileAvailabilityEntry>>(
    () => new Map(),
  )
  const [navigationAvailabilityItems, setNavigationAvailabilityItems] = useState<readonly XDriveFileExplorerItem[]>([])
  const [availabilityRefreshToken, setAvailabilityRefreshToken] = useState(0)
  const availabilityRequestRef = useRef(0)

  useEffect(() => {
    availabilityRequestRef.current += 1
    setAvailabilityByID(new Map())
    setNavigationAvailabilityItems([])
  }, [navigationSessionStorageKey])

  const actionIntentRef = useRef(0)
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
    searchByID,
    explorerItems,
    explorerCrumbs,
    copyItems: copyWorkspaceItems,
    cutItems: cutWorkspaceItems,
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
    reorderItems: async (nodeIDs) => {
      const result = await window.xdriveDesktop.agent.cloudReorderFileQuickAccess(nodeIDs)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })

  const organizationAdapter = useMemo(() => ({
    listTags: async () => {
      const result = await window.xdriveDesktop.agent.cloudFileTags()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    createTag: async (name: string, color: string) => {
      const result = await window.xdriveDesktop.agent.cloudCreateFileTag(name, color)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    updateTag: async (id: number, input: { name?: string; color?: string }) => {
      const result = await window.xdriveDesktop.agent.cloudUpdateFileTag(id, input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    deleteTag: async (id: number) => {
      const result = await window.xdriveDesktop.agent.cloudDeleteFileTag(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    queryNodeTags: async (nodeIDs: number[]) => {
      const result = await window.xdriveDesktop.agent.cloudQueryFileNodeTags(nodeIDs)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    addTagNodes: async (tagID: number, nodeIDs: number[]) => {
      const result = await window.xdriveDesktop.agent.cloudSetFileTagNodes(tagID, nodeIDs, true)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    removeTagNodes: async (tagID: number, nodeIDs: number[]) => {
      const result = await window.xdriveDesktop.agent.cloudSetFileTagNodes(tagID, nodeIDs, false)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    listSavedSearches: async () => {
      const result = await window.xdriveDesktop.agent.cloudFileSavedSearches()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    createSavedSearch: async (input: AgentFileSavedSearchInput) => {
      const result = await window.xdriveDesktop.agent.cloudCreateFileSavedSearch(input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    updateSavedSearch: async (id: number, input: AgentFileSavedSearchInput) => {
      const result = await window.xdriveDesktop.agent.cloudUpdateFileSavedSearch(id, input)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    deleteSavedSearch: async (id: number) => {
      const result = await window.xdriveDesktop.agent.cloudDeleteFileSavedSearch(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    reorderSavedSearches: async (ids: number[]) => {
      const result = await window.xdriveDesktop.agent.cloudReorderFileSavedSearches(ids)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  }), [])
  const organization = useXDriveFileExplorerOrganization({
    lifecycleKey: navigationSessionStorageKey ?? '',
    adapter: organizationAdapter,
    enabled: fileTagsSupported && savedSearchesSupported,
    onError: (error) => onError(error instanceof Error ? error.message : String(error)),
  })
  const organizationLifecycleKeyRef = useRef(navigationSessionStorageKey ?? '')
  organizationLifecycleKeyRef.current = navigationSessionStorageKey ?? ''
  const [tagDialogItems, setTagDialogItems] = useState<XDriveFileExplorerItem[]>([])
  const [tagDialogMode, setTagDialogMode] = useState<'manage' | 'assign' | null>(null)
  const [saveSearchOpen, setSaveSearchOpen] = useState(false)
  const [renameSavedSearch, setRenameSavedSearch] = useState<AgentFileSavedSearch | null>(null)
  const organizationSearchState = xDriveFileExplorerOrganizationSearchState({
    active: !trashActive && searchState.results !== null,
    query: searchState.query,
    filters: searchFilters,
    savedSearches: organization.savedSearches,
  })
  const { activeSavedSearchID, activeTagID } = organizationSearchState
  const persistedSearchFilters = xDriveFileExplorerPersistedSearchFilters(searchFilters)
  const organizationSearchScopeKey = `${searchState.query}\n${xDriveFileExplorerSearchFiltersSignature(searchFilters)}`
  const organizationSearchScopeKeyRef = useRef(organizationSearchScopeKey)
  organizationSearchScopeKeyRef.current = organizationSearchScopeKey
  const canSaveSmartFolder = organizationSearchState.canSaveCurrentSearch

  const loadColumnPage = useCallback(async (
    parentID: string | number,
    cursor: string,
    _signal: AbortSignal,
  ) => {
    const result = await window.xdriveDesktop.agent.cloudChildrenPage(Number(parentID), {
      cursor: cursor || undefined,
      limit: 200,
      sort: 'name',
      order: 'asc',
    })
    if (!result.ok) throw new Error(result.error.message)
    return {
      items: result.data.items.map((node) => xDriveProjectFileExplorerNode(node, '')),
      nextCursor: result.data.next_cursor,
    }
  }, [])

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
      startChildren: transferLifecycleBatchSupported ? async (groupID, inputs) => {
        const ids: string[] = []
        for (
          let start = 0;
          start < inputs.length;
          start += desktopTransferLifecycleChildBatchSize
        ) {
          const batch = inputs.slice(
            start,
            start + desktopTransferLifecycleChildBatchSize,
          )
          const result = await window.xdriveDesktop.agent.transferLifecycle({
            action: 'start_children',
            parent_id: groupID,
            children: batch.map((input) => ({
              file_name: input.fileName,
              relative_path: input.relativePath,
              kind: 'upload',
              direction: 'upload',
              bytes_total: input.bytesTotal,
              items_total: 1,
            })),
          })
          if (!result.ok || !result.data.ids) {
            throw new Error(result.ok ? '未批量创建传输子任务。' : result.error.message)
          }
          if (result.data.ids.length !== batch.length) {
            throw new Error('传输子任务数量不匹配。')
          }
          ids.push(...result.data.ids)
        }
        return ids
      } : undefined,
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
    destinationRequest,
    openDestination,
    closeDestination,
    submitDestination,
  } = useXDriveFileExplorerOperationController<AgentCloudNode, AgentCloudFileOperation>({
    lifecycleKey: navigationSessionStorageKey ?? '',
    maxItems: 200,
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

  const getSelectionActionDisabledReason = (
    action: XDriveFileExplorerSelectionAction,
    selected: readonly XDriveFileExplorerItem[],
    selectedCount: number,
  ) => {
    const mutation = ['copy', 'cut', 'delete', 'move-to', 'copy-to'].includes(action)
    const reason = xDriveFileExplorerSelectionActionDisabledReason({
      selected,
      selectedCount,
      nodeByID,
      maxItems: mutation ? 200 : action === 'manage-tags' ? 500 : undefined,
      requireRevision: mutation,
    })
    if (reason) return reason
    if (action === 'manage-tags' && !fileTagsSupported) return '当前客户端不支持标签，请更新客户端核心组件。'
    if (action === 'download') {
      const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID) ?? []
      const fileCount = nodes.filter((node) => node.type === 'file').length
      if ((archiveDownloadSupported ? selectedCount : fileCount) > 1000) {
        return archiveDownloadSupported
          ? '一次下载最多 1000 个项目，请缩小选择范围。'
          : '一次下载最多 1000 个文件，请缩小选择范围。'
      }
      if (!archiveDownloadSupported && !(folderTreeDownloadSupported && selectedCount === 1) && fileCount === 0) {
        return '当前客户端不支持下载所选文件夹，请选择文件或更新客户端核心组件。'
      }
    }
    return null
  }
  const allowSelectionAction = (
    action: XDriveFileExplorerSelectionAction,
    selected: readonly XDriveFileExplorerItem[],
  ) => {
    const reason = getSelectionActionDisabledReason(action, selected, new Set(selected.map((item) => Number(item.id))).size)
    if (reason) onError(reason)
    return !reason
  }
  const copyItems = (selected: XDriveFileExplorerItem[]) => {
    if (allowSelectionAction('copy', selected)) copyWorkspaceItems(selected)
  }
  const cutItems = (selected: XDriveFileExplorerItem[]) => {
    if (allowSelectionAction('cut', selected)) cutWorkspaceItems(selected)
  }

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

  const loadMediaDetails = useCallback(async (
    refs: readonly XDriveFileExplorerMediaDetailsRef[],
    signal: AbortSignal,
  ) => {
    if (!mediaDetailsSupported || signal.aborted) return []
    const result = await window.xdriveDesktop.agent.cloudFileMediaDetails([...refs])
    if (signal.aborted) return []
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }, [mediaDetailsSupported])

  const loadMediaItem = useCallback(async (
    item: XDriveFileExplorerItem,
    signal: AbortSignal,
  ) => {
    if (!mediaPropertiesSupported || item.kind !== 'file') return null
    const requestID = nextDesktopFilePropertiesRequestID()
    const cancel = () => {
      void window.xdriveDesktop.agent.cancelMediaItem(requestID)
    }
    if (signal.aborted) return null
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await window.xdriveDesktop.agent.getMediaItem(Number(item.id), requestID)
      if (signal.aborted) return null
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }, [mediaPropertiesSupported])

  const loadPreviewURL = useCallback(async (
    item: XDriveFileExplorerItem,
    kind: 'image' | 'video' | 'audio' | 'pdf' | 'live_photo',
  ) => {
    if (!previewStreamSupported || item.kind !== 'file') return null
    if (kind === 'live_photo') {
      const result = await window.xdriveDesktop.agent.getMediaLivePhotoStill(Number(item.id))
      return result.ok ? result.data : null
    }
    if (!['pdf', 'video', 'audio', 'image'].includes(kind)) return null
    const result = await window.xdriveDesktop.agent.cloudFilePreviewURL(Number(item.id))
    return result.ok ? result.data : null
  }, [previewStreamSupported])

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem, signal?: AbortSignal) => {
    if (item.kind !== 'file' || signal?.aborted) return null
    const lifecycleGeneration = actionGenerationRef.current
    const isCurrentLifecycle = () => (
      lifecycleGeneration === actionGenerationRef.current && !signal?.aborted
    )

    const result = await xDriveDesktopViewportRequest(
      signal,
      (requestID) => window.xdriveDesktop.agent.getMediaThumbnail(Number(item.id), requestID),
    )
    if (!isCurrentLifecycle()) return null
    if (result.ok) {
      const contentType = result.data.content_type || 'image/jpeg'
      const blob = new Blob([result.data.data], { type: contentType })
      return URL.createObjectURL(blob)
    }
    if (!previewStreamSupported || xDriveFileKind(item.name, item.kind) !== 'video') return null

    const preview = await window.xdriveDesktop.agent.cloudFilePreviewURL(Number(item.id))
    if (!isCurrentLifecycle() || !preview.ok) return null
    const poster = await xDriveCaptureVideoPosterBlob(preview.data, 0, 0, 0, 512, signal)
    if (!poster || !isCurrentLifecycle()) return null
    const revision = Number(item.revision)
    if (Number.isSafeInteger(revision) && revision > 0) {
      try {
        const posterBytes = await poster.arrayBuffer()
        if (!isCurrentLifecycle()) return null
        await window.xdriveDesktop.agent.putMediaVideoPoster(
          Number(item.id),
          revision,
          posterBytes,
        )
        if (!isCurrentLifecycle()) return null
      } catch {
        // Preserve the local poster when the shared Server cache is unavailable.
      }
    }
    if (!isCurrentLifecycle()) return null
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
    const lifecycleGeneration = actionGenerationRef.current
    const result = await window.xdriveDesktop.agent.getMediaLivePhotoMotion(Number(item.id), onProgress)
    if (
      lifecycleGeneration !== actionGenerationRef.current ||
      !result.ok
    ) return null
    const motionURL = result.data
    return {
      url: motionURL,
      dispose: () => {
        if (lifecycleGeneration !== actionGenerationRef.current) return
        void window.xdriveDesktop.agent.releaseMediaLivePhotoMotion(motionURL)
      },
    }
  }, [])

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
    navigationSessionStorageKey,
  ])

  const hydrationProgressByPath = useMemo(
    () => desktopActiveHydrationProgress(transfers),
    [transfers],
  )
  const hadHydrationTransferRef = useRef(false)

  useEffect(() => {
    const active = hydrationProgressByPath.size > 0
    if (!active && hadHydrationTransferRef.current) {
      setAvailabilityRefreshToken((value) => value + 1)
    }
    hadHydrationTransferRef.current = active
  }, [hydrationProgressByPath])

  useEffect(() => {
    if (!fileAvailabilitySupported) return
    const hasUntrackedSyncing = [...availabilityByID.values()].some((entry) => {
      if (!entry.state?.Syncing) return false
      return !hydrationProgressByPath.has(desktopFileAvailabilityPathKey(entry.state.Path))
    })
    if (!hasUntrackedSyncing) return
    const timer = window.setTimeout(
      () => setAvailabilityRefreshToken((value) => value + 1),
      1500,
    )
    return () => window.clearTimeout(timer)
  }, [availabilityByID, fileAvailabilitySupported, hydrationProgressByPath])

  const getItemStatus = useCallback((item: XDriveFileExplorerItem) => {
    const entry = availabilityByID.get(Number(item.id))
    if (entry?.error) return '状态异常'
    if (!entry?.state) return undefined
    const hydrationActive = hydrationProgressByPath.has(
      desktopFileAvailabilityPathKey(entry.state.Path),
    )
    return desktopFileStatusLabel(entry.state, hydrationActive)
  }, [availabilityByID, hydrationProgressByPath])

  const getItemAvailability = useCallback((item: XDriveFileExplorerItem) => {
    const entry = availabilityByID.get(Number(item.id))
    if (entry?.error) return xDriveFileExplorerAvailabilityError()
    if (!entry?.state) return undefined
    const hydrationProgress = hydrationProgressByPath.get(
      desktopFileAvailabilityPathKey(entry.state.Path),
    )
    return xDriveFileExplorerAvailabilityFromSnapshot({
      mode: entry.state.Mode,
      pinned: entry.state.Pinned,
      onlineOnly: entry.state.OnlineOnly,
      availableOffline: entry.state.AvailableOffline,
      mixed: entry.state.Mixed,
      syncing: entry.state.Syncing || hydrationProgress !== undefined,
      progress: hydrationProgress ?? undefined,
    })
  }, [availabilityByID, hydrationProgressByPath])

  const setNodeAvailability = useCallback(async (
    node: AgentCloudNode,
    action: 'keep' | 'release',
  ) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    const busyToken = beginActionBusy(`availability-${node.id}`)
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.setFileAvailability(
        relativePath,
        action,
      )
      if (!isActionBusyCurrent(busyToken)) return
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
      finishActionBusy(busyToken)
    }
  }, [
    beginActionBusy,
    crumbs,
    finishActionBusy,
    isActionBusyCurrent,
    onError,
    onFeedback,
    searchByID,
  ])

  const openLocalNode = async (node: AgentCloudNode, reveal = false) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    const busyToken = beginActionBusy(`${reveal ? 'reveal' : 'open'}-${node.id}`)
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.openPath(relativePath, reveal)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) {
        onError(result.error.message)
      }
    } finally {
      finishActionBusy(busyToken)
    }
  }

  const openLocalNodeWith = async (node: AgentCloudNode) => {
    const relativePath = relativePathForNode(node)
    if (!relativePath) {
      onError('无法确定本地同步路径。')
      return
    }
    const busyToken = beginActionBusy(`open-with-${node.id}`)
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.openWith(relativePath)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) {
        onError(result.error.message)
      }
    } finally {
      finishActionBusy(busyToken)
    }
  }

  const downloadNode = async (node: AgentCloudNode) => {
    const busyToken = beginActionBusy(`download-${node.id}`)
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.cloudDownload(node.id, node.name)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.saved) onFeedback('good', `${node.name} 已保存。`)
    } finally {
      finishActionBusy(busyToken)
    }
  }

  type DesktopUploadTarget = { parentID: number; file: File; relativePath?: string }

const desktopTransferLifecycleChildBatchSize = 1000

  const uploadConflictAwareTargets = async (
    resolveTargets: () => Promise<readonly DesktopUploadTarget[]>,
    busyState: 'upload' | 'drop-upload' | 'upload-folder',
    refreshEvenWithoutUploads = false,
    refreshCurrentDirectory = true,
  ) => {
    if (actionBusyRef.current || fileOperationBusy || uploadBusy) return false
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

  const uploadFolderFiles = async (expectedCurrentID: number, files: File[]) => {
    if (files.length === 0 || !uploadConflictSupported) return
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
    if (!current || actionBusyRef.current || fileOperationBusy || uploadBusy) return
    const expectedCurrentID = current.id
    if (uploadConflictSupported) {
      uploadPickerParentIDRef.current = expectedCurrentID
      uploadInputRef.current?.click()
      return
    }
    const busyToken = beginActionBusy('upload')
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.cloudUploadFiles(expectedCurrentID)
      if (!isActionBusyCurrent(busyToken)) return
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
      finishActionBusy(busyToken)
    }
  }

  const openFolderUploadPicker = () => {
    if (
      !current ||
      actionBusyRef.current ||
      fileOperationBusy ||
      uploadBusy ||
      !uploadConflictSupported
    ) return
    folderUploadPickerParentIDRef.current = current.id
    folderUploadInputRef.current?.click()
  }

  const createFolder = async (name: string) => {
    if (actionBusyRef.current || fileOperationBusy || uploadBusy) return
    const expectedCurrentID = createFolderParentIDRef.current
    if (expectedCurrentID === null) return
    const busyToken = beginActionBusy('create-folder')
    if (!busyToken) return
    try {
      const result = await window.xdriveDesktop.agent.cloudCreateDirectory(expectedCurrentID, name)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) throw new Error(result.error.message)
      await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
      if (!isActionBusyCurrent(busyToken)) return
      onFeedback('good', '文件夹已创建。')
    } finally {
      finishActionBusy(busyToken)
    }
  }

  useEffect(() => {
    if (!actionIntent || actionIntent.id === actionIntentRef.current) return

    if (actionIntent.lifecycleKey !== (navigationSessionStorageKey ?? '')) {
      actionIntentRef.current = actionIntent.id
      onActionIntentConsumed?.(actionIntent.id)
      return
    }

    if (trashActive || !current || explorerActionBusy) return

    if (actionIntent.action === 'upload-folder' && !uploadConflictSupported) {
      actionIntentRef.current = actionIntent.id
      onActionIntentConsumed?.(actionIntent.id)
      onError('当前客户端不支持文件夹上传，请更新客户端核心组件。')
      return
    }

    actionIntentRef.current = actionIntent.id
    onActionIntentConsumed?.(actionIntent.id)
    if (actionIntent.action === 'upload-files') {
      void uploadFiles()
    } else if (actionIntent.action === 'upload-folder') {
      openFolderUploadPicker()
    } else {
      createFolderParentIDRef.current = current.id
      setCreateOpen(true)
    }
  }, [
    actionIntent,
    current,
    explorerActionBusy,
    navigationSessionStorageKey,
    onActionIntentConsumed,
    onError,
    trashActive,
    uploadConflictSupported,
  ])

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    if (actionBusyRef.current || fileOperationBusy || uploadBusy) {
      throw new Error('当前有文件操作正在进行，请稍后重试。')
    }
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    const expectedCurrentID = current.id
    const busyToken = beginActionBusy('rename-' + node.id)
    if (!busyToken) throw new Error('当前有文件操作正在进行，请稍后重试。')
    try {
      const result = await window.xdriveDesktop.agent.cloudRename(node.id, node.revision, name)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) throw new Error(result.error.message)
      clearSearch()
      await refreshCurrentDirectoryIfCurrent(expectedCurrentID)
      if (!isActionBusyCurrent(busyToken)) return
      onFeedback('good', '已重命名。')
    } catch (error) {
      if (isActionBusyCurrent(busyToken)) {
        onError(error instanceof Error ? error.message : String(error))
      }
      throw error
    } finally {
      finishActionBusy(busyToken)
    }
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node) return []

    const standardItems = xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      primaryDisabled: explorerActionBusy,
      onShowContainingFolder: searchState.results !== null
        ? () => { void showItemInContainingFolder(item) }
        : undefined,
      onOpen: node.type === 'file'
        ? () => { void openLocalNode(node) }
        : () => { void openWorkspaceItem(item, () => undefined) },
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
    if (!allowSelectionAction('download', selected)) return
    const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)
    if (
      !nodes?.length ||
      actionBusyRef.current ||
      fileOperationBusy ||
      uploadBusy
    ) return

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
      const busyToken = beginActionBusy('download-folder')
      if (!busyToken) return
      const reportDownloadResult = onDownloadStart?.()
      try {
        const result = await window.xdriveDesktop.agent.cloudDownloadFolder(
          folder.id,
          folder.parent_id,
        )
        if (!isActionBusyCurrent(busyToken)) return
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        reportDownloadResult?.({
          downloaded: result.data.downloaded,
          failed: result.data.failed,
          skippedFolders: 0,
          canceled: result.data.canceled,
        })
        if (result.data.canceled) return
        if (result.data.failed > 0) {
          onFeedback('warning', `已下载 ${result.data.downloaded} 个文件，${result.data.failed} 个失败。`)
        } else {
          onFeedback('good', `${result.data.root || folder.name} 下载完成，共 ${result.data.downloaded} 个文件。`)
        }
      } finally {
        finishActionBusy(busyToken)
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
      const busyToken = beginActionBusy('download-archive')
      if (!busyToken) return
      try {
        const result = await window.xdriveDesktop.agent.cloudDownloadArchive(archivePlan.ids)
        if (!isActionBusyCurrent(busyToken)) return
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        if (result.data.canceled) return
        const feedback = xDriveFileExplorerDesktopArchiveDownloadFeedback(result.data.downloaded.length)
        onFeedback(feedback.tone, feedback.message)
      } finally {
        finishActionBusy(busyToken)
      }
      return
    }

    const plan = xDriveFileExplorerDownloadPlan(nodes)
    if (plan.files.length === 0) return
    const busyToken = beginActionBusy('download-many')
    if (!busyToken) return
    const reportDownloadResult = onDownloadStart?.()
    try {
      const result = await window.xdriveDesktop.agent.cloudDownloadFiles(plan.items)
      if (!isActionBusyCurrent(busyToken)) return
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      reportDownloadResult?.({
        downloaded: result.data.downloaded.length,
        failed: result.data.failures.length,
        skippedFolders: plan.skippedFolders,
        failures: result.data.failures,
        canceled: result.data.canceled,
      })
      if (result.data.canceled) return
      const feedback = xDriveFileExplorerDesktopDownloadFeedback({
        downloaded: result.data.downloaded.length,
        failed: result.data.failures.length,
        skippedFolders: plan.skippedFolders,
      })
      onFeedback(feedback.tone, feedback.message)
    } finally {
      finishActionBusy(busyToken)
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
    lifecycleKey: navigationSessionStorageKey ?? '',
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
      const busyToken = beginActionBusy('drop-upload')
      if (!busyToken) return false
      try {
        const result = await window.xdriveDesktop.agent.cloudUploadDroppedFiles(parentID, files)
        if (!isActionBusyCurrent(busyToken)) return false
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
        finishActionBusy(busyToken)
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
    onCreateFolder: () => {
      if (!current) return
      createFolderParentIDRef.current = current.id
      setCreateOpen(true)
    },
    onUpload: () => { void uploadFiles() },
    onUploadFolder: uploadConflictSupported
      ? openFolderUploadPicker
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
          const parentID = uploadPickerParentIDRef.current
          uploadPickerParentIDRef.current = null
          if (parentID !== null) void uploadConflictAwareFiles(parentID, files, 'upload')
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
          const parentID = folderUploadPickerParentIDRef.current
          folderUploadPickerParentIDRef.current = null
          if (parentID !== null) void uploadFolderFiles(parentID, files)
        }}
      />

      <XDriveFileExplorer
        interactionLifecycleKey={navigationSessionStorageKey ?? ''}
        presentation="workspace"
        keyboardProfile={keyboardProfile}
        items={trashActive ? trash.items : explorerItems}
        crumbs={trashActive ? trash.crumbs : explorerCrumbs}
        virtualCollection={trashActive ? trash.virtualCollection : explorerVirtualCollection}
        loading={trashActive ? trash.loading : loading || searchLoading || explorerActionBusy}
        emptyMessage={trashActive ? '回收站为空' : searchState.results !== null
          ? searchError ? '搜索未完成，请重试' : searchReady ? '未找到匹配的文件或文件夹' : '正在搜索…'
          : undefined}
        loadThumbnail={loadThumbnail}
        loadTextPreview={textPreviewSupported ? loadTextPreview : undefined}
        loadPreviewURL={previewStreamSupported ? loadPreviewURL : undefined}
        loadLivePhotoMotion={loadLivePhotoMotion}
        loadPropertiesStats={propertiesStatsSupported ? loadPropertiesStats : undefined}
        loadMediaDetails={mediaDetailsSupported ? loadMediaDetails : undefined}
        loadMediaItem={!trashActive && mediaPropertiesSupported ? loadMediaItem : undefined}
        getItemStatus={fileAvailabilitySupported ? getItemStatus : undefined}
        getItemAvailability={fileAvailabilitySupported ? getItemAvailability : undefined}
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
            sourceOptions: searchSourceOptions,
            tagOptions: fileTagsSupported ? organization.tagOptions : [],
            availabilityOptions: fileAvailabilitySupported ? desktopSearchAvailabilityOptions : [],
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
        onCreateFolder={trashActive ? undefined : () => {
          if (!current) return
          createFolderParentIDRef.current = current.id
          setCreateOpen(true)
        }}
        onUpload={trashActive ? undefined : () => { void uploadFiles() }}
        onUploadFolder={!trashActive && uploadConflictSupported
          ? openFolderUploadPicker
          : undefined}
        onOpenItem={trashActive ? undefined : (item) => {
          const node = xDriveFileExplorerNodeForItem(item, nodeByID)
          if (!node) return
          if (node.type === 'file') void openLocalNode(node)
          else void openWorkspaceItem(item, () => undefined)
        }}
        onOpenItemInNewTab={!trashActive && canNewTab
          ? (item) => { void openItemInNewTab(item) }
          : undefined}
        onPreviewItem={trashActive ? undefined : (item) => { void recent.record(Number(item.id)) }}
        onNativeDragOutItem={!trashActive && nativeDragOutSupported
          ? startNativeDragOut
          : undefined}
        loadColumnPage={trashActive || searchStatusText ? undefined : loadColumnPage}
        onColumnNavigate={trashActive || searchStatusText ? undefined : (nextCrumbs) => {
          onCloseTrash()
          void navigateTo(nextCrumbs.map((crumb) => ({ id: Number(crumb.id), name: crumb.name })))
        }}
        onColumnOpenItem={trashActive ? undefined : (item) => {
          const node = xDriveFileExplorerNodeForItem(item, nodeByID)
          if (!node) return
          if (node.type === 'file') void openLocalNode(node)
          else void openWorkspaceItem(item, () => undefined)
        }}
        onManageTags={!trashActive && fileTagsSupported ? (selected) => {
          if (!allowSelectionAction('manage-tags', selected)) return
          setTagDialogItems(selected)
          setTagDialogMode('assign')
        } : undefined}
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
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={DESKTOP_FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={trashActive ? undefined : copyItems}
        onCopyPaths={trashActive ? undefined : copyItemPaths}
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
        folderDownloadSupported={!trashActive && (folderTreeDownloadSupported || archiveDownloadSupported)}
        onDeleteItems={trashActive ? undefined : (selected) => {
          if (!allowSelectionAction('delete', selected)) return
          const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)
          if (nodes?.length) onDeleteMany(nodes)
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
            tagOptions={fileTagsSupported ? organization.tagOptions : []}
            availabilityOptions={fileAvailabilitySupported ? desktopSearchAvailabilityOptions : []}
            canSaveSearch={savedSearchesSupported && canSaveSmartFolder}
            onSaveSearch={savedSearchesSupported ? () => setSaveSearchOpen(true) : undefined}
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
            onReorderQuickAccess={quickAccessSupported ? (nodeIDs) => { void quickAccess.reorder(nodeIDs) } : undefined}
            organizationLoading={organization.loading}
            organizationError={organization.error}
            onRetryOrganization={() => { void organization.refresh() }}
            onManageTags={fileTagsSupported ? () => {
              setTagDialogItems([])
              setTagDialogMode('manage')
            } : undefined}
            onSaveCurrentSearch={savedSearchesSupported ? () => setSaveSearchOpen(true) : undefined}
            canSaveCurrentSearch={canSaveSmartFolder}
            savedSearchRuleLabels={(saved) => xDriveFileExplorerSavedSearchRuleLabels(saved, {
              sourceOptions: searchSourceOptions,
              tagOptions: organization.tagOptions,
            })}
            currentSearchNotice={organizationSearchState.currentSearchNotice}
            savedSearchesEnabled={savedSearchesSupported}
            savedSearches={organization.savedSearches}
            activeSavedSearchID={activeSavedSearchID}
            matchingSavedSearchIDs={organizationSearchState.matchingSavedSearchIDs}
            onActivateSavedSearch={(savedSearch) => {
              onCloseTrash()
              void applySearch(savedSearch.query, savedSearch.filters)
            }}
            onRenameSavedSearch={(savedSearch) => setRenameSavedSearch(savedSearch as AgentFileSavedSearch)}
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
            tagsEnabled={fileTagsSupported}
            tags={organization.tags}
            activeTagID={activeTagID}
            onActivateTag={(tag) => {
              onCloseTrash()
              void applySearch('', { tagID: tag.id })
            }}
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
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
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
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
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

      <XDriveUploadConflictDialog {...uploadConflictDialogProps} />

      <XDriveFileNameDialog
        open={createOpen}
        mode="create-folder"
        onClose={() => {
          createFolderParentIDRef.current = null
          setCreateOpen(false)
        }}
        onSubmit={createFolder}
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
      />

    </>
  )
}
