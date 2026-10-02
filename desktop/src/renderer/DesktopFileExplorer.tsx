import { useCallback, useState } from 'react'
import { xDriveResolveFileExplorerPath } from '@xdrive/shared'
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
type DesktopExplorerClipboard = { mode: 'copy' | 'cut'; nodes: AgentCloudNode[] }

function normalizeSearchCrumbs(result: AgentCloudSearchResult): AgentCloudCrumb[] {
  return result.crumbs.map((crumb, index) => ({
    id: crumb.id,
    name: index === 0 && !crumb.name ? '我的文件' : crumb.name,
  }))
}

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
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<AgentCloudSearchResult[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameNode, setRenameNode] = useState<AgentCloudNode | null>(null)
  const [actionBusy, setActionBusy] = useState('')
  const [clipboard, setClipboard] = useState<DesktopExplorerClipboard | null>(null)

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
    setSearchResults(null)
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
    const normalized = query.trim()
    if (!normalized) {
      clearSearch()
      return
    }
    if ([...normalized].length < 2) {
      onError('搜索关键字至少需要 2 个字符。')
      return
    }
    setSearchLoading(true)
    try {
      const result = await window.xdriveDesktop.agent.cloudSearch(normalized)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      setSearchResults(result.data)
    } finally {
      setSearchLoading(false)
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
    if (searchResult) {
      await navigateTo(normalizeSearchCrumbs(searchResult))
      return
    }
    await navigateTo([...crumbs, { id: node.id, name: node.name }])
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

  const explorerNodesForItems = (selected: XDriveFileExplorerItem[]) => (
    selected
      .map((item) => nodeByID.get(Number(item.id)))
      .filter((node): node is AgentCloudNode => Boolean(node))
  )

  const downloadSelected = async (selected: XDriveFileExplorerItem[]) => {
    const nodes = explorerNodesForItems(selected)
    const files = nodes.filter((node) => node.type === 'file')
    if (files.length === 0 || actionBusy) return
    setActionBusy('download-many')
    try {
      const result = await window.xdriveDesktop.agent.cloudDownloadFiles(
        files.map((node) => ({ id: node.id, name: node.name })),
      )
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      if (result.data.canceled) return
      const skipped = nodes.length - files.length
      const failed = result.data.failures.length
      if (failed > 0) {
        onFeedback('warning', `已下载 ${result.data.downloaded.length} 个文件，${failed} 个失败。`)
      } else if (skipped > 0) {
        onFeedback('warning', `已下载 ${result.data.downloaded.length} 个文件，跳过 ${skipped} 个文件夹。`)
      } else {
        onFeedback('good', `已下载 ${result.data.downloaded.length} 个文件。`)
      }
    } finally {
      setActionBusy('')
    }
  }

  const pasteClipboard = async () => {
    if (!current || !clipboard || clipboard.nodes.length === 0 || actionBusy) return
    setActionBusy('paste')
    try {
      const nodes = clipboard.mode === 'cut'
        ? clipboard.nodes.filter((node) => node.parent_id !== current.id)
        : clipboard.nodes
      if (nodes.length > 0) {
        const refs = nodes.map((node) => ({ id: node.id, revision: node.revision }))
        const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(
          clipboard.mode === 'cut' ? 'move' : 'copy',
          refs,
          current.id,
        )
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        onOperationQueued(result.data)
        onFeedback(
          'good',
          clipboard.mode === 'cut'
            ? `已将 ${nodes.length} 个项目加入移动任务。`
            : `已将 ${nodes.length} 个项目加入复制任务。`,
        )
      }
      if (clipboard.mode === 'cut') setClipboard(null)
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
    const nodes = explorerNodesForItems(selected).filter((node) => node.id !== targetNode.id)
    if (nodes.length === 0) return
    setActionBusy('drop-items')
    try {
      const refs = nodes.map((node) => ({ id: node.id, revision: node.revision }))
      const result = await window.xdriveDesktop.agent.cloudCreateFileOperation(operation, refs, targetNode.id)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      onOperationQueued(result.data)
      clearSearch()
      onFeedback(
        'good',
        operation === 'copy'
          ? `已将 ${nodes.length} 个项目加入复制任务。`
          : `已将 ${nodes.length} 个项目加入移动任务。`,
      )
    } finally {
      setActionBusy('')
    }
  }

  const dropExternalFiles = async (files: File[], target?: XDriveFileExplorerItem) => {
    if (!current || files.length === 0 || actionBusy) return
    const targetNode = target ? nodeByID.get(Number(target.id)) : undefined
    const parentID = targetNode?.type === 'dir' ? targetNode.id : current.id
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
        hasMore={!searchResults && hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => {
          if (current && !searchResults) void onLoadMore(current.id, sort)
        }}
        detailsPreferencesKey={DESKTOP_FILE_DETAILS_LAYOUT_KEY}
        onCopyItems={(selected) => {
          const nodes = explorerNodesForItems(selected)
          if (nodes.length > 0) setClipboard({ mode: 'copy', nodes })
        }}
        onCutItems={(selected) => {
          const nodes = explorerNodesForItems(selected)
          if (nodes.length > 0) setClipboard({ mode: 'cut', nodes })
        }}
        onPaste={() => { void pasteClipboard() }}
        canPaste={Boolean(clipboard?.nodes.length) && !actionBusy}
        onDownloadItems={(selected) => { void downloadSelected(selected) }}
        onDeleteItems={(selected) => {
          const nodes = explorerNodesForItems(selected)
          if (nodes.length > 0) onDeleteMany(nodes)
        }}
        onDropItemsToFolder={(selected, target, operation) => { void dropItemsToFolder(selected, target, operation) }}
        onExternalFilesDrop={(files, target) => { void dropExternalFiles(files, target) }}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        commandBarStart={<XDriveFileExplorerTrashCommandButton onClick={onOpenTrash} />}
        statusText={searchResults
          ? `搜索“${searchValue.trim()}”${searchResults.length >= 200 ? ' · 最多显示 200 个结果' : ''}`
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
