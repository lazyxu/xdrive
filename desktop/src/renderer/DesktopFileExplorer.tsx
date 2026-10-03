import { useCallback, useRef, useState } from 'react'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerCanPaste,
  xDriveFileExplorerClipboardFromItems,
  xDriveFileExplorerClipboardOperationPlan,
  xDriveFileExplorerDesktopDownloadFeedback,
  xDriveFileExplorerDirectoryCrumbs,
  xDriveFileExplorerDownloadPlan,
  xDriveFileExplorerDropOperationPlan,
  xDriveFileExplorerExternalDropParentID,
  xDriveFileExplorerMergeSearchResults,
  xDriveFileExplorerNodesForItems,
  xDriveFileExplorerOperationQueuedMessage,
  xDriveFileExplorerSearchDecision,
  xDriveResolveFileExplorerPath,
} from '@xdrive/shared'
import type { XDriveFileExplorerClipboard } from '@xdrive/shared'
import {
  XDriveFileExplorer,
  XDriveFileNameDialog,
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
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const [searchValue, setSearchValue] = useState('')
  const searchRequestRef = useRef(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<AgentCloudSearchResult[] | null>(null)
  const [searchCursor, setSearchCursor] = useState('')
  const [searchLoadingMore, setSearchLoadingMore] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<AgentCloudNode | null>(null)
  const [actionBusy, setActionBusy] = useState('')
  const [clipboard, setClipboard] = useState<XDriveFileExplorerClipboard<AgentCloudNode> | null>(null)

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
    const result = await window.xdriveDesktop.agent.getMediaThumbnail(Number(item.id))
    if (!result.ok) return null
    const contentType = result.data.content_type || 'image/jpeg'
    return `data:${contentType};base64,${result.data.data_base64}`
  }, [])

  const clearSearch = () => {
    searchRequestRef.current += 1
    setSearchResults(null)
    setSearchCursor('')
    setSearchLoading(false)
    setSearchLoadingMore(false)
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
    viewModeStorageKey: DESKTOP_FILE_VIEW_KEY,
    searchActive: Boolean(searchResults),
    onLoadDirectory,
    onAfterNavigate: () => {
      clearSearch()
      setSearchValue('')
    },
  })

  const submitPath = async (rawPath: string) => {
    try {
      const rootResult = await window.xdriveDesktop.agent.cloudRoot()
      if (!rootResult.ok) {
        onError(rootResult.error.message)
        return
      }
      const rootName = crumbs[0]?.name || '我的文件'
      const nextCrumbs = await xDriveResolveFileExplorerPath({
        rawPath,
        rootID: rootResult.data.id,
        rootName,
        listChildren: async (parentID) => {
          const result = await window.xdriveDesktop.agent.cloudChildren(parentID)
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        },
      })
      await navigateTo(nextCrumbs)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const submitSearch = async (query: string) => {
    const decision = xDriveFileExplorerSearchDecision(query)
    if (decision.kind === 'clear') {
      clearSearch()
      return
    }
    if (decision.kind === 'invalid') {
      onError(decision.message)
      return
    }
    const requestID = ++searchRequestRef.current
    setSearchResults([])
    setSearchCursor('')
    setSearchLoadingMore(false)
    setSearchLoading(true)
    try {
      const result = await window.xdriveDesktop.agent.cloudSearch(decision.query)
      if (requestID !== searchRequestRef.current) return
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      setSearchResults(result.data.items)
      setSearchCursor(result.data.next_cursor ?? '')
    } finally {
      if (requestID === searchRequestRef.current) setSearchLoading(false)
    }
  }

  const loadMoreSearch = async () => {
    if (!searchResults || !searchCursor || searchLoadingMore) return
    const decision = xDriveFileExplorerSearchDecision(searchValue)
    if (decision.kind !== 'search') return
    const requestID = searchRequestRef.current
    setSearchLoadingMore(true)
    try {
      const result = await window.xdriveDesktop.agent.cloudSearch(decision.query, searchCursor)
      if (requestID !== searchRequestRef.current) return
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      setSearchResults((current) => (
        xDriveFileExplorerMergeSearchResults(current ?? [], result.data.items)
      ))
      setSearchCursor(result.data.next_cursor ?? '')
    } finally {
      if (requestID === searchRequestRef.current) setSearchLoadingMore(false)
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

  const uploadFiles = async () => {
    if (!current) return
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

  const rename = async (name: string) => {
    if (!renameNode || !current) return
    setActionBusy('rename')
    try {
      const result = await window.xdriveDesktop.agent.cloudRename(renameNode.id, renameNode.revision, name)
      if (!result.ok) throw new Error(result.error.message)
      await onLoadDirectory(current.id, crumbs, sort)
      onFeedback('good', '已重命名。')
    } finally {
      setActionBusy('')
    }
  }

  const openItem = async (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return
    if (node.type === 'file') {
      await openLocalNode(node)
      return
    }
    const searchResult = searchByID.get(node.id)
    await navigateTo(xDriveFileExplorerDirectoryCrumbs(node, crumbs, searchResult?.crumbs))
  }

  const getItemMenuItems = (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
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
      onRename: () => setRenameNode(node),
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

  const pasteClipboard = async () => {
    if (!current || !clipboard || clipboard.nodes.length === 0 || actionBusy) return
    setActionBusy('paste')
    try {
      const plan = xDriveFileExplorerClipboardOperationPlan(
        clipboard.mode,
        clipboard.nodes,
        current.id,
      )
      if (plan.count > 0) {
        const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
          plan.operation,
          plan.items,
          plan.parentID,
        )
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        onOperationQueued(result.data)
        onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
      }
      if (plan.clearClipboard) setClipboard(null)
      clearSearch()
    } finally {
      setActionBusy('')
    }
  }

  const dropItemsToFolder = async (
    selected: XDriveFileExplorerItem[],
    target: XDriveFileExplorerItem,
    operation: 'move' | 'copy',
  ) => {
    const targetNode = nodeByID.get(Number(target.id))
    if (!targetNode || targetNode.type !== 'dir' || actionBusy) return
    const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
    const plan = xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)
    if (plan.count === 0) return
    setActionBusy('drop-items')
    try {
      const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
        plan.operation,
        plan.items,
        plan.parentID,
      )
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      onOperationQueued(result.data)
      clearSearch()
      onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
    } finally {
      setActionBusy('')
    }
  }

  const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {
    if (!current || files.length === 0 || actionBusy) return
    const parentID = xDriveFileExplorerExternalDropParentID(current.id, target, nodeByID)
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

  const backgroundMenuItems = xDriveFileExplorerBackgroundMenuItems({
    onCreateFolder: () => setCreateOpen(true),
    onUpload: () => { void uploadFiles() },
    uploadDisabled: Boolean(actionBusy),
    onRefresh: () => {
      if (current) void onLoadDirectory(current.id, crumbs, sort)
    },
  })

  return (
    <>
      <XDriveFileExplorer
        presentation="workspace"
        items={explorerItems}
        crumbs={explorerCrumbs}
        loading={loading || searchLoading || Boolean(actionBusy)}
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
        onCreateFolder={() => setCreateOpen(true)}
        onUpload={() => { void uploadFiles() }}
        onOpenItem={(item) => { void openItem(item) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={changeSort}
        externallySorted={!searchResults}
        hasMore={searchResults ? Boolean(searchCursor) : hasMore}
        loadingMore={searchResults ? searchLoadingMore : loadingMore}
        onLoadMore={() => {
          if (searchResults) {
            void loadMoreSearch()
          } else if (current) {
            void onLoadMore(current.id, sort)
          }
        }}
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
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
        canPaste={xDriveFileExplorerCanPaste(clipboard, Boolean(actionBusy))}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        onDeleteItems={(selected) => {
          const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
          if (nodes.length > 0) onDeleteMany(nodes)
        }}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        statusText={searchResults
          ? `搜索“${searchValue.trim()}”`
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
              : actionBusy.startsWith('download-')
              ? '正在另存为…'
              : actionBusy.startsWith('open-')
                ? '正在打开…'
                : actionBusy.startsWith('reveal-')
                  ? '正在定位…'
                  : undefined}
      />

      <XDriveFileNameDialog
        open={createOpen}
        mode="create-folder"
        onClose={() => setCreateOpen(false)}
        onSubmit={createFolder}
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
      />

      <XDriveFileNameDialog
        open={Boolean(renameNode)}
        mode="rename"
        initialValue={renameNode?.name ?? ''}
        onClose={() => setRenameNode(null)}
        onSubmit={rename}
        onError={(error) => onError(error instanceof Error ? error.message : String(error))}
      />

    </>
  )
}
