import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import LabelRoundedIcon from '@mui/icons-material/LabelRounded'
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, InputAdornment, ListItemIcon, Menu, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { formatBytes, xDriveFileExplorerDragAutoScrollDelta } from '../../ui/shared/src'
import type { MediaItem, NodeLocation, XDriveFileExplorerGrouping } from '../../ui/shared/src'
import {
  XDriveFileExplorerAvailabilityBadge, xDriveFileExplorerMarkThumbnailScrollActivity,
  XDriveFileExplorerThumbnail, XDriveFileExplorerThumbnailProvider,
  XDriveFilePropertiesDialog, XDriveMediaDetailsInspector, xDriveFileSupportsThumbnail,
  xDriveFileKind, xDriveFileTypeLabel, xDriveCreateFileExplorerGroupLayout,
  xDriveFileExplorerVisibleGroupSegments,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerCrumb, XDriveFileExplorerItem, XDriveFileExplorerMenuItem,
  XDriveFileExplorerSearchSummary, XDriveFileExplorerSort, XDriveFileExplorerVirtualCollection,
} from '@xdrive/ui/mui'
import { useXDrivePointerDrag } from '../../ui/shared/src/mui/usePointerDrag'
import {
  mobileFilesDecodeState, mobileFilesEncodeState, mobileFilesIsMoved, mobileFilesWindow,
  MOBILE_FILES_HOLD_MS, MOBILE_FILES_GRID_ROW_HEIGHT, MOBILE_FILES_ROW_HEIGHT,
} from './mobileFilesState'
import type { MobileFilesSection } from './mobileFilesState'

type SectionEntry = {
  id: number
  name: string
  kind: 'dir' | 'file'
  subtitle?: string
  size?: number
  revision?: number
  updatedAt?: string
}
type MobileCollectionAction = 'copy' | 'download' | 'share'
type SavedEntry = { id: number; name: string }

type Props = {
  lifecycleKey: string
  requestedDirectoryID?: number
  items: XDriveFileExplorerItem[]
  virtualCollection?: XDriveFileExplorerVirtualCollection
  crumbs: XDriveFileExplorerCrumb[]
  loading: boolean
  trashActive: boolean
  onOpenTrash: () => void
  onCloseTrash: () => void
  onBrowseRoot: () => void
  onGoUp: () => void
  onCrumbClick: (index: number) => void
  onRestoreFolder: (id: number) => Promise<void>
  onOpenItem: (item: XDriveFileExplorerItem) => boolean | void | Promise<boolean | void>
  onOpenError: (error: unknown) => void
  recentItems: SectionEntry[]
  favorites: SectionEntry[]
  quickAccess: SectionEntry[]
  savedSearches: SavedEntry[]
  tags: SavedEntry[]
  onOpenRecent: (id: number) => Promise<boolean>
  onOpenFavorite: (id: number) => Promise<boolean>
  onOpenQuickAccess: (id: number) => Promise<boolean>
  onReorderQuickAccess?: (ids: number[]) => Promise<boolean>
  onReorderSavedSearches?: (ids: number[]) => Promise<void>
  onClearRecent: () => void | boolean | Promise<void | boolean>
  onUnfavorite: (id: number) => void | boolean | Promise<void | boolean>
  onCollectionAction?: (entry: SectionEntry, action: MobileCollectionAction) => Promise<void>
  onPrepareNativeShareFile?: (entry: Pick<XDriveFileExplorerItem, 'id' | 'name' | 'kind'>, signal: AbortSignal) => Promise<File>
  onOpenSavedSearch: (id: number) => void
  onOpenTag: (id: number) => void
  onManageTags: (items?: XDriveFileExplorerItem[]) => void
  searchValue: string
  onSearchValueChange: (value: string) => void
  onSearch: (query: string) => void
  onClearSearch: () => void
  searchActive: boolean
  searchSummary?: XDriveFileExplorerSearchSummary
  filtersControl?: ReactNode
  sort: XDriveFileExplorerSort
  onSortChange: (sort: XDriveFileExplorerSort) => void
  grouping?: XDriveFileExplorerGrouping
  onGroupingChange?: (grouping: XDriveFileExplorerGrouping) => void
  actionFeedback?: ReactNode
  viewMode: 'details' | 'grid' | 'columns'
  onViewModeChange: (view: 'details' | 'grid') => void
  onCreateFolder: () => void
  onUpload: () => void
  onUploadFolder: () => void
  onRefresh: () => void
  onRefreshRecent: () => void
  onRefreshFavorites: () => void
  canPaste: boolean
  onPaste: () => void
  onRename: (item: XDriveFileExplorerItem, name: string) => Promise<void>
  onCopy: (items: XDriveFileExplorerItem[]) => void
  onCut: (items: XDriveFileExplorerItem[]) => void
  onMove: (items: XDriveFileExplorerItem[]) => void
  onCopyTo: (items: XDriveFileExplorerItem[]) => void
  onDownload: (items: XDriveFileExplorerItem[]) => void
  onDelete: (items: XDriveFileExplorerItem[]) => void
  onDropToFolder: (items: XDriveFileExplorerItem[], folder: XDriveFileExplorerItem) => void
  onDropToCrumb: (items: XDriveFileExplorerItem[], crumb: XDriveFileExplorerCrumb) => void
  getItemMenuItems: (item: XDriveFileExplorerItem) => XDriveFileExplorerMenuItem[]
  loadThumbnail: (item: XDriveFileExplorerItem, signal?: AbortSignal) => Promise<string | null | undefined>
  loadMediaItem: (item: XDriveFileExplorerItem, signal: AbortSignal) => Promise<MediaItem | null>
  loadNodeLocation: (id: number, signal?: AbortSignal) => Promise<NodeLocation>
  onShowInFolder: (location: NodeLocation) => boolean | void | Promise<boolean | void>
}

// Visually calibrated against Apple's published Files folder screenshot:
// https://cdsassets.apple.com/live/7WUAS350/images/icloud/ios-26-iphone-16-pro-files-icloud-drive-downloads.png
// Keep colors central so grid/list/Recents/Favorites never diverge. This is
// xDrive's own SVG; appearance comparisons do not establish pixel equivalence.
const BLUE_FOLDER = '#4caddb'
const IOS_FILES_ICON_COLORS = {
  folderBackTop: '#69c8ee',
  folderBackBottom: '#49add9',
  folderFrontTop: '#7dceeb',
  folderFrontMiddle: '#5dbce3',
  folderOutline: '#399abf',
  folderHighlight: '#e8fbff',
  documentPaper: '#ffffff',
  documentBorder: '#c4cad2',
  documentFold: '#e6e9ed',
  documentDetail: '#c8cfd6',
} as const
const MOBILE_DOCUMENT_BADGES: Record<string, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: '#e34c50' },
  document: { label: 'DOC', color: '#377ec9' },
  spreadsheet: { label: 'XLS', color: '#359f70' },
  presentation: { label: 'PPT', color: '#e48b43' },
  archive: { label: 'ZIP', color: '#6b83a3' },
  code: { label: '</>', color: '#607fae' },
  text: { label: 'TXT', color: '#9aa6b5' },
  image: { label: 'IMG', color: '#55a5db' },
  video: { label: 'MOV', color: '#9c78bc' },
  audio: { label: 'AUD', color: '#ac78bd' },
}

