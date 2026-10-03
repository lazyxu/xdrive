import { useCallback, useRef, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerTrashCommandButton,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerNavigation,
  useXDriveFileExplorerProjection,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerApplySearchPageState,
  xDriveFileExplorerCanPaste,
  xDriveFileExplorerClipboardFromItems,
  xDriveFileExplorerClipboardOperationPlan,
  xDriveFileExplorerDirectoryCrumbs,
  xDriveFileExplorerDownloadPlan,
  xDriveFileExplorerDropOperationPlan,
  xDriveFileExplorerCanLoadMoreSearch,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerIdleSearchState,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerPaginationPresentation,
  xDriveFileExplorerOperationQueuedMessage,
  xDriveFileExplorerSettleSearchState,
  xDriveFileExplorerStartSearchLoadMoreState,
  xDriveFileExplorerStartSearchState,
  xDriveFileExplorerWebDownloadFeedback,
  xDriveFileExplorerSearchDecision,
  xDriveResolveFileExplorerPath,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveFileExplorerClipboard,
  XDriveFileExplorerSearchState,
  XDriveFileOperation,
} from '../../ui/shared/src'
import type { SearchResult, XDriveApi } from './api'

const FILE_VIEW_KEY = 'xdrive.files.view_mode'
const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'

type Crumb = { id: number; name: string }

