import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent, WheelEvent as ReactWheelEvent } from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded'
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
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
import ViewColumnRoundedIcon from '@mui/icons-material/ViewColumnRounded'
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
import type { XDriveFileTextPreview } from '../file-preview'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT, XDRIVE_FILE_EXPLORER_TYPE_SELECT_TIMEOUT_MS, xDriveFileExplorerDragAutoScrollDelta, xDriveFileExplorerKeyboardTargetIndex, xDriveFileExplorerRenameSelectionEnd, xDriveFileExplorerTypeSelectTargetIndex } from '../file-explorer-controller'
import type { XDriveFileExplorerKeyboardNavigationKey } from '../file-explorer-controller'
import { XDriveStatePanel } from './StatePanel'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import { XDriveFilePropertiesDialog } from './FilePropertiesDialog'
import type { XDriveFilePropertiesDialogProperty } from './FilePropertiesDialog'
import { xDriveFileExplorerReadExternalDrop } from './FileExplorerExternalDrop'
import type { XDriveFileExplorerExternalDropPayload } from './FileExplorerExternalDrop'

export type XDriveFileExplorerID = string | number
export type XDriveFileExplorerViewMode = 'details' | 'grid'
export type XDriveFileExplorerPresentation = 'card' | 'workspace'
export type XDriveFileExplorerSortKey = 'name' | 'updated' | 'type' | 'size'
export type XDriveFileExplorerSortDirection = 'asc' | 'desc'
export type XDriveFileExplorerDetailsColumnKey = XDriveFileExplorerSortKey

export type XDriveFileExplorerDetailsLayout = {
  visible: XDriveFileExplorerDetailsColumnKey[]
  order: XDriveFileExplorerDetailsColumnKey[]
  widths: Record<XDriveFileExplorerDetailsColumnKey, number>
}

export type XDriveFileExplorerDetailsDensity = 'normal' | 'compact'
export type XDriveFileExplorerGridSize = 'small' | 'medium' | 'large'

export type XDriveFileExplorerViewPreferences = {
  detailsDensity: XDriveFileExplorerDetailsDensity
  gridSize: XDriveFileExplorerGridSize
}

const detailsColumnKeys: XDriveFileExplorerDetailsColumnKey[] = ['name', 'updated', 'type', 'size']
const detailsColumnMeta: Record<XDriveFileExplorerDetailsColumnKey, { label: string; defaultWidth: number; minWidth: number; maxWidth: number }> = {
  name: { label: '名称', defaultWidth: 320, minWidth: 180, maxWidth: 900 },
  updated: { label: '修改时间', defaultWidth: 190, minWidth: 130, maxWidth: 420 },
  type: { label: '类型', defaultWidth: 150, minWidth: 100, maxWidth: 360 },
  size: { label: '大小', defaultWidth: 120, minWidth: 90, maxWidth: 260 },
}

export function xDriveDefaultFileExplorerDetailsLayout(): XDriveFileExplorerDetailsLayout {
  return {
    visible: [...detailsColumnKeys],
    order: [...detailsColumnKeys],
    widths: Object.fromEntries(detailsColumnKeys.map((key) => [key, detailsColumnMeta[key].defaultWidth])) as Record<XDriveFileExplorerDetailsColumnKey, number>,
  }
}

export function xDriveNormalizeFileExplorerDetailsLayout(value: unknown): XDriveFileExplorerDetailsLayout {
  const fallback = xDriveDefaultFileExplorerDetailsLayout()
  if (!value || typeof value !== 'object') return fallback
  const input = value as { visible?: unknown; order?: unknown; widths?: unknown }
  const visibleInput = Array.isArray(input.visible) ? input.visible : fallback.visible
  const visible = ['name', ...visibleInput.filter((key): key is XDriveFileExplorerDetailsColumnKey => (
    typeof key === 'string' && key !== 'name' && detailsColumnKeys.includes(key as XDriveFileExplorerDetailsColumnKey)
  ))] as XDriveFileExplorerDetailsColumnKey[]
  const dedupedVisible = [...new Set(visible)]
  const orderInput = Array.isArray(input.order) ? input.order : fallback.order
  const ordered = orderInput.filter((key): key is XDriveFileExplorerDetailsColumnKey => (
    typeof key === 'string' && detailsColumnKeys.includes(key as XDriveFileExplorerDetailsColumnKey)
  ))
  const order = [...new Set([
    ...ordered,
    ...detailsColumnKeys.filter((key) => !ordered.includes(key)),
  ])] as XDriveFileExplorerDetailsColumnKey[]
  const widthInput = input.widths && typeof input.widths === 'object' ? input.widths as Record<string, unknown> : {}
  const widths = {} as Record<XDriveFileExplorerDetailsColumnKey, number>
  for (const key of detailsColumnKeys) {
    const meta = detailsColumnMeta[key]
    const raw = typeof widthInput[key] === 'number' && Number.isFinite(widthInput[key]) ? widthInput[key] as number : meta.defaultWidth
    widths[key] = Math.round(Math.max(meta.minWidth, Math.min(meta.maxWidth, raw)))
  }
  return { visible: dedupedVisible, order, widths }
}

function loadFileExplorerDetailsLayout(storageKey?: string) {
  if (!storageKey || typeof window === 'undefined') return xDriveDefaultFileExplorerDetailsLayout()
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? xDriveNormalizeFileExplorerDetailsLayout(JSON.parse(raw)) : xDriveDefaultFileExplorerDetailsLayout()
  } catch {
    return xDriveDefaultFileExplorerDetailsLayout()
  }
}

const fileExplorerGridSizeOrder: XDriveFileExplorerGridSize[] = ['small', 'medium', 'large']

const fileExplorerGridMetrics: Record<XDriveFileExplorerGridSize, {
  minColumnWidth: number
  maxItemWidth: number
  minItemHeight: number
  thumbnailWidth: number
  thumbnailHeight: number
  iconSize: number
  folderIconSize: number
  gap: number
  padding: number
  itemPadding: number
  itemGap: number
  estimatedRowHeight: number
}> = {
  small: {
    minColumnWidth: 88,
    maxItemWidth: 136,
    minItemHeight: 92,
    thumbnailWidth: 48,
    thumbnailHeight: 44,
    iconSize: 36,
    folderIconSize: 40,
    gap: 0.5,
    padding: 1,
    itemPadding: 0.75,
    itemGap: 0.5,
    estimatedRowHeight: 108,
  },
  medium: {
    minColumnWidth: 112,
    maxItemWidth: 180,
    minItemHeight: 116,
    thumbnailWidth: 72,
    thumbnailHeight: 64,
    iconSize: 48,
    folderIconSize: 52,
    gap: 1,
    padding: 1.25,
    itemPadding: 1,
    itemGap: 0.75,
    estimatedRowHeight: 132,
  },
  large: {
    minColumnWidth: 148,
    maxItemWidth: 236,
    minItemHeight: 156,
    thumbnailWidth: 108,
    thumbnailHeight: 96,
    iconSize: 72,
    folderIconSize: 76,
    gap: 1.25,
    padding: 1.5,
    itemPadding: 1.25,
    itemGap: 1,
    estimatedRowHeight: 174,
  },
}

export function xDriveDefaultFileExplorerViewPreferences(): XDriveFileExplorerViewPreferences {
  return { detailsDensity: 'normal', gridSize: 'medium' }
}

export function xDriveNormalizeFileExplorerViewPreferences(value: unknown): XDriveFileExplorerViewPreferences {
  const fallback = xDriveDefaultFileExplorerViewPreferences()
  if (!value || typeof value !== 'object') return fallback
  const input = value as { detailsDensity?: unknown; gridSize?: unknown }
  const detailsDensity: XDriveFileExplorerDetailsDensity = input.detailsDensity === 'compact' ? 'compact' : 'normal'
  const gridSize: XDriveFileExplorerGridSize = fileExplorerGridSizeOrder.includes(input.gridSize as XDriveFileExplorerGridSize)
    ? input.gridSize as XDriveFileExplorerGridSize
    : fallback.gridSize
  return { detailsDensity, gridSize }
}

export function xDriveFileExplorerNextGridSize(
  current: XDriveFileExplorerGridSize,
  direction: -1 | 1,
): XDriveFileExplorerGridSize {
  const index = Math.max(0, fileExplorerGridSizeOrder.indexOf(current))
  const next = Math.max(0, Math.min(fileExplorerGridSizeOrder.length - 1, index + direction))
  return fileExplorerGridSizeOrder[next]
}

function loadFileExplorerViewPreferences(storageKey?: string) {
  if (!storageKey || typeof window === 'undefined') return xDriveDefaultFileExplorerViewPreferences()
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? xDriveNormalizeFileExplorerViewPreferences(JSON.parse(raw)) : xDriveDefaultFileExplorerViewPreferences()
  } catch {
    return xDriveDefaultFileExplorerViewPreferences()
  }
}

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

