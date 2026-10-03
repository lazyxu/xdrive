import { useCallback, useRef, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerTrashCommandButton,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerClipboard,
  useXDriveFileExplorerNavigation,
  useXDriveFileExplorerProjection,
  useXDriveFileExplorerSearch,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerOpenItemPlan,
  xDriveFileExplorerDownloadPlan,
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerPaginationPresentation,
  xDriveFileExplorerOperationQueuedMessage,
  xDriveFileExplorerWebDownloadFeedback,
  xDriveFileExplorerSubmitPath,
} from '../../ui/shared/src'
import type {
  Node,
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
  } = useXDriveFileExplorerSearch<SearchResult>({
    loadPage: (query, cursor) => api.search(
      query,
      XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
      cursor,
    ),
    onError,
  })
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

  const {
    copyItems,
    cutItems,
    planPaste,
    completePaste,
    canPaste,
  } = useXDriveFileExplorerClipboard<Node>({
    nodeByID,
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
    viewModeStorageKey: FILE_VIEW_KEY,
    searchActive: Boolean(searchResults),
    onLoadDirectory,
    onAfterNavigate: clearSearch,
  })

  const submitPath = async (rawPath: string) => {
    try {
      await xDriveFileExplorerSubmitPath({
        rawPath,
        currentCrumbs: crumbs,
        loadRoot: () => api.root(),
        listChildren: (parentID) => api.list(parentID),
        navigate: navigateTo,
      })
    } catch (error) {
      onError(error)
    }
  }

  const openItem = async (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node) return

    const plan = xDriveFileExplorerOpenItemPlan(
      node,
      crumbs,
      searchByID.get(node.id)?.breadcrumbs,
    )
    if (plan.kind === 'file') {
      try {
        await api.download(plan.node)
      } catch (error) {
        onError(error)
      }
      return
    }

    await navigateTo(plan.crumbs)
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
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
    if (!current || clipboardBusy) return
    const plan = planPaste(current.id)
    if (!plan) return
    setClipboardBusy(true)
    try {
      if (plan.count > 0) {
        const queued = await api.createFileOperation(plan.operation, plan.items, plan.parentID)
        onOperationQueued(queued)
        onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
      }
      completePaste(plan)
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
    if (clipboardBusy) return
    const plan = xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)
    if (!plan) return
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
        onCopyItems={copyItems}
        onCutItems={cutItems}
        onPaste={() => { void pasteClipboard() }}
        canPaste={canPaste(clipboardBusy)}
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
