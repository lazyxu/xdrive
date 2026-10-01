import { useCallback, useEffect, useMemo, useState } from 'react'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import { Dialog, Stack, TextField } from '@mui/material'
import {
  XDriveActionButton,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDriveFileExplorer,
  XDriveFileExplorerCommandButton,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
  XDriveFileExplorerMenuItem,
  XDriveFileExplorerSort,
  XDriveFileExplorerViewMode,
} from '@xdrive/ui/mui'

const DESKTOP_FILE_VIEW_KEY = 'xdrive.desktop.files.view_mode'
const DESKTOP_FILE_DETAILS_LAYOUT_KEY = 'xdrive.desktop.files.details_layout'
type DesktopExplorerClipboard = { mode: 'copy' | 'cut'; nodes: AgentCloudNode[] }

function initialViewMode(): XDriveFileExplorerViewMode {
  return localStorage.getItem(DESKTOP_FILE_VIEW_KEY) === 'grid' ? 'grid' : 'details'
}

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
  onQuotaChanged: () => Promise<unknown>
  onError: (message: string) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const [viewMode, setViewMode] = useState<XDriveFileExplorerViewMode>(initialViewMode)
  const [sort, setSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const [searchValue, setSearchValue] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<AgentCloudSearchResult[] | null>(null)
  const [history, setHistory] = useState<AgentCloudCrumb[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [renameNode, setRenameNode] = useState<AgentCloudNode | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [actionBusy, setActionBusy] = useState('')
  const [clipboard, setClipboard] = useState<DesktopExplorerClipboard | null>(null)

  const current = crumbs.at(-1)

  useEffect(() => {
    if (crumbs.length === 0 || history.length > 0) return
    setHistory([crumbs])
    setHistoryIndex(0)
  }, [crumbs, history.length])

  useEffect(() => {
    localStorage.setItem(DESKTOP_FILE_VIEW_KEY, viewMode)
  }, [viewMode])

  const activeNodes = searchResults ? searchResults.map((result) => result.node) : items
  const nodeByID = useMemo(
    () => new Map(activeNodes.map((node) => [node.id, node])),
    [activeNodes],
  )
  const searchByID = useMemo(
    () => new Map((searchResults ?? []).map((result) => [result.node.id, result])),
    [searchResults],
  )

  const explorerItems = useMemo<XDriveFileExplorerItem[]>(
    () => activeNodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.type,
      size: node.size,
      updatedAt: node.updated_at,
      secondaryLabel: searchByID.get(node.id)?.path,
      path: searchByID.get(node.id)?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/'),
      revision: node.revision,
    })),
    [activeNodes, crumbs, searchByID],
  )

  const explorerCrumbs = useMemo<XDriveFileExplorerCrumb[]>(
    () => crumbs.map((crumb) => ({ id: crumb.id, name: crumb.name })),
    [crumbs],
  )

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

  const changeSort = (nextSort: XDriveFileExplorerSort) => {
    setSort(nextSort)
    if (searchResults) return
    if (current) void onLoadDirectory(current.id, crumbs, nextSort)
  }

  const recordHistory = (nextCrumbs: AgentCloudCrumb[]) => {
    setHistory((currentHistory) => {
      const next = [...currentHistory.slice(0, historyIndex + 1), nextCrumbs]
      setHistoryIndex(next.length - 1)
      return next
    })
  }

  const navigateTo = async (nextCrumbs: AgentCloudCrumb[], record = true) => {
    const target = nextCrumbs.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, nextCrumbs, sort)
    if (record) recordHistory(nextCrumbs)
    clearSearch()
    setSearchValue('')
  }

  const goBack = async () => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next, sort)
    setHistoryIndex(nextIndex)
    clearSearch()
    setSearchValue('')
  }

  const goForward = async () => {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next, sort)
    setHistoryIndex(nextIndex)
    clearSearch()
    setSearchValue('')
  }

  const goUp = async () => {
    if (crumbs.length <= 1) return
    await navigateTo(crumbs.slice(0, -1))
  }

  const submitPath = async (rawPath: string) => {
    try {
      const rootResult = await window.xdriveDesktop.agent.cloudRoot()
      if (!rootResult.ok) {
        onError(rootResult.error.message)
        return
      }
      const rootName = crumbs[0]?.name || '我的文件'
      const parts = rawPath
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
      if (parts[0] === rootName || parts[0] === '我的文件') parts.shift()

      let parentID = rootResult.data.id
      const nextCrumbs: AgentCloudCrumb[] = [{ id: parentID, name: rootName }]
      for (const part of parts) {
        const result = await window.xdriveDesktop.agent.cloudChildren(parentID)
        if (!result.ok) {
          onError(result.error.message)
          return
        }
        const next = result.data.find((node) => node.type === 'dir' && node.name === part)
        if (!next) {
          onError(`找不到文件夹：${part}`)
          return
        }
        parentID = next.id
        nextCrumbs.push({ id: next.id, name: next.name })
      }
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

  const createFolder = async () => {
    if (!current) return
    const name = createName.trim()
    const error = !name ? '请填写文件夹名称' : name.length > 255 ? '文件夹名称不能超过 255 个字符' : ''
    setCreateError(error)
    if (error) return

    setActionBusy('create-folder')
    try {
      const result = await window.xdriveDesktop.agent.cloudCreateDirectory(current.id, name)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      setCreateOpen(false)
      setCreateName('')
      setCreateError('')
      await onLoadDirectory(current.id, crumbs, sort)
      onFeedback('good', '文件夹已创建。')
    } finally {
      setActionBusy('')
    }
  }

  const rename = async () => {
    if (!renameNode || !current) return
    const name = renameName.trim()
    const error = !name ? '请填写名称' : name.length > 255 ? '名称不能超过 255 个字符' : ''
    setRenameError(error)
    if (error) return

    setActionBusy('rename')
    try {
      const result = await window.xdriveDesktop.agent.cloudRename(renameNode.id, renameNode.revision, name)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      setRenameNode(null)
      setRenameName('')
      setRenameError('')
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

  const getItemMenuItems = (item: XDriveFileExplorerItem): XDriveFileExplorerMenuItem[] => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return []
    const menu: XDriveFileExplorerMenuItem[] = []

    if (node.type === 'dir') {
      menu.push({
        id: 'open',
        label: '打开',
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        onSelect: () => { void openItem(item) },
      })
      menu.push({
        id: 'reveal',
        label: '在文件资源管理器中显示',
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: Boolean(actionBusy),
        onSelect: () => { void openLocalNode(node, true) },
      })
    } else {
      menu.push({
        id: 'open',
        label: '打开',
        icon: <OpenInNewRoundedIcon fontSize="small" />,
        disabled: Boolean(actionBusy),
        onSelect: () => { void openLocalNode(node) },
      })
      menu.push({
        id: 'download',
        label: '另存为…',
        icon: <DownloadRoundedIcon fontSize="small" />,
        disabled: Boolean(actionBusy),
        onSelect: () => { void downloadNode(node) },
      })
      menu.push({
        id: 'reveal',
        label: '在文件资源管理器中显示',
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        disabled: Boolean(actionBusy),
        onSelect: () => { void openLocalNode(node, true) },
      })
      menu.push({
        id: 'share',
        label: '分享',
        icon: <ShareRoundedIcon fontSize="small" />,
        onSelect: () => onOpenShares(node),
      })
      menu.push({
        id: 'history',
        label: '历史版本',
        icon: <HistoryRoundedIcon fontSize="small" />,
        onSelect: () => onOpenHistory(node, searchByID.get(node.id)?.crumbs ?? crumbs),
      })
    }

    menu.push({
      id: 'rename',
      label: '重命名',
      icon: <EditRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: () => {
        setRenameNode(node)
        setRenameName(node.name)
        setRenameError('')
      },
    })
    menu.push({
      id: 'delete',
      label: '删除',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      danger: true,
      onSelect: () => onDelete(node),
    })
    return menu
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
        const result = clipboard.mode === 'cut'
          ? await window.xdriveDesktop.agent.cloudBatchMove(refs, current.id)
          : await window.xdriveDesktop.agent.cloudBatchCopy(refs, current.id)
        if (!result.ok) {
          onError(result.error.message)
          return
        }
      }
      if (clipboard.mode === 'cut') setClipboard(null)
      clearSearch()
      await onLoadDirectory(current.id, crumbs, sort)
      await onQuotaChanged()
      onFeedback('good', clipboard.mode === 'cut' ? '已移动到当前文件夹。' : '已复制到当前文件夹。')
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
      const result = operation === 'copy'
        ? await window.xdriveDesktop.agent.cloudBatchCopy(refs, targetNode.id)
        : await window.xdriveDesktop.agent.cloudBatchMove(refs, targetNode.id)
      if (!result.ok) {
        onError(result.error.message)
        return
      }
      clearSearch()
      if (current) await onLoadDirectory(current.id, crumbs, sort)
      await onQuotaChanged()
      onFeedback('good', operation === 'copy' ? '已复制到目标文件夹。' : '已移动到目标文件夹。')
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

  const backgroundMenuItems = useMemo<XDriveFileExplorerMenuItem[]>(() => [
    {
      id: 'new-folder',
      label: '新建文件夹',
      icon: <CreateNewFolderRoundedIcon fontSize="small" />,
      onSelect: () => {
        setCreateName('')
        setCreateError('')
        setCreateOpen(true)
      },
    },
    {
      id: 'upload',
      label: '上传文件',
      icon: <UploadRoundedIcon fontSize="small" />,
      disabled: Boolean(actionBusy),
      onSelect: () => { void uploadFiles() },
    },
    {
      id: 'refresh',
      label: '刷新',
      icon: <RefreshRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: () => {
        if (current) void onLoadDirectory(current.id, crumbs, sort)
      },
    },
  ], [actionBusy, crumbs, current, onLoadDirectory])

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
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
        canGoUp={crumbs.length > 1}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={() => {
          if (current) void onLoadDirectory(current.id, crumbs, sort)
        }}
        onCrumbClick={(_crumb, index) => { void navigateTo(crumbs.slice(0, index + 1)) }}
        onCreateFolder={() => {
          setCreateName('')
          setCreateError('')
          setCreateOpen(true)
        }}
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
        commandBarStart={(
          <XDriveFileExplorerCommandButton startIcon={<RestoreFromTrashRoundedIcon />} onClick={onOpenTrash}>
            回收站
          </XDriveFileExplorerCommandButton>
        )}
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

      <Dialog
        open={createOpen}
        onClose={() => { if (!actionBusy) setCreateOpen(false) }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="新建文件夹"
          onClose={() => setCreateOpen(false)}
          closeDisabled={Boolean(actionBusy)}
        />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => {
            event.preventDefault()
            void createFolder()
          }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="文件夹名称"
              value={createName}
              error={Boolean(createError)}
              helperText={createError || ' '}
              onChange={(event) => {
                setCreateName(event.target.value)
                if (createError) setCreateError('')
              }}
            />
            <XDriveActionButton
              intent="primary"
              type="submit"
              loading={actionBusy === 'create-folder'}
              loadingLabel="正在创建…"
            >
              创建
            </XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameNode)}
        onClose={() => { if (!actionBusy) setRenameNode(null) }}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="重命名"
          onClose={() => setRenameNode(null)}
          closeDisabled={Boolean(actionBusy)}
        />
        <XDriveDialogContent>
          <Stack component="form" spacing={2} onSubmit={(event) => {
            event.preventDefault()
            void rename()
          }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="名称"
              value={renameName}
              error={Boolean(renameError)}
              helperText={renameError || ' '}
              onChange={(event) => {
                setRenameName(event.target.value)
                if (renameError) setRenameError('')
              }}
            />
            <XDriveActionButton
              intent="primary"
              type="submit"
              loading={actionBusy === 'rename'}
              loadingLabel="正在保存…"
            >
              保存
            </XDriveActionButton>
          </Stack>
        </XDriveDialogContent>
      </Dialog>
    </>
  )
}
