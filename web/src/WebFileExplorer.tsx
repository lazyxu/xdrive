import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import { Box, LinearProgress } from '@mui/material'
import {
  XDriveFileExplorer,
  XDriveFileExplorerCommandButton,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
  XDriveFileExplorerMenuItem,
  XDriveFileExplorerViewMode,
} from '@xdrive/ui/mui'
import type { Node } from '../../ui/shared/src'
import type { SearchResult, XDriveApi } from './api'

const FILE_VIEW_KEY = 'xdrive.files.view_mode'

type Crumb = { id: number; name: string }
type WebExplorerClipboard = { mode: 'copy' | 'cut'; nodes: Node[] }

function normalizedSearchCrumbs(result: SearchResult): Crumb[] {
  return result.breadcrumbs.map((crumb, index) => ({
    id: crumb.id,
    name: index === 0 && !crumb.name ? '我的文件' : crumb.name,
  }))
}

function initialViewMode(): XDriveFileExplorerViewMode {
  return localStorage.getItem(FILE_VIEW_KEY) === 'grid' ? 'grid' : 'details'
}

export default function WebFileExplorer({
  api,
  items,
  crumbs,
  loading,
  uploadProgress,
  onLoadDirectory,
  onUploadFiles,
  onCreateFolder,
  onOpenTrash,
  onRename,
  onRemove,
  onShare,
  onHistory,
  onError,
}: {
  api: XDriveApi
  items: Node[]
  crumbs: Crumb[]
  loading: boolean
  uploadProgress: number | null
  onLoadDirectory: (id: number, crumbs: Crumb[]) => Promise<void>
  onUploadFiles: (files: FileList | null) => Promise<void>
  onCreateFolder: () => void
  onOpenTrash: () => void
  onRename: (node: Node) => void
  onRemove: (node: Node) => void
  onShare: (node: Node) => void
  onHistory: (node: Node) => void
  onError: (error: unknown) => void
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [viewMode, setViewMode] = useState<XDriveFileExplorerViewMode>(initialViewMode)
  const [searchValue, setSearchValue] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [history, setHistory] = useState<Crumb[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [clipboard, setClipboard] = useState<WebExplorerClipboard | null>(null)
  const [clipboardBusy, setClipboardBusy] = useState(false)

  const current = crumbs.at(-1)

  useEffect(() => {
    if (crumbs.length === 0 || history.length > 0) return
    setHistory([crumbs])
    setHistoryIndex(0)
  }, [crumbs, history.length])

  useEffect(() => {
    localStorage.setItem(FILE_VIEW_KEY, viewMode)
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
    () => activeNodes.map((node) => {
      const result = searchByID.get(node.id)
      return {
        id: node.id,
        name: node.name,
        kind: node.type,
        size: node.size,
        updatedAt: node.updated_at,
        secondaryLabel: result?.path || undefined,
      }
    }),
    [activeNodes, searchByID],
  )

  const explorerCrumbs = useMemo<XDriveFileExplorerCrumb[]>(
    () => crumbs.map((crumb) => ({ id: crumb.id, name: crumb.name })),
    [crumbs],
  )

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

  const recordHistory = (nextCrumbs: Crumb[]) => {
    setHistory((currentHistory) => {
      const next = [...currentHistory.slice(0, historyIndex + 1), nextCrumbs]
      setHistoryIndex(next.length - 1)
      return next
    })
  }

  const navigateTo = async (nextCrumbs: Crumb[], record = true) => {
    const target = nextCrumbs.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, nextCrumbs)
    if (record) recordHistory(nextCrumbs)
    clearSearch()
  }

  const goBack = async () => {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next)
    setHistoryIndex(nextIndex)
    clearSearch()
  }

  const goForward = async () => {
    if (historyIndex < 0 || historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    await onLoadDirectory(target.id, next)
    setHistoryIndex(nextIndex)
    clearSearch()
  }

  const goUp = async () => {
    if (crumbs.length <= 1) return
    await navigateTo(crumbs.slice(0, -1))
  }

  const submitPath = async (rawPath: string) => {
    try {
      const root = await api.root()
      const rootName = crumbs[0]?.name || '我的文件'
      const parts = rawPath
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
      if (parts[0] === rootName || parts[0] === '我的文件') parts.shift()

      let parentID = root.id
      const nextCrumbs: Crumb[] = [{ id: root.id, name: rootName }]
      for (const part of parts) {
        const children = await api.list(parentID)
        const next = children.find((node) => node.type === 'dir' && node.name === part)
        if (!next) throw new Error(`找不到文件夹：${part}`)
        parentID = next.id
        nextCrumbs.push({ id: next.id, name: next.name })
      }
      await navigateTo(nextCrumbs)
    } catch (error) {
      onError(error)
    }
  }

  const submitSearch = async (query: string) => {
    const normalized = query.trim()
    if (!normalized) {
      clearSearch()
      return
    }
    if ([...normalized].length < 2) {
      onError(new Error('搜索关键字至少需要 2 个字符。'))
      return
    }
    setSearchLoading(true)
    try {
      const page = await api.search(normalized, 200)
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

  const startRename = (node: Node) => onRename(node)

  const getItemMenuItems = (item: XDriveFileExplorerItem): XDriveFileExplorerMenuItem[] => {
    const node = nodeByID.get(Number(item.id))
    if (!node) return []

    const result: XDriveFileExplorerMenuItem[] = []
    if (node.type === 'dir') {
      result.push({
        id: 'open',
        label: '打开',
        icon: <FolderOpenRoundedIcon fontSize="small" />,
        onSelect: () => { void openItem(item) },
      })
    } else {
      result.push({
        id: 'download',
        label: '下载',
        icon: <DownloadRoundedIcon fontSize="small" />,
        onSelect: () => { void api.download(node).catch(onError) },
      })
      result.push({
        id: 'share',
        label: '分享',
        icon: <ShareRoundedIcon fontSize="small" />,
        onSelect: () => onShare(node),
      })
      result.push({
        id: 'history',
        label: '历史版本',
        icon: <HistoryRoundedIcon fontSize="small" />,
        onSelect: () => onHistory(node),
      })
    }
    result.push({
      id: 'rename',
      label: '重命名',
      icon: <EditRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: () => startRename(node),
    })
    result.push({
      id: 'delete',
      label: '删除',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      danger: true,
      onSelect: () => onRemove(node),
    })
    return result
  }

  const explorerNodesForItems = (selected: XDriveFileExplorerItem[]) => (
    selected
      .map((item) => nodeByID.get(Number(item.id)))
      .filter((node): node is Node => Boolean(node))
  )

  const pasteClipboard = async () => {
    if (!current || !clipboard || clipboard.nodes.length === 0 || clipboardBusy) return
    setClipboardBusy(true)
    try {
      for (const node of clipboard.nodes) {
        if (clipboard.mode === 'cut') {
          if (node.parent_id === current.id) continue
          await api.move(node.id, node.revision, current.id)
        } else {
          await api.copy(node.id, current.id)
        }
      }
      if (clipboard.mode === 'cut') setClipboard(null)
      clearSearch()
      await onLoadDirectory(current.id, crumbs)
    } catch (error) {
      onError(error)
    } finally {
      setClipboardBusy(false)
    }
  }

  const backgroundMenuItems = useMemo<XDriveFileExplorerMenuItem[]>(() => [
    {
      id: 'new-folder',
      label: '新建文件夹',
      icon: <CreateNewFolderRoundedIcon fontSize="small" />,
      onSelect: onCreateFolder,
    },
    {
      id: 'upload',
      label: '上传文件',
      icon: <UploadRoundedIcon fontSize="small" />,
      onSelect: () => uploadInputRef.current?.click(),
    },
    {
      id: 'refresh',
      label: '刷新',
      icon: <RefreshRoundedIcon fontSize="small" />,
      dividerBefore: true,
      onSelect: () => {
        if (current) void onLoadDirectory(current.id, crumbs)
      },
    },
  ], [crumbs, current, onCreateFolder, onLoadDirectory])

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
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
        canGoUp={crumbs.length > 1}
        onBack={() => { void goBack() }}
        onForward={() => { void goForward() }}
        onUp={() => { void goUp() }}
        onRefresh={() => {
          if (current) void onLoadDirectory(current.id, crumbs)
        }}
        onCrumbClick={(_crumb, index) => { void navigateTo(crumbs.slice(0, index + 1)) }}
        onCreateFolder={onCreateFolder}
        onUpload={() => uploadInputRef.current?.click()}
        onOpenItem={(item) => { void openItem(item) }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCopyItems={(selected) => {
          const nodes = explorerNodesForItems(selected)
          if (nodes.length > 0) setClipboard({ mode: 'copy', nodes })
        }}
        onCutItems={(selected) => {
          const nodes = explorerNodesForItems(selected)
          if (nodes.length > 0) setClipboard({ mode: 'cut', nodes })
        }}
        onPaste={() => { void pasteClipboard() }}
        canPaste={Boolean(clipboard?.nodes.length) && !clipboardBusy}
        getItemMenuItems={getItemMenuItems}
        backgroundMenuItems={backgroundMenuItems}
        commandBarStart={(
          <XDriveFileExplorerCommandButton startIcon={<RestoreFromTrashRoundedIcon />} onClick={onOpenTrash}>
            回收站
          </XDriveFileExplorerCommandButton>
        )}
        statusText={searchResults
          ? `搜索“${searchValue.trim()}”${searchHasMore ? ' · 仅显示前 200 个结果' : ''}`
          : uploadProgress !== null
            ? `上传中 ${Math.round(uploadProgress)}%`
            : undefined}
      />
    </Box>
  )
}
