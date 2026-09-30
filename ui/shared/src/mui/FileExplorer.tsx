import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, UIEvent } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded'
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import MovieRoundedIcon from '@mui/icons-material/MovieRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import UploadRoundedIcon from '@mui/icons-material/UploadRounded'
import ViewCarouselRoundedIcon from '@mui/icons-material/ViewCarouselRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import {
  Box,
  Breadcrumbs,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ButtonProps } from '@mui/material'
import { formatSize } from '../format'
import { XDriveStatePanel } from './StatePanel'

export type XDriveFileExplorerID = string | number
export type XDriveFileExplorerViewMode = 'details' | 'grid'
export type XDriveFileExplorerPresentation = 'card' | 'workspace'
export type XDriveFileExplorerSortKey = 'name' | 'updated' | 'type' | 'size'
export type XDriveFileExplorerSortDirection = 'asc' | 'desc'

export type XDriveFileExplorerCrumb = {
  id: XDriveFileExplorerID
  name: string
}

export type XDriveFileExplorerFileKind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'code'
  | 'text'
  | 'file'

export type XDriveFileExplorerItem = {
  id: XDriveFileExplorerID
  name: string
  kind: 'dir' | 'file'
  size?: number
  updatedAt?: string
  typeLabel?: string
  fileKind?: XDriveFileExplorerFileKind
  secondaryLabel?: string
  icon?: ReactNode
  thumbnail?: ReactNode
  thumbnailEligible?: boolean
}

export type XDriveFileExplorerSort = {
  key: XDriveFileExplorerSortKey
  direction: XDriveFileExplorerSortDirection
}

export type XDriveFileExplorerMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  dividerBefore?: boolean
  onSelect: () => void
}

const imageExtensions = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp'])
const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'])
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'wma'])
const documentExtensions = new Set(['doc', 'docx', 'odt', 'rtf'])
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx'])
const presentationExtensions = new Set(['odp', 'ppt', 'pptx'])
const archiveExtensions = new Set(['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip'])
const codeExtensions = new Set([
  'c', 'cc', 'cpp', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'jsx',
  'kt', 'md', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'swift', 'toml', 'ts', 'tsx',
  'xml', 'yaml', 'yml',
])
const textExtensions = new Set(['ini', 'log', 'text', 'txt'])

function explorerExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function xDriveFileKind(name: string, kind: 'dir' | 'file'): XDriveFileExplorerFileKind {
  if (kind === 'dir') return 'folder'
  const extension = explorerExtension(name)
  if (imageExtensions.has(extension)) return 'image'
  if (videoExtensions.has(extension)) return 'video'
  if (audioExtensions.has(extension)) return 'audio'
  if (extension === 'pdf') return 'pdf'
  if (documentExtensions.has(extension)) return 'document'
  if (spreadsheetExtensions.has(extension)) return 'spreadsheet'
  if (presentationExtensions.has(extension)) return 'presentation'
  if (archiveExtensions.has(extension)) return 'archive'
  if (codeExtensions.has(extension)) return 'code'
  if (textExtensions.has(extension)) return 'text'
  return 'file'
}

export function xDriveFileTypeLabel(name: string, kind: 'dir' | 'file') {
  if (kind === 'dir') return '文件夹'
  const extension = explorerExtension(name)
  const fileKind = xDriveFileKind(name, kind)
  switch (fileKind) {
    case 'image': return extension ? `${extension.toUpperCase()} 图像` : '图像'
    case 'video': return extension ? `${extension.toUpperCase()} 视频` : '视频'
    case 'audio': return extension ? `${extension.toUpperCase()} 音频` : '音频'
    case 'pdf': return 'PDF 文档'
    case 'document': return extension ? `${extension.toUpperCase()} 文档` : '文档'
    case 'spreadsheet': return extension ? `${extension.toUpperCase()} 工作表` : '工作表'
    case 'presentation': return extension ? `${extension.toUpperCase()} 演示文稿` : '演示文稿'
    case 'archive': return extension ? `${extension.toUpperCase()} 压缩文件` : '压缩文件'
    case 'code': return extension ? `${extension.toUpperCase()} 文件` : '代码文件'
    case 'text': return '文本文档'
    default: return extension ? `${extension.toUpperCase()} 文件` : '文件'
  }
}

export function xDriveFileSupportsThumbnail(name: string, kind: 'dir' | 'file') {
  const fileKind = xDriveFileKind(name, kind)
  return fileKind === 'image' || fileKind === 'video'
}

