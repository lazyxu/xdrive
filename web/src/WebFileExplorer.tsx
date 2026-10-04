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
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerDispatchOpenItem,
  xDriveFileExplorerWebDownloadPlan,
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerDropItemsToParentPlan,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerPaginationController,
  xDriveFileExplorerRunQueuedOperation,
  xDriveFileExplorerWebDownloadFeedback,
  xDriveFileExplorerSubmitPath,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveFileExplorerQueuedOperationPlan,
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
  onUploadFolderFiles,
  onUploadDroppedFiles,
  onCreateFolder,
  onOpenTrash,
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
  onUploadFolderFiles: (files: FileList | null) => Promise<void>
  onUploadDroppedFiles: (parentID: number, files: File[]) => Promise<void>
  onCreateFolder: () => void
  onOpenTrash: () => void
  onRemove: (node: Node) => void
  onRemoveMany: (nodes: Node[]) => void
  onOperationQueued: (operation: XDriveFileOperation) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
  onShare: (node: Node) => void
  onHistory: (node: Node) => void
  onError: (error: unknown) => void
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null)
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
    await xDriveFileExplorerDispatchOpenItem({
      item,
      nodeByID,
      currentCrumbs: crumbs,
      searchCrumbsForNode: (node) => searchByID.get(node.id)?.breadcrumbs,
      openFile: async (node) => {
        try {
          await api.download(node)
        } catch (error) {
          onError(error)
        }
      },
      navigate: navigateTo,
    })
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
      onOpen: node.type === 'dir' ? () => { void openItem(item) } : undefined,
      onDownload: () => { void downloadSelected([item]) },
      onShare: node.type === 'file' ? () => onShare(node) : undefined,
      onHistory: node.type === 'file' ? () => onHistory(node) : undefined,
      onDelete: () => onRemove(node),
    })
  }

  const renameItem = async (item: XDriveFileExplorerItem, name: string) => {
    const node = xDriveFileExplorerNodeForItem(item, nodeByID)
    if (!node || !current) return
    try {
      await api.rename(node.id, node.revision, name)
      clearSearch()
      await onLoadDirectory(current.id, crumbs, sort)
      onFeedback('good', '已重命名。')
    } catch (error) {
      onError(error)
      throw error
    }
  }

  const runQueuedOperation = (
    plan: XDriveFileExplorerQueuedOperationPlan,
    onComplete: () => void,
  ) => xDriveFileExplorerRunQueuedOperation({
    plan,
    submit: () => api.createFileOperation(plan.operation, plan.items, plan.parentID),
    onQueued: (queued) => onOperationQueued(queued),
    onFeedback,
    onComplete,
    onError,
  })

  const pasteClipboard = async () => {
    if (!current || clipboardBusy) return
    const plan = planPaste(current.id)
    if (!plan) return
    setClipboardBusy(true)
    try {
      await runQueuedOperation(plan, () => {
        completePaste(plan)
        clearSearch()
      })
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
      await runQueuedOperation(plan, clearSearch)
    } finally {
      setClipboardBusy(false)
    }
  }

  const dropItemsToCrumb = async (
    selected: XDriveFileExplorerItem[],
    crumb: XDriveFileExplorerCrumb,
    operation: 'move' | 'copy',
  ) => {
    if (clipboardBusy) return
    const plan = xDriveFileExplorerDropItemsToParentPlan(
      operation,
      selected,
      Number(crumb.id),
      nodeByID,
    )
    if (!plan) return
    setClipboardBusy(true)
    try {
      await runQueuedOperation(plan, clearSearch)
    } finally {
      setClipboardBusy(false)
    }
  }

  const dropExternalFilesToParent = async (files: File[], parentID: number) => {
    if (files.length === 0) return
    await onUploadDroppedFiles(parentID, files)
    if (current) await onLoadDirectory(current.id, crumbs, sort)
  }

  const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {
    if (!current || files.length === 0) return
    const parentID = xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)
    await dropExternalFilesToParent(files, parentID)
  }

  const dropExternalFilesToCrumb = async (files: File[], crumb: XDriveFileExplorerCrumb) => {
    await dropExternalFilesToParent(files, Number(crumb.id))
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
        onUploadFolder={() => folderUploadInputRef.current?.click()}
        onOpenItem={(item) => { void openItem(item) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={!searchResults}
        hasMore={explorerPagination.hasMore}
        loadingMore={explorerPagination.loadingMore}
        onLoadMore={explorerPagination.onLoadMore}
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
        onRenameItem={renameItem}
        renameDisabled={clipboardBusy}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onDropItemsToCrumb={(selected, crumb, operation) => { void dropItemsToCrumb(selected, crumb, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        onExternalFilesDropToCrumb={(files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
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