export type XDriveFileExplorerProperty = XDriveFilePropertiesDialogProperty

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
  path?: string
  revision?: string | number
  properties?: XDriveFileExplorerProperty[]
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

function setFileExplorerDragImage(
  event: ReactDragEvent<HTMLElement>,
  items: readonly XDriveFileExplorerItem[],
) {
  if (typeof document === 'undefined' || items.length === 0) return
  const ghost = document.createElement('div')
  ghost.textContent = items.length > 1 ? `${items.length} 个项目` : items[0].name
  ghost.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:-10000px',
    'max-width:260px',
    'padding:6px 10px',
    'border-radius:6px',
    'background:rgba(32,33,36,.92)',
    'color:white',
    'font:500 13px system-ui,sans-serif',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'box-shadow:0 4px 14px rgba(0,0,0,.28)',
    'pointer-events:none',
    'z-index:2147483647',
  ].join(';')
  document.body.appendChild(ghost)
  event.dataTransfer.setDragImage(ghost, 18, 18)
  window.setTimeout(() => ghost.remove(), 0)
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

const detailsNormalRowHeight = 38
const detailsCompactRowHeight = 30
const detailsHeaderHeight = 32
const detailsVirtualizationThreshold = 240
const detailsOverscan = 10

type XDriveFileExplorerMarqueeRect = {
  left: number
  top: number
  width: number
  height: number
}

