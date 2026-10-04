import { useCallback, useRef } from 'react'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerTrashCommandButton,
  xDriveFileExplorerBackgroundMenuItems,
  xDriveFileExplorerStandardItemMenuItems,
  useXDriveFileExplorerWorkspace,
  useXDriveFileExplorerOperationController,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerExternalDropPayload,
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
} from '@xdrive/ui/mui'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerNodeForItem,
  xDriveFileExplorerWebDownloadPlan,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerWebDownloadFeedback,
} from '../../ui/shared/src'
import type {
  Node,
  XDriveFileOperation,
} from '../../ui/shared/src'
import type { SearchResult, XDriveApi } from './api'

const FILE_VIEW_KEY = 'xdrive.files.view_mode'
const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'
const FILE_VIEW_PREFERENCES_KEY = 'xdrive.files.view_preferences'

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
  onUploadDroppedFolderEntries,
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
  onUploadDroppedFolderEntries: (
    parentID: number,
    payload: XDriveFileExplorerExternalDropPayload,
  ) => Promise<void>
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
    searchLoading,
    changeSearchValue,
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
    refresh,
    navigateToCrumb,
    goBack,
    goForward,
    goUp,
    canGoBack,
    canGoForward,
    canGoUp,
    submitPath,
    openItem,
    explorerPagination,
    externallySorted,
    searchStatusText,
  } = useXDriveFileExplorerWorkspace<Node, SearchResult>({
    items,
    crumbs,
    viewModeStorageKey: FILE_VIEW_KEY,
    directoryHasMore: hasMore,
    directoryLoadingMore: loadingMore,
    onLoadDirectory,
    onLoadMoreDirectory: onLoadMore,
    loadSearchPage: (query, cursor) => api.search(
      query,
      XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
      cursor,
    ),
    loadRoot: () => api.root(),
    listChildren: (parentID) => api.list(parentID),
    searchCrumbsForResult: (result) => result.breadcrumbs,
    onError,
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

  const loadThumbnail = useCallback(async (item: XDriveFileExplorerItem) => {
    if (item.kind !== 'file') return null
    try {
      const blob = await api.mediaThumbnail(Number(item.id))
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [api])

  const openWebNode = async (node: Node) => {
    try {
      await api.download(node)
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
      onOpen: node.type === 'dir' ? () => { void openItem(item, openWebNode) } : undefined,
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

  const dropExternalFolderEntriesToParent = async (
    payload: XDriveFileExplorerExternalDropPayload,
    parentID: number,
  ) => {
    await onUploadDroppedFolderEntries(parentID, payload)
    if (current) await onLoadDirectory(current.id, crumbs, sort)
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
        loading={loading || searchLoading || fileOperationBusy}
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
        onOpenItem={(item) => { void openItem(item, openWebNode) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={externallySorted}
        hasMore={explorerPagination.hasMore}
        loadingMore={explorerPagination.loadingMore}
        onLoadMore={explorerPagination.onLoadMore}
        detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}
        viewPreferencesKey={FILE_VIEW_PREFERENCES_KEY}
        onCopyItems={copyItems}
        onCutItems={cutItems}
        onPaste={() => { void pasteClipboard() }}
        canPaste={fileOperationCanPaste}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        folderDownloadSupported
        onDeleteItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onRemoveMany(nodes)
        }}
        onRenameItem={renameItem}
        renameDisabled={fileOperationBusy}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onDropItemsToCrumb={(selected, crumb, operation) => { void dropItemsToCrumb(selected, crumb, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        onExternalFilesDropToCrumb={(files, crumb) => { void dropExternalFilesToCrumb(files, crumb) }}
        onExternalFolderDrop={(payload, target) => { void dropExternalFolderEntries(payload, target) }}
        onExternalFolderDropToCrumb={(payload, crumb) => { void dropExternalFolderEntriesToCrumb(payload, crumb) }}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        statusText={searchStatusText ?? (
          uploadProgress !== null
            ? `上传中 ${Math.round(uploadProgress)}%`
            : undefined
        )}
      />
    </Box>
  )
}