function explorerIDKey(id: XDriveFileExplorerID) {
  return `${typeof id}:${String(id)}`
}

function XDriveLazyFileThumbnail({
  item,
  loadThumbnail,
  fallback,
}: {
  item: XDriveFileExplorerItem
  loadThumbnail: (item: XDriveFileExplorerItem) => Promise<string | null | undefined>
  fallback: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    setSrc(null)
  }, [item.id, item.updatedAt])

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || failed) return
    let active = true
    void loadThumbnail(item)
      .then((value) => {
        if (!active) {
          if (value?.startsWith('blob:')) URL.revokeObjectURL(value)
          return
        }
        if (!value) {
          setFailed(true)
          return
        }
        setSrc(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [failed, item.id, item.updatedAt, loadThumbnail, visible])

  useEffect(() => () => {
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src)
  }, [src])

  return (
    <Box ref={hostRef} sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? (
        <Box
          component="img"
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : fallback}
    </Box>
  )
}

const xDriveWindowsFolderYellow = '#ffcb3d'

export function XDriveFileExplorerCommandButton({ sx, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      size="small"
      variant="text"
      color="inherit"
      sx={[
        { minHeight: 30, px: 1, borderRadius: 1, color: 'text.primary', whiteSpace: 'nowrap' },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}

const detailsRowHeight = 38
const detailsHeaderHeight = 32
const detailsVirtualizationThreshold = 240
const detailsOverscan = 10

export function XDriveFileExplorer({
  items,
  crumbs,
  loading = false,
  presentation = 'card',
  emptyMessage = '此文件夹为空',
  pathValue,
  onPathSubmit,
  searchValue = '',
  onSearchValueChange,
  onSearch,
  canGoBack = false,
  canGoForward = false,
  canGoUp = false,
  onBack,
  onForward,
  onUp,
  onRefresh,
  onCrumbClick,
  onCreateFolder,
  onUpload,
  onItemClick,
  onOpenItem,
  selectedIDs: controlledSelectedIDs,
  defaultSelectedIDs = [],
  onSelectionChange,
  onCopyItems,
  onCutItems,
  onPaste,
  canPaste = false,
  onDownloadItems,
  onDeleteItems,
  onDropItemsToFolder,
  onExternalFilesDrop,
  getItemMenuItems,
  backgroundMenuItems = [],
  viewMode: controlledViewMode,
  onViewModeChange,
  sort: controlledSort,
  onSortChange,
  commandBarStart,
  commandBarEnd,
  statusText,
  loadThumbnail,
}: {
  items: XDriveFileExplorerItem[]
  crumbs: XDriveFileExplorerCrumb[]
  loading?: boolean
  presentation?: XDriveFileExplorerPresentation
  emptyMessage?: string
  pathValue?: string
  onPathSubmit?: (path: string) => void
  searchValue?: string
  onSearchValueChange?: (value: string) => void
  onSearch?: (value: string) => void
  canGoBack?: boolean
  canGoForward?: boolean
  canGoUp?: boolean
  onBack?: () => void
  onForward?: () => void
  onUp?: () => void
  onRefresh?: () => void
  onCrumbClick?: (crumb: XDriveFileExplorerCrumb, index: number) => void
  onCreateFolder?: () => void
  onUpload?: () => void
  onItemClick?: (item: XDriveFileExplorerItem) => void
  onOpenItem?: (item: XDriveFileExplorerItem) => void
  selectedIDs?: readonly XDriveFileExplorerID[]
  defaultSelectedIDs?: readonly XDriveFileExplorerID[]
  onSelectionChange?: (ids: XDriveFileExplorerID[]) => void
  onCopyItems?: (items: XDriveFileExplorerItem[]) => void
  onCutItems?: (items: XDriveFileExplorerItem[]) => void
  onPaste?: () => void
  canPaste?: boolean
  onDownloadItems?: (items: XDriveFileExplorerItem[]) => void
  onDeleteItems?: (items: XDriveFileExplorerItem[]) => void
  onDropItemsToFolder?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerItem, operation: 'move' | 'copy') => void
  onExternalFilesDrop?: (files: File[], target?: XDriveFileExplorerItem) => void
  getItemMenuItems?: (item: XDriveFileExplorerItem) => XDriveFileExplorerMenuItem[]
  backgroundMenuItems?: XDriveFileExplorerMenuItem[]
  viewMode?: XDriveFileExplorerViewMode
  onViewModeChange?: (mode: XDriveFileExplorerViewMode) => void
  sort?: XDriveFileExplorerSort
  onSortChange?: (sort: XDriveFileExplorerSort) => void
  commandBarStart?: ReactNode
  commandBarEnd?: ReactNode
  statusText?: ReactNode
  loadThumbnail?: (item: XDriveFileExplorerItem) => Promise<string | null | undefined>
}) {
  const [editingPath, setEditingPath] = useState(false)
  const derivedPath = useMemo(
    () => pathValue ?? crumbs.map((crumb) => crumb.name).join('/'),
    [crumbs, pathValue],
  )
  const [pathDraft, setPathDraft] = useState(derivedPath)
  const [internalViewMode, setInternalViewMode] = useState<XDriveFileExplorerViewMode>('details')
  const [internalSort, setInternalSort] = useState<XDriveFileExplorerSort>({ key: 'name', direction: 'asc' })
  const [internalSelectedIDs, setInternalSelectedIDs] = useState<XDriveFileExplorerID[]>([...defaultSelectedIDs])
  const [selectionAnchorID, setSelectionAnchorID] = useState<XDriveFileExplorerID | null>(null)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number
    mouseY: number
    items: XDriveFileExplorerMenuItem[]
  } | null>(null)
  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [draggedItems, setDraggedItems] = useState<XDriveFileExplorerItem[]>([])
  const [dropTargetID, setDropTargetID] = useState<XDriveFileExplorerID | null>(null)

  const viewMode = controlledViewMode ?? internalViewMode
  const sort = controlledSort ?? internalSort
  const selectedIDs = controlledSelectedIDs ?? internalSelectedIDs
  const selectedKeySet = useMemo(
    () => new Set(selectedIDs.map(explorerIDKey)),
    [selectedIDs],
  )

  useEffect(() => {
    if (!editingPath) setPathDraft(derivedPath)
  }, [derivedPath, editingPath])

  useEffect(() => {
    const host = scrollHostRef.current
    if (!host) return
    const update = () => setViewportHeight(host.clientHeight)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const visibleItems = useMemo(() => {
    const result = [...items]
    const multiplier = sort.direction === 'asc' ? 1 : -1
    result.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
      if (sort.key === 'size') return ((left.size ?? 0) - (right.size ?? 0)) * multiplier
      if (sort.key === 'updated') {
        const leftTime = left.updatedAt ? Date.parse(left.updatedAt) || 0 : 0
        const rightTime = right.updatedAt ? Date.parse(right.updatedAt) || 0 : 0
        return (leftTime - rightTime) * multiplier
      }
      if (sort.key === 'type') {
        const leftType = left.typeLabel || xDriveFileTypeLabel(left.name, left.kind)
        const rightType = right.typeLabel || xDriveFileTypeLabel(right.name, right.kind)
        return leftType.localeCompare(rightType, undefined, { numeric: true }) * multiplier
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }) * multiplier
    })
    return result
  }, [items, sort.direction, sort.key])

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedKeySet.has(explorerIDKey(item.id))),
    [selectedKeySet, visibleItems],
  )

  const commitSelection = (ids: XDriveFileExplorerID[]) => {
    if (controlledSelectedIDs === undefined) setInternalSelectedIDs(ids)
    onSelectionChange?.(ids)
  }

  const clearSelection = () => {
    setSelectionAnchorID(null)
    commitSelection([])
  }

  const selectItem = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
    index: number,
  ) => {
    const itemKey = explorerIDKey(item.id)
    const additive = event.ctrlKey || event.metaKey

    if (event.shiftKey && selectionAnchorID !== null) {
      const anchorKey = explorerIDKey(selectionAnchorID)
      const anchorIndex = visibleItems.findIndex((candidate) => explorerIDKey(candidate.id) === anchorKey)
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, index)
        const end = Math.max(anchorIndex, index)
        const range = visibleItems.slice(start, end + 1).map((candidate) => candidate.id)
        if (additive) {
          const merged = new Map(selectedIDs.map((id) => [explorerIDKey(id), id]))
          for (const id of range) merged.set(explorerIDKey(id), id)
          commitSelection([...merged.values()])
        } else {
          commitSelection(range)
        }
        onItemClick?.(item)
        return
      }
    }

    if (additive) {
      if (selectedKeySet.has(itemKey)) {
        commitSelection(selectedIDs.filter((id) => explorerIDKey(id) !== itemKey))
      } else {
        commitSelection([...selectedIDs, item.id])
      }
    } else {
      commitSelection([item.id])
    }
    setSelectionAnchorID(item.id)
    onItemClick?.(item)
  }

  const toggleKeyboardSelection = (item: XDriveFileExplorerItem) => {
    const key = explorerIDKey(item.id)
    if (selectedKeySet.has(key)) {
      commitSelection(selectedIDs.filter((id) => explorerIDKey(id) !== key))
    } else {
      commitSelection([...selectedIDs, item.id])
    }
    setSelectionAnchorID(item.id)
  }

  const openItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedKeySet.has(explorerIDKey(item.id))) {
      commitSelection([item.id])
      setSelectionAnchorID(item.id)
    }
    const selection = selectedKeySet.has(explorerIDKey(item.id)) && selectedItems.length > 0
      ? selectedItems
      : [item]
    const actionItems = selection.length > 1 ? [] : (getItemMenuItems?.(item) ?? [])
    const clipboardItems: XDriveFileExplorerMenuItem[] = []
    if (onCutItems) {
      clipboardItems.push({
        id: 'cut',
        label: '剪切',
        icon: <ContentCutRoundedIcon fontSize="small" />,
        dividerBefore: actionItems.length > 0,
        onSelect: () => onCutItems(selection),
      })
    }
    if (onCopyItems) {
      clipboardItems.push({
        id: 'copy',
        label: '复制',
        icon: <ContentCopyRoundedIcon fontSize="small" />,
        dividerBefore: actionItems.length > 0 && clipboardItems.length === 0,
        onSelect: () => onCopyItems(selection),
      })
    }
    const bulkItems: XDriveFileExplorerMenuItem[] = []
    if (selection.length > 1 && onDownloadItems && selection.some((candidate) => candidate.kind === 'file')) {
      bulkItems.push({
        id: 'download-selected',
        label: '下载所选文件',
        icon: <DownloadRoundedIcon fontSize="small" />,
        dividerBefore: actionItems.length + clipboardItems.length > 0,
        onSelect: () => onDownloadItems(selection),
      })
    }
    if (selection.length > 1 && onDeleteItems) {
      bulkItems.push({
        id: 'delete-selected',
        label: '删除所选项目',
        icon: <DeleteOutlineRoundedIcon fontSize="small" />,
        danger: true,
        dividerBefore: actionItems.length + clipboardItems.length > 0 && bulkItems.length === 0,
        onSelect: () => onDeleteItems(selection),
      })
    }
    const menuItems = [...actionItems, ...clipboardItems, ...bulkItems]
    if (menuItems.length === 0) return
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      items: menuItems,
    })
  }

  const openBackgroundContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const menuItems = [...backgroundMenuItems]
    if (onPaste) {
      menuItems.unshift({
        id: 'paste',
        label: '粘贴',
        icon: <ContentPasteRoundedIcon fontSize="small" />,
        disabled: !canPaste,
        onSelect: onPaste,
      })
    }
    if (menuItems.length === 0) return
    event.preventDefault()
    clearSelection()
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      items: menuItems,
    })
  }

  const startItemDrag = (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (!onDropItemsToFolder) return
    const selection = selectedKeySet.has(explorerIDKey(item.id)) && selectedItems.length > 0
      ? selectedItems
      : [item]
    if (!selectedKeySet.has(explorerIDKey(item.id))) {
      commitSelection([item.id])
      setSelectionAnchorID(item.id)
    }
    setDraggedItems(selection)
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('application/x-xdrive-fileexplorer', '1')
  }

  const endItemDrag = () => {
    setDraggedItems([])
    setDropTargetID(null)
  }

  const dragOverFolder = (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    const external = event.dataTransfer.types.includes('Files')
    const internal = draggedItems.length > 0
    if (item.kind !== 'dir' || (!external && !internal)) return
    if (internal && draggedItems.some((candidate) => explorerIDKey(candidate.id) === explorerIDKey(item.id))) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = internal && (event.ctrlKey || event.metaKey) ? 'copy' : external ? 'copy' : 'move'
    setDropTargetID(item.id)
  }

  const dropOnFolder = (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (item.kind !== 'dir') return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0 && onExternalFilesDrop) {
      onExternalFilesDrop(files, item)
      endItemDrag()
      return
    }
    if (draggedItems.length > 0 && onDropItemsToFolder) {
      const operation = event.ctrlKey || event.metaKey ? 'copy' : 'move'
      onDropItemsToFolder(draggedItems, item, operation)
    }
    endItemDrag()
  }

  const dropExternalFilesOnBackground = (event: ReactDragEvent<HTMLElement>) => {
    if (!onExternalFilesDrop || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onExternalFilesDrop(files)
    endItemDrag()
  }

  const contextMenuItems = contextMenu?.items ?? []

  const setViewMode = (mode: XDriveFileExplorerViewMode) => {
    if (controlledViewMode === undefined) setInternalViewMode(mode)
    onViewModeChange?.(mode)
  }

  const setSort = (next: XDriveFileExplorerSort) => {
    if (controlledSort === undefined) setInternalSort(next)
    onSortChange?.(next)
    setSortAnchor(null)
  }

  const submitPath = () => {
    const next = pathDraft.trim()
    setEditingPath(false)
    if (next && next !== derivedPath) onPathSubmit?.(next)
  }

  const handlePathKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitPath()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setPathDraft(derivedPath)
      setEditingPath(false)
    }
  }

  const submitSearch = () => onSearch?.(searchValue.trim())

  const defaultTypeLabel = (item: XDriveFileExplorerItem) => (
    item.typeLabel || xDriveFileTypeLabel(item.name, item.kind)
  )

  const defaultItemIcon = (item: XDriveFileExplorerItem, large = false) => {
    if (item.icon) return item.icon
    const fontSize = large ? 48 : 21
    const fileKind = item.fileKind ?? xDriveFileKind(item.name, item.kind)
    if (fileKind === 'folder') return <FolderRoundedIcon sx={{ fontSize: large ? 52 : 22, color: xDriveWindowsFolderYellow }} />
    if (fileKind === 'image') return <ImageRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'video') return <MovieRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'audio') return <AudioFileRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'pdf') return <PictureAsPdfRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'spreadsheet') return <TableChartRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'presentation') return <ViewCarouselRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'document' || fileKind === 'text') return <DescriptionRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    if (fileKind === 'code') return <CodeRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
    return <InsertDriveFileRoundedIcon sx={{ fontSize, color: 'text.secondary' }} />
  }

  const thumbnailForItem = (item: XDriveFileExplorerItem) => {
    if (item.thumbnail) return item.thumbnail
    const eligible = item.thumbnailEligible ?? xDriveFileSupportsThumbnail(item.name, item.kind)
    if (!eligible || !loadThumbnail) return defaultItemIcon(item, true)
    return (
      <XDriveLazyFileThumbnail
        item={item}
        loadThumbnail={loadThumbnail}
        fallback={defaultItemIcon(item, true)}
      />
    )
  }

  const itemKeyDown = (event: KeyboardEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenItem?.(item)
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      toggleKeyboardSelection(item)
    }
  }

  const selectedSize = useMemo(
    () => items.reduce((total, item) => (
      selectedKeySet.has(explorerIDKey(item.id)) && item.kind === 'file'
        ? total + (item.size ?? 0)
        : total
    ), 0),
    [items, selectedKeySet],
  )

  const virtualizeDetails = viewMode === 'details' && visibleItems.length >= detailsVirtualizationThreshold
  const detailsWindow = useMemo(() => {
    if (!virtualizeDetails) return { start: 0, end: visibleItems.length, before: 0, after: 0 }
    const effectiveHeight = Math.max(viewportHeight, detailsRowHeight * 8)
    const rawFirstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop - detailsHeaderHeight) / detailsRowHeight))
    const firstVisible = Math.min(Math.max(0, visibleItems.length - 1), rawFirstVisible)
    const visibleCount = Math.ceil(effectiveHeight / detailsRowHeight)
    const start = Math.max(0, firstVisible - detailsOverscan)
    const end = Math.min(visibleItems.length, firstVisible + visibleCount + detailsOverscan)
    return {
      start,
      end,
      before: start * detailsRowHeight,
      after: Math.max(0, (visibleItems.length - end) * detailsRowHeight),
    }
  }, [scrollTop, viewportHeight, virtualizeDetails, visibleItems.length])

  const detailItems = virtualizeDetails
    ? visibleItems.slice(detailsWindow.start, detailsWindow.end)
    : visibleItems

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (virtualizeDetails) setScrollTop(event.currentTarget.scrollTop)
  }

  return (
    <Paper
      variant={presentation === 'workspace' ? 'elevation' : 'outlined'}
      elevation={0}
      square={presentation === 'workspace'}
      data-xdrive-file-explorer
      data-xdrive-file-explorer-presentation={presentation}
      sx={{
        minHeight: 0,
        height: '100%',
        flex: presentation === 'workspace' ? 1 : undefined,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: presentation === 'workspace' ? 0 : undefined,
        borderRadius: presentation === 'workspace' ? 0 : 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{
          px: 1,
          py: 0.5,
          minWidth: 0,
          minHeight: 44,
          '& .MuiIconButton-root': { width: 32, height: 32, borderRadius: 1 },
        }}
      >
        <Tooltip title="后退">
          <span>
            <IconButton size="small" aria-label="后退" disabled={!canGoBack} onClick={onBack}>
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="前进">
          <span>
            <IconButton size="small" aria-label="前进" disabled={!canGoForward} onClick={onForward}>
              <ArrowForwardRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="上一级">
          <span>
            <IconButton size="small" aria-label="上一级" disabled={!canGoUp} onClick={onUp}>
              <ArrowUpwardRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="刷新">
          <span>
            <IconButton size="small" aria-label="刷新" disabled={!onRefresh || loading} onClick={onRefresh}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 120 }}>
          {editingPath && onPathSubmit ? (
            <TextField
              fullWidth
              autoFocus
              size="small"
              aria-label="文件路径"
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={handlePathKeyDown}
              onBlur={submitPath}
              slotProps={{ htmlInput: { spellCheck: false } }}
              sx={{ '& .MuiOutlinedInput-root': { height: 36, borderRadius: '6px' } }}
            />
          ) : (
            <Paper
              variant="outlined"
              role={onPathSubmit ? 'button' : undefined}
              tabIndex={onPathSubmit ? 0 : undefined}
              aria-label="文件路径"
              onClick={() => {
                if (onPathSubmit) setEditingPath(true)
              }}
              onKeyDown={(event) => {
                if (onPathSubmit && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  setEditingPath(true)
                }
              }}
              sx={{
                minHeight: 36,
                px: 1,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                minWidth: 0,
                cursor: onPathSubmit ? 'text' : 'default',
                bgcolor: 'background.default',
                '&:focus-visible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                },
              }}
            >
              <Breadcrumbs
                maxItems={6}
                separator={<NavigateNextRoundedIcon sx={{ fontSize: 15 }} />}
                aria-label="面包屑路径"
                sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
              >
                {crumbs.map((crumb, index) => (
                  <ButtonBase
                    key={crumb.id}
                    disabled={index === crumbs.length - 1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCrumbClick?.(crumb, index)
                    }}
                    sx={{
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 1,
                      maxWidth: 180,
                      color: index === crumbs.length - 1 ? 'text.primary' : 'text.secondary',
                      fontSize: 13,
                      justifyContent: 'flex-start',
                    }}
                  >
                    <Typography variant="body2" noWrap>{crumb.name}</Typography>
                  </ButtonBase>
                ))}
              </Breadcrumbs>
            </Paper>
          )}
        </Box>

        <TextField
          size="small"
          value={searchValue}
          onChange={(event) => onSearchValueChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitSearch()
            }
          }}
          placeholder="搜索"
          aria-label="搜索文件和文件夹"
          sx={{
            width: { xs: 150, sm: 220, lg: 280 },
            flexShrink: 0,
            '& .MuiOutlinedInput-root': { height: 36, borderRadius: '6px' },
          }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="搜索" onClick={submitSearch}>
                    <SearchRoundedIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      <Divider />

      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{
          px: 1.25,
          py: 0.5,
          minHeight: 40,
          '& .MuiButton-root': { minHeight: 30, px: 1, borderRadius: 1 },
          '& .MuiToggleButton-root': { width: 32, height: 30, p: 0.5 },
        }}
      >
        {onCutItems ? (
          <XDriveFileExplorerCommandButton
            startIcon={<ContentCutRoundedIcon />}
            disabled={selectedItems.length === 0}
            onClick={() => onCutItems(selectedItems)}
          >
            剪切
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onCopyItems ? (
          <XDriveFileExplorerCommandButton
            startIcon={<ContentCopyRoundedIcon />}
            disabled={selectedItems.length === 0}
            onClick={() => onCopyItems(selectedItems)}
          >
            复制
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onPaste ? (
          <XDriveFileExplorerCommandButton
            startIcon={<ContentPasteRoundedIcon />}
            disabled={!canPaste}
            onClick={onPaste}
          >
            粘贴
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onDownloadItems ? (
          <XDriveFileExplorerCommandButton
            startIcon={<DownloadRoundedIcon />}
            disabled={!selectedItems.some((item) => item.kind === 'file')}
            onClick={() => onDownloadItems(selectedItems)}
          >
            下载
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onDeleteItems ? (
          <XDriveFileExplorerCommandButton
            startIcon={<DeleteOutlineRoundedIcon />}
            disabled={selectedItems.length === 0}
            onClick={() => onDeleteItems(selectedItems)}
            sx={{ color: selectedItems.length > 0 ? 'error.main' : undefined }}
          >
            删除
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onCreateFolder ? (
          <XDriveFileExplorerCommandButton startIcon={<CreateNewFolderRoundedIcon />} onClick={onCreateFolder}>
            新建文件夹
          </XDriveFileExplorerCommandButton>
        ) : null}
        {onUpload ? (
          <XDriveFileExplorerCommandButton startIcon={<UploadRoundedIcon />} onClick={onUpload}>
            上传
          </XDriveFileExplorerCommandButton>
        ) : null}
        {commandBarStart}

        <Box sx={{ flex: 1 }} />

        {commandBarEnd}

        <XDriveFileExplorerCommandButton
          startIcon={<SortRoundedIcon />}
          onClick={(event) => setSortAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(sortAnchor)}
        >
          排序
        </XDriveFileExplorerCommandButton>
        <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}>
          {([
            ['name', '名称'],
            ['updated', '修改时间'],
            ['type', '类型'],
            ['size', '大小'],
          ] as const).map(([key, label]) => (
            <MenuItem
              key={key}
              selected={sort.key === key}
              onClick={() => setSort({
                key,
                direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
              })}
            >
              {label}{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            </MenuItem>
          ))}
        </Menu>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={viewMode}
          onChange={(_event, next: XDriveFileExplorerViewMode | null) => {
            if (next) setViewMode(next)
          }}
          aria-label="文件查看方式"
        >
          <ToggleButton value="details" aria-label="详细信息">
            <ViewListRoundedIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="grid" aria-label="图标">
            <GridViewRoundedIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Divider />

      <Box
        ref={scrollHostRef}
        sx={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto' }}
        tabIndex={0}
        onScroll={handleScroll}
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (!target.closest('[data-xdrive-file-explorer-item]')) clearSelection()
        }}
        onContextMenu={openBackgroundContextMenu}
        onDragOver={(event) => {
          if (onExternalFilesDrop && event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={dropExternalFilesOnBackground}
        onKeyDown={(event) => {
          const modifier = event.ctrlKey || event.metaKey
          const key = event.key.toLowerCase()
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault()
            commitSelection(visibleItems.map((item) => item.id))
            return
          }
          if (modifier && key === 'c' && onCopyItems && selectedItems.length > 0) {
            event.preventDefault()
            onCopyItems(selectedItems)
            return
          }
          if (modifier && key === 'x' && onCutItems && selectedItems.length > 0) {
            event.preventDefault()
            onCutItems(selectedItems)
            return
          }
          if (modifier && key === 'v' && onPaste && canPaste) {
            event.preventDefault()
            onPaste()
            return
          }
          if (event.key === 'Delete' && onDeleteItems && selectedItems.length > 0) {
            event.preventDefault()
            onDeleteItems(selectedItems)
            return
          }
          if (event.key === 'Escape') clearSelection()
        }}
      >
        {loading && visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" loading message="正在加载文件…" />
        ) : visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" message={emptyMessage} />
        ) : viewMode === 'details' ? (
          <Box role="table" aria-label="文件列表" sx={{ minWidth: 620 }}>
            <Box
              role="row"
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 120px',
                minHeight: detailsHeaderHeight,
                alignItems: 'center',
                px: 1.5,
                bgcolor: 'background.default',
                borderBottom: 1,
                borderColor: 'divider',
                color: 'text.secondary',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span role="columnheader">名称</span>
              <span role="columnheader">修改时间</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">大小</span>
            </Box>
            {virtualizeDetails && detailsWindow.before > 0 ? (
              <Box role="presentation" aria-hidden sx={{ height: detailsWindow.before }} />
            ) : null}
            {detailItems.map((item, windowIndex) => {
              const index = virtualizeDetails ? detailsWindow.start + windowIndex : windowIndex
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              return (
              <ButtonBase
                key={item.id}
                component="div"
                role="row"
                data-xdrive-file-explorer-item
                tabIndex={0}
                aria-selected={selected}
                draggable={Boolean(onDropItemsToFolder)}
                onDragStart={(event) => startItemDrag(event, item)}
                onDragEnd={endItemDrag}
                onDragOver={(event) => dragOverFolder(event, item)}
                onDragLeave={() => {
                  if (dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)) setDropTargetID(null)
                }}
                onDrop={(event) => dropOnFolder(event, item)}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => onOpenItem?.(item)}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(260px, 1fr) 190px 150px 120px',
                  minHeight: detailsRowHeight,
                  alignItems: 'center',
                  px: 1.5,
                  textAlign: 'left',
                  borderRadius: '4px',
                  bgcolor: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)
                    ? 'action.hover'
                    : selected ? 'action.selected' : 'transparent',
                  outline: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id) ? '2px solid' : undefined,
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" minWidth={0} role="cell">
                  {defaultItemIcon(item)}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{item.name}</Typography>
                    {item.secondaryLabel ? (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {item.secondaryLabel}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}
                </Typography>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {defaultTypeLabel(item)}
                </Typography>
                <Typography variant="body2" color="text.secondary" role="cell">
                  {item.kind === 'dir' ? '—' : formatSize(item.size ?? 0)}
                </Typography>
              </ButtonBase>
              )
            })}
            {virtualizeDetails && detailsWindow.after > 0 ? (
              <Box role="presentation" aria-hidden sx={{ height: detailsWindow.after }} />
            ) : null}
          </Box>
        ) : (
          <Box
            role="list"
            aria-label="文件图标"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 1,
              p: 1.25,
              alignContent: 'start',
            }}
          >
            {visibleItems.map((item, index) => {
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              return (
              <ButtonBase
                key={item.id}
                component="div"
                role="listitem"
                data-xdrive-file-explorer-item
                tabIndex={0}
                aria-selected={selected}
                draggable={Boolean(onDropItemsToFolder)}
                onDragStart={(event) => startItemDrag(event, item)}
                onDragEnd={endItemDrag}
                onDragOver={(event) => dragOverFolder(event, item)}
                onDragLeave={() => {
                  if (dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)) setDropTargetID(null)
                }}
                onDrop={(event) => dropOnFolder(event, item)}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => onOpenItem?.(item)}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  minWidth: 0,
                  minHeight: 116,
                  maxWidth: 180,
                  borderRadius: 1,
                  p: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  gap: 0.75,
                  textAlign: 'center',
                  bgcolor: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)
                    ? 'action.hover'
                    : selected ? 'action.selected' : 'transparent',
                  outline: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id) ? '2px solid' : undefined,
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                  contentVisibility: 'auto',
                  containIntrinsicSize: '132px 128px',
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 72,
                    height: 64,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    borderRadius: 1,
                  }}
                >
                  {thumbnailForItem(item)}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    width: '100%',
                    overflowWrap: 'anywhere',
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                    lineHeight: 1.25,
                  }}
                >
                  {item.name}
                </Typography>
              </ButtonBase>
              )
            })}
          </Box>
        )}

        {loading && visibleItems.length > 0 ? (
          <Box
            aria-label="正在刷新文件"
            sx={{
              position: 'absolute',
              inset: '0 0 auto',
              height: 2,
              bgcolor: 'primary.main',
              opacity: 0.55,
            }}
          />
        ) : null}
      </Box>

      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        {contextMenuItems.map((menuItem) => (
          <Fragment key={menuItem.id}>
            {menuItem.dividerBefore ? <Divider /> : null}
            <MenuItem
              disabled={menuItem.disabled}
              onClick={() => {
                setContextMenu(null)
                menuItem.onSelect()
              }}
              sx={menuItem.danger ? { color: 'error.main' } : undefined}
            >
              {menuItem.icon ? <Box sx={{ mr: 1, display: 'flex' }}>{menuItem.icon}</Box> : null}
              {menuItem.label}
            </MenuItem>
          </Fragment>
        ))}
      </Menu>

      <Divider />

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ minHeight: 28, px: 1.25, color: 'text.secondary', bgcolor: 'background.default' }}
      >
        <Typography variant="caption">
          {items.length} 个项目{selectedIDs.length > 0 ? ` · 已选择 ${selectedIDs.length} 个` : ''}
        </Typography>
        <Typography variant="caption">
          {statusText ?? (selectedIDs.length > 0 && selectedSize > 0 ? `已选择 ${formatSize(selectedSize)}` : '')}
        </Typography>
      </Stack>
    </Paper>
  )
}