type XDriveFileExplorerMarqueeSession = {
  pointerId: number
  startClientX: number
  startClientY: number
  startContentX: number
  startContentY: number
  baseIDs: XDriveFileExplorerID[]
  moved: boolean
}

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
  onUploadFolder,
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
  folderDownloadSupported = false,
  onDeleteItems,
  onRenameItem,
  renameDisabled = false,
  detailsPreferencesKey,
  viewPreferencesKey,
  onDropItemsToFolder,
  onDropItemsToCrumb,
  onExternalFilesDrop,
  onExternalFilesDropToCrumb,
  onExternalFolderDrop,
  onExternalFolderDropToCrumb,
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
  loadTextPreview,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  externallySorted = false,
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
  onUploadFolder?: () => void
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
  folderDownloadSupported?: boolean
  onDeleteItems?: (items: XDriveFileExplorerItem[]) => void
  onRenameItem?: (item: XDriveFileExplorerItem, name: string) => void | Promise<void>
  renameDisabled?: boolean
  detailsPreferencesKey?: string
  viewPreferencesKey?: string
  onDropItemsToFolder?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerItem, operation: 'move' | 'copy') => void
  onDropItemsToCrumb?: (items: XDriveFileExplorerItem[], target: XDriveFileExplorerCrumb, operation: 'move' | 'copy') => void
  onExternalFilesDrop?: (files: File[], target?: XDriveFileExplorerItem) => void | Promise<void>
  onExternalFilesDropToCrumb?: (files: File[], target: XDriveFileExplorerCrumb) => void | Promise<void>
  onExternalFolderDrop?: (payload: XDriveFileExplorerExternalDropPayload, target?: XDriveFileExplorerItem) => void | Promise<void>
  onExternalFolderDropToCrumb?: (payload: XDriveFileExplorerExternalDropPayload, target: XDriveFileExplorerCrumb) => void | Promise<void>
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
  loadTextPreview?: (item: XDriveFileExplorerItem) => Promise<XDriveFileTextPreview | null | undefined>
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  externallySorted?: boolean
}) {
  const [editingPath, setEditingPath] = useState(false)
  const derivedPath = useMemo(
    () => pathValue ?? crumbs.map((crumb) => crumb.name).join('/'),
    [crumbs, pathValue],
  )
  const [pathDraft, setPathDraft] = useState(derivedPath)
  const [internalViewMode, setInternalViewMode] = useState<XDriveFileExplorerViewMode>('details')
  const [internalSort, setInternalSort] = useState<XDriveFileExplorerSort>(XDRIVE_FILE_EXPLORER_DEFAULT_SORT)
  const [internalSelectedIDs, setInternalSelectedIDs] = useState<XDriveFileExplorerID[]>([...defaultSelectedIDs])
  const [selectionAnchorID, setSelectionAnchorID] = useState<XDriveFileExplorerID | null>(null)
  const [activeItemID, setActiveItemID] = useState<XDriveFileExplorerID | null>(null)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [detailsColumnsAnchor, setDetailsColumnsAnchor] = useState<HTMLElement | null>(null)
  const [viewPreferencesAnchor, setViewPreferencesAnchor] = useState<HTMLElement | null>(null)
  const [draggedDetailsColumn, setDraggedDetailsColumn] = useState<XDriveFileExplorerDetailsColumnKey | null>(null)
  const [detailsColumnDropTarget, setDetailsColumnDropTarget] = useState<XDriveFileExplorerDetailsColumnKey | null>(null)
  const [detailsLayout, setDetailsLayout] = useState<XDriveFileExplorerDetailsLayout>(() => loadFileExplorerDetailsLayout(detailsPreferencesKey))
  const [viewPreferences, setViewPreferences] = useState<XDriveFileExplorerViewPreferences>(() => loadFileExplorerViewPreferences(viewPreferencesKey))
  const detailsResizeRef = useRef<{ key: XDriveFileExplorerDetailsColumnKey; startX: number; startWidth: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number
    mouseY: number
    items: XDriveFileExplorerMenuItem[]
  } | null>(null)
  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameSubmittingRef = useRef(false)
  const renameCancelledRef = useRef(false)
  const itemElementRefs = useRef(new Map<string, HTMLElement>())
  const dragAutoScrollFrameRef = useRef<number | null>(null)
  const dragPointerYRef = useRef<number | null>(null)
  const marqueeSessionRef = useRef<XDriveFileExplorerMarqueeSession | null>(null)
  const suppressBackgroundClickRef = useRef(false)
  const typeSelectRef = useRef({ query: '', updatedAt: 0 })
  const [renamingID, setRenamingID] = useState<XDriveFileExplorerID | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [propertiesItems, setPropertiesItems] = useState<XDriveFileExplorerItem[]>([])
  const [draggedItems, setDraggedItems] = useState<XDriveFileExplorerItem[]>([])
  const [dropTargetID, setDropTargetID] = useState<XDriveFileExplorerID | null>(null)
  const [dropTargetCrumbID, setDropTargetCrumbID] = useState<XDriveFileExplorerID | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<XDriveFileExplorerMarqueeRect | null>(null)

  const viewMode = controlledViewMode ?? internalViewMode
  const sort = controlledSort ?? internalSort
  const detailsRowHeight = viewPreferences.detailsDensity === 'compact'
    ? detailsCompactRowHeight
    : detailsNormalRowHeight
  const gridMetrics = fileExplorerGridMetrics[viewPreferences.gridSize]
  const visibleDetailsColumns = useMemo(
    () => detailsLayout.order.filter((key) => detailsLayout.visible.includes(key)),
    [detailsLayout.order, detailsLayout.visible],
  )
  const detailsGridTemplate = useMemo(
    () => visibleDetailsColumns.map((key) => `${detailsLayout.widths[key]}px`).join(' '),
    [detailsLayout.widths, visibleDetailsColumns],
  )
  const detailsMinWidth = useMemo(
    () => visibleDetailsColumns.reduce((total, key) => total + detailsLayout.widths[key], 0) + 24,
    [detailsLayout.widths, visibleDetailsColumns],
  )
  const selectedIDs = controlledSelectedIDs ?? internalSelectedIDs
  const selectedKeySet = useMemo(
    () => new Set(selectedIDs.map(explorerIDKey)),
    [selectedIDs],
  )

  useEffect(() => {
    if (!editingPath) setPathDraft(derivedPath)
  }, [derivedPath, editingPath])

  useEffect(() => {
    setDetailsLayout(loadFileExplorerDetailsLayout(detailsPreferencesKey))
  }, [detailsPreferencesKey])

  useEffect(() => {
    if (!detailsPreferencesKey || typeof window === 'undefined') return
    window.localStorage.setItem(detailsPreferencesKey, JSON.stringify(detailsLayout))
  }, [detailsLayout, detailsPreferencesKey])

  useEffect(() => {
    setViewPreferences(loadFileExplorerViewPreferences(viewPreferencesKey))
  }, [viewPreferencesKey])

  useEffect(() => {
    if (!viewPreferencesKey || typeof window === 'undefined') return
    window.localStorage.setItem(viewPreferencesKey, JSON.stringify(viewPreferences))
  }, [viewPreferences, viewPreferencesKey])

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
    if (externallySorted) return result
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
  }, [externallySorted, items, sort.direction, sort.key])

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedKeySet.has(explorerIDKey(item.id))),
    [selectedKeySet, visibleItems],
  )
  const activeIndex = useMemo(
    () => activeItemID === null
      ? -1
      : visibleItems.findIndex((item) => explorerIDKey(item.id) === explorerIDKey(activeItemID)),
    [activeItemID, visibleItems],
  )
  const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] : visibleItems[0]

  useEffect(() => {
    if (visibleItems.length === 0) {
      if (activeItemID !== null) setActiveItemID(null)
      return
    }
    if (activeIndex >= 0) return
    const selected = visibleItems.find((item) => selectedKeySet.has(explorerIDKey(item.id)))
    setActiveItemID((selected ?? visibleItems[0]).id)
  }, [activeIndex, activeItemID, selectedKeySet, visibleItems])

  const commitSelection = (ids: XDriveFileExplorerID[]) => {
    if (controlledSelectedIDs === undefined) setInternalSelectedIDs(ids)
    onSelectionChange?.(ids)
  }

  const resetTypeSelect = () => {
    typeSelectRef.current = { query: '', updatedAt: 0 }
  }

  const clearSelection = () => {
    resetTypeSelect()
    setSelectionAnchorID(null)
    commitSelection([])
  }

  const marqueeSelectionIDs = (
    session: XDriveFileExplorerMarqueeSession,
    currentClientX: number,
    currentClientY: number,
    currentContentY: number,
  ) => {
    const selected = new Map(session.baseIDs.map((id) => [explorerIDKey(id), id]))

    if (viewMode === 'details') {
      const top = Math.min(session.startContentY, currentContentY)
      const bottom = Math.max(session.startContentY, currentContentY)
      if (bottom > detailsHeaderHeight && visibleItems.length > 0) {
        const first = Math.max(
          0,
          Math.floor((Math.max(detailsHeaderHeight, top) - detailsHeaderHeight) / detailsRowHeight),
        )
        const last = Math.min(
          visibleItems.length - 1,
          Math.floor((Math.max(detailsHeaderHeight, bottom - 0.001) - detailsHeaderHeight) / detailsRowHeight),
        )
        for (let index = first; index <= last; index += 1) {
          const item = visibleItems[index]
          if (item) selected.set(explorerIDKey(item.id), item.id)
        }
      }
      return [...selected.values()]
    }

    const left = Math.min(session.startClientX, currentClientX)
    const right = Math.max(session.startClientX, currentClientX)
    const top = Math.min(session.startClientY, currentClientY)
    const bottom = Math.max(session.startClientY, currentClientY)
    for (const item of visibleItems) {
      const element = itemElementRefs.current.get(explorerIDKey(item.id))
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
        selected.set(explorerIDKey(item.id), item.id)
      }
    }
    return [...selected.values()]
  }

  const startMarqueeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || renamingID !== null || draggedItems.length > 0) return
    const target = event.target as HTMLElement
    if (target.closest(
      '[data-xdrive-file-explorer-item], button, input, textarea, select, [role="columnheader"], [role="separator"], [data-xdrive-file-explorer-marquee]',
    )) return

    const host = event.currentTarget
    const rect = host.getBoundingClientRect()
    const verticalScrollbar = host.offsetWidth - host.clientWidth
    const horizontalScrollbar = host.offsetHeight - host.clientHeight
    if (verticalScrollbar > 0 && event.clientX >= rect.right - verticalScrollbar) return
    if (horizontalScrollbar > 0 && event.clientY >= rect.bottom - horizontalScrollbar) return

    const additive = event.ctrlKey || event.metaKey
    const contentX = event.clientX - rect.left + host.scrollLeft
    const contentY = event.clientY - rect.top + host.scrollTop
    marqueeSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startContentX: contentX,
      startContentY: contentY,
      baseIDs: additive ? [...selectedIDs] : [],
      moved: false,
    }
    setSelectionAnchorID(null)
    if (!additive) commitSelection([])
    setMarqueeRect({ left: contentX, top: contentY, width: 0, height: 0 })
    host.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const updateMarqueeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = marqueeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const host = event.currentTarget
    const rect = host.getBoundingClientRect()
    const currentContentX = event.clientX - rect.left + host.scrollLeft
    const currentContentY = event.clientY - rect.top + host.scrollTop
    const moved = Math.max(
      Math.abs(event.clientX - session.startClientX),
      Math.abs(event.clientY - session.startClientY),
    ) >= 3
    if (!session.moved && !moved) return
    session.moved = true
    event.preventDefault()
    setMarqueeRect({
      left: Math.min(session.startContentX, currentContentX),
      top: Math.min(session.startContentY, currentContentY),
      width: Math.abs(currentContentX - session.startContentX),
      height: Math.abs(currentContentY - session.startContentY),
    })
    commitSelection(marqueeSelectionIDs(
      session,
      event.clientX,
      event.clientY,
      currentContentY,
    ))
  }

  const finishMarqueeSelection = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const session = marqueeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (cancelled) commitSelection(session.baseIDs)
    if (session.moved && !cancelled) suppressBackgroundClickRef.current = true
    marqueeSessionRef.current = null
    setMarqueeRect(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const scheduleItemFocus = (id: XDriveFileExplorerID) => {
    if (typeof window === 'undefined') return
    let attempts = 0
    const focus = () => {
      const element = itemElementRefs.current.get(explorerIDKey(id))
      if (element) {
        element.focus()
        return
      }
      attempts += 1
      if (attempts < 4) window.requestAnimationFrame(focus)
    }
    window.requestAnimationFrame(focus)
  }

  const focusItemAtIndex = (index: number) => {
    const item = visibleItems[index]
    if (!item) return
    setActiveItemID(item.id)
    const host = scrollHostRef.current
    if (host && viewMode === 'details') {
      const top = detailsHeaderHeight + index * detailsRowHeight
      const bottom = top + detailsRowHeight
      if (top < host.scrollTop + detailsHeaderHeight) {
        host.scrollTop = Math.max(0, top - detailsHeaderHeight)
      } else if (bottom > host.scrollTop + host.clientHeight) {
        host.scrollTop = Math.max(0, bottom - host.clientHeight)
      }
    }
    scheduleItemFocus(item.id)
  }

  const beginRename = (item: XDriveFileExplorerItem) => {
    if (!onRenameItem || renameDisabled || renameSubmitting) return
    resetTypeSelect()
    if (!selectedKeySet.has(explorerIDKey(item.id)) || selectedItems.length !== 1) {
      commitSelection([item.id])
      setSelectionAnchorID(item.id)
    }
    setActiveItemID(item.id)
    renameCancelledRef.current = false
    renameSubmittingRef.current = false
    setRenameDraft(item.name)
    setRenameError('')
    setRenamingID(item.id)
  }

  const cancelRename = (item: XDriveFileExplorerItem) => {
    renameCancelledRef.current = true
    setRenamingID(null)
    setRenameDraft('')
    setRenameError('')
    setRenameSubmitting(false)
    scheduleItemFocus(item.id)
  }

  const submitRename = async (item: XDriveFileExplorerItem) => {
    if (!onRenameItem || renameCancelledRef.current || renameSubmittingRef.current) return
    const normalized = renameDraft.trim()
    if (!normalized) {
      setRenameError('请填写名称')
      renameInputRef.current?.focus()
      return
    }
    if (normalized.length > 255) {
      setRenameError('名称不能超过 255 个字符')
      renameInputRef.current?.focus()
      return
    }
    if (normalized === item.name) {
      setRenamingID(null)
      setRenameError('')
      scheduleItemFocus(item.id)
      return
    }

    renameSubmittingRef.current = true
    setRenameSubmitting(true)
    setRenameError('')
    try {
      await onRenameItem(item, normalized)
      setRenamingID(null)
      setRenameDraft('')
      scheduleItemFocus(item.id)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error))
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          renameInputRef.current?.focus()
        })
      }
    } finally {
      renameSubmittingRef.current = false
      setRenameSubmitting(false)
    }
  }

  useEffect(() => {
    if (renamingID === null || typeof window === 'undefined') return
    const item = visibleItems.find((candidate) => explorerIDKey(candidate.id) === explorerIDKey(renamingID))
    if (!item) return
    window.requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(0, xDriveFileExplorerRenameSelectionEnd(item.name, item.kind))
    })
  }, [renamingID, visibleItems])

  const renderItemName = (item: XDriveFileExplorerItem, grid: boolean) => {
    const renaming = renamingID !== null && explorerIDKey(renamingID) === explorerIDKey(item.id)
    if (renaming) {
      return (
        <TextField
          inputRef={renameInputRef}
          value={renameDraft}
          size="small"
          variant="standard"
          disabled={renameSubmitting}
          error={Boolean(renameError)}
          title={renameError || undefined}
          aria-label={'重命名 ' + item.name}
          slotProps={{ htmlInput: { maxLength: 255, spellCheck: false } }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            setRenameDraft(event.target.value)
            if (renameError) setRenameError('')
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              void submitRename(item)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelRename(item)
            }
          }}
          onBlur={() => {
            if (!renameCancelledRef.current) void submitRename(item)
          }}
          sx={grid ? { width: '100%' } : { minWidth: 120, maxWidth: '100%' }}
        />
      )
    }
    return grid ? (
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
    ) : (
      <Typography variant="body2" noWrap>{item.name}</Typography>
    )
  }

  const selectItem = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
    index: number,
  ) => {
    const itemKey = explorerIDKey(item.id)
    const additive = event.ctrlKey || event.metaKey
    resetTypeSelect()
    setActiveItemID(item.id)

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
    setActiveItemID(item.id)
    if (selectedKeySet.has(key)) {
      commitSelection(selectedIDs.filter((id) => explorerIDKey(id) !== key))
    } else {
      commitSelection([...selectedIDs, item.id])
    }
    setSelectionAnchorID(item.id)
  }

  const openItemContextMenuAt = (
    item: XDriveFileExplorerItem,
    mouseX: number,
    mouseY: number,
  ) => {
    setActiveItemID(item.id)
    if (!selectedKeySet.has(explorerIDKey(item.id))) {
      commitSelection([item.id])
      setSelectionAnchorID(item.id)
    }
    const selection = selectedKeySet.has(explorerIDKey(item.id)) && selectedItems.length > 0
      ? selectedItems
      : [item]
    let actionItems = selection.length > 1 ? [] : (getItemMenuItems?.(item) ?? [])
    if (selection.length === 1 && onRenameItem) {
      const inlineRename: XDriveFileExplorerMenuItem = {
        id: 'rename',
        label: '重命名',
        icon: <EditRoundedIcon fontSize="small" />,
        dividerBefore: true,
        disabled: renameDisabled || renameSubmitting,
        onSelect: () => beginRename(item),
      }
      const renameIndex = actionItems.findIndex((menuItem) => menuItem.id === 'rename')
      if (renameIndex >= 0) {
        actionItems = actionItems.map((menuItem, index) => (
          index === renameIndex ? { ...menuItem, ...inlineRename } : menuItem
        ))
      } else {
        const deleteIndex = actionItems.findIndex((menuItem) => menuItem.id === 'delete')
        actionItems = deleteIndex >= 0
          ? [...actionItems.slice(0, deleteIndex), inlineRename, ...actionItems.slice(deleteIndex)]
          : [...actionItems, inlineRename]
      }
    }
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
    const downloadableSelection = selection.some((candidate) => (
      candidate.kind === 'file' || folderDownloadSupported
    ))
    if (selection.length > 1 && onDownloadItems && downloadableSelection) {
      bulkItems.push({
        id: 'download-selected',
        label: folderDownloadSupported ? '下载所选项目' : '下载所选文件',
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
    const inspectorItems: XDriveFileExplorerMenuItem[] = [{
      id: 'properties',
      label: '属性',
      icon: <InfoOutlinedIcon fontSize="small" />,
      dividerBefore: actionItems.length + clipboardItems.length + bulkItems.length > 0,
      onSelect: () => setPropertiesItems(selection),
    }]
    const menuItems = [...actionItems, ...clipboardItems, ...bulkItems, ...inspectorItems]
    if (menuItems.length === 0) return
    setContextMenu({
      mouseX,
      mouseY,
      items: menuItems,
    })
  }

  const openItemContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    openItemContextMenuAt(item, event.clientX + 2, event.clientY - 6)
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

  const stopDragAutoScroll = () => {
    dragPointerYRef.current = null
    if (dragAutoScrollFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current)
    }
    dragAutoScrollFrameRef.current = null
  }

  const runDragAutoScroll = () => {
    dragAutoScrollFrameRef.current = null
    const host = scrollHostRef.current
    const pointerY = dragPointerYRef.current
    if (!host || pointerY === null || typeof window === 'undefined') return
    const rect = host.getBoundingClientRect()
    const delta = xDriveFileExplorerDragAutoScrollDelta(pointerY, rect.top, rect.bottom)
    if (delta === 0) return
    host.scrollTop += delta
    dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll)
  }

  const updateDragAutoScroll = (clientY: number) => {
    dragPointerYRef.current = clientY
    if (dragAutoScrollFrameRef.current === null && typeof window !== 'undefined') {
      dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScroll)
    }
  }

  useEffect(() => () => {
    if (dragAutoScrollFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current)
    }
  }, [])

  const startItemDrag = (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (!onDropItemsToFolder || (renamingID !== null && explorerIDKey(renamingID) === explorerIDKey(item.id))) return
    setActiveItemID(item.id)
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
    setFileExplorerDragImage(event, selection)
  }

  const endItemDrag = () => {
    stopDragAutoScroll()
    setDraggedItems([])
    setDropTargetID(null)
    setDropTargetCrumbID(null)
  }

  const dragOverFolder = (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    const external = event.dataTransfer.types.includes('Files') && Boolean(onExternalFilesDrop || onExternalFolderDrop)
    const internal = draggedItems.length > 0
    if (item.kind !== 'dir' || (!external && !internal)) return
    if (internal && draggedItems.some((candidate) => explorerIDKey(candidate.id) === explorerIDKey(item.id))) return
    event.preventDefault()
    event.stopPropagation()
    updateDragAutoScroll(event.clientY)
    event.dataTransfer.dropEffect = internal && (event.ctrlKey || event.metaKey) ? 'copy' : external ? 'copy' : 'move'
    setDropTargetID(item.id)
  }

  const dropOnFolder = async (event: ReactDragEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (item.kind !== 'dir') return
    event.preventDefault()
    event.stopPropagation()
    const dataTransfer = event.dataTransfer
    const files = Array.from(dataTransfer.files)
    try {
      if (dataTransfer.types.includes('Files') && onExternalFolderDrop) {
        const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
        if (payload.directories.length > 0) {
          await onExternalFolderDrop(payload, item)
          return
        }
      }
      if (files.length > 0 && onExternalFilesDrop) {
        await onExternalFilesDrop(files, item)
        return
      }
      if (draggedItems.length > 0 && onDropItemsToFolder) {
        const operation = event.ctrlKey || event.metaKey ? 'copy' : 'move'
        onDropItemsToFolder(draggedItems, item, operation)
      }
    } finally {
      endItemDrag()
    }
  }

  const dragOverCrumb = (
    event: ReactDragEvent<HTMLElement>,
    crumb: XDriveFileExplorerCrumb,
  ) => {
    const external = event.dataTransfer.types.includes('Files') && Boolean(onExternalFilesDropToCrumb || onExternalFolderDropToCrumb)
    const internal = draggedItems.length > 0 && Boolean(onDropItemsToCrumb)
    if (!external && !internal) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = internal && (event.ctrlKey || event.metaKey) ? 'copy' : external ? 'copy' : 'move'
    setDropTargetCrumbID(crumb.id)
  }

  const dropOnCrumb = async (
    event: ReactDragEvent<HTMLElement>,
    crumb: XDriveFileExplorerCrumb,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const dataTransfer = event.dataTransfer
    const files = Array.from(dataTransfer.files)
    try {
      if (dataTransfer.types.includes('Files') && onExternalFolderDropToCrumb) {
        const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
        if (payload.directories.length > 0) {
          await onExternalFolderDropToCrumb(payload, crumb)
          return
        }
      }
      if (files.length > 0 && onExternalFilesDropToCrumb) {
        await onExternalFilesDropToCrumb(files, crumb)
        return
      }
      if (draggedItems.length > 0 && onDropItemsToCrumb) {
        const operation = event.ctrlKey || event.metaKey ? 'copy' : 'move'
        onDropItemsToCrumb(draggedItems, crumb, operation)
      }
    } finally {
      endItemDrag()
    }
  }

  const dropExternalFilesOnBackground = async (event: ReactDragEvent<HTMLElement>) => {
    if (!(onExternalFilesDrop || onExternalFolderDrop) || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    const dataTransfer = event.dataTransfer
    const files = Array.from(dataTransfer.files)
    try {
      if (onExternalFolderDrop) {
        const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
        if (payload.directories.length > 0) {
          await onExternalFolderDrop(payload)
          return
        }
      }
      if (files.length > 0 && onExternalFilesDrop) await onExternalFilesDrop(files)
    } finally {
      endItemDrag()
    }
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

  const chooseDetailsDensity = (detailsDensity: XDriveFileExplorerDetailsDensity) => {
    setViewPreferences((current) => ({ ...current, detailsDensity }))
    setViewMode('details')
    setViewPreferencesAnchor(null)
  }

  const chooseGridSize = (gridSize: XDriveFileExplorerGridSize) => {
    setViewPreferences((current) => ({ ...current, gridSize }))
    setViewMode('grid')
    setViewPreferencesAnchor(null)
  }

  const handleViewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (viewMode !== 'grid' || !(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
    event.preventDefault()
    const direction: -1 | 1 = event.deltaY < 0 ? 1 : -1
    setViewPreferences((current) => ({
      ...current,
      gridSize: xDriveFileExplorerNextGridSize(current.gridSize, direction),
    }))
  }

  const commitDetailsLayout = (next: XDriveFileExplorerDetailsLayout) => {
    setDetailsLayout(xDriveNormalizeFileExplorerDetailsLayout(next))
  }

  const toggleDetailsColumn = (key: XDriveFileExplorerDetailsColumnKey) => {
    if (key === 'name') return
    const visible = detailsLayout.visible.includes(key)
      ? detailsLayout.visible.filter((candidate) => candidate !== key)
      : detailsLayout.order.filter((candidate) => candidate === 'name' || detailsLayout.visible.includes(candidate) || candidate === key)
    commitDetailsLayout({ ...detailsLayout, visible })
  }

  const reorderDetailsColumn = (
    source: XDriveFileExplorerDetailsColumnKey,
    target: XDriveFileExplorerDetailsColumnKey,
  ) => {
    if (source === target) return
    const next = detailsLayout.order.filter((key) => key !== source)
    const targetIndex = next.indexOf(target)
    if (targetIndex < 0) return
    next.splice(targetIndex, 0, source)
    commitDetailsLayout({ ...detailsLayout, order: next })
  }

  const startDetailsColumnDrag = (
    event: ReactDragEvent<HTMLElement>,
    key: XDriveFileExplorerDetailsColumnKey,
  ) => {
    setDraggedDetailsColumn(key)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-xdrive-details-column', key)
  }

  const dragOverDetailsColumn = (
    event: ReactDragEvent<HTMLElement>,
    key: XDriveFileExplorerDetailsColumnKey,
  ) => {
    if (!draggedDetailsColumn || draggedDetailsColumn === key) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDetailsColumnDropTarget(key)
  }

  const dropDetailsColumn = (
    event: ReactDragEvent<HTMLElement>,
    key: XDriveFileExplorerDetailsColumnKey,
  ) => {
    if (!draggedDetailsColumn) return
    event.preventDefault()
    event.stopPropagation()
    reorderDetailsColumn(draggedDetailsColumn, key)
    setDraggedDetailsColumn(null)
    setDetailsColumnDropTarget(null)
  }

  const endDetailsColumnDrag = () => {
    setDraggedDetailsColumn(null)
    setDetailsColumnDropTarget(null)
  }

  const startDetailsColumnResize = (event: ReactPointerEvent<HTMLElement>, key: XDriveFileExplorerDetailsColumnKey) => {
    event.preventDefault()
    event.stopPropagation()
    detailsResizeRef.current = { key, startX: event.clientX, startWidth: detailsLayout.widths[key] }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDetailsColumnResize = (event: ReactPointerEvent<HTMLElement>, key: XDriveFileExplorerDetailsColumnKey) => {
    const state = detailsResizeRef.current
    if (!state || state.key !== key) return
    const meta = detailsColumnMeta[key]
    const width = Math.round(Math.max(meta.minWidth, Math.min(meta.maxWidth, state.startWidth + event.clientX - state.startX)))
    if (width !== detailsLayout.widths[key]) {
      commitDetailsLayout({ ...detailsLayout, widths: { ...detailsLayout.widths, [key]: width } })
    }
  }

  const endDetailsColumnResize = (event: ReactPointerEvent<HTMLElement>) => {
    detailsResizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
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

  const detailsColumnText = (
    item: XDriveFileExplorerItem,
    key: XDriveFileExplorerDetailsColumnKey,
  ) => {
    if (key === 'name') return item.name
    if (key === 'updated') return item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'
    if (key === 'type') return defaultTypeLabel(item)
    return item.kind === 'dir' ? '—' : formatSize(item.size ?? 0)
  }

  const estimatedTextWidth = (value: string) => {
    let units = 0
    for (const character of value) {
      units += character.codePointAt(0)! > 0xff ? 2 : 1
    }
    return units * 7
  }

  const autoFitDetailsColumnWidth = (key: XDriveFileExplorerDetailsColumnKey) => {
    const meta = detailsColumnMeta[key]
    let contentWidth = estimatedTextWidth(meta.label) + 34
    for (const item of visibleItems.slice(0, 2000)) {
      const allowance = key === 'name' ? 52 : 28
      contentWidth = Math.max(contentWidth, estimatedTextWidth(detailsColumnText(item, key)) + allowance)
    }
    return Math.round(Math.max(meta.minWidth, Math.min(meta.maxWidth, contentWidth)))
  }

  const autoFitDetailsColumn = (key: XDriveFileExplorerDetailsColumnKey) => {
    commitDetailsLayout({
      ...detailsLayout,
      widths: { ...detailsLayout.widths, [key]: autoFitDetailsColumnWidth(key) },
    })
  }

  const autoFitAllDetailsColumns = () => {
    const widths = { ...detailsLayout.widths }
    for (const key of detailsLayout.order) widths[key] = autoFitDetailsColumnWidth(key)
    commitDetailsLayout({ ...detailsLayout, widths })
    setDetailsColumnsAnchor(null)
  }

  const defaultItemIcon = (item: XDriveFileExplorerItem, large = false) => {
    if (item.icon) return item.icon
    const fontSize = large ? gridMetrics.iconSize : 21
    const fileKind = item.fileKind ?? xDriveFileKind(item.name, item.kind)
    if (fileKind === 'folder') return <FolderRoundedIcon sx={{ fontSize: large ? gridMetrics.folderIconSize : 22, color: xDriveWindowsFolderYellow }} />
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

  const gridColumnCount = () => {
    if (viewMode !== 'grid') return 1
    const elements = visibleItems
      .map((item) => itemElementRefs.current.get(explorerIDKey(item.id)))
      .filter((element): element is HTMLElement => Boolean(element))
    if (elements.length < 2) return 1
    const firstTop = elements[0].offsetTop
    let columns = 0
    for (const element of elements) {
      if (Math.abs(element.offsetTop - firstTop) > 2) break
      columns += 1
    }
    return Math.max(1, columns)
  }

  const moveKeyboardFocus = (
    event: KeyboardEvent<HTMLElement>,
    item: XDriveFileExplorerItem,
  ) => {
    const currentIndex = visibleItems.findIndex((candidate) => explorerIDKey(candidate.id) === explorerIDKey(item.id))
    if (currentIndex < 0) return false
    const columns = gridColumnCount()
    const visibleRows = Math.max(
      1,
      Math.floor(Math.max(viewportHeight, gridMetrics.estimatedRowHeight) / (
        viewMode === 'details' ? detailsRowHeight : gridMetrics.estimatedRowHeight
      )),
    )
    const pageSize = viewMode === 'details' ? visibleRows : visibleRows * columns
    const targetIndex = xDriveFileExplorerKeyboardTargetIndex({
      key: event.key as XDriveFileExplorerKeyboardNavigationKey,
      currentIndex,
      itemCount: visibleItems.length,
      viewMode,
      gridColumns: columns,
      pageSize,
    })
    if (targetIndex === null) return false
    event.preventDefault()
    event.stopPropagation()
    resetTypeSelect()
    if (targetIndex === currentIndex) return true
    const target = visibleItems[targetIndex]

    const modifier = event.ctrlKey || event.metaKey
    if (event.shiftKey) {
      const anchorID = selectionAnchorID ?? item.id
      if (selectionAnchorID === null) setSelectionAnchorID(anchorID)
      const anchorIndex = visibleItems.findIndex((candidate) => explorerIDKey(candidate.id) === explorerIDKey(anchorID))
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        const range = visibleItems.slice(start, end + 1).map((candidate) => candidate.id)
        if (modifier) {
          const merged = new Map(selectedIDs.map((id) => [explorerIDKey(id), id]))
          for (const id of range) merged.set(explorerIDKey(id), id)
          commitSelection([...merged.values()])
        } else {
          commitSelection(range)
        }
      }
    } else if (!modifier) {
      commitSelection([target.id])
      setSelectionAnchorID(target.id)
    }

    setActiveItemID(target.id)
    onItemClick?.(target)
    focusItemAtIndex(targetIndex)
    return true
  }

  const itemKeyDown = (event: KeyboardEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      setPropertiesItems([item])
      return
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      if (moveKeyboardFocus(event, item)) return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onOpenItem?.(item)
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      toggleKeyboardSelection(item)
    }
  }

  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || Boolean(target.closest('input, textarea, select, [role="textbox"]'))
  }

  const typeSelectFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing ||
      event.key === ' ' ||
      Array.from(event.key).length !== 1
    ) {
      return false
    }

    const now = Date.now()
    const previous = now - typeSelectRef.current.updatedAt <= XDRIVE_FILE_EXPLORER_TYPE_SELECT_TIMEOUT_MS
      ? typeSelectRef.current.query
      : ''
    const typed = event.key.normalize('NFKC')
    const repeatedSingleKey =
      Array.from(previous).length === 1 &&
      previous.normalize('NFKC').toLocaleLowerCase() === typed.toLocaleLowerCase()
    const query = repeatedSingleKey ? typed : previous + typed
    typeSelectRef.current = { query, updatedAt: now }

    const targetIndex = xDriveFileExplorerTypeSelectTargetIndex({
      names: visibleItems.map((item) => item.name),
      currentIndex: activeIndex,
      query,
      cycle: repeatedSingleKey,
    })
    event.preventDefault()
    event.stopPropagation()
    if (targetIndex === null) return true

    const target = visibleItems[targetIndex]
    commitSelection([target.id])
    setSelectionAnchorID(target.id)
    setActiveItemID(target.id)
    onItemClick?.(target)
    focusItemAtIndex(targetIndex)
    return true
  }

  const handleExplorerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (event.altKey && event.key === 'ArrowLeft' && canGoBack && onBack) {
      event.preventDefault()
      onBack()
      return
    }
    if (event.altKey && event.key === 'ArrowRight' && canGoForward && onForward) {
      event.preventDefault()
      onForward()
      return
    }
    if (event.altKey && event.key === 'ArrowUp' && canGoUp && onUp) {
      event.preventDefault()
      onUp()
      return
    }
    if ((modifier && key === 'l') || (event.altKey && key === 'd') || event.key === 'F4') {
      if (!onPathSubmit) return
      event.preventDefault()
      setPathDraft(derivedPath)
      setEditingPath(true)
      return
    }
    if ((modifier && (key === 'f' || key === 'e')) || event.key === 'F3') {
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      return
    }
    if ((event.key === 'F5' || (modifier && key === 'r')) && onRefresh) {
      event.preventDefault()
      onRefresh()
      return
    }
    if (modifier && event.shiftKey && key === 'n' && onCreateFolder) {
      event.preventDefault()
      onCreateFolder()
      return
    }
    if (event.altKey && key === 'p') {
      event.preventDefault()
      setInspectorOpen((open) => !open)
      return
    }

    if (isEditableTarget(event.target)) return
    if (typeSelectFromKeyboard(event)) return

    const navigationKeys: XDriveFileExplorerKeyboardNavigationKey[] = [
      'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
      ...(viewMode === 'grid' ? ['ArrowLeft', 'ArrowRight'] as const : []),
    ]
    if (activeItem && navigationKeys.includes(event.key as XDriveFileExplorerKeyboardNavigationKey)) {
      if (moveKeyboardFocus(event, activeItem)) return
    }

    if (event.key === 'Backspace' && canGoBack && onBack) {
      event.preventDefault()
      onBack()
      return
    }
    if (event.key === 'F2' && activeItem && onRenameItem && !renameDisabled) {
      event.preventDefault()
      beginRename(activeItem)
      return
    }
    if (event.shiftKey && event.key === 'F10' && activeItem) {
      event.preventDefault()
      const element = itemElementRefs.current.get(explorerIDKey(activeItem.id))
      const rect = element?.getBoundingClientRect()
      openItemContextMenuAt(
        activeItem,
        (rect?.left ?? 12) + 12,
        (rect?.top ?? 12) + 24,
      )
      return
    }
    if (modifier && key === 'a') {
      event.preventDefault()
      commitSelection(visibleItems.map((candidate) => candidate.id))
      if (activeItemID === null && visibleItems[0]) setActiveItemID(visibleItems[0].id)
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
  }

  const propertiesForItem = (item: XDriveFileExplorerItem) => [
    { label: '类型', value: defaultTypeLabel(item) },
    { label: '大小', value: item.kind === 'dir' ? '—' : formatSize(item.size ?? 0) },
    { label: '修改时间', value: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—' },
    { label: '位置', value: item.path || item.secondaryLabel || derivedPath },
    ...(item.properties ?? []),
    { label: 'Revision', value: item.revision ?? '—', technical: true },
    { label: 'ID', value: String(item.id), technical: true },
  ] satisfies XDriveFileExplorerProperty[]

  const inspectorItem = selectedItems.length === 1 ? selectedItems[0] : null
  const inspectorFileCount = selectedItems.filter((item) => item.kind === 'file').length
  const inspectorFolderCount = selectedItems.length - inspectorFileCount
  const inspectorProperties = inspectorItem ? propertiesForItem(inspectorItem) : []

  const propertiesDialogItem = propertiesItems.length === 1 ? propertiesItems[0] : null
  const propertiesDialogFileCount = propertiesItems.filter((item) => item.kind === 'file').length
  const propertiesDialogFolderCount = propertiesItems.length - propertiesDialogFileCount
  const propertiesDialogSize = propertiesItems.reduce((total, item) => (
    item.kind === 'file' ? total + (item.size ?? 0) : total
  ), 0)
  const propertiesDialogProperties = propertiesDialogItem
    ? propertiesForItem(propertiesDialogItem)
    : propertiesItems.length > 1
      ? [
          { label: '项目数', value: `${propertiesItems.length} 个` },
          { label: '内容', value: `${propertiesDialogFileCount} 个文件 · ${propertiesDialogFolderCount} 个文件夹` },
          { label: '文件大小合计', value: formatSize(propertiesDialogSize) },
          { label: '位置', value: derivedPath },
        ] satisfies XDriveFileExplorerProperty[]
      : []
  const propertiesDialogTitle = propertiesDialogItem
    ? `属性 — ${propertiesDialogItem.name}`
    : '所选项目属性'
  const propertiesDialogPreview = propertiesDialogItem
    ? thumbnailForItem(propertiesDialogItem)
    : propertiesItems.length > 1
      ? <InsertDriveFileRoundedIcon color="action" sx={{ fontSize: 64 }} />
      : undefined

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
    const host = event.currentTarget
    if (virtualizeDetails) setScrollTop(host.scrollTop)
    if (
      hasMore &&
      !loadingMore &&
      onLoadMore &&
      host.scrollHeight - host.scrollTop - host.clientHeight <= 500
    ) {
      onLoadMore()
    }
  }

  return (
    <Paper
      variant={presentation === 'workspace' ? 'elevation' : 'outlined'}
      onKeyDown={handleExplorerKeyDown}
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
              onFocus={(event) => event.currentTarget.select()}
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
                    aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (index !== crumbs.length - 1) onCrumbClick?.(crumb, index)
                    }}
                    onDragOver={(event) => dragOverCrumb(event, crumb)}
                    onDragLeave={(event) => {
                      const related = event.relatedTarget
                      if (!(related instanceof HTMLElement) || !event.currentTarget.contains(related)) {
                        if (dropTargetCrumbID !== null && explorerIDKey(dropTargetCrumbID) === explorerIDKey(crumb.id)) {
                          setDropTargetCrumbID(null)
                        }
                      }
                    }}
                    onDrop={(event) => dropOnCrumb(event, crumb)}
                    sx={{
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 1,
                      maxWidth: 180,
                      color: index === crumbs.length - 1 ? 'text.primary' : 'text.secondary',
                      fontSize: 13,
                      justifyContent: 'flex-start',
                      cursor: index === crumbs.length - 1 ? 'default' : 'pointer',
                      bgcolor: dropTargetCrumbID !== null && explorerIDKey(dropTargetCrumbID) === explorerIDKey(crumb.id)
                        ? 'action.hover'
                        : 'transparent',
                      outline: dropTargetCrumbID !== null && explorerIDKey(dropTargetCrumbID) === explorerIDKey(crumb.id)
                        ? '2px solid'
                        : undefined,
                      outlineColor: 'primary.main',
                      outlineOffset: -2,
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
          inputRef={searchInputRef}
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
        {selectedItems.length > 0 ? (
          <>
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{ px: 0.5, whiteSpace: 'nowrap' }}
            >
              已选择 {selectedItems.length} 项
            </Typography>
            {onCutItems ? (
              <XDriveFileExplorerCommandButton
                startIcon={<ContentCutRoundedIcon />}
                onClick={() => onCutItems(selectedItems)}
              >
                剪切
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onCopyItems ? (
              <XDriveFileExplorerCommandButton
                startIcon={<ContentCopyRoundedIcon />}
                onClick={() => onCopyItems(selectedItems)}
              >
                复制
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onDownloadItems && selectedItems.some((item) => (
              item.kind === 'file' || folderDownloadSupported
            )) ? (
              <XDriveFileExplorerCommandButton
                startIcon={<DownloadRoundedIcon />}
                onClick={() => onDownloadItems(selectedItems)}
              >
                下载
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onDeleteItems ? (
              <XDriveFileExplorerCommandButton
                startIcon={<DeleteOutlineRoundedIcon />}
                onClick={() => onDeleteItems(selectedItems)}
                sx={{ color: 'error.main' }}
              >
                删除
              </XDriveFileExplorerCommandButton>
            ) : null}
            <XDriveFileExplorerCommandButton
              startIcon={<CloseRoundedIcon />}
              onClick={clearSelection}
            >
              取消选择
            </XDriveFileExplorerCommandButton>
          </>
        ) : (
          <>
            {onPaste ? (
              <XDriveFileExplorerCommandButton
                startIcon={<ContentPasteRoundedIcon />}
                disabled={!canPaste}
                onClick={onPaste}
              >
                粘贴
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onCreateFolder ? (
              <XDriveFileExplorerCommandButton startIcon={<CreateNewFolderRoundedIcon />} onClick={onCreateFolder}>
                新建文件夹
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onUpload ? (
              <XDriveFileExplorerCommandButton startIcon={<UploadRoundedIcon />} onClick={onUpload}>
                上传文件
              </XDriveFileExplorerCommandButton>
            ) : null}
            {onUploadFolder ? (
              <XDriveFileExplorerCommandButton startIcon={<DriveFolderUploadRoundedIcon />} onClick={onUploadFolder}>
                上传文件夹
              </XDriveFileExplorerCommandButton>
            ) : null}
            {commandBarStart}
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {commandBarEnd}

        <XDriveFileExplorerCommandButton
          startIcon={<InfoOutlinedIcon />}
          aria-pressed={inspectorOpen}
          onClick={() => setInspectorOpen((open) => !open)}
        >
          详细信息
        </XDriveFileExplorerCommandButton>

        <XDriveFileExplorerCommandButton
          startIcon={<GridViewRoundedIcon />}
          onClick={(event) => setViewPreferencesAnchor(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(viewPreferencesAnchor)}
        >
          视图
        </XDriveFileExplorerCommandButton>
        <Menu
          anchorEl={viewPreferencesAnchor}
          open={Boolean(viewPreferencesAnchor)}
          onClose={() => setViewPreferencesAnchor(null)}
        >
          <MenuItem
            selected={viewMode === 'details' && viewPreferences.detailsDensity === 'normal'}
            onClick={() => chooseDetailsDensity('normal')}
          >
            详细信息
          </MenuItem>
          <MenuItem
            selected={viewMode === 'details' && viewPreferences.detailsDensity === 'compact'}
            onClick={() => chooseDetailsDensity('compact')}
          >
            紧凑详细信息
          </MenuItem>
          <Divider />
          <MenuItem
            selected={viewMode === 'grid' && viewPreferences.gridSize === 'small'}
            onClick={() => chooseGridSize('small')}
          >
            小图标
          </MenuItem>
          <MenuItem
            selected={viewMode === 'grid' && viewPreferences.gridSize === 'medium'}
            onClick={() => chooseGridSize('medium')}
          >
            中图标
          </MenuItem>
          <MenuItem
            selected={viewMode === 'grid' && viewPreferences.gridSize === 'large'}
            onClick={() => chooseGridSize('large')}
          >
            大图标
          </MenuItem>
          <Divider />
          <MenuItem disabled sx={{ fontSize: 12 }}>
            Grid 模式可用 Ctrl + 滚轮缩放
          </MenuItem>
        </Menu>

        {viewMode === 'details' ? (
          <XDriveFileExplorerCommandButton
            startIcon={<ViewColumnRoundedIcon />}
            onClick={(event) => setDetailsColumnsAnchor(event.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={Boolean(detailsColumnsAnchor)}
          >
            列
          </XDriveFileExplorerCommandButton>
        ) : null}
        <Menu anchorEl={detailsColumnsAnchor} open={Boolean(detailsColumnsAnchor)} onClose={() => setDetailsColumnsAnchor(null)}>
          {detailsLayout.order.map((key) => (
            <MenuItem key={key} disabled={key === 'name'} onClick={() => toggleDetailsColumn(key)}>
              <Box component="span" sx={{ width: 20, color: 'text.secondary' }}>
                {detailsLayout.visible.includes(key) ? '✓' : ''}
              </Box>
              {detailsColumnMeta[key].label}
            </MenuItem>
          ))}
          <Divider />
          <MenuItem onClick={autoFitAllDetailsColumns}>自动调整列宽</MenuItem>
          <MenuItem onClick={() => commitDetailsLayout(xDriveDefaultFileExplorerDetailsLayout())}>重置列</MenuItem>
        </Menu>

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

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Box
        ref={scrollHostRef}
        sx={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'auto',
          userSelect: marqueeRect ? 'none' : undefined,
        }}
        tabIndex={visibleItems.length === 0 ? 0 : -1}
        onScroll={handleScroll}
        onWheel={handleViewWheel}
        onPointerDown={startMarqueeSelection}
        onPointerMove={updateMarqueeSelection}
        onPointerUp={(event) => finishMarqueeSelection(event)}
        onPointerCancel={(event) => finishMarqueeSelection(event, true)}
        onClick={(event) => {
          if (suppressBackgroundClickRef.current) {
            suppressBackgroundClickRef.current = false
            return
          }
          const target = event.target as HTMLElement
          if (!target.closest('[data-xdrive-file-explorer-item]')) {
            clearSelection()
            scrollHostRef.current?.focus()
          }
        }}
        onContextMenu={openBackgroundContextMenu}
        onDragOver={(event) => {
          const external = Boolean(onExternalFilesDrop || onExternalFolderDrop) && event.dataTransfer.types.includes('Files')
          const internal = draggedItems.length > 0
          if (external || internal) updateDragAutoScroll(event.clientY)
          if (external) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget
          if (!(related instanceof HTMLElement) || !event.currentTarget.contains(related)) {
            stopDragAutoScroll()
          }
        }}
        onDrop={dropExternalFilesOnBackground}
      >
        {loading && visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" loading message="正在加载文件…" />
        ) : visibleItems.length === 0 ? (
          <XDriveStatePanel variant="plain" message={emptyMessage} />
        ) : viewMode === 'details' ? (
          <Box role="table" aria-label="文件列表" sx={{ minWidth: detailsMinWidth }}>
            <Box
              role="row"
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                display: 'grid',
                gridTemplateColumns: detailsGridTemplate,
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
              {visibleDetailsColumns.map((key) => (
                <Box
                  key={key}
                  role="columnheader"
                  onDragOver={(event) => dragOverDetailsColumn(event, key)}
                  onDragLeave={(event) => {
                    const related = event.relatedTarget
                    if (!(related instanceof HTMLElement) || !event.currentTarget.contains(related)) {
                      if (detailsColumnDropTarget === key) setDetailsColumnDropTarget(null)
                    }
                  }}
                  onDrop={(event) => dropDetailsColumn(event, key)}
                  sx={{
                    position: 'relative',
                    minWidth: 0,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    bgcolor: detailsColumnDropTarget === key ? 'action.hover' : 'transparent',
                  }}
                >
                  <ButtonBase
                    draggable
                    aria-grabbed={draggedDetailsColumn === key}
                    onDragStart={(event) => startDetailsColumnDrag(event, key)}
                    onDragEnd={endDetailsColumnDrag}
                    aria-label={`按${detailsColumnMeta[key].label}排序`}
                    onClick={() => setSort({
                      key,
                      direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
                    })}
                    sx={{ minWidth: 0, flex: 1, height: '100%', justifyContent: 'flex-start', pr: 1.5, fontSize: 12, color: 'inherit' }}
                  >
                    <Typography component="span" variant="caption" noWrap color="inherit">
                      {detailsColumnMeta[key].label}{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                    </Typography>
                  </ButtonBase>
                  <Box
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`调整${detailsColumnMeta[key].label}列宽`}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      autoFitDetailsColumn(key)
                    }}
                    onPointerDown={(event) => startDetailsColumnResize(event, key)}
                    onPointerMove={(event) => moveDetailsColumnResize(event, key)}
                    onPointerUp={endDetailsColumnResize}
                    onPointerCancel={endDetailsColumnResize}
                    sx={{
                      position: 'absolute',
                      right: -4,
                      top: 4,
                      bottom: 4,
                      width: 8,
                      cursor: 'col-resize',
                      zIndex: 2,
                      touchAction: 'none',
                      '&:hover::after': {
                        content: '""',
                        position: 'absolute',
                        left: '3px',
                        top: 0,
                        bottom: 0,
                        borderLeft: 1,
                        borderColor: 'primary.main',
                      },
                    }}
                  />
                </Box>
              ))}
            </Box>
            {virtualizeDetails && detailsWindow.before > 0 ? (
              <Box role="presentation" aria-hidden sx={{ height: detailsWindow.before }} />
            ) : null}
            {detailItems.map((item, windowIndex) => {
              const index = virtualizeDetails ? detailsWindow.start + windowIndex : windowIndex
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              const active = activeItemID === null ? index === 0 : explorerIDKey(activeItemID) === explorerIDKey(item.id)
              const renaming = renamingID !== null && explorerIDKey(renamingID) === explorerIDKey(item.id)
              return (
              <ButtonBase
                key={item.id}
                ref={(element) => {
                  const key = explorerIDKey(item.id)
                  if (element) itemElementRefs.current.set(key, element)
                  else itemElementRefs.current.delete(key)
                }}
                component="div"
                role="row"
                data-xdrive-file-explorer-item
                tabIndex={active ? 0 : -1}
                aria-selected={selected}
                draggable={Boolean(onDropItemsToFolder) && !renaming}
                onDragStart={(event) => startItemDrag(event, item)}
                onDragEnd={endItemDrag}
                onDragOver={(event) => dragOverFolder(event, item)}
                onDragLeave={() => {
                  if (dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)) setDropTargetID(null)
                }}
                onDrop={(event) => dropOnFolder(event, item)}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => {
                  if (!renaming) onOpenItem?.(item)
                }}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onFocus={() => setActiveItemID(item.id)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: detailsGridTemplate,
                  minHeight: detailsRowHeight,
                  alignItems: 'center',
                  justifyContent: 'start',
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
                {visibleDetailsColumns.map((key) => (
                  <Box key={key} role="cell" sx={{ minWidth: 0, overflow: 'hidden' }}>
                    {key === 'name' ? (
                      <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
                        {defaultItemIcon(item)}
                        <Box sx={{ minWidth: 0 }}>
                          {renderItemName(item, false)}
                          {viewPreferences.detailsDensity === 'normal' && item.secondaryLabel ? (
                            <Typography variant="caption" color="text.secondary" noWrap display="block">
                              {item.secondaryLabel}
                            </Typography>
                          ) : null}
                        </Box>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {detailsColumnText(item, key)}
                      </Typography>
                    )}
                  </Box>
                ))}
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
              gridTemplateColumns: `repeat(auto-fill, minmax(${gridMetrics.minColumnWidth}px, 1fr))`,
              gap: gridMetrics.gap,
              p: gridMetrics.padding,
              alignContent: 'start',
            }}
          >
            {visibleItems.map((item, index) => {
              const selected = selectedKeySet.has(explorerIDKey(item.id))
              const active = activeItemID === null ? index === 0 : explorerIDKey(activeItemID) === explorerIDKey(item.id)
              const renaming = renamingID !== null && explorerIDKey(renamingID) === explorerIDKey(item.id)
              return (
              <ButtonBase
                key={item.id}
                ref={(element) => {
                  const key = explorerIDKey(item.id)
                  if (element) itemElementRefs.current.set(key, element)
                  else itemElementRefs.current.delete(key)
                }}
                component="div"
                role="listitem"
                data-xdrive-file-explorer-item
                tabIndex={active ? 0 : -1}
                aria-selected={selected}
                draggable={Boolean(onDropItemsToFolder) && !renaming}
                onDragStart={(event) => startItemDrag(event, item)}
                onDragEnd={endItemDrag}
                onDragOver={(event) => dragOverFolder(event, item)}
                onDragLeave={() => {
                  if (dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)) setDropTargetID(null)
                }}
                onDrop={(event) => dropOnFolder(event, item)}
                onClick={(event) => selectItem(event, item, index)}
                onDoubleClick={() => {
                  if (!renaming) onOpenItem?.(item)
                }}
                onContextMenu={(event) => openItemContextMenu(event, item)}
                onFocus={() => setActiveItemID(item.id)}
                onKeyDown={(event) => itemKeyDown(event, item)}
                sx={{
                  minWidth: 0,
                  minHeight: gridMetrics.minItemHeight,
                  maxWidth: gridMetrics.maxItemWidth,
                  borderRadius: 1,
                  p: gridMetrics.itemPadding,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  gap: gridMetrics.itemGap,
                  textAlign: 'center',
                  bgcolor: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id)
                    ? 'action.hover'
                    : selected ? 'action.selected' : 'transparent',
                  outline: dropTargetID !== null && explorerIDKey(dropTargetID) === explorerIDKey(item.id) ? '2px solid' : undefined,
                  outlineColor: 'primary.main',
                  outlineOffset: -2,
                  contentVisibility: 'auto',
                  containIntrinsicSize: `${gridMetrics.maxItemWidth}px ${gridMetrics.estimatedRowHeight}px`,
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
                    width: gridMetrics.thumbnailWidth,
                    height: gridMetrics.thumbnailHeight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    borderRadius: 1,
                  }}
                >
                  {thumbnailForItem(item)}
                </Box>
                {renderItemName(item, true)}
              </ButtonBase>
              )
            })}
          </Box>
        )}

        {marqueeRect ? (
          <Box
            data-xdrive-file-explorer-marquee
            aria-hidden
            sx={{
              position: 'absolute',
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
              border: '1px solid',
              borderColor: 'primary.main',
              bgcolor: 'action.selected',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          />
        ) : null}

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
      {inspectorOpen ? (
        <>
          <Divider orientation="vertical" flexItem />
          <Box
            data-xdrive-file-explorer-inspector
            aria-label="文件详细信息"
            sx={{
              width: 'clamp(248px, 27vw, 328px)',
              flexShrink: 0,
              minHeight: 0,
              overflowY: 'auto',
              bgcolor: 'background.paper',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 40, px: 1.5 }}>
              <Typography variant="subtitle2">详细信息</Typography>
              <IconButton size="small" aria-label="关闭详细信息" onClick={() => setInspectorOpen(false)}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Divider />
            {selectedItems.length === 0 ? (
              <XDriveStatePanel variant="plain" compact message="选择一个项目以查看预览和属性。" />
            ) : selectedItems.length > 1 ? (
              <Stack spacing={1.5} sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                  <InsertDriveFileRoundedIcon color="action" sx={{ fontSize: 52 }} />
                </Box>
                <Typography variant="subtitle2">已选择 {selectedItems.length} 个项目</Typography>
                <Typography variant="body2" color="text.secondary">
                  {inspectorFileCount} 个文件 · {inspectorFolderCount} 个文件夹
                </Typography>
                {selectedSize > 0 ? (
                  <Typography variant="body2" color="text.secondary">文件大小合计 {formatSize(selectedSize)}</Typography>
                ) : null}
              </Stack>
            ) : inspectorItem ? (
              <Stack spacing={1.5} sx={{ p: 1.5 }}>
                <Box
                  data-xdrive-file-explorer-preview
                  sx={{
                    minHeight: 176,
                    maxHeight: 220,
                    borderRadius: 1,
                    bgcolor: 'background.default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <XDriveFilePreviewSurface
                    target={inspectorItem}
                    loadTextPreview={loadTextPreview}
                    loadImagePreview={
                      (inspectorItem.thumbnailEligible ?? xDriveFileSupportsThumbnail(inspectorItem.name, inspectorItem.kind))
                        ? loadThumbnail
                        : undefined
                    }
                    fallback={defaultItemIcon(inspectorItem, true)}
                    minHeight={176}
                    maxHeight={220}
                  />
                </Box>
                <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{inspectorItem.name}</Typography>
                <Divider />
                <Stack spacing={1}>
                  {inspectorProperties.filter((property) => !property.technical).map((property) => (
                    <Box key={property.label} sx={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">{property.label}</Typography>
                      <Typography variant="body2" component="div" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{property.value}</Typography>
                    </Box>
                  ))}
                </Stack>
                <Divider />
                <Typography variant="caption" color="text.secondary">技术信息</Typography>
                <Stack spacing={1}>
                  {inspectorProperties.filter((property) => property.technical).map((property) => (
                    <Box key={property.label} sx={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">{property.label}</Typography>
                      <Typography variant="body2" component="div" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{property.value}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Stack>
            ) : null}
          </Box>
        </>
      ) : null}
      </Box>

      <XDriveFilePropertiesDialog
        open={propertiesItems.length > 0}
        title={propertiesDialogTitle}
        preview={propertiesDialogPreview}
        properties={propertiesDialogProperties}
        onClose={() => setPropertiesItems([])}
      />

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
          {loadingMore
            ? '正在加载更多…'
            : statusText ?? (selectedIDs.length > 0 && selectedSize > 0 ? `已选择 ${formatSize(selectedSize)}` : '')}
        </Typography>
      </Stack>
    </Paper>
  )
}