function MobileFolderIcon({ size = 38 }: { size?: number }) {
  // A gradient id must be unique per mounted folder, including virtualized rows.
  const paintID = useId().replace(/:/g, '')
  return (
    <Box component="svg" viewBox="0 0 64 54" aria-hidden="true" focusable="false"
      data-xdrive-mobile-folder-icon
      sx={{ width: size, height: size * 54 / 64, flexShrink: 0, display: 'block' }}>
      <defs>
        <linearGradient id={`${paintID}-folder-back`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={IOS_FILES_ICON_COLORS.folderBackTop}/>
          <stop offset="100%" stopColor={IOS_FILES_ICON_COLORS.folderBackBottom}/>
        </linearGradient>
        <linearGradient id={`${paintID}-folder-front`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={IOS_FILES_ICON_COLORS.folderFrontTop}/>
          <stop offset="26%" stopColor={IOS_FILES_ICON_COLORS.folderFrontMiddle}/>
          <stop offset="100%" stopColor={BLUE_FOLDER}/>
        </linearGradient>
      </defs>
      <path d="M6 8h15c1.1 0 2.1.4 2.9 1.2l4.8 4.6H58a4 4 0 0 1 4 4v28.7H2V12a4 4 0 0 1 4-4Z"
        fill={`url(#${paintID}-folder-back)`} stroke={IOS_FILES_ICON_COLORS.folderOutline} strokeWidth="0.75"/>
      <path d="M6 18.5h52a4 4 0 0 1 4 4v24a4.5 4.5 0 0 1-4.5 4.5h-51A4.5 4.5 0 0 1 2 46.5v-24a4 4 0 0 1 4-4Z"
        fill={`url(#${paintID}-folder-front)`} stroke={IOS_FILES_ICON_COLORS.folderOutline} strokeWidth="0.75"/>
      <path d="M6 19.5h52" fill="none" stroke={IOS_FILES_ICON_COLORS.folderHighlight} strokeWidth="1.1"
        strokeOpacity="0.95" strokeLinecap="round"/>
    </Box>
  )
}

function MobileDocumentIcon({ item, size = 32 }: {
  item: Pick<XDriveFileExplorerItem, 'name' | 'kind' | 'fileKind'>
  size?: number
}) {
  const kind = item.fileKind ?? xDriveFileKind(item.name, item.kind)
  // Unknown files are plain white pages. Known formats get a small native-like
  // type band, never an invented preview of the file's actual contents.
  const badge = MOBILE_DOCUMENT_BADGES[kind]
  return (
    <Box component="svg" viewBox="0 0 44 52" aria-hidden="true" focusable="false"
      data-xdrive-mobile-document-icon
      sx={{ width: size, height: size * 52 / 44, flexShrink: 0, display: 'block' }}>
      <path d="M8 1.5h21.5L41 13v33.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-41a4 4 0 0 1 4-4Z"
        fill={IOS_FILES_ICON_COLORS.documentPaper} stroke={IOS_FILES_ICON_COLORS.documentBorder} strokeWidth="1.2"/>
      <path d="M29.5 1.5v8.3A3.2 3.2 0 0 0 32.7 13H41Z"
        fill={IOS_FILES_ICON_COLORS.documentFold} stroke={IOS_FILES_ICON_COLORS.documentBorder} strokeWidth="0.8" strokeLinejoin="round"/>
      {kind === 'text' || kind === 'document' || kind === 'code' ? (
        <path d="M10 21h24M10 25h21M10 29h23" fill="none" stroke={IOS_FILES_ICON_COLORS.documentDetail}
          strokeWidth="1.1" strokeLinecap="round"/>
      ) : null}
      {badge ? (
        <>
          <rect x="7" y="34" width="32" height="13" rx="1.6" fill={badge.color}/>
          <text x="23" y="43.5" textAnchor="middle" fontFamily="system-ui, sans-serif"
            fontWeight="700" fontSize="9.5" letterSpacing="0.4" fill="#fff">
            {badge.label}
          </text>
        </>
      ) : null}
    </Box>
  )
}

const MIN_TOUCH = 44
// Only Mobile Files uses the iOS-like type scale and surfaces. Shared Web and
// Desktop themes remain unchanged; these tokens are not copied Apple assets.
const IOS_FILES_MOBILE_BLUE = '#007aff'
const IOS_FILES_MOBILE_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif'
const labelOf = (item: XDriveFileExplorerItem) => (
  item.kind === 'dir' ? '文件夹' : xDriveFileTypeLabel(item.name, item.kind)
)
const mobileItemKey = (item: XDriveFileExplorerItem) => String(item.id)

// iOS/Android may emit a native touch contextmenu before pointerup.
// Only a stationary, completed press may mount the mobile action Portal.
function isNativeTouchContext(event: MouseEvent | undefined) {
  if (!event) return false
  const native = event as MouseEvent & {
    pointerType?: string
    sourceCapabilities?: { firesTouchEvents?: boolean }
  }
  return native.pointerType === 'touch' || native.sourceCapabilities?.firesTouchEvents === true
}

export default function MobileFiles(props: Props) {
  const storageKey = 'xdrive.mobile.files.v1:' + props.lifecycleKey
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return mobileFilesDecodeState(null)
    try {
      const previous = mobileFilesDecodeState(window.localStorage.getItem(storageKey))
      return props.requestedDirectoryID
        ? { ...previous, section: 'browse' as const, folderID: props.requestedDirectoryID, scrollTop: 0 }
        : previous
    } catch { return mobileFilesDecodeState(null) }
  }, [storageKey, props.requestedDirectoryID])
  // A new Files launch resumes the last Browse location, not a different
  // Recent/Favorites rail tab that happened to be visible before exit.
  const [section, setSection] = useState<MobileFilesSection>('browse')
  const [browseHome, setBrowseHome] = useState(initial.folderID === null)
  const [editBrowseHome, setEditBrowseHome] = useState(false)
  const browseSectionsKey = 'xdrive.mobile.files.sections.v1:' + props.lifecycleKey
  const [browseSections, setBrowseSections] = useState<{ quick: boolean; organization: boolean }>(() => {
    const defaults = { quick: true, organization: true }
    if (typeof window === 'undefined') return defaults
    try {
      const saved = JSON.parse(window.localStorage.getItem(browseSectionsKey) || 'null') as
        { quick?: unknown; organization?: unknown } | null
      return {
        quick: typeof saved?.quick === 'boolean' ? saved.quick : true,
        organization: typeof saved?.organization === 'boolean' ? saved.organization : true,
      }
    } catch { return defaults }
  })
  const [viewPreference, setViewPreference] = useState<'details' | 'grid'>(initial.view)
  const [ready, setReady] = useState(initial.folderID === null || Boolean(props.requestedDirectoryID))
  const [scrollTop, setScrollTop] = useState(initial.scrollTop)
  const scrollSaveRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<{ folderID: number; scrollTop: number } | null>(null)
  const [viewport, setViewport] = useState({ width: 375, height: 600 })
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [arrangeAnchor, setArrangeAnchor] = useState<HTMLElement | null>(null)
  const [itemMenu, setItemMenu] = useState<{ item: XDriveFileExplorerItem; x: number; y: number } | null>(null)
  const [collectionMenu, setCollectionMenu] = useState<{
    entry: SectionEntry; owner: 'recent' | 'favorites'; x: number; y: number
  } | null>(null)
  const [clearRecentConfirm, setClearRecentConfirm] = useState(false)
  const [nativeShare, setNativeShare] = useState<{
    name: string
    status: 'preparing' | 'ready' | 'error'
    file?: File
    error?: string
  } | null>(null)
  const nativeShareControllerRef = useRef<AbortController | null>(null)
  const nativeShareInvocationRef = useRef(false)
  const canNativeShareFile = Boolean(
    props.onPrepareNativeShareFile &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function',
  )
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectionMoreAnchor, setSelectionMoreAnchor] = useState<HTMLElement | null>(null)
  const [selectionFeedback, setSelectionFeedback] = useState('')
  const [selected, setSelected] = useState<Map<string, XDriveFileExplorerItem>>(() => new Map())
  const [renaming, setRenaming] = useState<XDriveFileExplorerItem | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [properties, setProperties] = useState<XDriveFileExplorerItem | null>(null)
  const [mediaState, setMediaState] = useState<{
    key: string; status: 'loading' | 'done'; item: MediaItem | null
  } | null>(null)
  const [dropFolderID, setDropFolderID] = useState<string | null>(null)
  const [dropCrumbID, setDropCrumbID] = useState<string | null>(null)
  const ownerRef = useRef<HTMLDivElement | null>(null)
  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  const lastRequestedDirectoryRef = useRef(props.requestedDirectoryID)
  const restoredScrollRef = useRef(false)
  const browseScrollRef = useRef(initial.scrollTop)
  const pendingSectionScrollRef = useRef<number | null>(null)
  const navigationIntentRef = useRef(0)
  const searchReturnHomeRef = useRef(initial.folderID === null)
  const restoreFolderRef = useRef(props.onRestoreFolder)
  restoreFolderRef.current = props.onRestoreFolder
  const restoreTaskRef = useRef<{ id: number; promise: Promise<void> } | null>(null)
  const holdRef = useRef<{
    id: number; item: XDriveFileExplorerItem; x: number; y: number; timer: number; held: boolean; moved: boolean
  } | null>(null)
  const collectionHoldRef = useRef<{
    id: number; entry: SectionEntry; owner: 'recent' | 'favorites'
    x: number; y: number; timer: number; held: boolean
  } | null>(null)
  const cancelClickRef = useRef(false)
  const selection = [...selected.values()]
  const directoryID = Number(props.crumbs.at(-1)?.id ?? 0) || null
  const showDirectory = section === 'browse' && (!browseHome || props.trashActive || props.searchActive)
  const selectionActive = selectionMode && showDirectory
  const effectiveGrid = viewPreference === 'grid'
  const columns = Math.max(2, Math.min(5, Math.floor(viewport.width / 120)))
  const rowHeight = effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT
  const totalCount = props.virtualCollection?.itemCount ?? props.items.length
  const logicalRows = effectiveGrid ? Math.ceil(totalCount / columns) : totalCount
  const windowRows = mobileFilesWindow(logicalRows, scrollTop, viewport.height, rowHeight)
  const start = windowRows.start * (effectiveGrid ? columns : 1)
  const end = Math.min(totalCount, windowRows.end * (effectiveGrid ? columns : 1))
  const sectionItems = section === 'recent' ? props.recentItems : props.favorites
  const sectionWindow = mobileFilesWindow(sectionItems.length, scrollTop, viewport.height, MOBILE_FILES_ROW_HEIGHT)
  const sortLabel = ({ name: '名称', updated: '修改日期', type: '类型', size: '大小' })[props.sort.key]
  const groupLabel = props.grouping?.groupBy === 'type' ? '类型' :
    props.grouping?.groupBy === 'modified' ? '修改日期' :
      props.grouping?.groupBy === 'size' ? '大小' : ''
  const arrangementLabel = `${sortLabel} ${props.sort.direction === 'asc' ? '↑' : '↓'} · ${effectiveGrid ? '图标' : '列表'}${groupLabel ? ` · 按${groupLabel}分组` : ''}`
  // Grouping is still the authoritative Server ordering/index. Never invent
  // local group membership from the loaded portion of a paged collection.
  const groupedLayout = useMemo(() => {
    if (!props.grouping || props.trashActive) return null
    return xDriveCreateFileExplorerGroupLayout({
      groups: props.virtualCollection?.groups ?? [],
      groupBy: props.grouping.groupBy,
      itemCount: totalCount,
      columns: effectiveGrid ? columns : 1,
      rowHeight,
      groupHeaderHeight: 30,
      groupGap: 6,
    })
  }, [props.grouping?.groupBy, props.trashActive, props.virtualCollection?.groups, totalCount, effectiveGrid, columns, rowHeight])
  const groupedSegments = useMemo(() => groupedLayout
    ? xDriveFileExplorerVisibleGroupSegments(groupedLayout, scrollTop, Math.max(1, viewport.height), rowHeight * 4)
    : [], [groupedLayout, scrollTop, viewport.height, rowHeight])

  const toggleBrowseSection = (sectionName: 'quick' | 'organization') => {
    setBrowseSections(current => {
      const next = { ...current, [sectionName]: !current[sectionName] }
      try { window.localStorage.setItem(browseSectionsKey, JSON.stringify(next)) }
      catch { /* Private browsing still allows in-memory folding. */ }
      return next
    })
  }
  const reorderHomeEntry = (kind: 'quick' | 'saved', from: number, offset: -1 | 1) => {
    const entries = kind === 'quick' ? props.quickAccess : props.savedSearches
    const destination = from + offset
    if (destination < 0 || destination >= entries.length) return
    const ids = entries.map(entry => entry.id)
    ;[ids[from], ids[destination]] = [ids[destination], ids[from]]
    const work = kind === 'quick'
      ? props.onReorderQuickAccess?.(ids)
      : props.onReorderSavedSearches?.(ids)
    if (work) void work.catch(props.onOpenError)
  }

  const persist = useCallback((next: Partial<{
    section: MobileFilesSection; folderID: number | null; scrollTop: number; view: 'details' | 'grid'
  }>) => {
    if (typeof window === 'undefined') return
    try {
      const old = mobileFilesDecodeState(window.localStorage.getItem(storageKey))
      window.localStorage.setItem(storageKey, mobileFilesEncodeState({ ...old, ...next }))
    } catch { /* Private browsing must still work without persistent storage. */ }
  }, [storageKey])

  useEffect(() => {
    // One historical app-tab preference must not supersede Q2's resume policy.
    if (initial.section !== 'browse') persist({ section: 'browse' })
  }, [initial.section, persist])

  useEffect(() => {
    if (initial.folderID === null || props.requestedDirectoryID) return
    const folderID = initial.folderID
    // Reuse the one pending navigation through StrictMode effect replay;
    // the second subscription must still observe the same completion.
    if (restoreTaskRef.current?.id !== folderID) {
      restoreTaskRef.current = { id: folderID, promise: restoreFolderRef.current(folderID) }
    }
    let live = true
    const task = restoreTaskRef.current
    void task.promise.then(() => {
      if (live && restoreTaskRef.current === task) { setBrowseHome(false); setReady(true) }
    }).catch(() => {
      if (live && restoreTaskRef.current === task) {
        setBrowseHome(true)
        setReady(true)
        persist({ folderID: null, scrollTop: 0 })
      }
    })
    return () => { live = false }
  }, [storageKey, initial.folderID, props.requestedDirectoryID, persist])

  useEffect(() => {
    if (!props.requestedDirectoryID || props.requestedDirectoryID === lastRequestedDirectoryRef.current) return
    lastRequestedDirectoryRef.current = props.requestedDirectoryID
    navigationIntentRef.current += 1
    restoredScrollRef.current = true
    browseScrollRef.current = 0
    pendingSectionScrollRef.current = 0
    setSection('browse')
    setBrowseHome(false)
    setReady(true)
    setScrollTop(0)
    scrollHostRef.current?.scrollTo({ top: 0 })
    persist({ section: 'browse', folderID: props.requestedDirectoryID, scrollTop: 0 })
  }, [props.requestedDirectoryID, persist])

  useEffect(() => {
    const host = scrollHostRef.current
    if (!host) return
    const resize = () => setViewport({ width: host.clientWidth, height: host.clientHeight })
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [section, showDirectory])

  useEffect(() => () => {
    nativeShareControllerRef.current?.abort()
  }, [props.lifecycleKey])
  // Navigation invalidates the prepared bytes, even if the parent app remains
  // mounted behind a sibling viewer.
  useEffect(() => {
    nativeShareControllerRef.current?.abort()
    nativeShareControllerRef.current = null
    nativeShareInvocationRef.current = false
    setNativeShare(null)
  }, [props.lifecycleKey, section, directoryID])

  useEffect(() => () => {
    closeHold()
    if (collectionHoldRef.current) window.clearTimeout(collectionHoldRef.current.timer)
    collectionHoldRef.current = null
    if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
    if (pendingScrollRef.current) persist(pendingScrollRef.current)
    pendingScrollRef.current = null
    scrollSaveRef.current = null
  }, [persist])

  useLayoutEffect(() => {
    if (!ready || restoredScrollRef.current || !showDirectory || !totalCount) return
    if (initial.folderID !== null && directoryID !== initial.folderID) return
    const host = scrollHostRef.current
    if (!host) return
    restoredScrollRef.current = true
    host.scrollTop = initial.scrollTop
    setScrollTop(host.scrollTop)
  }, [ready, showDirectory, initial.scrollTop, totalCount, directoryID, initial.folderID])

  useLayoutEffect(() => {
    const target = pendingSectionScrollRef.current
    if (target === null) return
    const host = scrollHostRef.current
    if (!host) return
    pendingSectionScrollRef.current = null
    host.scrollTop = target
    setScrollTop(host.scrollTop)
  }, [section, browseHome, props.trashActive, props.searchActive])

  useEffect(() => {
    if (!ready || !showDirectory || !props.virtualCollection?.onRangeChange || !totalCount) return
    if (groupedLayout) {
      const visible = groupedSegments.filter(segment => segment.endIndex > segment.startIndex)
      if (!visible.length) return
      // The viewport may cross headers, but a single bounded Server range
      // covers only the visible logical IDs; never request all 100k items.
      props.virtualCollection.onRangeChange(visible[0].startIndex, visible[visible.length - 1].endIndex - 1)
      return
    }
    props.virtualCollection.onRangeChange(start, Math.max(start, end - 1))
  }, [ready, showDirectory, props.virtualCollection, groupedLayout, groupedSegments, start, end, totalCount])

  useEffect(() => {
    setSelected(new Map())
    setSelectionMode(false)
    setSelectionFeedback('')
    setSelectionMoreAnchor(null)
    setClearRecentConfirm(false)
    setItemMenu(null)
    setCollectionMenu(null)
  }, [section, props.trashActive, props.searchActive, props.virtualCollection?.interactionKey, props.lifecycleKey, directoryID])

  useEffect(() => {
    if (!ready || !showDirectory || props.searchActive || props.trashActive || directoryID === null) return
    persist({ folderID: directoryID })
  }, [ready, showDirectory, props.searchActive, props.trashActive, directoryID, persist])

  useEffect(() => {
    if (!props.searchActive || section === 'browse') return
    // The same authoritative global Search can be started from any Files tab.
    // Reveal its results rather than leaving the user in an unrelated list.
    searchReturnHomeRef.current = browseHome
    setSection('browse')
    setBrowseHome(false)
    setScrollTop(0)
    pendingSectionScrollRef.current = 0
  }, [props.searchActive, section, browseHome])

  const mediaEligible = properties?.kind === 'file' &&
    ['image', 'video'].includes(xDriveFileKind(properties.name, properties.kind))
  const mediaKey = mediaEligible && properties ? String(properties.id) + ':' + String(properties.revision ?? '') : ''
  const activeMediaState = mediaState?.key === mediaKey ? mediaState : null
  useEffect(() => {
    if (!properties || !mediaEligible) return
    const abort = new AbortController()
    const key = String(properties.id) + ':' + String(properties.revision ?? '')
    setMediaState({ key, status: 'loading', item: null })
    void props.loadMediaItem(properties, abort.signal).then(item => {
      if (!abort.signal.aborted) setMediaState({ key, status: 'done', item })
    }).catch(() => {
      if (!abort.signal.aborted) setMediaState({ key, status: 'done', item: null })
    })
    return () => abort.abort()
  }, [properties, mediaEligible, props.loadMediaItem])

  const flushBrowseScroll = () => {
    if (scrollSaveRef.current !== null) {
      window.clearTimeout(scrollSaveRef.current)
      scrollSaveRef.current = null
    }
    if (pendingScrollRef.current) {
      persist(pendingScrollRef.current)
      pendingScrollRef.current = null
    }
  }
  const beginBrowse = (id: number | null = null) => {
    flushBrowseScroll()
    navigationIntentRef.current += 1
    setEditBrowseHome(false)
    setSection('browse')
    setBrowseHome(id === null)
    searchReturnHomeRef.current = id === null
    setScrollTop(0)
    pendingSectionScrollRef.current = 0
    browseScrollRef.current = 0
    restoredScrollRef.current = true
    persist({ section: 'browse', folderID: id, scrollTop: 0 })
    scrollHostRef.current?.scrollTo({ top: 0 })
  }
  const onOpenEntry = (item: XDriveFileExplorerItem) => {
    // Trash actions stay in the existing restore/delete Context Menu. A
    // disabled ordinary Open must never persist a trashed folder as Browse.
    if (props.trashActive) return
    if (selectionMode) {
      setSelected(current => {
        const next = new Map(current)
        const key = mobileItemKey(item)
        if (next.has(key)) next.delete(key)
        else next.set(key, item)
        return next
      })
      return
    }
    const intent = ++navigationIntentRef.current
    void Promise.resolve(props.onOpenItem(item)).then(accepted => {
      if (accepted !== false && intent === navigationIntentRef.current && item.kind === 'dir') {
        beginBrowse(Number(item.id))
      }
    }).catch(props.onOpenError)
  }
  const changeSection = (next: MobileFilesSection) => {
    flushBrowseScroll()
    navigationIntentRef.current += 1
    if (props.trashActive) {
      props.onCloseTrash()
      if (next === 'browse') setBrowseHome(true)
    }
    if (props.searchActive && next !== 'browse') props.onClearSearch()
    setSection(next)
    const top = next === 'browse' && !browseHome && !props.trashActive ? browseScrollRef.current : 0
    setScrollTop(top)
    pendingSectionScrollRef.current = top
    // Commit the next section first; writing scroll on the previous short
    // collection would clamp and destroy a large directory's position.
    persist({ section: next })
  }
  const clearGlobalSearch = () => {
    props.onClearSearch()
    setBrowseHome(searchReturnHomeRef.current)
    setScrollTop(searchReturnHomeRef.current ? 0 : browseScrollRef.current)
    pendingSectionScrollRef.current = searchReturnHomeRef.current ? 0 : browseScrollRef.current
  }
  const launchGlobalSearch = (action: () => void) => {
    flushBrowseScroll()
    if (!props.searchActive) searchReturnHomeRef.current = browseHome
    navigationIntentRef.current += 1
    setSection('browse')
    setBrowseHome(false)
    setScrollTop(0)
    pendingSectionScrollRef.current = 0
    action()
    persist({ section: 'browse' })
  }
  const navigateUp = () => {
    flushBrowseScroll()
    navigationIntentRef.current += 1
    if (props.trashActive) { props.onCloseTrash(); beginBrowse(null); return }
    if (props.searchActive) { clearGlobalSearch(); return }
    // The cloud root and Browse home are distinct destinations.
    // A direct child goes up to the cloud root first, not straight Home.
    if (props.crumbs.length <= 1) { beginBrowse(null); return }
    props.onGoUp()
    persist({ folderID: Number(props.crumbs[props.crumbs.length - 2].id), scrollTop: 0 })
    browseScrollRef.current = 0
    setScrollTop(0)
    pendingSectionScrollRef.current = 0
  }
  const refresh = () => {
    if (section === 'recent') props.onRefreshRecent()
    else if (section === 'favorites') props.onRefreshFavorites()
    else props.onRefresh()
    setMoreAnchor(null)
  }
  const closeHold = () => {
    if (!holdRef.current) return
    window.clearTimeout(holdRef.current.timer)
    holdRef.current = null
  }
  const closeCollectionHold = () => {
    if (!collectionHoldRef.current) return
    window.clearTimeout(collectionHoldRef.current.timer)
    collectionHoldRef.current = null
  }
  const validDropTarget = (source: readonly XDriveFileExplorerItem[], point: { clientX: number; clientY: number }) => {
    const root = ownerRef.current
    const hit = root?.ownerDocument.elementFromPoint(point.clientX, point.clientY)
    if (!root || !hit || !root.contains(hit)) return null
    const sourceIDs = new Set(source.map(mobileItemKey))
    const crumb = hit.closest<HTMLElement>('[data-mobile-files-crumb-id]')
    const crumbID = crumb?.dataset.mobileFilesCrumbId
    const targetCrumb = props.crumbs.find(c => String(c.id) === crumbID)
    if (targetCrumb && !sourceIDs.has(String(targetCrumb.id))) return { kind: 'crumb' as const, crumb: targetCrumb }
    const folder = hit.closest<HTMLElement>('[data-mobile-files-folder-id]')
    const target = folder && props.virtualCollection
      ? [...props.virtualCollection.loadedItems.values()].find(x => String(x.id) === folder.dataset.mobileFilesFolderId)
      : props.items.find(x => String(x.id) === folder?.dataset.mobileFilesFolderId)
    if (target?.kind === 'dir' && !sourceIDs.has(String(target.id))) return { kind: 'folder' as const, folder: target }
    return null
  }
  const pointerDrag = useXDrivePointerDrag<XDriveFileExplorerItem[]>({
    ownerRef, scrollHostRef, enabled: showDirectory && !props.trashActive && !props.searchActive,
    scopeKey: props.lifecycleKey + ':' + String(directoryID) + ':' + String(props.virtualCollection?.interactionKey),
    autoScrollDelta: xDriveFileExplorerDragAutoScrollDelta,
    onMove: (sources, point) => {
      const target = validDropTarget(sources, point)
      setDropFolderID(target?.kind === 'folder' ? String(target.folder.id) : null)
      setDropCrumbID(target?.kind === 'crumb' ? String(target.crumb.id) : null)
    },
    onDrop: (sources, point) => {
      closeHold()
      const target = validDropTarget(sources, point)
      setDropFolderID(null)
      setDropCrumbID(null)
      if (target?.kind === 'folder') props.onDropToFolder(sources, target.folder)
      if (target?.kind === 'crumb') props.onDropToCrumb(sources, target.crumb)
    },
    onCancel: () => { closeHold(); setDropFolderID(null); setDropCrumbID(null) },
  })

  const pointerDown = (event: ReactPointerEvent<HTMLElement>, item: XDriveFileExplorerItem) => {
    if (event.pointerType === 'touch' && !event.isPrimary) { closeHold(); pointerDrag.cancel(); return }
    if (event.pointerType !== 'touch' || !event.isPrimary || selectionMode) return
    closeHold()
    cancelClickRef.current = false
    const entry = { id: event.pointerId, item, x: event.clientX, y: event.clientY, timer: 0, held: false, moved: false }
    entry.timer = window.setTimeout(() => {
      if (holdRef.current !== entry) return
      entry.held = true
      cancelClickRef.current = true
      if (!props.trashActive && !props.searchActive) pointerDrag.begin(event, [item])
    }, MOBILE_FILES_HOLD_MS)
    holdRef.current = entry
  }
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const press = holdRef.current
    if (!press || press.id !== event.pointerId) return
    if (mobileFilesIsMoved({ x: press.x, y: press.y }, { x: event.clientX, y: event.clientY })) {
      if (press.held) press.moved = true
      else closeHold()
    }
  }
  const suppressHeldRelease = (pointerId: number) => {
    const doc = ownerRef.current?.ownerDocument
    if (!doc) return
    const suppress = (click: MouseEvent) => {
      const clickID = (click as MouseEvent & { pointerId?: number }).pointerId
      if (click.detail === 0 || (clickID !== undefined && clickID > 0 && clickID !== pointerId)) return
      click.preventDefault()
      click.stopImmediatePropagation()
      doc.removeEventListener('click', suppress, true)
    }
    doc.addEventListener('click', suppress, true)
    window.setTimeout(() => doc.removeEventListener('click', suppress, true), 350)
  }
  const pointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const press = holdRef.current
    if (press?.id !== event.pointerId) return
    closeHold()
    if (press.held && !press.moved) {
      suppressHeldRelease(press.id)
      setItemMenu({ item: press.item, x: press.x, y: press.y })
    }
  }

  const menuFor = (item: XDriveFileExplorerItem) =>
    props.getItemMenuItems(item).filter(action => !['open-new-tab', 'open-browser-tab'].includes(action.id))
  // The shared menu adapter already supplies genuine action icons and danger/
  // separator metadata. Preserve that semantic structure in Mobile Files.
  const mobileContextAction = (action: XDriveFileExplorerMenuItem) => (
    <MenuItem key={action.id} data-mobile-files-context-action={action.id}
      disabled={action.disabled}
      sx={{ color: action.danger ? 'error.main' : undefined, minHeight: MIN_TOUCH }}
      onClick={() => { setItemMenu(null); action.onSelect() }}>
      {action.icon ? (
        <ListItemIcon sx={{ minWidth: 34, color: action.danger ? 'error.main' : 'inherit' }}>
          {action.icon}
        </ListItemIcon>
      ) : null}
      {action.id === 'share' ? '分享链接' : action.label}
    </MenuItem>
  )
  const openProperties = (item: XDriveFileExplorerItem) => { setItemMenu(null); setProperties(item) }
  const closeNativeShare = () => {
    nativeShareInvocationRef.current = false
    nativeShareControllerRef.current?.abort()
    nativeShareControllerRef.current = null
    setNativeShare(null)
  }
  const prepareNativeShare = (entry: Pick<XDriveFileExplorerItem, 'id' | 'name' | 'kind'>) => {
    if (!canNativeShareFile || !props.onPrepareNativeShareFile || entry.kind !== 'file') return
    nativeShareControllerRef.current?.abort()
    setItemMenu(null)
    setCollectionMenu(null)
    const controller = new AbortController()
    nativeShareControllerRef.current = controller
    setNativeShare({ name: entry.name, status: 'preparing' })
    void props.onPrepareNativeShareFile(entry, controller.signal).then(file => {
      if (controller.signal.aborted || nativeShareControllerRef.current !== controller) return
      if (!navigator.canShare({ files: [file] })) {
        setNativeShare({ name: entry.name, status: 'error', error: '系统不支持分享此文件，请使用下载或分享链接。' })
        return
      }
      setNativeShare({ name: file.name, status: 'ready', file })
    }).catch(error => {
      if (controller.signal.aborted || nativeShareControllerRef.current !== controller) return
      setNativeShare({ name: entry.name, status: 'error',
        error: error instanceof Error ? error.message : String(error) })
    })
  }
  // Web Share requires a *new* synchronous user activation: do not await any
  // fetch or preparation inside this onClick before calling navigator.share.
  const invokeNativeShare = () => {
    if (nativeShare?.status !== 'ready' || !nativeShare.file || nativeShareInvocationRef.current) return
    nativeShareInvocationRef.current = true
    try {
      const result = navigator.share({ title: nativeShare.file.name, files: [nativeShare.file] })
      void result.then(() => closeNativeShare()).catch(error => {
        if (error instanceof Error && error.name === 'AbortError') { closeNativeShare(); return }
        nativeShareInvocationRef.current = false
        setNativeShare(current => current?.status === 'ready'
          ? { ...current, error: error instanceof Error ? error.message : String(error) } : current)
      })
    } catch (error) {
      nativeShareInvocationRef.current = false
      setNativeShare(current => current?.status === 'ready'
        ? { ...current, error: error instanceof Error ? error.message : String(error) } : current)
    }
  }
  const runCollectionAction = (entry: SectionEntry, action: MobileCollectionAction) => {
    setCollectionMenu(null)
    const task = props.onCollectionAction?.(entry, action)
    if (task) void task.catch(props.onOpenError)
  }
  const beginRename = (item: XDriveFileExplorerItem) => {
    setItemMenu(null); setRenameDraft(item.name); setRenaming(item)
  }
  const submitRename = async () => {
    if (!renaming || !renameDraft.trim() || renameBusy) return
    setRenameBusy(true)
    try { await props.onRename(renaming, renameDraft.trim()); setRenaming(null) }
    catch { /* The Web adapter already provides the actionable error. */ }
    finally { setRenameBusy(false) }
  }
  const selectedAction = (kind: 'copy' | 'cut' | 'move' | 'copy-to' | 'download' | 'delete') => {
    if (!selection.length) return
    // Do not discard selection before a server-side validation, destination
    // choice or delete confirmation has actually succeeded.
    if (kind === 'copy') props.onCopy(selection)
    if (kind === 'cut') props.onCut(selection)
    if (kind === 'move') props.onMove(selection)
    if (kind === 'copy-to') props.onCopyTo(selection)
    if (kind === 'download') props.onDownload(selection)
    if (kind === 'delete') props.onDelete(selection)
  }
  const selectAllCurrent = async () => {
    if (totalCount === 0) return
    if (totalCount > 200) {
      setSelectionFeedback('当前范围超过单次文件操作的 200 项上限，请缩小范围后选择。')
      return
    }
    const all = props.virtualCollection?.collectRange
      ? await props.virtualCollection.collectRange(0, totalCount - 1)
      : props.items
    if (!all || all.length !== totalCount) {
      setSelectionFeedback('部分文件尚未加载，无法完成全选。请重试。')
      return
    }
    setSelectionFeedback('')
    setSelected(new Map(all.map(item => [mobileItemKey(item), item])))
  }
  const renderEntry = (item: XDriveFileExplorerItem, key: string) => {
    const chosen = selected.has(mobileItemKey(item))
    return (
      <Box
        key={key}
        data-mobile-files-item
        data-mobile-files-folder-id={item.kind === 'dir' ? String(item.id) : undefined}
        role="button"
        tabIndex={0}
        aria-label={selectionMode ? `${chosen ? '已选' : '未选'}，${item.name}` : item.name}
        aria-pressed={selectionMode ? chosen : undefined}
        onClick={() => { if (!cancelClickRef.current) onOpenEntry(item); else cancelClickRef.current = false }}
        onContextMenu={event => {
          event.preventDefault()
          // The 450ms hold owns touch activation until pointerup.
          if (holdRef.current || isNativeTouchContext(event.nativeEvent)) return
          setItemMenu({ item, x: event.clientX, y: event.clientY })
        }}
        onPointerDown={event => pointerDown(event, item)}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { closeHold(); cancelClickRef.current = false }}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setItemMenu({ item, x: rect.left + 14, y: rect.top + 28 })
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenEntry(item)
          }
        }}
        sx={{
          minWidth: 0, minHeight: effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT,
          display: 'flex', flexDirection: effectiveGrid ? 'column' : 'row', alignItems: 'center',
          gap: effectiveGrid ? 0.5 : 1.5, py: effectiveGrid ? 1 : 0.6, px: effectiveGrid ? 0.5 : 2,
          position: 'relative', cursor: 'pointer',
          bgcolor: chosen || dropFolderID === String(item.id) ? 'action.selected' :
            effectiveGrid ? 'transparent' : (theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff'),
          outline: dropFolderID === String(item.id) ? '2px solid' : 'none',
          outlineColor: IOS_FILES_MOBILE_BLUE, outlineOffset: -2,
          '&:focus-visible': { outline: '2px solid', outlineColor: IOS_FILES_MOBILE_BLUE },
          ...(!effectiveGrid ? { '&:not(:last-child)::after': {
            content: '""', position: 'absolute', bottom: 0, left: 60, right: 0,
            borderBottom: '1px solid', borderColor: 'divider', pointerEvents: 'none',
          } } : {}),
        }}
      >
        {selectionMode ? (
          <Box sx={{ color: chosen ? 'primary.main' : 'text.disabled', width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {chosen ? <CheckCircleRoundedIcon fontSize="small"/> : <RadioButtonUncheckedRoundedIcon fontSize="small"/>}
          </Box>
        ) : null}
        <Box sx={{ flexShrink: 0, width: effectiveGrid ? 70 : 44, height: effectiveGrid ? 70 : 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {item.kind === 'dir' ? <MobileFolderIcon size={effectiveGrid ? 62 : 38} /> : (
            <XDriveFileExplorerThumbnail item={item} eligible={xDriveFileSupportsThumbnail(item.name, item.kind)}
              fallback={<MobileDocumentIcon item={item} size={effectiveGrid ? 38 : 28}/>}
              sx={{ width: effectiveGrid ? 64 : 42, height: effectiveGrid ? 64 : 42, borderRadius: 0 }}/>
          )}
        </Box>
        <Box sx={{ minWidth: 0, width: effectiveGrid ? '100%' : undefined, flex: effectiveGrid ? undefined : 1 }}>
          <Typography variant="body2" fontWeight={500} noWrap textAlign={effectiveGrid ? 'center' : 'left'}>{item.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap display="block" textAlign={effectiveGrid ? 'center' : 'left'}>
            {item.secondaryLabel || [labelOf(item), item.kind === 'file' && item.size !== undefined ? formatBytes(item.size) : ''].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        {!effectiveGrid && item.availability ? <XDriveFileExplorerAvailabilityBadge availability={item.availability} compact /> : null}
        {!effectiveGrid && item.kind === 'dir' ? <ArrowBackIosNewRoundedIcon sx={{ fontSize: 13, transform: 'rotate(180deg)', color: 'text.disabled' }}/> : null}
      </Box>
    )
  }
  const mobileRow = (
    entry: SectionEntry, action: () => void, isFolder = false,
    owner?: 'recent' | 'favorites',
    locationKind?: 'cloud' | 'trash' | 'smart' | 'tag',
  ) => (
    <Box key={`${locationKind ?? owner ?? 'home'}:${String(entry.id)}`} role="button" tabIndex={0}
      onClick={() => {
        if (cancelClickRef.current) { cancelClickRef.current = false; return }
        action()
      }}
      onContextMenu={event => {
        if (!owner) return
        event.preventDefault()
        if (collectionHoldRef.current || isNativeTouchContext(event.nativeEvent)) return
        setCollectionMenu({ entry, owner, x: event.clientX, y: event.clientY })
      }}
      onPointerDown={event => {
        if (!owner) return
        if (event.pointerType === 'touch' && !event.isPrimary) { closeCollectionHold(); return }
        if (event.pointerType !== 'touch') return
        closeCollectionHold()
        cancelClickRef.current = false
        const press = { id: event.pointerId, entry, owner,
          x: event.clientX, y: event.clientY, timer: 0, held: false }
        press.timer = window.setTimeout(() => {
          if (collectionHoldRef.current !== press) return
          press.held = true
          cancelClickRef.current = true
        }, MOBILE_FILES_HOLD_MS)
        collectionHoldRef.current = press
      }}
      onPointerMove={event => {
        const press = collectionHoldRef.current
        if (!press || press.id !== event.pointerId) return
        if (mobileFilesIsMoved({ x: press.x, y: press.y }, { x: event.clientX, y: event.clientY })) {
          closeCollectionHold()
        }
      }}
      onPointerUp={event => {
        const press = collectionHoldRef.current
        if (!press || press.id !== event.pointerId) return
        closeCollectionHold()
        if (!press.held) return
        suppressHeldRelease(press.id)
        setCollectionMenu({ entry: press.entry, owner: press.owner, x: press.x, y: press.y })
      }}
      onPointerCancel={() => { closeCollectionHold(); cancelClickRef.current = false }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
      }}
      sx={{ display: 'flex', alignItems: 'center', minHeight: 64, px: 2, gap: 1.5,
        position: 'relative',
        bgcolor: theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff',
        '&:not(:last-child)::after': {
          content: '""', position: 'absolute', bottom: 0, left: 60, right: 0,
          borderBottom: '1px solid', borderColor: 'divider', pointerEvents: 'none',
        },
        '&:focus-visible': { outline: '2px solid', outlineColor: IOS_FILES_MOBILE_BLUE } }}>
      <Box sx={{ flexShrink: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {locationKind === 'cloud'
          ? <CloudRoundedIcon sx={{ color: 'primary.main', fontSize: 32 }} />
          : locationKind === 'trash'
            ? <DeleteOutlineRoundedIcon sx={{ color: 'text.secondary', fontSize: 31 }} />
            : locationKind === 'smart'
              ? <ManageSearchRoundedIcon sx={{ color: 'secondary.main', fontSize: 31 }} />
              : locationKind === 'tag'
                ? <LabelRoundedIcon sx={{ color: 'warning.main', fontSize: 30 }} />
                : isFolder || entry.kind === 'dir'
                  ? <MobileFolderIcon size={35}/>
                  : <XDriveFileExplorerThumbnail item={entry}
                      eligible={xDriveFileSupportsThumbnail(entry.name, entry.kind)}
                      fallback={<MobileDocumentIcon item={entry} size={29}/>}
                      sx={{ width: 42, height: 42, borderRadius: 0 }}/>}
      </Box>
      <Box minWidth={0} flex={1}>
        <Typography variant="body2" noWrap>{entry.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">{entry.subtitle ?? (entry.kind === 'dir' ? '文件夹' : '文件')}</Typography>
      </Box>
    </Box>
  )
  const editableHomeRow = (
    entry: SectionEntry,
    action: () => void,
    kind: 'quick' | 'saved',
    index: number,
  ) => {
    const row = mobileRow(entry, editBrowseHome ? () => {} : action, true, undefined,
      kind === 'saved' ? 'smart' : undefined)
    if (!editBrowseHome) return row
    const disabled = kind === 'quick'
      ? !props.onReorderQuickAccess : !props.onReorderSavedSearches
    const count = kind === 'quick' ? props.quickAccess.length : props.savedSearches.length
    return (
      <Stack key={`${kind}:${entry.id}`} data-mobile-files-home-edit-item={kind} direction="row" alignItems="center">
        <Box sx={{ minWidth: 0, flex: 1 }}>{row}</Box>
        <IconButton aria-label={`上移 ${entry.name}`} disabled={disabled || index === 0}
          onClick={() => reorderHomeEntry(kind, index, -1)} sx={{ width: MIN_TOUCH, height: MIN_TOUCH }}>
          <KeyboardArrowUpRoundedIcon />
        </IconButton>
        <IconButton aria-label={`下移 ${entry.name}`} disabled={disabled || index === count - 1}
          onClick={() => reorderHomeEntry(kind, index, 1)} sx={{ width: MIN_TOUCH, height: MIN_TOUCH }}>
          <KeyboardArrowDownRoundedIcon />
        </IconButton>
      </Stack>
    )
  }

  const renderLogicalCell = (index: number) => {
    const item = props.virtualCollection?.itemAt(index) ?? props.items[index]
    return item ? renderEntry(item, `${index}:${mobileItemKey(item)}`) : (
      <Box key={index} data-mobile-files-placeholder aria-label="正在加载文件"
        sx={{ minHeight: effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT,
          p: 2, color: 'text.disabled' }}>
        <Typography variant="caption">加载中…</Typography>
      </Box>
    )
  }
  const heading = props.trashActive ? '最近删除' : section === 'recent' ? '最近' : section === 'favorites' ? '收藏' :
    showDirectory ? (props.searchActive ? '搜索结果' : props.crumbs.at(-1)?.name ?? '云端文件') : '浏览'
  const editTitle = editBrowseHome && section === 'browse' && !showDirectory
  const compactTitleVisible = scrollTop > 48 || selectionActive || editTitle
  const compactTitle = selectionActive ? `已选 ${selection.length} 项` : editTitle ? '整理浏览' : heading
  const overflowAction = (label: string, action: () => void, disabled = false) => (
    <MenuItem key={label} disabled={disabled} onClick={() => { setMoreAnchor(null); action() }} sx={{ minHeight: MIN_TOUCH }}>{label}</MenuItem>
  )

  return (
    <XDriveFileExplorerThumbnailProvider lifecycleKey={props.lifecycleKey} loadThumbnail={props.loadThumbnail}>
      <Box ref={ownerRef} data-xdrive-mobile-files sx={{
        minHeight: 0, minWidth: 0, height: '100%', flex: 1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        bgcolor: theme => theme.palette.mode === 'dark' ? '#000000' : '#f2f2f7',
        fontFamily: IOS_FILES_MOBILE_FONT,
        '& .MuiTypography-root, & .MuiButton-root': { fontFamily: IOS_FILES_MOBILE_FONT },
      }}>
        <Stack data-mobile-files-navigation-bar direction="row" alignItems="center" sx={{
          px: 1.5, flexShrink: 0, minHeight: 52, gap: 1,
          bgcolor: theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#f2f2f7',
          borderBottom: compactTitleVisible ? 1 : 0,
          borderColor: 'divider',
        }}>
          {showDirectory ? (
            <Button size="small" onClick={navigateUp} startIcon={<ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }}/>}
              sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, px: 1, color: IOS_FILES_MOBILE_BLUE }}>返回</Button>
          ) : null}
          <Typography data-mobile-files-compact-title component="span" variant="subtitle1" noWrap
            aria-hidden={!compactTitleVisible}
            sx={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 650, textAlign: 'center',
              visibility: compactTitleVisible ? 'visible' : 'hidden' }}>
            {compactTitle}
          </Typography>
          {selectionActive ? (
            <>
              <Button size="small" onClick={() => void selectAllCurrent()}
                disabled={props.loading || totalCount === 0} sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>
                全选
              </Button>
              <Button size="small" onClick={() => {
                setSelectionMode(false); setSelected(new Map())
                setSelectionFeedback(''); setSelectionMoreAnchor(null)
              }} sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>完成</Button>
            </>
          ) : editBrowseHome && section === 'browse' && !showDirectory ? (
            <Button size="small" onClick={() => setEditBrowseHome(false)}
              sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>完成</Button>
          ) : (
            <IconButton aria-label="文件操作菜单" onClick={event => setMoreAnchor(event.currentTarget)}
              sx={{ width: MIN_TOUCH, height: MIN_TOUCH, color: IOS_FILES_MOBILE_BLUE }}><MoreHorizRoundedIcon/></IconButton>
          )}
        </Stack>
        <Box ref={scrollHostRef} data-xdrive-mobile-files-scroll data-xdrive-file-explorer-scroll-host
          onScroll={(event: UIEvent<HTMLDivElement>) => {
            xDriveFileExplorerMarkThumbnailScrollActivity(event.currentTarget)
            const top = event.currentTarget.scrollTop
            setScrollTop(top)
            if (section === 'browse' && showDirectory && !props.trashActive && !props.searchActive) {
              browseScrollRef.current = top
              if (directoryID !== null) {
                pendingScrollRef.current = { scrollTop: top, folderID: directoryID }
                if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
                scrollSaveRef.current = window.setTimeout(() => flushBrowseScroll(), 200)
              }
            }
          }}
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain' }}>
          {!selectionActive && !editTitle ? (
            <Box data-mobile-files-large-title sx={{ px: 2, pt: 1.75, pb: 0.5 }}>
              <Typography component="h2" sx={{ fontSize: 34, fontWeight: 730,
                lineHeight: 1.22, letterSpacing: '-0.5px' }}>{heading}</Typography>
            </Box>
          ) : null}
          <Box sx={{ position: 'sticky', top: 0, zIndex: 1,
            bgcolor: theme => theme.palette.mode === 'dark' ? '#000000' : '#f2f2f7', px: 2,
            py: scrollTop > 48 && !props.searchValue && !props.searchActive ? 0 : 1.5,
            maxHeight: scrollTop > 48 && !props.searchValue && !props.searchActive ? 0 : 198,
            opacity: scrollTop > 48 && !props.searchValue && !props.searchActive ? 0 : 1,
            overflow: 'hidden', transition: 'max-height .16s ease, opacity .16s ease, padding .16s ease' }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
            <TextField size="small" fullWidth value={props.searchValue}
              placeholder="搜索全部文件"
              aria-label="搜索全部文件"
              onChange={event => props.onSearchValueChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  launchGlobalSearch(() => props.onSearch(props.searchValue))
                }
              }}
              sx={{ '& .MuiOutlinedInput-root': {
                bgcolor: theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#e3e3e8',
                borderRadius: 2.5, minHeight: MIN_TOUCH,
                '& fieldset': { border: 0 },
              } }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small"/></InputAdornment>,
                endAdornment: props.searchValue ? <InputAdornment position="end"><IconButton size="small" aria-label="清除搜索文本" onClick={() => props.onSearchValueChange('')}><CloseRoundedIcon fontSize="small"/></IconButton></InputAdornment> : null }}}/>
            {props.filtersControl}
            </Stack>
            {props.searchActive || props.searchSummary ? (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  全部文件 · {props.searchSummary?.resultCount === null ? '正在查询…' : `${props.searchSummary?.resultCount ?? totalCount} 个结果`}
                </Typography>
                <Button size="small" onClick={clearGlobalSearch}>清除</Button>
              </Stack>
            ) : null}
            {props.searchSummary?.error ? (
              <Stack direction="row" alignItems="center" gap={1} role="alert" sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="error" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{props.searchSummary.error}</Typography>
                {props.searchSummary.onRetry ? <Button size="small" onClick={props.searchSummary.onRetry}>重试</Button> : null}
              </Stack>
            ) : null}
          </Box>
          {section === 'browse' && !showDirectory ? (
            <Box data-xdrive-mobile-files-home>
              <Typography variant="overline" sx={{ px: 2, color: 'text.secondary',
                display: 'block', pt: 1.5, pb: 0.5 }}>位置</Typography>
              <Box data-mobile-files-group="locations" sx={{ mx: 2, borderRadius: '13px',
                overflow: 'hidden', bgcolor: 'background.paper' }}>
              {mobileRow({ id: -1, name: '云端文件', kind: 'dir' }, () => {
                props.onCloseTrash()
                props.onBrowseRoot()
                beginBrowse(Number(props.crumbs[0]?.id ?? 0) || null)
                setBrowseHome(false)
              }, true, undefined, 'cloud')}
              {mobileRow({ id: -2, name: '最近删除', kind: 'dir' }, () => {
                props.onOpenTrash(); beginBrowse(null)
              }, true, undefined, 'trash')}
              </Box>
              {props.quickAccess.length > 0 ? (
                <>
                  <Button data-mobile-files-home-section="quick" aria-expanded={browseSections.quick}
                    onClick={() => toggleBrowseSection('quick')}
                    endIcon={browseSections.quick ? <ExpandLessRoundedIcon/> : <ExpandMoreRoundedIcon/>}
                    sx={{ width: '100%', minHeight: MIN_TOUCH, justifyContent: 'space-between', px: 2,
                      color: 'text.secondary', textTransform: 'none' }}>
                    个人收藏文件夹 · {props.quickAccess.length}
                  </Button>
                  {browseSections.quick ? (
                    <Box data-mobile-files-group="quick" sx={{ mx: 2, borderRadius: '13px',
                      overflow: 'hidden', bgcolor: 'background.paper' }}>
                      {props.quickAccess.map((entry, index) => editableHomeRow(entry, () => {
                        const intent = ++navigationIntentRef.current
                        void props.onOpenQuickAccess(entry.id).then(accepted => {
                          if (accepted && intent === navigationIntentRef.current) beginBrowse(entry.id)
                        }).catch(props.onOpenError)
                      }, 'quick', index))}
                    </Box>
                  ) : null}
                </>
              ) : null}
              {props.savedSearches.length > 0 || props.tags.length > 0 ? (
                <>
                  <Button data-mobile-files-home-section="organization" aria-expanded={browseSections.organization}
                    onClick={() => toggleBrowseSection('organization')}
                    endIcon={browseSections.organization ? <ExpandLessRoundedIcon/> : <ExpandMoreRoundedIcon/>}
                    sx={{ width: '100%', minHeight: MIN_TOUCH, justifyContent: 'space-between', px: 2,
                      color: 'text.secondary', textTransform: 'none' }}>
                    整理 · {props.savedSearches.length + props.tags.length}
                  </Button>
                  {browseSections.organization ? (
                    <Box data-mobile-files-group="organization" sx={{ mx: 2, borderRadius: '13px',
                      overflow: 'hidden', bgcolor: 'background.paper' }}>
                      {props.savedSearches.map((entry, index) => editableHomeRow({
                        ...entry, kind: 'dir', subtitle: '智能文件夹',
                      }, () => launchGlobalSearch(() => props.onOpenSavedSearch(entry.id)), 'saved', index))}
                      {props.tags.map(entry => mobileRow({ ...entry, kind: 'dir', subtitle: '标签' }, () => {
                        if (!editBrowseHome) launchGlobalSearch(() => props.onOpenTag(entry.id))
                      }, false, undefined, 'tag'))}
                    </Box>
                  ) : null}
                </>
              ) : null}
            </Box>
          ) : section === 'browse' ? (
            <>
              {props.searchActive ? (
                <Typography color="text.secondary" variant="caption" sx={{ px: 2, display: 'block', pb: 1 }}>
                  搜索范围：全部文件（不限定当前文件夹）
                </Typography>
              ) : null}
              {!props.searchActive && !props.trashActive && props.crumbs.length > 1 ? (
                <Stack direction="row" gap={0.5} sx={{ px: 1.5, pb: 1, overflowX: 'auto' }}>
                  {props.crumbs.map((crumb, i) => (
                    <Button key={String(crumb.id)} data-mobile-files-crumb-id={String(crumb.id)}
                      variant={i === props.crumbs.length - 1 ? 'outlined' : 'text'}
                      sx={{ whiteSpace: 'nowrap', minHeight: 36,
                        bgcolor: dropCrumbID === String(crumb.id) ? 'action.selected' : undefined }}
                      onClick={() => { props.onCrumbClick(i); browseScrollRef.current = 0; setScrollTop(0); scrollHostRef.current?.scrollTo({ top: 0 }) }}>
                      {crumb.name || '根目录'}
                    </Button>
                  ))}
                </Stack>
              ) : null}
              <Typography data-mobile-files-arrangement-status variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', pb: 1 }}>
                {props.loading ? '正在加载…' : `${totalCount} 个项目`} · {arrangementLabel}{groupedLayout ? ' · 已分组' : ''}
              </Typography>
              {props.loading && totalCount === 0 ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24}/></Box> : null}
              {totalCount === 0 && !props.loading ? <Typography sx={{ p: 4 }} color="text.secondary">这里还没有文件</Typography> : null}
              {groupedLayout ? (
                <Box data-xdrive-mobile-files-grouped sx={{
                  position: 'relative', height: groupedLayout.totalHeight, minWidth: 0,
                }}>
                  {groupedSegments.map(segment => (
                    <Box key={segment.group.key} sx={{
                      position: 'absolute', top: segment.group.top, left: 0, right: 0,
                    }}>
                      {segment.headerVisible ? (
                        <Typography data-xdrive-mobile-files-group-header={segment.group.key}
                          variant="caption" fontWeight={700}
                          sx={{ position: 'absolute', top: 0, left: 0, right: 0,
                            px: 2, height: groupedLayout.groupHeaderHeight,
                            display: 'flex', alignItems: 'center', color: 'text.secondary',
                            bgcolor: 'background.default' }}>
                          {segment.group.label}
                        </Typography>
                      ) : null}
                      {segment.endIndex > segment.startIndex ? (
                        <Box sx={{
                          position: 'absolute', top: segment.itemsTop - segment.group.top,
                          left: 0, right: 0,
                          display: effectiveGrid ? 'grid' : 'block',
                          gridTemplateColumns: effectiveGrid
                            ? `repeat(${columns}, minmax(0, 1fr))` : undefined,
                        }}>
                          {Array.from({ length: segment.endIndex - segment.startIndex },
                            (_, offset) => renderLogicalCell(segment.startIndex + offset))}
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box data-mobile-files-group="directory" sx={{
                  mx: effectiveGrid ? 0 : 2, borderRadius: effectiveGrid ? 0 : '13px',
                  overflow: 'hidden', bgcolor: effectiveGrid ? 'transparent' : 'background.paper',
                }}>
                  <Box sx={{ height: windowRows.before }} />
                  <Box sx={effectiveGrid ? {
                    display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  } : undefined}>
                    {Array.from({ length: end - start }, (_, offset) => renderLogicalCell(start + offset))}
                  </Box>
                  <Box sx={{ height: windowRows.after }}/>
                </Box>
              )}
            </>
          ) : (
            <Box data-xdrive-mobile-files-collection>
              {sectionItems.length === 0 ? <Typography color="text.secondary" sx={{ p: 3 }}>暂无{section === 'recent' ? '最近打开的项目' : '收藏的文件'}</Typography> : null}
              <Box data-mobile-files-group="collection" sx={{ mx: 2, mt: 1.5,
                borderRadius: '13px', overflow: 'hidden', bgcolor: 'background.paper' }}>
                <Box sx={{ height: sectionWindow.before }}/>
                {sectionItems.slice(sectionWindow.start, sectionWindow.end).map(entry => mobileRow(entry, () => {
                  const intent = ++navigationIntentRef.current
                  const open = section === 'recent'
                    ? props.onOpenRecent(entry.id)
                    : props.onOpenFavorite(entry.id)
                  void open.then(accepted => {
                    if (accepted && intent === navigationIntentRef.current && entry.kind === 'dir') beginBrowse(entry.id)
                  }).catch(props.onOpenError)
                }, false, section === 'recent' ? 'recent' : 'favorites'))}
                <Box sx={{ height: sectionWindow.after }}/>
              </Box>
            </Box>
          )}
        </Box>
        {props.actionFeedback ? <Box data-mobile-files-operation-feedback sx={{ flexShrink: 0 }}>{props.actionFeedback}</Box> : null}
        {selectionFeedback ? <Typography role="status" variant="caption" color="warning.main"
          sx={{ px: 2, py: 0.5, flexShrink: 0 }}>{selectionFeedback}</Typography> : null}
        {selectionActive ? (
          <Stack data-xdrive-mobile-selection-toolbar direction="row" alignItems="stretch" sx={{
            px: 0.5, pt: 0.5, pb: 'max(env(safe-area-inset-bottom), 4px)',
            borderTop: 1, borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper',
          }}>
            <Button aria-label="复制已选" disabled={!selection.length} onClick={() => selectedAction('copy')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <ContentCopyOutlinedIcon fontSize="small"/>复制
            </Button>
            <Button aria-label="移动已选" disabled={!selection.length} onClick={() => selectedAction('move')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <DriveFileMoveOutlinedIcon fontSize="small"/>移动
            </Button>
            <Button aria-label="下载已选" disabled={!selection.length} onClick={() => selectedAction('download')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <DownloadRoundedIcon fontSize="small"/>下载
            </Button>
            <Button aria-label="删除已选" disabled={!selection.length} onClick={() => selectedAction('delete')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11, color: 'error.main' }}>
              <DeleteOutlineRoundedIcon fontSize="small"/>删除
            </Button>
            <Button aria-label="更多已选操作" disabled={!selection.length}
              onClick={event => setSelectionMoreAnchor(event.currentTarget)}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <MoreHorizRoundedIcon fontSize="small"/>更多
            </Button>
          </Stack>
        ) : (
          <Stack component="nav" direction="row" justifyContent="space-around" sx={{
            flexShrink: 0, borderTop: 1, borderColor: 'divider', py: 0.25,
            pb: 'max(env(safe-area-inset-bottom), 4px)', bgcolor: 'background.paper',
          }} aria-label="文件分类">
            {([
              ['recent', <HistoryRoundedIcon/>, '最近'],
              ['browse', <FolderRoundedIcon/>, '浏览'],
              ['favorites', <StarBorderRoundedIcon/>, '收藏'],
            ] as const).map(([value, icon, label]) => (
              <Button key={value} data-mobile-files-section={value} aria-current={section === value ? 'page' : undefined}
                onClick={() => changeSection(value)} sx={{
                  flex: 1, flexDirection: 'column', minHeight: 52, gap: 0,
                  color: section === value ? IOS_FILES_MOBILE_BLUE : 'text.secondary',
                  fontSize: 11, borderRadius: 0,
                }}>
                {icon}{label}
              </Button>
            ))}
          </Stack>
        )}
        <Menu anchorEl={selectionMoreAnchor} open={Boolean(selectionMoreAnchor)}
          onClose={() => setSelectionMoreAnchor(null)}>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('cut') }}>剪切所选</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('copy-to') }}>复制到…</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('download') }}>下载所选</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); props.onManageTags(selection) }}>添加/管理标签</MenuItem>
        </Menu>
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(70dvh, 520px)' } } }}>
          {section === 'browse' && !showDirectory ? overflowAction('整理浏览首页', () => setEditBrowseHome(true)) : null}
          {showDirectory && !props.trashActive ? overflowAction('选择', () => setSelectionMode(true)) : null}
          {showDirectory && !props.trashActive ? overflowAction('新建文件夹', props.onCreateFolder) : null}
          {showDirectory && !props.trashActive ? overflowAction('上传文件', props.onUpload) : null}
          {showDirectory && !props.trashActive ? overflowAction('上传文件夹', props.onUploadFolder) : null}
          {showDirectory && !props.trashActive ? overflowAction('粘贴', props.onPaste, !props.canPaste) : null}
          {showDirectory ? overflowAction('排序与分组', () => {
            setArrangeAnchor(moreAnchor)
          }) : null}
          {showDirectory ? overflowAction(effectiveGrid ? '切换到列表' : '切换到图标', () => {
            const next = effectiveGrid ? 'details' : 'grid'
            setViewPreference(next); browseScrollRef.current = 0; setScrollTop(0)
            scrollHostRef.current?.scrollTo({ top: 0 }); persist({ view: next, scrollTop: 0 })
          }) : null}
          {section === 'recent' ? overflowAction('清空最近记录', () => setClearRecentConfirm(true)) : null}
          {overflowAction('刷新', refresh)}
          {overflowAction('管理标签', props.onManageTags)}
          {overflowAction('搜索全部文件', () => launchGlobalSearch(() => props.onSearch(props.searchValue)))}
        </Menu>
        <Menu anchorEl={arrangeAnchor} open={Boolean(arrangeAnchor)} onClose={() => setArrangeAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(70dvh, 460px)' } } }}>
          {(['name', 'updated', 'type', 'size'] as const).map(key => (
            <MenuItem key={key} selected={props.sort.key === key}
              onClick={() => { props.onSortChange({ ...props.sort, key }); setArrangeAnchor(null) }}>
              {({ name: '名称', updated: '修改日期', type: '类型', size: '大小' })[key]}
            </MenuItem>
          ))}
          <MenuItem onClick={() => {
            props.onSortChange({ ...props.sort, direction: props.sort.direction === 'asc' ? 'desc' : 'asc' })
            setArrangeAnchor(null)
          }}>方向：{props.sort.direction === 'asc' ? '升序' : '降序'}</MenuItem>
          {props.grouping && props.onGroupingChange ? (['none', 'type', 'modified', 'size'] as const).map(kind => (
            <MenuItem key={kind} selected={props.grouping?.groupBy === kind} onClick={() => {
              if (props.grouping) props.onGroupingChange?.({ ...props.grouping, groupBy: kind })
              setArrangeAnchor(null)
            }}>{({ none: '不分组', type: '按类型分组', modified: '按修改日期分组', size: '按大小分组' })[kind]}</MenuItem>
          )) : null}
          {props.grouping && props.onGroupingChange ? (
            <MenuItem onClick={() => {
              if (props.grouping) props.onGroupingChange?.({ ...props.grouping, foldersFirst: !props.grouping.foldersFirst })
              setArrangeAnchor(null)
            }}>文件夹优先：{props.grouping.foldersFirst ? '开启' : '关闭'}</MenuItem>
          ) : null}
        </Menu>
        <Menu open={Boolean(itemMenu)} onClose={() => setItemMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={itemMenu ? { top: itemMenu.y, left: itemMenu.x } : undefined}
          slotProps={{ paper: { sx: { borderRadius: '14px', minWidth: 218,
            maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(70dvh, 560px)' } } }}>
          {itemMenu ? menuFor(itemMenu.item).filter(item => !item.danger).flatMap(item => (
            item.dividerBefore
              ? [<Divider key={`${item.id}-separator`} sx={{ my: 0.5 }}/>, mobileContextAction(item)]
              : [mobileContextAction(item)]
          )) : null}
          {itemMenu && !props.trashActive ? (
            <Divider data-mobile-files-context-separator="edit" sx={{ my: 0.5 }}/>
          ) : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => beginRename(itemMenu.item)}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><EditRoundedIcon fontSize="small"/></ListItemIcon>重命名</MenuItem> : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => { props.onMove([itemMenu.item]); setItemMenu(null) }}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><DriveFileMoveOutlinedIcon fontSize="small"/></ListItemIcon>移动到…</MenuItem> : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => { props.onCopyTo([itemMenu.item]); setItemMenu(null) }}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><ContentCopyOutlinedIcon fontSize="small"/></ListItemIcon>复制到…</MenuItem> : null}
          {itemMenu?.item.kind === 'file' && !props.trashActive && canNativeShareFile ? (
            <MenuItem data-mobile-files-native-share-entry="directory"
              onClick={() => prepareNativeShare(itemMenu.item)} sx={{ minHeight: MIN_TOUCH }}>
              <ListItemIcon><ShareRoundedIcon fontSize="small"/></ListItemIcon>系统分享文件
            </MenuItem>
          ) : null}
          {itemMenu ? <MenuItem onClick={() => openProperties(itemMenu.item)}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><InfoOutlinedIcon fontSize="small"/></ListItemIcon>属性</MenuItem> : null}
          {itemMenu && menuFor(itemMenu.item).some(item => item.danger) ? (
            <Divider data-mobile-files-context-separator="danger" sx={{ my: 0.5 }}/>
          ) : null}
          {itemMenu ? menuFor(itemMenu.item).filter(item => item.danger).map(mobileContextAction) : null}
        </Menu>
        <Menu open={Boolean(collectionMenu)} onClose={() => setCollectionMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={collectionMenu ? { top: collectionMenu.y, left: collectionMenu.x } : undefined}>
          {collectionMenu ? <MenuItem onClick={() => {
            const selectedEntry = collectionMenu.entry
            const owner = collectionMenu.owner
            setCollectionMenu(null)
            const intent = ++navigationIntentRef.current
            const work = owner === 'recent' ? props.onOpenRecent(selectedEntry.id) : props.onOpenFavorite(selectedEntry.id)
            void work.then(accepted => {
              if (accepted && intent === navigationIntentRef.current && selectedEntry.kind === 'dir') beginBrowse(selectedEntry.id)
            }).catch(props.onOpenError)
          }}>打开</MenuItem> : null}
          {collectionMenu ? <MenuItem onClick={() => {
            const entry = collectionMenu.entry
            setCollectionMenu(null)
            void props.loadNodeLocation(entry.id).then(location => {
              if (!location.parent_id) return
              void Promise.resolve(props.onShowInFolder(location)).then(accepted => {
                if (accepted !== false) beginBrowse(location.parent_id)
              }).catch(props.onOpenError)
            }).catch(props.onOpenError)
          }}>显示所在文件夹</MenuItem> : null}
          {collectionMenu ? <MenuItem onClick={() => {
            const entry = collectionMenu.entry
            setCollectionMenu(null)
            openProperties({ id: entry.id, name: entry.name, kind: entry.kind,
              size: entry.size, revision: entry.revision })
          }}>属性</MenuItem> : null}
          {collectionMenu?.owner === 'favorites' ? <MenuItem onClick={() => {
            const id = collectionMenu.entry.id
            setCollectionMenu(null)
            void Promise.resolve(props.onUnfavorite(id)).catch(props.onOpenError)
          }}>取消收藏</MenuItem> : null}
          {collectionMenu && props.onCollectionAction ? (
            <MenuItem data-mobile-files-collection-action="copy"
              onClick={() => runCollectionAction(collectionMenu.entry, 'copy')}>复制</MenuItem>
          ) : null}
          {collectionMenu && props.onCollectionAction ? (
            <MenuItem data-mobile-files-collection-action="download"
              onClick={() => runCollectionAction(collectionMenu.entry, 'download')}>下载</MenuItem>
          ) : null}
          {collectionMenu?.entry.kind === 'file' && props.onCollectionAction ? (
            <MenuItem data-mobile-files-collection-action="share"
              onClick={() => runCollectionAction(collectionMenu.entry, 'share')}>分享链接</MenuItem>
          ) : null}
          {collectionMenu?.entry.kind === 'file' && canNativeShareFile ? (
            <MenuItem data-mobile-files-native-share-entry="collection"
              onClick={() => prepareNativeShare(collectionMenu.entry)}>
              <ShareRoundedIcon fontSize="small" sx={{ mr: 1 }}/>系统分享文件
            </MenuItem>
          ) : null}
        </Menu>
        <Dialog open={Boolean(nativeShare)} onClose={closeNativeShare} fullWidth maxWidth="xs">
          <DialogTitle>系统分享文件</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{nativeShare?.name}</Typography>
            {nativeShare?.status === 'preparing' ? (
              <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 2 }} role="status">
                <CircularProgress size={20}/>正在安全读取文件…
              </Stack>
            ) : null}
            {nativeShare?.error ? (
              <Typography role="alert" variant="body2" color="error" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                {nativeShare.error}
              </Typography>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeNativeShare} sx={{ minHeight: MIN_TOUCH }}>取消</Button>
            <Button data-mobile-files-native-share-confirm disabled={nativeShare?.status !== 'ready'}
              onClick={invokeNativeShare} sx={{ minHeight: MIN_TOUCH }}>打开系统分享</Button>
          </DialogActions>
        </Dialog>
        <Dialog open={clearRecentConfirm} onClose={() => setClearRecentConfirm(false)} fullWidth maxWidth="xs">
          <DialogTitle>清空最近记录？</DialogTitle>
          <DialogContent><Typography variant="body2">只清除最近打开的记录，不删除云端文件。</Typography></DialogContent>
          <DialogActions>
            <Button onClick={() => setClearRecentConfirm(false)}>取消</Button>
            <Button color="error" onClick={() => {
              setClearRecentConfirm(false)
              void Promise.resolve(props.onClearRecent()).catch(props.onOpenError)
            }}>清空记录</Button>
          </DialogActions>
        </Dialog>
        <Dialog open={Boolean(renaming)} onClose={() => { if (!renameBusy) setRenaming(null) }} fullWidth maxWidth="xs">
          <DialogTitle>重命名</DialogTitle>
          <DialogContent><TextField autoFocus fullWidth size="small" value={renameDraft}
            onChange={event => setRenameDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void submitRename() }} /></DialogContent>
          <DialogActions><Button disabled={renameBusy} onClick={() => setRenaming(null)}>取消</Button>
            <Button disabled={renameBusy || !renameDraft.trim()} onClick={() => void submitRename()}>保存</Button></DialogActions>
        </Dialog>
        {properties && mediaEligible && (activeMediaState?.status !== 'done' || activeMediaState.item) ? (
          <XDriveMediaDetailsInspector open item={activeMediaState?.item ?? null}
            fallbackName={properties.name} showPreview={false} onClose={() => setProperties(null)}
            albums={[]} loadThumbnail={async nodeID => Number(properties.id) === nodeID
              ? (await props.loadThumbnail(properties)) ?? null : null}
            loadNodeLocation={props.loadNodeLocation} onShowInFolder={props.onShowInFolder}/>
        ) : (
          <XDriveFilePropertiesDialog open={Boolean(properties)} title={properties?.name ?? '文件属性'}
            properties={properties ? [
              { label: '名称', value: properties.name },
              { label: '类型', value: labelOf(properties) },
              { label: '大小', value: properties.size !== undefined ? formatBytes(properties.size) : '未知' },
              { label: '修改时间', value: properties.updatedAt ?? '未知' },
              { label: '节点 ID', value: String(properties.id), section: 'technical' },
            ] : []} onClose={() => setProperties(null)}/>
        )}
      </Box>
    </XDriveFileExplorerThumbnailProvider>
  )
}
