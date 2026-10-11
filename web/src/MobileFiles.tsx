import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react'
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
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, InputAdornment, ListItemIcon, Menu, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import {
  formatBytes, xDriveFileExplorerDragAutoScrollDelta, xDriveFileExplorerKeyboardCommand,
  xDriveFileExplorerKeyboardProfileFromPlatform, xDriveFileExplorerInlineLayout,
  xDriveFileExplorerInlineCellAt, xDriveFileExplorerInlineVisibleRanges,
  xDriveFileExplorerInlineGroupIndex, XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE,
} from '../../ui/shared/src'
import type {
  MediaItem, NodeLocation, XDriveFileExplorerGrouping,
  XDriveFileExplorerInlineBranchSnapshot, XDriveFileExplorerInlineVisibleRange,
} from '../../ui/shared/src'
import {
  XDriveFileExplorerAvailabilityBadge, xDriveFileExplorerMarkThumbnailScrollActivity,
  XDriveFileExplorerThumbnail, XDriveFileExplorerThumbnailProvider,
  XDriveFileNameDialog, XDriveFilePropertiesDialog, XDriveMediaDetailsInspector, xDriveFileSupportsThumbnail,
  useXDriveFileExplorerPropertiesController,
  xDriveFileKind, xDriveFileTypeLabel, xDriveCreateFileExplorerGroupLayout,
  xDriveFileExplorerVisibleGroupSegments, xDriveFileExplorerReadExternalDrop,
} from '@xdrive/ui/mui'
import type {
  XDriveFileExplorerCrumb, XDriveFileExplorerItem, XDriveFileExplorerMenuItem,
  XDriveFileExplorerSelectionAction,
  XDriveFileExplorerSearchSummary, XDriveFileExplorerSort, XDriveFileExplorerVirtualCollection,
  XDriveFileExplorerPropertiesLoader, XDriveFilePropertiesDialogProperty,
  XDriveFileExplorerExternalDropPayload,
} from '@xdrive/ui/mui'
import { useXDrivePointerDrag } from '../../ui/shared/src/mui/usePointerDrag'
import {
  mobileFilesDecodeState, mobileFilesEncodeState, mobileFilesIsMoved, mobileFilesWindow,
  mobileFilesRowTextInset, MOBILE_FILES_HOLD_MS, MOBILE_FILES_GRID_ROW_HEIGHT, MOBILE_FILES_ROW_HEIGHT,
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
type SavedEntry = { id: number; name: string; subtitle?: string }

type Props = {
  lifecycleKey: string
  requestedDirectoryID?: number
  items: XDriveFileExplorerItem[]
  virtualCollection?: XDriveFileExplorerVirtualCollection
  inlineBranches?: readonly XDriveFileExplorerInlineBranchSnapshot<XDriveFileExplorerItem>[]
  onToggleInlineFolder?: (item: XDriveFileExplorerItem, parentID: number, parentIndex: number) => void
  onRetryInlineFolder?: (ownerID: number) => void
  onInlineViewport?: (ranges: readonly XDriveFileExplorerInlineVisibleRange[]) => void
  onClearInline?: () => void
  onSelectedItemsChange?: (items: readonly XDriveFileExplorerItem[]) => void
  getSelectionActionDisabledReason?: (
    action: XDriveFileExplorerSelectionAction,
    items: readonly XDriveFileExplorerItem[],
    count: number,
  ) => string | null
  crumbs: XDriveFileExplorerCrumb[]
  loading: boolean
  trashActive: boolean
  onOpenTrash: () => void
  onCloseTrash: () => void
  onBrowseRoot: () => void
  onGoUp: () => void
  onCrumbClick: (index: number) => void
  pathValue?: string
  onPathSubmit?: (path: string) => void
  onRestoreFolder: (id: number) => Promise<void>
  onOpenItem: (item: XDriveFileExplorerItem, parentID?: number) => boolean | void | Promise<boolean | void>
  onQuickLookItem?: (item: XDriveFileExplorerItem, parentID?: number) => void
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
  organizationLoading?: boolean
  organizationError?: string
  onRetryOrganization?: () => void
  organizationBusyKey?: string
  onRenameSavedSearch?: (id: number) => void
  canReplaceSavedSearch?: boolean
  onReplaceSavedSearch?: (id: number) => void
  onDeleteSavedSearch?: (id: number) => Promise<unknown>
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
  onPaste: (operationOverride?: 'move') => void
  canUndo?: boolean
  onUndo?: () => void
  canRedo?: boolean
  onRedo?: () => void
  canHistoryBack?: boolean
  onHistoryBack?: () => void
  canHistoryForward?: boolean
  onHistoryForward?: () => void
  onCopyPaths?: (items: XDriveFileExplorerItem[]) => void
  onRename: (item: XDriveFileExplorerItem, name: string) => Promise<void>
  onCopy: (items: XDriveFileExplorerItem[]) => void
  onCut: (items: XDriveFileExplorerItem[]) => void
  onMove: (items: XDriveFileExplorerItem[]) => void
  onCopyTo: (items: XDriveFileExplorerItem[]) => void
  onDownload: (items: XDriveFileExplorerItem[]) => void
  onDelete: (items: XDriveFileExplorerItem[]) => void
  onDropToFolder: (items: XDriveFileExplorerItem[], folder: XDriveFileExplorerItem) => void
  onDropToCrumb: (items: XDriveFileExplorerItem[], crumb: XDriveFileExplorerCrumb) => void
  onExternalFilesDrop?: (files: File[], target?: XDriveFileExplorerItem) => void | Promise<void>
  onExternalFolderDrop?: (payload: XDriveFileExplorerExternalDropPayload, target?: XDriveFileExplorerItem) => void | Promise<void>
  onExternalFilesDropToCrumb?: (files: File[], crumb: XDriveFileExplorerCrumb) => void | Promise<void>
  onExternalFolderDropToCrumb?: (payload: XDriveFileExplorerExternalDropPayload, crumb: XDriveFileExplorerCrumb) => void | Promise<void>
  getItemMenuItems: (item: XDriveFileExplorerItem) => XDriveFileExplorerMenuItem[]
  loadThumbnail: (item: XDriveFileExplorerItem, signal?: AbortSignal) => Promise<string | null | undefined>
  loadMediaItem: (item: XDriveFileExplorerItem, signal: AbortSignal) => Promise<MediaItem | null>
  loadPropertiesStats?: XDriveFileExplorerPropertiesLoader<XDriveFileExplorerItem>
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
  const [savedSearchMenu, setSavedSearchMenu] = useState<{ anchor: HTMLElement; id: number; name: string } | null>(null)
  const [deleteSavedSearchTarget, setDeleteSavedSearchTarget] = useState<{ id: number; name: string } | null>(null)
  const [deleteSavedSearchBusy, setDeleteSavedSearchBusy] = useState(false)
  const [deleteSavedSearchError, setDeleteSavedSearchError] = useState('')
  const deleteSavedSearchBusyRef = useRef(false)
  const deleteSavedSearchGenerationRef = useRef(0)
  const [replaceSavedSearchOpen, setReplaceSavedSearchOpen] = useState(false)
  const [replaceSavedSearchTargetID, setReplaceSavedSearchTargetID] = useState<number | null>(null)
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
  const [goToPathOpen, setGoToPathOpen] = useState(false)
  const [goToPathDraft, setGoToPathDraft] = useState('')
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
  const [selectionLoad, setSelectionLoad] = useState<{ intent: number; loaded: number; total: number } | null>(null)
  const [selectionMoreAnchor, setSelectionMoreAnchor] = useState<HTMLElement | null>(null)
  const [selectionFeedback, setSelectionFeedback] = useState('')
  const [selected, setSelected] = useState<Map<string, XDriveFileExplorerItem>>(() => new Map())
  const [renaming, setRenaming] = useState<XDriveFileExplorerItem | null>(null)
  // Single and multi-item Properties share the same Server-owned stats hook,
  // MUI dialog, and selection identity as wide Web. Keep only one inspector.
  const [propertiesItems, setPropertiesItems] = useState<XDriveFileExplorerItem[]>([])
  const properties = propertiesItems.length === 1 ? propertiesItems[0] : null
  const propertiesStatsState = useXDriveFileExplorerPropertiesController({
    items: propertiesItems, loadStats: props.loadPropertiesStats,
  })
  const [mediaState, setMediaState] = useState<{
    key: string; status: 'loading' | 'done'; item: MediaItem | null
  } | null>(null)
  const [dropFolderID, setDropFolderID] = useState<string | null>(null)
  const [dropCrumbID, setDropCrumbID] = useState<string | null>(null)
  const externalDropGenerationRef = useRef(0)
  const selectionIntentRef = useRef(0)
  const selectionAbortRef = useRef<AbortController | null>(null)
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Reuse the same OS-aware command interpreter as the wide FileExplorer.
  // Only the Mobile presentation chooses which real Web callbacks are exposed.
  const filesKeyboardProfile = xDriveFileExplorerKeyboardProfileFromPlatform(
    typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`,
  )
  const selection = [...selected.values()]
  const directoryID = Number(props.crumbs.at(-1)?.id ?? 0) || null
  const selectionScopeKey = [
    props.lifecycleKey, directoryID ?? 0, section,
    props.trashActive, props.searchActive,
    props.virtualCollection?.interactionKey ?? '',
  ].join(':')
  const selectionScopeRef = useRef(selectionScopeKey)
  selectionScopeRef.current = selectionScopeKey
  const showDirectory = section === 'browse' && (!browseHome || props.trashActive || props.searchActive)
  const selectionActive = selectionMode && showDirectory
  const effectiveGrid = viewPreference === 'grid'
  const columns = Math.max(2, Math.min(5, Math.floor(viewport.width / 120)))
  const rowHeight = effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT
  const totalCount = props.virtualCollection?.itemCount ?? props.items.length
  const inlineEnabled = showDirectory && !effectiveGrid && !props.trashActive &&
    !props.searchActive && directoryID !== null && Boolean(props.onToggleInlineFolder)
  // Run-length projection: no full-directory materialization at 100k items.
  const inlineLayout = useMemo(() => {
    if (!inlineEnabled || directoryID === null) return null
    return xDriveFileExplorerInlineLayout<XDriveFileExplorerItem>({
      ownerID: directoryID,
      itemCount: totalCount,
      itemAt: index => props.virtualCollection?.itemAt(index) ?? props.items[index],
    }, (props.inlineBranches ?? []).filter(branch => branch.itemCount !== null).map(branch => ({
      ownerID: branch.ownerID, parentID: branch.parentID,
      parentIndex: branch.parentIndex, itemCount: branch.itemCount ?? 0,
      itemAt: index => branch.items.get(index),
    })))
  }, [inlineEnabled, directoryID, totalCount, props.virtualCollection, props.items, props.inlineBranches])
  const displayedCount = inlineLayout?.itemCount ?? totalCount
  const logicalRows = effectiveGrid ? Math.ceil(displayedCount / columns) : displayedCount
  const windowRows = mobileFilesWindow(logicalRows, scrollTop, viewport.height, rowHeight)
  const start = windowRows.start * (effectiveGrid ? columns : 1)
  const end = Math.min(displayedCount, windowRows.end * (effectiveGrid ? columns : 1))
  const inlineItemByID = useMemo(() => {
    const index = new Map<string, XDriveFileExplorerItem>()
    for (const branch of props.inlineBranches ?? []) {
      for (const item of branch.items.values()) index.set(String(item.id), item)
    }
    return index
  }, [props.inlineBranches])
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
    // Retain Server group membership/order: children are inserted under their
    // parent's section, without regrouping the sparse loaded subset.
    const groups = inlineLayout && directoryID !== null
      ? xDriveFileExplorerInlineGroupIndex(
          inlineLayout, directoryID, props.virtualCollection?.groups ?? [], totalCount)
      : (props.virtualCollection?.groups ?? [])
    return xDriveCreateFileExplorerGroupLayout({
      groups: groups ?? [],
      groupBy: props.grouping.groupBy,
      itemCount: displayedCount,
      columns: effectiveGrid ? columns : 1,
      rowHeight,
      groupHeaderHeight: 30,
      groupGap: 6,
    })
  }, [props.grouping?.groupBy, props.trashActive, props.virtualCollection?.groups,
    inlineLayout, directoryID, totalCount, displayedCount, effectiveGrid, columns, rowHeight])
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
  const confirmDeleteSavedSearch = () => {
    const target = deleteSavedSearchTarget
    if (!target || !props.onDeleteSavedSearch || deleteSavedSearchBusyRef.current) return
    deleteSavedSearchBusyRef.current = true
    const generation = deleteSavedSearchGenerationRef.current
    setDeleteSavedSearchBusy(true)
    setDeleteSavedSearchError('')
    void Promise.resolve().then(() => props.onDeleteSavedSearch?.(target.id)).then(() => {
      if (deleteSavedSearchGenerationRef.current === generation) setDeleteSavedSearchTarget(null)
    }).catch(error => {
      if (deleteSavedSearchGenerationRef.current !== generation) return
      setDeleteSavedSearchError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (deleteSavedSearchGenerationRef.current !== generation) return
      deleteSavedSearchBusyRef.current = false
      setDeleteSavedSearchBusy(false)
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
    selectionAbortRef.current?.abort()
    deleteSavedSearchGenerationRef.current += 1
  }, [props.lifecycleKey])
  // A dropped directory may still be reading on another browser task. Fence
  // its result before starting uploads after account, folder or Search changes.
  useEffect(() => () => {
    externalDropGenerationRef.current += 1
  }, [props.lifecycleKey, directoryID, props.trashActive, props.searchActive, props.virtualCollection?.interactionKey])
  useEffect(() => {
    if (props.searchActive) return
    setReplaceSavedSearchOpen(false)
    setReplaceSavedSearchTargetID(null)
  }, [props.searchActive])
  useEffect(() => {
    // Path navigation is a Files operation, never a Trash mutation.
    if (props.trashActive) setGoToPathOpen(false)
  }, [props.trashActive])
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
    if (!ready || !showDirectory || !totalCount) return
    if (inlineLayout && directoryID !== null) {
      // When Server groups are visible, use the group's positioned virtual
      // segments rather than the ungrouped scrollTop/window approximation.
      const visible = groupedLayout
        ? groupedSegments.filter(segment => segment.endIndex > segment.startIndex)
        : []
      if (groupedLayout && visible.length === 0) {
        props.onInlineViewport?.([])
        return
      }
      const from = groupedLayout ? visible[0].startIndex : start
      const through = groupedLayout
        ? visible[visible.length - 1].endIndex - 1 : Math.max(start, end - 1)
      const ranges = xDriveFileExplorerInlineVisibleRanges(inlineLayout, from, through)
      const roots = ranges.filter(range => range.ownerID === directoryID)
      if (roots.length && props.virtualCollection?.onRangeChange) {
        props.virtualCollection.onRangeChange(roots[0].startIndex, roots[roots.length - 1].endIndex)
      }
      props.onInlineViewport?.(ranges.filter(range => range.ownerID !== directoryID))
      return
    }
    if (!props.virtualCollection?.onRangeChange) return
    if (groupedLayout) {
      const visible = groupedSegments.filter(segment => segment.endIndex > segment.startIndex)
      if (!visible.length) return
      props.virtualCollection.onRangeChange(visible[0].startIndex, visible[visible.length - 1].endIndex - 1)
      return
    }
    props.virtualCollection.onRangeChange(start, Math.max(start, end - 1))
    props.onInlineViewport?.([])
  }, [ready, showDirectory, directoryID, props.virtualCollection, props.onInlineViewport,
    groupedLayout, groupedSegments, inlineLayout, start, end, totalCount])

  useEffect(() => {
    if (!showDirectory || props.trashActive || props.searchActive) props.onClearInline?.()
  }, [showDirectory, props.trashActive, props.searchActive, props.onClearInline])

  useEffect(() => {
    selectionAbortRef.current?.abort()
    selectionAbortRef.current = null
    selectionIntentRef.current += 1
    setSelectionLoad(null)
    setSelected(new Map())
    setSelectionMode(false)
    setSelectionFeedback('')
    setSelectionMoreAnchor(null)
    setClearRecentConfirm(false)
    setItemMenu(null)
    setCollectionMenu(null)
    // A pending rename belongs to the original account/directory/Search
    // scope; the shared FileNameDialog fences any late Server response.
    setRenaming(null)
    // Owner/scope changes close the inspector and abort old Server stats
    // through the existing shared PropertiesController cleanup.
    setPropertiesItems([])
  }, [section, props.trashActive, props.searchActive, props.virtualCollection?.interactionKey, props.lifecycleKey, directoryID])

  // Notify the same Web workspace of selected sparse Nodes before their pages
  // can be evicted by scrolling. The callback retains IDs/revisions only;
  // Mobile never owns a second API, permission check or mutation controller.
  useEffect(() => {
    props.onSelectedItemsChange?.([...selected.values()])
  }, [selected, props.onSelectedItemsChange])

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

  const mediaEligible = properties?.kind === 'file' && (
    ['image', 'video'].includes(xDriveFileKind(properties.name, properties.kind)) ||
    properties.name.toLowerCase().endsWith('.livp')
  )
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

  // Use the same cancellable Server stats controller and property dialog as
  // wide Web. No Mobile-only traversal, recursive size scan or REST endpoint.
  const propertiesSource = propertiesStatsState.loading ? '正在加载…'
    : propertiesStatsState.error ? '加载失败'
      : propertiesStatsState.stats?.sources?.length
        ? propertiesStatsState.stats.sources.map(source => `${source.name} (${source.kind})`).join('；')
        : '—'
  const propertiesPath = properties?.path || properties?.secondaryLabel ||
    props.crumbs.map(crumb => crumb.name).join('/')
  const propertiesCreated = properties?.createdAt ? new Date(properties.createdAt).toLocaleString() : '—'
  const propertiesModified = properties?.updatedAt ? new Date(properties.updatedAt).toLocaleString() : '—'
  const recursiveSize = propertiesStatsState.stats
    ? formatBytes(propertiesStatsState.stats.total_bytes)
    : propertiesStatsState.loading ? '正在计算…'
      : propertiesStatsState.error ? '计算失败' : '—'
  const recursiveContent = propertiesStatsState.stats
    ? `${propertiesStatsState.stats.file_count} 个文件 · ${propertiesStatsState.stats.folder_count} 个文件夹`
    : propertiesStatsState.loading ? '正在计算…'
      : propertiesStatsState.error ? '计算失败' : '—'
  const bulkPropertiesTotals = useMemo(() => {
    let fileCount = 0
    let fileBytes = 0
    for (const item of propertiesItems) {
      if (item.kind !== 'file') continue
      fileCount += 1
      fileBytes += item.size ?? 0
    }
    return { fileCount, fileBytes, hasFolder: fileCount !== propertiesItems.length }
  }, [propertiesItems])
  const propertiesRows: XDriveFilePropertiesDialogProperty[] = properties ? [
    { label: '类型', value: labelOf(properties), section: 'general' },
    { label: '修改时间', value: propertiesModified, section: 'general' },
    { label: '创建时间', value: propertiesCreated, section: 'general' },
    { label: '位置', value: propertiesPath, section: 'general' },
    ...(properties.availability ? [
      { label: '可用性', value: properties.availability.label, section: 'general' as const },
    ] : []),
    { label: '大小', value: properties.kind === 'dir'
      ? recursiveSize : properties.size === undefined ? '未知' : formatBytes(properties.size), section: 'content' },
    ...(properties.kind === 'dir' ? [
      { label: '内容', value: recursiveContent, section: 'content' as const },
    ] : []),
    ...(properties.properties ?? []),
    ...(properties.kind === 'file' ? [
      { label: 'SHA-256', value: properties.sha256 || '—', section: 'technical' as const },
    ] : []),
    { label: 'Revision', value: properties.revision ?? '—', section: 'technical' },
    { label: 'ID', value: String(properties.id), section: 'technical' },
    { label: '来源', value: propertiesSource, section: 'technical' },
  ] : propertiesItems.length > 1 ? [
    { label: '项目数', value: `${propertiesItems.length} 个`, section: 'general' },
    { label: '位置', value: props.crumbs.map(crumb => crumb.name).join('/'), section: 'general' },
    { label: '内容', value: bulkPropertiesTotals.hasFolder
      ? recursiveContent
      : `${bulkPropertiesTotals.fileCount} 个文件 · 0 个文件夹`, section: 'content' },
    { label: '文件大小合计', value: bulkPropertiesTotals.hasFolder
      ? recursiveSize : formatBytes(bulkPropertiesTotals.fileBytes), section: 'content' },
  ] : []
  const mediaFileRows: Array<[string, ReactNode]> = properties ? [
    ['位置', propertiesPath],
    ['创建时间', propertiesCreated],
    ['修改时间', propertiesModified],
    ...(properties.availability ? [['可用性', properties.availability.label] as [string, string]] : []),
    ...(properties.sha256 ? [['SHA-256', properties.sha256] as [string, string]] : []),
    ...(properties.properties ?? []).map((property): [string, ReactNode] => [property.label, property.value]),
    ['Revision', String(properties.revision ?? '—')],
    ['ID', String(properties.id)],
    ['来源', propertiesSource],
  ] : []

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
  const openGoToPath = () => {
    if (!props.onPathSubmit || props.trashActive) return
    setGoToPathDraft(props.pathValue ?? props.crumbs.map(crumb => crumb.name).join('/'))
    setGoToPathOpen(true)
  }
  const submitGoToPath = () => {
    const target = goToPathDraft.trim()
    if (!target || !props.onPathSubmit || props.trashActive) return
    setGoToPathOpen(false)
    // This is navigation, not Search and not an internal FileExplorer tab.
    // Show the existing Browse context; the shared workspace resolves the
    // canonical path, authorizes it and owns errors and navigation history.
    beginBrowse(directoryID)
    props.onPathSubmit(target)
  }
  const onOpenEntry = (item: XDriveFileExplorerItem, ownerID?: number) => {
    // Trash actions stay in the existing restore/delete Context Menu. A
    // disabled ordinary Open must never persist a trashed folder as Browse.
    if (props.trashActive) return
    if (selectionMode) {
      // A manual selection supersedes an in-flight Select All range intent.
      selectionAbortRef.current?.abort()
      selectionAbortRef.current = null
      selectionIntentRef.current += 1
      setSelectionLoad(null)
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
    void Promise.resolve(props.onOpenItem(item, ownerID)).then(accepted => {
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
    else { props.onClearInline?.(); props.onRefresh() }
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
    const target = folder && (
      inlineItemByID.get(folder.dataset.mobileFilesFolderId ?? '') ??
      (props.virtualCollection
        ? [...props.virtualCollection.loadedItems.values()].find(x => String(x.id) === folder.dataset.mobileFilesFolderId)
        : props.items.find(x => String(x.id) === folder.dataset.mobileFilesFolderId))
    )
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

  type MobileExternalTarget =
    | { kind: 'folder'; item: XDriveFileExplorerItem }
    | { kind: 'crumb'; crumb: XDriveFileExplorerCrumb }
  const externalDropEnabled = showDirectory && !props.trashActive && Boolean(
    props.onExternalFilesDrop || props.onExternalFolderDrop ||
    props.onExternalFilesDropToCrumb || props.onExternalFolderDropToCrumb
  )
  const externalDragOver = (event: ReactDragEvent<HTMLElement>, target?: MobileExternalTarget) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (!externalDropEnabled) return
    if (target) event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDropFolderID(target?.kind === 'folder' ? String(target.item.id) : null)
    setDropCrumbID(target?.kind === 'crumb' ? String(target.crumb.id) : null)
  }
  const externalDrop = (event: ReactDragEvent<HTMLElement>, target?: MobileExternalTarget) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    if (target) event.stopPropagation()
    setDropFolderID(null)
    setDropCrumbID(null)
    if (!externalDropEnabled) return
    const generation = externalDropGenerationRef.current
    const dataTransfer = event.dataTransfer
    const files = Array.from(dataTransfer.files)
    // Share the exact wide-Web directory-entry reader and upload controller.
    void (async () => {
      const payload = await xDriveFileExplorerReadExternalDrop(dataTransfer)
      if (externalDropGenerationRef.current !== generation) return
      if (payload.directories.length > 0) {
        if (target?.kind === 'folder') await props.onExternalFolderDrop?.(payload, target.item)
        else if (target?.kind === 'crumb') await props.onExternalFolderDropToCrumb?.(payload, target.crumb)
        else await props.onExternalFolderDrop?.(payload)
        return
      }
      const selected = files.length > 0 ? files : payload.files.map(entry => entry.file)
      if (!selected.length) return
      if (target?.kind === 'folder') await props.onExternalFilesDrop?.(selected, target.item)
      else if (target?.kind === 'crumb') await props.onExternalFilesDropToCrumb?.(selected, target.crumb)
      else await props.onExternalFilesDrop?.(selected)
    })().catch(error => {
      if (externalDropGenerationRef.current === generation) props.onOpenError(error)
    })
  }

  const menuFor = (item: XDriveFileExplorerItem) =>
    props.getItemMenuItems(item).filter(action => action.id !== 'open-new-tab')
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
  const openProperties = (item: XDriveFileExplorerItem) => {
    setItemMenu(null)
    setPropertiesItems([item])
  }
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
    setItemMenu(null)
    setRenaming(item)
  }
  // A held file/folder's context commands operate on that precise Node,
  // even if an unrelated multi-selection is retained elsewhere. Wide Web
  // already uses this same Server-backed per-action eligibility contract.
  const contextItemAction = (
    action: 'cut' | 'copy' | 'move-to' | 'copy-to',
    item: XDriveFileExplorerItem,
  ) => {
    if (props.trashActive || props.getSelectionActionDisabledReason?.(action, [item], 1)) return
    setItemMenu(null)
    if (action === 'cut') props.onCut([item])
    if (action === 'copy') props.onCopy([item])
    if (action === 'move-to') props.onMove([item])
    if (action === 'copy-to') props.onCopyTo([item])
  }
  // Reuse the exact Wide Web/Server operation eligibility contract. A large
  // logical selection does not make an over-limit mutation actionable.
  const selectionDisabledReason = (action: XDriveFileExplorerSelectionAction) => (
    !selection.length ? '请先选择项目' :
      props.getSelectionActionDisabledReason?.(action, selection, selection.length) ?? null
  )
  const selectedMutationReason = selection.length ? selectionDisabledReason('copy') : null
  const selectedDownloadReason = selection.length ? selectionDisabledReason('download') : null
  const selectedAction = (kind: 'copy' | 'cut' | 'move' | 'copy-to' | 'download' | 'delete') => {
    const action: XDriveFileExplorerSelectionAction = kind === 'move' ? 'move-to' : kind
    if (selectionLoad || selectionDisabledReason(action)) return
    // Do not discard selection before a server-side validation, destination
    // choice or delete confirmation has actually succeeded.
    if (kind === 'copy') props.onCopy(selection)
    if (kind === 'cut') props.onCut(selection)
    if (kind === 'move') props.onMove(selection)
    if (kind === 'copy-to') props.onCopyTo(selection)
    if (kind === 'download') props.onDownload(selection)
    if (kind === 'delete') props.onDelete(selection)
  }
  const finishSelection = () => {
    selectionAbortRef.current?.abort()
    selectionAbortRef.current = null
    selectionIntentRef.current += 1
    setSelectionLoad(null)
    setSelectionMode(false)
    setSelected(new Map())
    setSelectionFeedback('')
    setSelectionMoreAnchor(null)
  }
  const cancelSelectAll = () => {
    if (!selectionLoad) return
    selectionAbortRef.current?.abort()
    selectionAbortRef.current = null
    selectionIntentRef.current += 1
    setSelectionLoad(null)
    setSelectionFeedback('已取消全选加载，保留原选择。')
    // The shared virtual collection retains previously selected identities
    // and cancels obsolete viewport requests through its existing lifecycle.
    props.virtualCollection?.retainInteractionIDs?.([...selected.keys()])
  }
  const selectAllCurrent = () => {
    if (!Number.isSafeInteger(totalCount) || totalCount <= 0 || props.loading || selectionLoad) return
    selectionAbortRef.current?.abort()
    const controller = new AbortController()
    selectionAbortRef.current = controller
    const intent = ++selectionIntentRef.current
    const scope = selectionScopeRef.current
    const count = totalCount
    const collection = props.virtualCollection
    const isCurrent = () => (
      !controller.signal.aborted && selectionIntentRef.current === intent && selectionScopeRef.current === scope
    )
    setSelectionFeedback('')
    setSelectionLoad({ intent, loaded: 0, total: count })
    // Match wide Web's shared Server-backed VirtualCollection page contract.
    // No dense 100k range is issued as one HTTP request. Commit atomically
    // only after every page and every unique Node ID has been validated.
    void (async () => {
      const results: XDriveFileExplorerItem[] = []
      try {
        for (let start = 0; start < count; start += XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE) {
          if (!isCurrent()) return
          const end = Math.min(count - 1, start + XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE - 1)
          const page = collection?.collectRange
            ? await collection.collectRange(start, end, controller.signal)
            : Array.from({ length: end - start + 1 },
                (_, offset) => collection?.itemAt(start + offset) ?? props.items[start + offset])
          if (!isCurrent()) return
          if (!page || page.length !== end - start + 1 ||
              page.some(item => !item || !Number.isSafeInteger(Number(item.id)) || Number(item.id) <= 0)) {
            setSelectionFeedback('未能完成全选，已保留原选择。请重试全选。')
            return
          }
          results.push(...page)
          setSelectionLoad({ intent, loaded: results.length, total: count })
        }
        if (!isCurrent()) return
        if (new Set(results.map(mobileItemKey)).size !== count) {
          setSelectionFeedback('结果在加载期间发生变化，已保留原选择。请刷新后重试全选。')
          return
        }
        setSelected(new Map(results.map(item => [mobileItemKey(item), item])))
      } catch {
        if (isCurrent()) setSelectionFeedback('未能完成全选，已保留原选择。请重试全选。')
      } finally {
        if (selectionAbortRef.current === controller) selectionAbortRef.current = null
        if (isCurrent()) setSelectionLoad(null)
      }
    })()
  }
  const handleFilesKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    // Native editing, accessibility menus, dialogs and text selection retain
    // their own keyboard handling; never intercept an input's Ctrl/Cmd+A/C/V.
    if (
      event.nativeEvent?.isComposing || event.repeat ||
      target?.isContentEditable ||
      target?.closest?.('input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"], [role="menuitem"]') ||
      moreAnchor || arrangeAnchor || selectionMoreAnchor || savedSearchMenu ||
      itemMenu || collectionMenu || renaming || propertiesItems.length ||
      nativeShare || goToPathOpen || replaceSavedSearchOpen ||
      deleteSavedSearchTarget || clearRecentConfirm || editBrowseHome
    ) return

    const command = xDriveFileExplorerKeyboardCommand(event, filesKeyboardProfile)
    if (event.key === 'Escape' && selectionActive) {
      event.preventDefault()
      if (selectionLoad) cancelSelectAll()
      else finishSelection()
      return
    }
    if (command === 'focus-search' && !props.trashActive) {
      event.preventDefault()
      scrollHostRef.current?.scrollTo({ top: 0 })
      setScrollTop(0)
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      return
    }
    if (!showDirectory || props.trashActive) return
    if (command === 'select-all') {
      event.preventDefault()
      if (!props.loading && totalCount > 0) {
        setSelectionMode(true)
        selectAllCurrent()
      }
      return
    }
    if ((command === 'paste' || command === 'paste-move') && props.canPaste) {
      event.preventDefault()
      props.onPaste(command === 'paste-move' ? 'move' : undefined)
      return
    }
    if (command === 'undo' && props.canUndo && props.onUndo) {
      event.preventDefault()
      props.onUndo()
      return
    }
    if (command === 'redo' && props.canRedo && props.onRedo) {
      event.preventDefault()
      props.onRedo()
      return
    }
    if (!selectionActive) return
    if (command === 'copy' || command === 'cut' || command === 'delete') {
      event.preventDefault()
      if (selection.length && !selectionLoad) selectedAction(command)
      return
    }
    if (command === 'copy-path' && props.onCopyPaths) {
      event.preventDefault()
      if (selection.length && !selectionLoad) props.onCopyPaths(selection)
    }
  }
  const renderEntry = (
    item: XDriveFileExplorerItem, key: string, depth = 0,
    ownerID = directoryID ?? 0, sourceIndex = -1,
  ) => {
    const chosen = selected.has(mobileItemKey(item))
    const inlineBranch = props.inlineBranches?.find(branch => branch.ownerID === Number(item.id))
    const canDisclose = inlineEnabled && !selectionMode && item.kind === 'dir' && sourceIndex >= 0
    return (
      <Box
        key={key}
        data-mobile-files-item
        data-mobile-files-folder-id={item.kind === 'dir' ? String(item.id) : undefined}
        data-mobile-files-depth={depth}
        role="button"
        tabIndex={0}
        aria-label={selectionMode ? `${chosen ? '已选' : '未选'}，${item.name}` : item.name}
        aria-pressed={selectionMode ? chosen : undefined}
        onClick={() => { if (!cancelClickRef.current) onOpenEntry(item, ownerID); else cancelClickRef.current = false }}
        onDragOver={item.kind === 'dir' ? event => externalDragOver(event, { kind: 'folder', item }) : undefined}
        onDrop={item.kind === 'dir' ? event => externalDrop(event, { kind: 'folder', item }) : undefined}
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
          const command = xDriveFileExplorerKeyboardCommand(event, filesKeyboardProfile)
          if (!selectionActive && !props.trashActive &&
              (command === 'copy' || command === 'cut' || command === 'copy-path' || command === 'delete')) {
            event.preventDefault()
            event.stopPropagation()
            if (command === 'copy-path') props.onCopyPaths?.([item])
            else if (command === 'delete') {
              if (!props.getSelectionActionDisabledReason?.('delete', [item], 1)) props.onDelete([item])
            } else contextItemAction(command, item)
            return
          }
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            setItemMenu({ item, x: rect.left + 14, y: rect.top + 28 })
          } else if (event.key === ' ' && !event.altKey && !event.ctrlKey && !event.metaKey && !selectionMode && !props.trashActive && props.onQuickLookItem) {
            // Desktop Space uses Quick Look. Retain Enter/tap Open and explicit selection.
            event.preventDefault()
            props.onQuickLookItem(item, ownerID)
          } else if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            onOpenEntry(item, ownerID)
          }
        }}
        sx={{
          minWidth: 0, minHeight: effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT,
          display: 'flex', flexDirection: effectiveGrid ? 'column' : 'row', alignItems: 'center',
          gap: effectiveGrid ? 0.5 : 1.5, py: effectiveGrid ? 1 : 0.6,
          px: effectiveGrid ? 0.5 : 2,
          pl: !effectiveGrid && depth > 0 ? 'calc(16px + ' + Math.min(depth, 4) * 16 + 'px)' : undefined,
          position: 'relative', cursor: 'pointer',
          bgcolor: chosen || dropFolderID === String(item.id) ? 'action.selected' :
            effectiveGrid ? 'transparent' : (theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff'),
          outline: dropFolderID === String(item.id) ? '2px solid' : 'none',
          outlineColor: IOS_FILES_MOBILE_BLUE, outlineOffset: -2,
          '&:focus-visible': { outline: '2px solid', outlineColor: IOS_FILES_MOBILE_BLUE },
          ...(!effectiveGrid ? { '&:not(:last-child)::after': {
            content: '""', position: 'absolute', bottom: 0,
            left: mobileFilesRowTextInset(selectionMode, depth), right: 0,
            borderBottom: '1px solid', borderColor: 'divider', pointerEvents: 'none',
          } } : {}),
        }}
      >
        {selectionMode ? (
          <Box sx={{ color: chosen ? 'primary.main' : 'text.disabled', width: 24, height: 24,
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          <Typography data-mobile-files-item-title variant="body2" fontWeight={500} noWrap textAlign={effectiveGrid ? 'center' : 'left'}>{item.name}</Typography>
          <Typography data-mobile-files-item-meta variant="caption" color="text.secondary" noWrap display="block" textAlign={effectiveGrid ? 'center' : 'left'}>
            {inlineBranch?.error ?? (inlineBranch?.itemCount === 0 ? '空文件夹' :
              item.secondaryLabel || [labelOf(item), item.kind === 'file' && item.size !== undefined ? formatBytes(item.size) : ''].filter(Boolean).join(' · '))}
          </Typography>
        </Box>
        {!effectiveGrid && item.availability ? <XDriveFileExplorerAvailabilityBadge availability={item.availability} compact /> : null}
        {canDisclose ? (
          <IconButton data-mobile-files-folder-disclosure={String(item.id)}
            aria-label={inlineBranch?.error ? '重试展开 ' + item.name :
              inlineBranch ? '收起 ' + item.name : '展开 ' + item.name}
            aria-expanded={Boolean(inlineBranch)}
            disabled={Boolean(inlineBranch?.loading)}
            onClick={event => {
              event.stopPropagation()
              if (inlineBranch?.error) props.onRetryInlineFolder?.(Number(item.id))
              else props.onToggleInlineFolder?.(item, ownerID, sourceIndex)
            }}
            onPointerDown={event => event.stopPropagation()}
            onPointerUp={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
            sx={{ width: MIN_TOUCH, height: MIN_TOUCH, flexShrink: 0,
              color: inlineBranch?.error ? 'error.main' : IOS_FILES_MOBILE_BLUE }}>
            {inlineBranch?.loading ? <CircularProgress size={18}/> :
              <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15,
                transform: inlineBranch ? 'rotate(90deg)' : 'rotate(180deg)' }}/>}
          </IconButton>
        ) : !effectiveGrid && item.kind === 'dir' ? (
          <ArrowBackIosNewRoundedIcon sx={{ fontSize: 13, transform: 'rotate(180deg)', color: 'text.disabled' }}/>
        ) : null}
      </Box>
    )
  }
  const mobileRow = (
    entry: SectionEntry, action: () => void, isFolder = false,
    owner?: 'recent' | 'favorites',
    locationKind?: 'cloud' | 'trash' | 'smart' | 'tag',
  ) => (
    <Box key={`${locationKind ?? owner ?? 'home'}:${String(entry.id)}`} role="button" tabIndex={0}
      data-mobile-files-collection-row={owner}
      aria-keyshortcuts={owner ? 'Shift+F10' : undefined}
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
        // ContextMenu and Shift+F10 must work on the same Recent/Favorites
        // selection as touch hold/right-click, without launching the item.
        // Never turn a nested Browse-home edit control's key into row Open.
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
        if (owner && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          setCollectionMenu({ entry, owner, x: rect.left + 14, y: rect.top + 28 })
        } else if (!event.shiftKey && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          action()
        }
      }}
      sx={{ display: 'flex', alignItems: 'center', minHeight: MOBILE_FILES_ROW_HEIGHT, px: 2, gap: 1.5,
        position: 'relative',
        bgcolor: theme => theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff',
        '&:not(:last-child)::after': {
          content: '""', position: 'absolute', bottom: 0,
          left: mobileFilesRowTextInset(false), right: 0,
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
        <Typography data-mobile-files-collection-title variant="body2" noWrap>{entry.name}</Typography>
        <Typography data-mobile-files-collection-meta variant="caption" color="text.secondary" noWrap display="block">{entry.subtitle ?? (entry.kind === 'dir' ? '文件夹' : '文件')}</Typography>
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
        {kind === 'saved' && (props.onRenameSavedSearch || props.onReplaceSavedSearch || props.onDeleteSavedSearch) ? (
          <IconButton data-mobile-files-saved-options={entry.id}
            aria-label={`管理智能文件夹 ${entry.name}`}
            disabled={Boolean(props.organizationBusyKey)}
            onClick={event => setSavedSearchMenu({ anchor: event.currentTarget, id: entry.id, name: entry.name })}
            sx={{ width: MIN_TOUCH, height: MIN_TOUCH, flexShrink: 0 }}>
            <MoreHorizRoundedIcon />
          </IconButton>
        ) : null}
      </Stack>
    )
  }

  const renderLogicalCell = (index: number) => {
    const inline = inlineLayout ? xDriveFileExplorerInlineCellAt(inlineLayout, index) : undefined
    const item = inlineLayout ? inline?.item : props.virtualCollection?.itemAt(index) ?? props.items[index]
    return item ? renderEntry(item, `${index}:${mobileItemKey(item)}`,
      inline?.depth ?? 0, inline?.ownerID ?? directoryID ?? 0, inline?.sourceIndex ?? index) : (
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
  // iOS 27 Files displays both Icons and List as explicit radio-like actions
  // in More. This changes Mobile presentation only, not the shared Web/Desktop
  // list query, workspace, tabs, Server sort, or virtual scroll owner.
  const chooseMobileView = (next: 'details' | 'grid') => {
    setMoreAnchor(null)
    if (next === viewPreference) return
    setViewPreference(next)
    browseScrollRef.current = 0
    setScrollTop(0)
    scrollHostRef.current?.scrollTo({ top: 0 })
    persist({ view: next, scrollTop: 0 })
  }

  return (
    <XDriveFileExplorerThumbnailProvider lifecycleKey={props.lifecycleKey} loadThumbnail={props.loadThumbnail}>
      <Box ref={ownerRef} data-xdrive-mobile-files onKeyDown={handleFilesKeyboard} sx={{
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
              {selectionLoad ? (
                <Button data-mobile-files-select-cancel size="small" onClick={cancelSelectAll}
                  sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>取消</Button>
              ) : (
                <Button data-mobile-files-select-all aria-label="全选当前目录或搜索结果"
                  size="small" onClick={selectAllCurrent}
                  disabled={props.loading || totalCount === 0}
                  sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>全选</Button>
              )}
              <Button size="small" onClick={finishSelection}
                sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}>完成</Button>
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
          onDragOver={event => externalDragOver(event)}
          onDrop={event => externalDrop(event)}
          onDragLeave={() => { setDropFolderID(null); setDropCrumbID(null) }}
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
            <TextField inputRef={searchInputRef} size="small" fullWidth value={props.searchValue}
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
              {props.organizationLoading ? (
                <Typography data-mobile-files-organization-loading variant="caption" sx={{ px: 2 }}>
                  正在加载智能文件夹和标签…
                </Typography>
              ) : null}
              {props.organizationError ? (
                <Stack data-mobile-files-organization-error role="alert" direction="row" alignItems="center"
                  sx={{ px: 2, gap: 1, minHeight: MIN_TOUCH }}>
                  <Typography variant="caption" color="error" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                    {props.organizationError}
                  </Typography>
                  {props.onRetryOrganization ? <Button onClick={props.onRetryOrganization} sx={{ minHeight: MIN_TOUCH }}>重试</Button> : null}
                </Stack>
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
                        ...entry, kind: 'dir', subtitle: entry.subtitle ? `智能文件夹 · ${entry.subtitle}` : '智能文件夹',
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
                      onDragOver={event => externalDragOver(event, { kind: 'crumb', crumb })}
                      onDrop={event => externalDrop(event, { kind: 'crumb', crumb })}
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
        {selectionLoad ? <Typography data-mobile-files-select-progress role="status"
          variant="caption" sx={{ px: 2, py: 0.5, flexShrink: 0 }}>
          正在选择 {selectionLoad.loaded} / {selectionLoad.total} 项
        </Typography> : null}
        {selectionFeedback ? <Typography role="status" variant="caption" color="warning.main"
          sx={{ px: 2, py: 0.5, flexShrink: 0 }}>{selectionFeedback}</Typography> : null}
        {selectionActive && !selectionLoad && selection.length > 0 &&
          (selectedMutationReason || selectedDownloadReason) ? (
          <Typography data-mobile-files-selection-limits role="status" variant="caption"
            color="text.secondary" sx={{ px: 2, py: 0.5, flexShrink: 0 }}>
            {selectedMutationReason ? `批量操作：${selectedMutationReason}` : ''}
            {selectedMutationReason && selectedDownloadReason ? '；' : ''}
            {selectedDownloadReason ? `下载：${selectedDownloadReason}` : ''}
          </Typography>
        ) : null}
        {selectionActive ? (
          <Stack data-xdrive-mobile-selection-toolbar direction="row" alignItems="stretch" sx={{
            px: 0.5, pt: 0.5, pb: 'max(env(safe-area-inset-bottom), 4px)',
            borderTop: 1, borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper',
          }}>
            <Button aria-label="复制已选" disabled={Boolean(selectionLoad || selectionDisabledReason('copy'))} onClick={() => selectedAction('copy')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <ContentCopyOutlinedIcon fontSize="small"/>复制
            </Button>
            <Button aria-label="移动已选" disabled={Boolean(selectionLoad || selectionDisabledReason('move-to'))} onClick={() => selectedAction('move')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <DriveFileMoveOutlinedIcon fontSize="small"/>移动
            </Button>
            <Button aria-label="下载已选" disabled={Boolean(selectionLoad || selectionDisabledReason('download'))} onClick={() => selectedAction('download')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <DownloadRoundedIcon fontSize="small"/>下载
            </Button>
            <Button aria-label="删除已选" disabled={Boolean(selectionLoad || selectionDisabledReason('delete'))} onClick={() => selectedAction('delete')}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11, color: 'error.main' }}>
              <DeleteOutlineRoundedIcon fontSize="small"/>删除
            </Button>
            <Button aria-label="更多已选操作" disabled={!selection.length || Boolean(selectionLoad)}
              onClick={event => setSelectionMoreAnchor(event.currentTarget)}
              sx={{ minWidth: 0, minHeight: 54, flex: 1, display: 'flex', flexDirection: 'column', gap: 0, fontSize: 11 }}>
              <MoreHorizRoundedIcon fontSize="small"/>更多
            </Button>
          </Stack>
        ) : (
          <Stack component="nav" direction="row" justifyContent="space-around" sx={{
            flexShrink: 0, mx: 1.5, mt: 0.75,
            mb: 'max(env(safe-area-inset-bottom), 6px)',
            px: 0.5, py: 0.35, borderRadius: '999px',
            border: '1px solid', borderColor: 'divider',
            bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(42,42,45,0.92)' : 'rgba(249,249,253,0.94)',
            backdropFilter: 'blur(18px) saturate(160%)',
            boxShadow: '0 3px 16px rgba(0,0,0,0.10)',
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
          <MenuItem disabled={Boolean(selectionLoad || selectionDisabledReason('cut'))}
            onClick={() => { setSelectionMoreAnchor(null); selectedAction('cut') }}>剪切所选</MenuItem>
          <MenuItem disabled={Boolean(selectionLoad || selectionDisabledReason('copy-to'))}
            onClick={() => { setSelectionMoreAnchor(null); selectedAction('copy-to') }}>复制到…</MenuItem>
          <MenuItem disabled={Boolean(selectionLoad || selectionDisabledReason('download'))}
            onClick={() => { setSelectionMoreAnchor(null); selectedAction('download') }}>下载所选</MenuItem>
          {props.onCopyPaths ? <MenuItem disabled={!selection.length || Boolean(selectionLoad)} onClick={() => {
            setSelectionMoreAnchor(null); props.onCopyPaths?.(selection)
          }}>复制所选路径</MenuItem> : null}
          <MenuItem disabled={Boolean(selectionLoad || selectionDisabledReason('manage-tags'))}
            onClick={() => {
              if (selectionDisabledReason('manage-tags')) return
              setSelectionMoreAnchor(null)
              props.onManageTags(selection)
            }}>添加/管理标签</MenuItem>
          <MenuItem data-mobile-files-batch-properties
            disabled={!selection.length || Boolean(selectionLoad)}
            onClick={() => {
              if (!selection.length || selectionLoad) return
              setSelectionMoreAnchor(null)
              setPropertiesItems([...selection])
            }}>所选项目属性</MenuItem>
        </Menu>
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(70dvh, 520px)' } } }}>
          {section === 'browse' && !showDirectory ? overflowAction('整理浏览首页', () => setEditBrowseHome(true)) : null}
          {showDirectory && !props.trashActive ? overflowAction('选择', () => setSelectionMode(true)) : null}
          {showDirectory && !props.trashActive ? overflowAction('新建文件夹', props.onCreateFolder) : null}
          {showDirectory ? <Divider data-mobile-files-view-group="start" sx={{ my: 0.5 }} /> : null}
          {showDirectory ? ([
            { view: 'grid', label: '图标', icon: <ViewModuleRoundedIcon fontSize="small" /> },
            { view: 'details', label: '列表', icon: <ViewListRoundedIcon fontSize="small" /> },
          ] as const).map(option => (
            <MenuItem key={option.view} data-mobile-files-view-option={option.view}
              role="menuitemradio" aria-checked={viewPreference === option.view}
              selected={viewPreference === option.view}
              sx={{ minHeight: MIN_TOUCH }}
              onClick={() => chooseMobileView(option.view)}>
              <ListItemIcon sx={{ minWidth: 36 }}>{option.icon}</ListItemIcon>
              {option.label}
              {viewPreference === option.view
                ? <CheckRoundedIcon sx={{ ml: 'auto', color: IOS_FILES_MOBILE_BLUE }} /> : null}
            </MenuItem>
          )) : null}
          {showDirectory ? overflowAction('排序与分组', () => {
            setArrangeAnchor(moreAnchor)
          }) : null}
          {showDirectory ? <Divider data-mobile-files-view-group="end" sx={{ my: 0.5 }} /> : null}
          {showDirectory && !props.trashActive ? overflowAction('上传文件', props.onUpload) : null}
          {showDirectory && !props.trashActive ? overflowAction('上传文件夹', props.onUploadFolder) : null}
          {showDirectory && !props.trashActive ? overflowAction('粘贴', props.onPaste, !props.canPaste) : null}
          {!props.trashActive && props.onPathSubmit
            ? overflowAction('前往文件夹路径…', openGoToPath) : null}
          {!props.trashActive ? <Divider sx={{ my: 0.5 }} /> : null}
          {!props.trashActive ? overflowAction('撤销', () => props.onUndo?.(), !props.canUndo || !props.onUndo) : null}
          {!props.trashActive ? overflowAction('重做', () => props.onRedo?.(), !props.canRedo || !props.onRedo) : null}
          {showDirectory && !props.trashActive ? overflowAction('后退（浏览历史）', () => props.onHistoryBack?.(), !props.canHistoryBack || !props.onHistoryBack) : null}
          {showDirectory && !props.trashActive ? overflowAction('前进（浏览历史）', () => props.onHistoryForward?.(), !props.canHistoryForward || !props.onHistoryForward) : null}
          {section === 'recent' ? overflowAction('清空最近记录', () => setClearRecentConfirm(true)) : null}
          {overflowAction('刷新', refresh)}
          {overflowAction('管理标签', props.onManageTags)}
          {overflowAction('搜索全部文件', () => launchGlobalSearch(() => props.onSearch(props.searchValue)))}
          {props.searchActive && props.canReplaceSavedSearch && props.savedSearches.length > 0
            ? overflowAction('更新已有智能文件夹…', () => {
              setReplaceSavedSearchTargetID(null)
              setReplaceSavedSearchOpen(true)
            })
            : null}
        </Menu>
        <Dialog data-mobile-files-go-to-path open={goToPathOpen && !props.trashActive}
          onClose={() => setGoToPathOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>前往文件夹</DialogTitle>
          <Box component="form" onSubmit={event => {
            event.preventDefault()
            submitGoToPath()
          }}>
            <DialogContent>
              <TextField autoFocus fullWidth size="small"
                label="文件夹路径" aria-label="文件夹路径"
                value={goToPathDraft}
                onChange={event => setGoToPathDraft(event.target.value)}
                helperText="使用与 Web 文件管理器相同的目录路径；不是全库搜索。"
                sx={{ '& .MuiOutlinedInput-root': { minHeight: MIN_TOUCH } }} />
            </DialogContent>
            <DialogActions>
              <Button sx={{ minHeight: MIN_TOUCH }} onClick={() => setGoToPathOpen(false)}>取消</Button>
              <Button data-mobile-files-go-to-path-submit type="submit"
                disabled={!goToPathDraft.trim() || !props.onPathSubmit}
                sx={{ minHeight: MIN_TOUCH }}>前往</Button>
            </DialogActions>
          </Box>
        </Dialog>
        <Menu data-mobile-files-saved-search-menu anchorEl={savedSearchMenu?.anchor ?? null}
          open={Boolean(savedSearchMenu)} onClose={() => setSavedSearchMenu(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(65dvh, 420px)' } } }}>
          {props.onRenameSavedSearch ? <MenuItem sx={{ minHeight: MIN_TOUCH }}
            onClick={() => {
              const target = savedSearchMenu
              setSavedSearchMenu(null)
              if (target) props.onRenameSavedSearch?.(target.id)
            }}>重命名智能文件夹</MenuItem> : null}
          {props.onReplaceSavedSearch ? <MenuItem sx={{ minHeight: MIN_TOUCH }}
            disabled={!props.canReplaceSavedSearch}
            onClick={() => {
              const target = savedSearchMenu
              setSavedSearchMenu(null)
              if (target) props.onReplaceSavedSearch?.(target.id)
            }}>更新为当前搜索</MenuItem> : null}
          {props.onDeleteSavedSearch ? <MenuItem sx={{ minHeight: MIN_TOUCH, color: 'error.main' }}
            onClick={() => {
              const target = savedSearchMenu
              setSavedSearchMenu(null)
              setDeleteSavedSearchError('')
              if (target) setDeleteSavedSearchTarget({ id: target.id, name: target.name })
            }}>删除智能文件夹</MenuItem> : null}
        </Menu>
        <Dialog data-mobile-files-saved-replace open={replaceSavedSearchOpen && Boolean(props.searchActive)}
          onClose={() => { setReplaceSavedSearchOpen(false); setReplaceSavedSearchTargetID(null) }}
          fullWidth maxWidth="xs">
          <DialogTitle>更新智能文件夹</DialogTitle>
          <DialogContent sx={{ maxHeight: 'min(60dvh, 440px)', overflowY: 'auto' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              将当前已应用的全部文件搜索条件保存到所选智能文件夹，原规则会被替换，文件不会被修改。
            </Typography>
            {props.savedSearches.map(item => (
              <MenuItem key={item.id} data-mobile-files-saved-replace-target={item.id}
                selected={replaceSavedSearchTargetID === item.id}
                onClick={() => setReplaceSavedSearchTargetID(item.id)}
                sx={{ minHeight: MIN_TOUCH, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {item.name}
              </MenuItem>
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setReplaceSavedSearchOpen(false); setReplaceSavedSearchTargetID(null) }}
              sx={{ minHeight: MIN_TOUCH }}>取消</Button>
            <Button data-mobile-files-saved-replace-confirm disabled={!props.canReplaceSavedSearch || replaceSavedSearchTargetID === null}
              onClick={() => {
                const id = replaceSavedSearchTargetID
                setReplaceSavedSearchOpen(false)
                setReplaceSavedSearchTargetID(null)
                if (id !== null) props.onReplaceSavedSearch?.(id)
              }} sx={{ minHeight: MIN_TOUCH }}>更新规则</Button>
          </DialogActions>
        </Dialog>
        <Dialog data-mobile-files-saved-delete open={Boolean(deleteSavedSearchTarget)}
          onClose={() => {
            if (deleteSavedSearchBusy) return
            setDeleteSavedSearchTarget(null)
            setDeleteSavedSearchError('')
          }} fullWidth maxWidth="xs">
          <DialogTitle>删除智能文件夹？</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              只删除保存的搜索规则“{deleteSavedSearchTarget?.name}”，不会删除任何匹配的文件。
            </Typography>
            {deleteSavedSearchError ? (
              <Typography role="alert" variant="body2" color="error" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
                {deleteSavedSearchError}
              </Typography>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button disabled={deleteSavedSearchBusy}
              onClick={() => { setDeleteSavedSearchTarget(null); setDeleteSavedSearchError('') }}
              sx={{ minHeight: MIN_TOUCH }}>取消</Button>
            <Button data-mobile-files-saved-delete-confirm color="error" disabled={deleteSavedSearchBusy}
              onClick={confirmDeleteSavedSearch} sx={{ minHeight: MIN_TOUCH }}>
              {deleteSavedSearchBusy ? '正在删除…' : '删除规则'}
            </Button>
          </DialogActions>
        </Dialog>
        <Menu anchorEl={arrangeAnchor} open={Boolean(arrangeAnchor)} onClose={() => setArrangeAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(70dvh, 460px)' } } }}>
          {(['name', 'updated', 'type', 'size'] as const).map(key => (
            <MenuItem key={key} selected={props.sort.key === key} sx={{ minHeight: MIN_TOUCH }}
              onClick={() => { props.onSortChange({ ...props.sort, key }); setArrangeAnchor(null) }}>
              {({ name: '名称', updated: '修改日期', type: '类型', size: '大小' })[key]}
            </MenuItem>
          ))}
          <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            props.onSortChange({ ...props.sort, direction: props.sort.direction === 'asc' ? 'desc' : 'asc' })
            setArrangeAnchor(null)
          }}>方向：{props.sort.direction === 'asc' ? '升序' : '降序'}</MenuItem>
          {props.grouping && props.onGroupingChange ? (['none', 'type', 'modified', 'size'] as const).map(kind => (
            <MenuItem key={kind} selected={props.grouping?.groupBy === kind} sx={{ minHeight: MIN_TOUCH }} onClick={() => {
              if (props.grouping) props.onGroupingChange?.({ ...props.grouping, groupBy: kind })
              setArrangeAnchor(null)
            }}>{({ none: '不分组', type: '按类型分组', modified: '按修改日期分组', size: '按大小分组' })[kind]}</MenuItem>
          )) : null}
          {props.grouping && props.onGroupingChange ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
              if (props.grouping) props.onGroupingChange?.({ ...props.grouping, foldersFirst: !props.grouping.foldersFirst })
              setArrangeAnchor(null)
            }}>文件夹优先：{props.grouping.foldersFirst ? '开启' : '关闭'}</MenuItem>
          ) : null}
        </Menu>
        <Menu open={Boolean(itemMenu)} onClose={() => setItemMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={itemMenu ? { top: itemMenu.y, left: itemMenu.x } : undefined}
          slotProps={{ paper: { sx: { borderRadius: '14px', minWidth: 218,
            maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(70dvh, 560px)',
            // MUI's sm+ MenuItem rule sets minHeight:auto and overrides
            // per-row sx.minHeight at 899px. A parent-scoped descendant rule
            // wins that breakpoint for both shared and Mobile-only actions.
            '& .MuiMenuItem-root': { minHeight: MIN_TOUCH },
          } } }}>
          {itemMenu ? menuFor(itemMenu.item).filter(item => !item.danger).flatMap(item => (
            item.dividerBefore
              ? [<Divider key={`${item.id}-separator`} sx={{ my: 0.5 }}/>, mobileContextAction(item)]
              : [mobileContextAction(item)]
          )) : null}
          {itemMenu && !props.trashActive ? (
            <Divider data-mobile-files-context-separator="edit" sx={{ my: 0.5 }}/>
          ) : null}
          {itemMenu && !props.trashActive && props.onQuickLookItem ? (
            <MenuItem data-mobile-files-quick-look sx={{ minHeight: MIN_TOUCH }}
              onClick={() => {
                const item = itemMenu.item
                setItemMenu(null)
                props.onQuickLookItem?.(item)
              }}>
              <ListItemIcon><InfoOutlinedIcon fontSize="small" /></ListItemIcon>快速预览
            </MenuItem>
          ) : null}
          {itemMenu && !props.trashActive ? <MenuItem data-mobile-files-item-rename
            onClick={() => beginRename(itemMenu.item)}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><EditRoundedIcon fontSize="small"/></ListItemIcon>重命名</MenuItem> : null}
          {itemMenu && !props.trashActive ? ([
            { action: 'cut', label: '剪切', icon: <ContentCutRoundedIcon fontSize="small"/> },
            { action: 'copy', label: '复制', icon: <ContentCopyOutlinedIcon fontSize="small"/> },
            { action: 'move-to', label: '移动到…', icon: <DriveFileMoveOutlinedIcon fontSize="small"/> },
            { action: 'copy-to', label: '复制到…', icon: <ContentCopyOutlinedIcon fontSize="small"/> },
          ] as const).filter(option => !menuFor(itemMenu.item).some(item => item.id === option.action))
            .map(option => {
              const item = itemMenu.item
              const reason = props.getSelectionActionDisabledReason?.(option.action, [item], 1) ?? null
              return (
                <MenuItem key={option.action}
                  data-mobile-files-context-selection-action={option.action}
                  disabled={Boolean(reason)}
                  title={reason || undefined}
                  aria-label={reason ? `${option.label}：${reason}` : option.label}
                  onClick={() => contextItemAction(option.action, item)}
                  sx={{ minHeight: MIN_TOUCH }}>
                  <ListItemIcon>{option.icon}</ListItemIcon>{option.label}
                </MenuItem>
              )
            }) : null}
          {itemMenu && !props.trashActive && props.onCopyPaths ? (
            <MenuItem data-mobile-files-copy-path onClick={() => {
              props.onCopyPaths?.([itemMenu.item]); setItemMenu(null)
            }} sx={{ minHeight: MIN_TOUCH }}>
              <ListItemIcon><ContentCopyOutlinedIcon fontSize="small"/></ListItemIcon>复制路径
            </MenuItem>
          ) : null}
          {itemMenu?.item.kind === 'file' && !props.trashActive && canNativeShareFile ? (
            <MenuItem data-mobile-files-native-share-entry="directory"
              onClick={() => prepareNativeShare(itemMenu.item)} sx={{ minHeight: MIN_TOUCH }}>
              <ListItemIcon><ShareRoundedIcon fontSize="small"/></ListItemIcon>系统分享文件
            </MenuItem>
          ) : null}
          {itemMenu ? <MenuItem data-mobile-files-item-properties onClick={() => openProperties(itemMenu.item)}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><InfoOutlinedIcon fontSize="small"/></ListItemIcon>属性</MenuItem> : null}
          {itemMenu && menuFor(itemMenu.item).some(item => item.danger) ? (
            <Divider data-mobile-files-context-separator="danger" sx={{ my: 0.5 }}/>
          ) : null}
          {itemMenu ? menuFor(itemMenu.item).filter(item => item.danger).map(mobileContextAction) : null}
        </Menu>
        <Menu data-mobile-files-collection-menu open={Boolean(collectionMenu)} onClose={() => setCollectionMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={collectionMenu ? { top: collectionMenu.y, left: collectionMenu.x } : undefined}
          slotProps={{ paper: { sx: { borderRadius: '14px', minWidth: 218,
            maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(70dvh, 560px)' } } }}>
          {collectionMenu ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const selectedEntry = collectionMenu.entry
            const owner = collectionMenu.owner
            setCollectionMenu(null)
            const intent = ++navigationIntentRef.current
            const work = owner === 'recent' ? props.onOpenRecent(selectedEntry.id) : props.onOpenFavorite(selectedEntry.id)
            void work.then(accepted => {
              if (accepted && intent === navigationIntentRef.current && selectedEntry.kind === 'dir') beginBrowse(selectedEntry.id)
            }).catch(props.onOpenError)
          }}>打开</MenuItem> : null}
          {collectionMenu ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const entry = collectionMenu.entry
            setCollectionMenu(null)
            void props.loadNodeLocation(entry.id).then(location => {
              if (!location.parent_id) return
              void Promise.resolve(props.onShowInFolder(location)).then(accepted => {
                if (accepted !== false) beginBrowse(location.parent_id)
              }).catch(props.onOpenError)
            }).catch(props.onOpenError)
          }}>显示所在文件夹</MenuItem> : null}
          {collectionMenu ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const entry = collectionMenu.entry
            setCollectionMenu(null)
            openProperties({ id: entry.id, name: entry.name, kind: entry.kind,
              size: entry.size, revision: entry.revision, path: entry.subtitle, updatedAt: entry.updatedAt })
          }}>属性</MenuItem> : null}
          {collectionMenu?.owner === 'favorites' ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const id = collectionMenu.entry.id
            setCollectionMenu(null)
            void Promise.resolve(props.onUnfavorite(id)).catch(props.onOpenError)
          }}>取消收藏</MenuItem> : null}
          {collectionMenu && props.onCollectionAction ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} data-mobile-files-collection-action="copy"
              onClick={() => runCollectionAction(collectionMenu.entry, 'copy')}>复制</MenuItem>
          ) : null}
          {collectionMenu && props.onCollectionAction ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} data-mobile-files-collection-action="download"
              onClick={() => runCollectionAction(collectionMenu.entry, 'download')}>下载</MenuItem>
          ) : null}
          {collectionMenu?.entry.kind === 'file' && props.onCollectionAction ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} data-mobile-files-collection-action="share"
              onClick={() => runCollectionAction(collectionMenu.entry, 'share')}>分享链接</MenuItem>
          ) : null}
          {collectionMenu?.entry.kind === 'file' && canNativeShareFile ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} data-mobile-files-native-share-entry="collection"
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
        <XDriveFileNameDialog
          open={Boolean(renaming)}
          mode="rename"
          initialValue={renaming?.name ?? ''}
          lifecycleKey={selectionScopeKey + ':rename:' + String(renaming?.id ?? 0) + ':' + String(renaming?.revision ?? 0)}
          onSubmit={async name => {
            if (!renaming) throw new Error('当前文件选择已失效，请重新打开重命名。')
            // One authoritative Web Controller owns the Node id/revision,
            // conflict handling and Server permissions for both layouts.
            // Let the shared dialog retain draft and show rejected mutations.
            await props.onRename(renaming, name)
          }}
          onClose={() => setRenaming(null)}
        />
        {properties && mediaEligible && (activeMediaState?.status !== 'done' || activeMediaState.item) ? (
          <XDriveMediaDetailsInspector open item={activeMediaState?.item ?? null}
            fallbackName={properties.name} showPreview={false} onClose={() => setPropertiesItems([])}
            albums={[]} loadThumbnail={async nodeID => Number(properties.id) === nodeID
              ? (await props.loadThumbnail(properties)) ?? null : null}
            extraFileRows={mediaFileRows}
            loadNodeLocation={props.loadNodeLocation} onShowInFolder={props.onShowInFolder}/>
        ) : (
          <XDriveFilePropertiesDialog open={propertiesItems.length > 0}
            title={properties ? `属性 — ${properties.name}` : '所选项目属性'}
            properties={propertiesRows} onClose={() => setPropertiesItems([])}/>
        )}
      </Box>
    </XDriveFileExplorerThumbnailProvider>
  )
}
