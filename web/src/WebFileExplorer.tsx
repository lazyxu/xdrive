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
  xDriveFileExplorerClipboardOperationPlan,
  xDriveFileExplorerDropOperationPlan,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerOperationQueuedMessage,
  xDriveFileExplorerSearchDecision,
  xDriveResolveFileExplorerPath,
} from '../../ui/shared/src'
import type { Node, XDriveFileOperation } from '../../ui/shared/src'
import type { SearchResult, XDriveApi } from './api'

const FILE_VIEW_KEY = 'xdrive.files.view_mode'
const FILE_DETAILS_LAYOUT_KEY = 'xdrive.files.details_layout'

type Crumb = { id: number; name: string }
type WebExplorerClipboard = { mode: 'copy' | 'cut'; nodes: Node[] }

function normalizedSearchCrumbs(result: SearchResult): Crumb[] {
  return result.breadcrumbs.map((crumb, index) => ({
    id: crumb.id,
    name: index === 0 && !crumb.name ? '我的文件' : crumb.name,
  }))
}

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
  const [searchValue, setSearchValue] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [clipboard, setClipboard] = useState<WebExplorerClipboard | null>(null)
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
    setSearchResults(null)
    setSearchHasMore(false)
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
    setSearchLoading(true)
    try {
      const page = await api.search(decision.query, 200)
      setSearchResults(page.items)
      setSearchHasMore(Boolean(page.next_cursor))
    } catch (error) {
      onError(error)
    } finally {
      setSearchLoading(false)
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
    if (result) {
      await navigateTo(normalizedSearchCrumbs(result))
      return
    }
    await navigateTo([...crumbs, { id: node.id, name: node.name }])
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
    const files = nodes.filter((node) => node.type === 'file')
    if (files.length === 0) return
    try {
      for (const node of files) await api.download(node)
      const skipped = nodes.length - files.length
      onFeedback(
        skipped > 0 ? 'warning' : 'good',
        skipped > 0
          ? `已下载 ${files.length} 个文件，跳过 ${skipped} 个文件夹。`
          : `已开始下载 ${files.length} 个文件。`,
      )
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
    const targetNode = target ? nodeByID.get(Number(target.id)) : undefined
    const parentID = targetNode?.type === 'dir' ? targetNode.id : current.id
    await onUploadDroppedFiles(parentID, files)
    if (current) await onLoadDirectory(current.id, crumbs, sort)
  }

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
        hasMore={!searchResults && hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => {
          if (current && !searchResults) void onLoadMore(current.id, sort)
        }}
        detailsPreferencesKey={FILE_DETAILS_LAYOUT_KEY}
        onCopyItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) setClipboard({ mode: 'copy', nodes })
        }}
        onCutItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) setClipboard({ mode: 'cut', nodes })
        }}
        onPaste={() => { void pasteClipboard() }}
        canPaste={Boolean(clipboard?.nodes.length) && !clipboardBusy}
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
          ? `搜索“${searchValue.trim()}”${searchHasMore ? ' · 仅显示前 200 个结果' : ''}`
          : uploadProgress !== null
            ? `上传中 ${Math.round(uploadProgress)}%`
            : undefined}
      />
    </Box>
  )
}