export default function WebFileExplorer({
  api,
  items,
  crumbs,
  loading,
  loadingMore,
  hasMore,
  uploadProgress,
  onLoadDirectory,
  onLoadMore,
  onUploadFiles,
  onUploadDroppedFiles,
  onCreateFolder,
  onOpenTrash,
  onRename,
  onRemove,
  onRemoveMany,
  onOperationQueued,
  onFeedback,
  onShare,
  onHistory,
  onError,
}: {
  api: XDriveApi
  items: Node[]
  crumbs: Crumb[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  uploadProgress: number | null
  onLoadDirectory: (id: number, crumbs: Crumb[], sort: XDriveFileExplorerSort) => Promise<void>
  onLoadMore: (id: number, sort: XDriveFileExplorerSort) => Promise<void>
  onUploadFiles: (files: FileList | null) => Promise<void>
  onUploadDroppedFiles: (parentID: number, files: File[]) => Promise<void>
  onCreateFolder: () => void
  onOpenTrash: () => void
  onRename: (node: Node) => void
  onRemove: (node: Node) => void
  onRemoveMany: (nodes: Node[]) => void
  onOperationQueued: (operation: XDriveFileOperation) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
  onShare: (node: Node) => void
  onHistory: (node: Node) => void
  onError: (error: unknown) => void
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const searchRequestRef = useRef(0)
  const [searchValue, setSearchValue] = useState('')
  const [searchState, setSearchState] = useState<XDriveFileExplorerSearchState<SearchResult>>(
    () => xDriveFileExplorerIdleSearchState<SearchResult>(),
  )
  const {
    results: searchResults,
    cursor: searchCursor,
    loading: searchLoading,
    loadingMore: searchLoadingMore,
  } = searchState
  const [clipboard, setClipboard] = useState<XDriveFileExplorerClipboard<Node> | null>(null)
  const [clipboardBusy, setClipboardBusy] = useState(false)

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

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    try {
      const blob = await api.mediaThumbnail(Number(item.id))
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [api])

  const clearSearch = () => {
    searchRequestRef.current += 1
    setSearchState(xDriveFileExplorerIdleSearchState<SearchResult>())
  }

  const {
    current,
    viewMode,
    setViewMode,
    sort,
    changeSort,
    navigateTo,
    goBack,
    goForward,
    goUp,
    canGoBack,
    canGoForward,
    canGoUp,
  } = useXDriveFileExplorerNavigation({
    crumbs,
    viewModeStorageKey: FILE_VIEW_KEY,
    searchActive: Boolean(searchResults),
    onLoadDirectory,
    onAfterNavigate: clearSearch,
  })

  const submitPath = async (rawPath: string) => {
    try {
      const root = await api.root()
      const rootName = crumbs[0]?.name || '我的文件'
      const nextCrumbs = await xDriveResolveFileExplorerPath({
        rawPath,
        rootID: root.id,
        rootName,
        listChildren: (parentID) => api.list(parentID),
      })
      await navigateTo(nextCrumbs)
    } catch (error) {
      onError(error)
    }
  }

  const submitSearch = async (query: string) => {
    const decision = xDriveFileExplorerSearchDecision(query)
    if (decision.kind === 'clear') {
      clearSearch()
      return
    }
    if (decision.kind === 'invalid') {
      onError(new Error(decision.message))
      return
    }
    const requestID = ++searchRequestRef.current
    setSearchState(xDriveFileExplorerStartSearchState<SearchResult>(decision.query))
    try {
      const page = await api.search(decision.query, XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE)
      if (requestID !== searchRequestRef.current) return
      setSearchState((currentSearchState) => (
        xDriveFileExplorerApplySearchPageState(currentSearchState, page, false)
      ))
    } catch (error) {
      if (requestID === searchRequestRef.current) onError(error)
    } finally {
      if (requestID === searchRequestRef.current) {
        setSearchState((currentSearchState) => (
          xDriveFileExplorerSettleSearchState(currentSearchState, false)
        ))
      }
    }
  }

  const loadMoreSearch = async () => {
    if (!xDriveFileExplorerCanLoadMoreSearch(searchResults, searchCursor, searchLoadingMore)) return
    const query = searchState.query
    if (!query) return
    const requestID = searchRequestRef.current
    setSearchState((currentSearchState) => (
      xDriveFileExplorerStartSearchLoadMoreState(currentSearchState)
    ))
    try {
      const page = await api.search(
        query,
        XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
        searchCursor,
      )
      if (requestID !== searchRequestRef.current) return
      setSearchState((currentSearchState) => (
        xDriveFileExplorerApplySearchPageState(currentSearchState, page, true)
      ))
    } catch (error) {
      if (requestID === searchRequestRef.current) onError(error)
    } finally {
      if (requestID === searchRequestRef.current) {
        setSearchState((currentSearchState) => (
          xDriveFileExplorerSettleSearchState(currentSearchState, true)
        ))
      }
    }
  }

  const openItem = async (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return
    if (node.type === 'file') {
      try {
        await api.download(node)
      } catch (error) {
        onError(error)
      }
      return
    }

    const result = searchByID.get(node.id)
    await navigateTo(xDriveFileExplorerDirectoryCrumbs(node, crumbs, result?.breadcrumbs))
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return []

    return xDriveFileExplorerStandardItemMenuItems({
      kind: node.type,
      onOpen: node.type === 'dir' ? () => { void openItem(item) } : undefined,
      onDownload: node.type === 'file' ? () => { void api.download(node).catch(onError) } : undefined,
      onShare: node.type === 'file' ? () => onShare(node) : undefined,
      onHistory: node.type === 'file' ? () => onHistory(node) : undefined,
      onRename: () => onRename(node),
      onDelete: () => onRemove(node),
    })
  }

  const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    const plan = xDriveFileExplorerDownloadPlan(nodes)
    if (plan.files.length === 0) return
    try {
      for (const node of plan.files) await api.download(node)
      const feedback = xDriveFileExplorerWebDownloadFeedback(plan.files.length, plan.skippedFolders)
      onFeedback(feedback.tone, feedback.message)
    } catch (error) {
      onError(error)
    }
  }

  const pasteClipboard = async () => {
    if (!current || !clipboard || clipboard.nodes.length === 0 || clipboardBusy) return
    setClipboardBusy(true)
    try {
      const plan = xDriveFileExplorerClipboardOperationPlan(
        clipboard.mode,
        clipboard.nodes,
        current.id,
      )
      if (plan.count > 0) {
        const queued = await api.createFileOperation(plan.operation, plan.items, plan.parentID)
        onOperationQueued(queued)
        onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
      }
      if (plan.clearClipboard) setClipboard(null)
      clearSearch()
    } catch (error) {
      onError(error)
    } finally {
      setClipboardBusy(false)
    }
  }

  const dropItemsToFolder = async (
    selected: XDriveFileExplorerItem[],
    target: XDriveFileExplorerItem,
    operation: 'move' | 'copy',
  ) => {
    const targetNode = nodeByID.get(Number(target.id))
    if (!targetNode || targetNode.type !== 'dir' || clipboardBusy) return
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    const plan = xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)
    if (plan.count === 0) return
    setClipboardBusy(true)
    try {
      const queued = await api.createFileOperation(plan.operation, plan.items, plan.parentID)
      onOperationQueued(queued)
      clearSearch()
      onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
    } catch (error) {
      onError(error)
    } finally {
      setClipboardBusy(false)
    }
  }

  const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {
    if (!current || files.length === 0) return
    const parentID = xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)
    await onUploadDroppedFiles(parentID, files)
    if (current) await onLoadDirectory(current.id, crumbs, sort)
  }

  const explorerPagination = xDriveFileExplorerPaginationPresentation({
    searchActive: searchResults !== null,
    searchCursor,
    searchLoadingMore,
    directoryHasMore: hasMore,
    directoryLoadingMore: loadingMore,
  })

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder,
    onUpload: () => uploadInputRef.current?.click(),
    onRefresh: () => {
      if (current) void onLoadDirectory(current.id, crumbs, sort)
    },
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
      {uploadProgress !== null ? (
        <LinearProgress
          variant="determinate"
          value={Math.max(0, Math.min(100, uploadProgress))}
          sx={{ position: 'absolute', inset: '0 0 auto', zIndex: 3 }}
        />
      ) : null}
      <XDriveFileExplorer
        presentation="workspace"
        items={explorerItems}
        crumbs={explorerCrumbs}
        loading={loading || searchLoading || clipboardBusy}
        loadThumbnail={loadThumbnail}
        pathValue={crumbs.map((crumb) => crumb.name).join('/')}
        onPathSubmit={(path) => { void submitPath(path) }}
        searchValue={searchValue}
        onSearchValueChange={(value) => {
          setSearchValue(value)
          if (!value.trim()) clearSearch()
        }}
        onSearch={(query) => { void submitSearch(query) }}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canGoUp={canGoUp}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={() => {
          if (current) void onLoadDirectory(current.id, crumbs, sort)
        }}
        onCrumbClick={(_crumb, index) => { void navigateTo(crumbs.slice(0, index + 1)) }}
        onCreateFolder={onCreateFolder}
        onUpload={() => uploadInputRef.current?.click()}
        onOpenItem={(item) => { void openItem(item) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={!searchResults}
        hasMore={explorerPagination.hasMore}
        loadingMore={explorerPagination.loadingMore}
        onLoadMore={() => {
          if (explorerPagination.mode === 'search') {
            void loadMoreSearch()
          } else if (current) {
            void onLoadMore(current.id, sort)
          }
        }}
        detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}
        onCopyItems={(selected) => {
          setClipboard((currentClipboard) => (
            xDriveFileExplorerClipboardFromItems('copy', selected, nodeByID) ?? currentClipboard
          ))
        }}
        onCutItems={(selected) => {
          setClipboard((currentClipboard) => (
            xDriveFileExplorerClipboardFromItems('cut', selected, nodeByID) ?? currentClipboard
          ))
        }}
        onPaste={() => { void pasteClipboard() }}
        canPaste={xDriveFileExplorerCanPaste(clipboard, clipboardBusy)}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        onDeleteItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onRemoveMany(nodes)
        }}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        statusText={searchResults
          ? `搜索“${searchState.query}”`
          : uploadProgress !== null
            ? `上传中 ${Math.round(uploadProgress)}%`
            : undefined}
      />
    </Box>
  )
}
