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
  xDriveFileExplorerIsComposingKey,
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
  XDriveFileNameDialog, XDriveFilePropertiesDialog, XDriveStatePanel, XDriveMediaDetailsInspector, xDriveFileSupportsThumbnail,
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
import { xDriveFileExplorerMenuDisabledReason, xDriveFileExplorerMenuReasonLabel } from '../../ui/shared/src/mui/FileExplorerMenuReasons'
import {
  mobileFilesDecodeState, mobileFilesEncodeState, mobileFilesIsMoved, mobileFilesWindow,
  mobileFilesRowTextInset, mobileFilesNativeMetadata, mobileFilesViewportAnchor, mobileFilesViewportTop,
  mobileFilesLogicalPositionDescription,
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
type SavedEntry = { id: number; name: string; subtitle?: string }

type MobileFilesArrangeTicket = {
    generation: number
    scope: string
    sourceCollectionKey: string
    targetSignature: string
    parentID: number
    nodeID: number
    revision: number
    fraction: number
    selected: boolean
    selectionIntent: number
    userGesture: number
    controller?: AbortController
  }

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
  initialSelectedItems?: readonly XDriveFileExplorerItem[]
  onSelectedItemsChange?: (items: readonly XDriveFileExplorerItem[]) => void
  getSelectionActionDisabledReason?: (
    action: XDriveFileExplorerSelectionAction,
    items: readonly XDriveFileExplorerItem[],
    count: number,
  ) => string | null
  crumbs: XDriveFileExplorerCrumb[]
  loading: boolean
  /** Only the real Owner directory first-Range request; excludes Search/operations. */
  directoryLoading?: boolean
  trashActive: boolean
  trashReadState?: 'unverified' | 'ready' | 'error'
  onOpenTrash: () => void
  onCloseTrash: () => void
  onBrowseRoot: () => void
  onGoUp: () => void
  onCrumbClick: (index: number) => void
  pathValue?: string
  onPathSubmit?: (path: string) => boolean | void | Promise<boolean | void>
  onRestoreFolder: (id: number) => Promise<boolean | void>
  /** Notify the original Web navigation owner if the user abandons an unverified saved restore. */
  onAbandonSavedFolderRestore?: () => void
  onOpenItem: (item: XDriveFileExplorerItem, parentID?: number) => boolean | void | Promise<boolean | void>
  onQuickLookItem?: (item: XDriveFileExplorerItem, parentID?: number) => void
  onOpenError: (error: unknown) => void
  recentItems: SectionEntry[]
  recentLoading?: boolean
  recentReadState?: 'unverified' | 'ready' | 'error'
  favorites: SectionEntry[]
  favoritesLoading?: boolean
  favoritesReadState?: 'unverified' | 'ready' | 'error'
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
  onSortChange: (sort: XDriveFileExplorerSort) => boolean | void | Promise<boolean | void>
  grouping?: XDriveFileExplorerGrouping
  onGroupingChange?: (grouping: XDriveFileExplorerGrouping) => boolean | void | Promise<boolean | void>
  /** Shared Web Owner/Server transport verifies Node+Revision and the exact new Range. */
  locateVerifiedCurrentChild?: (
    parentID: number, nodeID: number, revision: number, itemCount: number,
    sort: XDriveFileExplorerSort, grouping: XDriveFileExplorerGrouping,
    signal: AbortSignal,
  ) => Promise<{ index: number; item: XDriveFileExplorerItem } | null>
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
  renameDisabled?: boolean
  onRename: (item: XDriveFileExplorerItem, name: string) => Promise<void>
  /** Optional common Web owner for draft persistence through a 900px remount. */
  onOpenRenameDialog?: (item: XDriveFileExplorerItem) => void
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
// The MUI sm+ MenuItem rule can override item-level minHeight:44 at 899px.
// Keep all six Mobile Files Menu hit targets consistent with the item-context
// fix. The wide Web/Desktop FileExplorer and 52px App Header are independent.
const MOBILE_FILES_MENU_TOUCH_SX = {
  '& .MuiMenuItem-root': { minHeight: MIN_TOUCH },
} as const
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

// A child directory expansion retains the 44px chevron and fixed overlay
// footprint without inserting a transient ring. The real paged Server read,
// abort-on-collapse and error/retry remain owned by the shared inline store.
function MobileInlineDisclosureProgress() {
  return (
    <Box component="span" data-mobile-files-folder-disclosure-progress aria-hidden="true"
      sx={{ position: 'absolute', right: 3, bottom: 3, width: 14, height: 14,
        display: 'grid', placeItems: 'center', pointerEvents: 'none' }} />
  )
}

export default function MobileFiles(props: Props) {
  const storageKey = 'xdrive.mobile.files.v1:' + props.lifecycleKey
  // Browse Home keeps its real rows mounted through organization refreshes.
  // The original Owner/Server GET runs immediately; decorative progress never
  // appears, even for a longer wait. Real error/retry remains in the home.
  // The URL describes a pending intent. In a responsive remount, use it for
  // initial scroll only after the shared controller commits its real crumbs.
  // Until then the last verified folder and scroll position still own the UI.
  const committedFolderID = Number(props.crumbs.at(-1)?.id ?? 0) || null
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return mobileFilesDecodeState(null)
    try {
      const previous = mobileFilesDecodeState(window.localStorage.getItem(storageKey))
      const authorizedRouteID = props.requestedDirectoryID === committedFolderID
        ? props.requestedDirectoryID : null
      if (!authorizedRouteID) return previous
      // A same-folder responsive remount is a resume, not a new navigation.
      // A different already-committed deep link still opens at the top.
      return { ...previous, section: 'browse' as const, folderID: authorizedRouteID,
        scrollTop: previous.folderID === authorizedRouteID ? previous.scrollTop : 0 }
    } catch { return mobileFilesDecodeState(null) }
  }, [storageKey, props.requestedDirectoryID, committedFolderID])
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
  const [ready, setReady] = useState(initial.folderID === null || Boolean(props.requestedDirectoryID) ||
    // A current matching counted Range is already an accepted saved folder;
    // do not hide a legitimately verified 100k list behind a second resume.
    (initial.folderID === committedFolderID && Boolean(props.virtualCollection) &&
      !(props.directoryLoading ?? props.loading)))
  const [scrollTop, setScrollTop] = useState(initial.scrollTop)
  const scrollSaveRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<{ folderID: number; scrollTop: number } | null>(null)
  // Independent Recent/Favorites virtual scroll anchors. Never store a
  // collection offset in the Browse folder's authoritative saved position.
  const collectionScrollRef = useRef({
    recent: initial.recentScrollTop ?? 0,
    favorites: initial.favoritesScrollTop ?? 0,
  })
  const pendingCollectionScrollRef = useRef<{
    section: 'recent' | 'favorites'; scrollTop: number
  } | null>(null)
  const [viewport, setViewport] = useState({ width: 375, height: 600 })
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null)
  const [locationMenuAnchor, setLocationMenuAnchor] = useState<HTMLElement | null>(null)
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
  const [selectionMode, setSelectionMode] = useState(Boolean(props.initialSelectedItems?.length))
  const [selectionLoad, setSelectionLoad] = useState<{ intent: number; loaded: number; total: number } | null>(null)
  const [selectionMoreAnchor, setSelectionMoreAnchor] = useState<HTMLElement | null>(null)
  const [selectionFeedback, setSelectionFeedback] = useState('')
  const [selected, setSelected] = useState<Map<string, XDriveFileExplorerItem>>(
    () => new Map((props.initialSelectedItems ?? []).map((item) => [mobileItemKey(item), item])),
  )
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
  const arrangeGenerationRef = useRef(0)
  const [arrangeEpoch, setArrangeEpoch] = useState(0)
  const arrangeUserGestureRef = useRef(0)
  const arrangeTicketRef = useRef<MobileFilesArrangeTicket | null>(null)
  const ownerRef = useRef<HTMLDivElement | null>(null)
  const scrollHostRef = useRef<HTMLDivElement | null>(null)
  const lastRequestedDirectoryRef = useRef(props.requestedDirectoryID)
  const restoredScrollRef = useRef(false)
  const browseScrollRef = useRef(initial.scrollTop)
  const pendingSectionScrollRef = useRef<number | null>(null)
  const pendingViewScrollRef = useRef<{ view: 'details' | 'grid'; scope: string; top: number; browse: boolean } | null>(null)
  const navigationIntentRef = useRef(0)
  // A typed path is only a navigation intent until shared authorized crumbs
  // and its counted first range commit. Retain old section/scroll meanwhile.
  const pendingPathOriginRef = useRef<{
    directoryID: number | null
    intent: number
  } | null>(null)
  // The stable FileExplorer interactionKey is NOT a per-request receipt.
  const [acceptedPathIntent, setAcceptedPathIntent] = useState(0)
  // A Browse Home → Cloud root tap is a pending intent, not a committed page.
  const pendingBrowseRootRef = useRef<{ rootID: number; intent: number } | null>(null)
  // A Recent/Quick Access folder is only an intent until the shared counted
  // first Range and crumbs commit. Promise completion alone cannot reset UI.
  const pendingExternalDirectoryRef = useRef<{
    directoryID: number; intent: number; alreadyCommitted: boolean
  } | null>(null)
  // A file-row tap from Search/Browse Home cannot switch the rail merely
  // because its navigation Promise resolves. The current counted directory
  // and a new range identity must arrive together before any visual commit.
  const pendingRowDirectoryRef = useRef<{
    directoryID: number; intent: number; previousRangeKey: string | null
  } | null>(null)
  const searchReturnHomeRef = useRef(initial.folderID === null)
  // A Search entered from Recent/Favorites is still the one global Search.
  // Remember its presentation origin, without retaining another query/ACL.
  const searchReturnSectionRef = useRef<MobileFilesSection>('browse')
  const searchClearPendingRef = useRef(false)
  // Search is an intent before the owning Web props acknowledge it. During
  // that gap, do not persist the underlying root as if a folder was opened.
  const globalSearchPresentationRef = useRef(false)
  // A Home/Recent/Favorites Search tap is only intent until the shared Web
  // Owner has returned its matching, counted first Range (including zero).
  const pendingGlobalSearchRef = useRef<{ intent: number; lifecycleKey: string } | null>(null)
  const restoreFolderRef = useRef(props.onRestoreFolder)
  restoreFolderRef.current = props.onRestoreFolder
  // Resuming is an intent; only the matching counted CloudFiles first Range
  // may reveal the saved directory. A stale Promise must never flip the rail.
  const restoreTaskRef = useRef<{
    id: number; storageKey: string; intent: number; promise: Promise<boolean | void>
  } | null>(null)
  const acceptedResumeRef = useRef<string | null>(
    initial.folderID !== null && committedFolderID === initial.folderID &&
    Boolean(props.virtualCollection) && !(props.directoryLoading ?? props.loading)
      ? storageKey + ':' + initial.folderID : null)
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
  // The shared controller commits new crumbs and the first range together.
  // Only that commit should reset a mounted directory's virtual viewport.
  const lastCommittedDirectoryRef = useRef(directoryID)
  const selectionScopeKey = [
    props.lifecycleKey, directoryID ?? 0, section,
    props.trashActive, props.searchActive,
    props.virtualCollection?.interactionKey ?? '',
  ].join(':')
  const selectionScopeRef = useRef(selectionScopeKey)
  selectionScopeRef.current = selectionScopeKey
  // Arrangement identity is independent from the old virtual-page cache key.
  const arrangeScope = JSON.stringify([
    props.lifecycleKey, directoryID, section, props.searchActive, props.trashActive,
  ])
  const arrangeScopeRef = useRef(arrangeScope)
  arrangeScopeRef.current = arrangeScope
  const arrangeSignature = JSON.stringify([
    props.sort.key, props.sort.direction,
    props.grouping?.groupBy ?? 'none', props.grouping?.foldersFirst ?? true,
  ])
  const arrangeSignatureRef = useRef(arrangeSignature)
  arrangeSignatureRef.current = arrangeSignature
  const verifiedLocatorRef = useRef(props.locateVerifiedCurrentChild)
  verifiedLocatorRef.current = props.locateVerifiedCurrentChild
  const pendingGlobalSearchPresentation = Boolean(pendingGlobalSearchRef.current &&
    pendingGlobalSearchRef.current.intent === navigationIntentRef.current &&
    pendingGlobalSearchRef.current.lifecycleKey === props.lifecycleKey)
  const showDirectory = section === 'browse' &&
    (!browseHome || props.trashActive || (props.searchActive && !pendingGlobalSearchPresentation))
  const viewPositionScope = [
    selectionScopeKey, props.sort.key, props.sort.direction,
    props.grouping?.groupBy ?? 'none', props.grouping?.foldersFirst ?? true,
  ].join(':')
  const selectionActive = selectionMode && showDirectory
  const effectiveGrid = viewPreference === 'grid'
  const columns = Math.max(2, Math.min(5, Math.floor(viewport.width / 120)))
  const rowHeight = effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT
  // On a cold saved-folder resume the bootstrap root may already have files.
  // It is NOT the saved folder: reserve the same silent virtual scroll slot
  // until matching crumbs + current first counted Range are both verified.
  // Always preserve the original authoritative Server count; a pending
  // presentation may temporarily project zero *visible* items, not zero data.
  const totalCount = props.virtualCollection?.itemCount ?? props.items.length
  // Empty must mean an authoritative zero count, not an unanswered Search,
  // failed Search or empty Trash. Reuse the existing shared StatePanel rather
  // than creating a second mobile-only empty/error state component.
  const searchCountPending = Boolean(props.searchActive &&
    props.searchSummary?.resultCount === null && !props.searchSummary?.error)
  // An accepted empty directory is real content. Never overwrite its message
  // or show a new spinner while a later first Range is still pending.
  // The real CloudFiles first-Range receipt owns ordinary folder loading.
  // Composite busy also includes unrelated Copy/Upload/Delete/Search work and
  // must never hide an already verified empty directory.
  const ownerDirectoryLoading = props.directoryLoading ?? props.loading
  const savedResumePending = section === 'browse' && !browseHome &&
    initial.folderID !== null && !ready && !props.requestedDirectoryID &&
    !props.trashActive && !props.searchActive &&
    (directoryID !== initial.folderID || !props.virtualCollection || ownerDirectoryLoading)
  const acceptedEmptyDirectoryRef = useRef<string | null>(null)
  const emptyDirectoryKey = section === 'browse' && !browseHome &&
    !props.searchActive && !props.trashActive && directoryID !== null
    ? `${props.lifecycleKey}:${directoryID}` : null
  useEffect(() => {
    if (emptyDirectoryKey === null || totalCount > 0) {
      acceptedEmptyDirectoryRef.current = null
    } else if (!savedResumePending && !ownerDirectoryLoading && totalCount === 0 && props.virtualCollection) {
      // A failed cold first read also ends loading but cannot confirm zero.
      // Only an accepted counted Server range certifies an empty directory.
      acceptedEmptyDirectoryRef.current = emptyDirectoryKey
    }
  }, [emptyDirectoryKey, ownerDirectoryLoading, props.virtualCollection, totalCount, savedResumePending])
  const keepAcceptedEmptyDirectory = totalCount === 0 &&
    emptyDirectoryKey !== null &&
    acceptedEmptyDirectoryRef.current === emptyDirectoryKey

  // Ordinary folder transitions keep accepted rows and viewport. A cold
  // Directory or Trash first Range owns one silent 180px slot for the entire
  // current Owner read, even past 300ms. Only an explicit Search or a refresh
  // of already accepted Trash rows may show delayed in-place feedback.
  // Network thumbnails and sparse page fetching retain their own progress.
  const coldUnconfirmedBrowse = savedResumePending || (showDirectory && !props.searchActive &&
    !props.trashActive && totalCount === 0 && !keepAcceptedEmptyDirectory &&
    !props.virtualCollection)
  // Before the very first Owner Range is dispatched, loading may still be
  // false. It is NOT a failed directory read. Track a genuine pending cycle
  // for this exact account/directory/arrangement before showing a terminal
  // unverified error; a cold navigation must never flash an error then blank.
  const coldReadScope = [
    props.lifecycleKey, directoryID ?? 0, props.sort.key, props.sort.direction,
    props.grouping?.groupBy ?? 'none', props.grouping?.foldersFirst ?? true,
  ].join(':')
  const coldReadAttemptRef = useRef({ scope: coldReadScope, began: false })
  if (coldReadAttemptRef.current.scope !== coldReadScope) {
    coldReadAttemptRef.current = { scope: coldReadScope, began: false }
  }
  // Composite Files busy may include Search/Operations. Only the CloudFiles
  // controller's directory GET can confirm this exact cold-read lifecycle.
  if (coldUnconfirmedBrowse && ownerDirectoryLoading) coldReadAttemptRef.current.began = true
  const coldDirectoryReadFailed = coldUnconfirmedBrowse && !ownerDirectoryLoading &&
    coldReadAttemptRef.current.began && !savedResumePending
  const showRangeLoading = (props.loading || searchCountPending) &&
    (props.searchActive || (props.trashActive && totalCount > 0))
  const loadFeedbackScope = props.searchActive
    ? `search:${props.lifecycleKey}:${props.searchSummary?.query ?? ''}:${props.virtualCollection?.interactionKey ?? ''}`
    : props.trashActive ? `trash:${props.lifecycleKey}`
      : `cold:${props.lifecycleKey}:${directoryID ?? 0}`
  // Search and populated Trash have real pending feedback, but a previous
  // SAME-scope request must never paint its old 300ms indicator on this render.
  const loadFeedbackCycleRef = useRef({
    pending: showRangeLoading, scope: loadFeedbackScope, generation: 0,
  })
  if (loadFeedbackCycleRef.current.pending !== showRangeLoading ||
      loadFeedbackCycleRef.current.scope !== loadFeedbackScope) {
    loadFeedbackCycleRef.current = {
      pending: showRangeLoading, scope: loadFeedbackScope,
      generation: loadFeedbackCycleRef.current.generation + 1,
    }
  }
  const loadFeedbackGeneration = loadFeedbackCycleRef.current.generation
  const [delayedLoadGeneration, setDelayedLoadGeneration] = useState<number | null>(null)
  useEffect(() => {
    if (!showRangeLoading) return
    const timer = window.setTimeout(() => setDelayedLoadGeneration(loadFeedbackGeneration), 300)
    return () => window.clearTimeout(timer)
  }, [showRangeLoading, loadFeedbackScope, loadFeedbackGeneration])
  const showArrangementLoading = showRangeLoading &&
    delayedLoadGeneration === loadFeedbackGeneration

  const trashReadState = props.trashReadState ?? 'ready'
  const verifiedTrashEmpty = props.trashActive && trashReadState === 'ready' && totalCount === 0
  const unverifiedTrashEmpty = props.trashActive && totalCount === 0 &&
    (trashReadState === 'unverified' || (trashReadState === 'error' && props.loading))
  const failedTrashEmpty = props.trashActive && totalCount === 0 &&
    trashReadState === 'error' && !props.loading
  // Search/Trash still own their genuine progress. A normal Browse folder
  // uses only CloudFiles busy: a concurrent durable operation must not blank
  // a verified-zero directory or defer its truthful empty state.
  const zeroStateOwnerLoading = props.searchActive || props.trashActive
    ? props.loading : ownerDirectoryLoading
  const zeroStatePending = (zeroStateOwnerLoading && !keepAcceptedEmptyDirectory &&
    !verifiedTrashEmpty) || searchCountPending
  const zeroStateLoading = props.searchActive && zeroStatePending && showArrangementLoading
  // Do not insert a padded zero-state loading panel for a request that
  // finishes before the next meaningful frame. An accepted empty directory
  // is content and remains visible throughout an uncommitted navigation.
  const coldDirectoryReadUnconfirmed = coldUnconfirmedBrowse && !coldDirectoryReadFailed
  // Keep an identical silent slot from the first paint through an arbitrarily
  // slow Directory GET. Only a real counted result or terminal error changes
  // its content; no delayed network spinner is inserted during navigation.
  const coldDirectoryFirstRead = coldUnconfirmedBrowse && ownerDirectoryLoading
  // A cold Search COUNT is also an unresolved first Range. Reserve the same
  // empty-slot geometry before its 300ms *visual-only* delay instead of
  // inserting a new in-flow search panel when the timer fires.
  const showZeroState = (savedResumePending || totalCount === 0) &&
    (coldDirectoryFirstRead || (props.searchActive && zeroStatePending) ||
      (!zeroStatePending && !coldUnconfirmedBrowse) ||
      keepAcceptedEmptyDirectory || zeroStateLoading || coldDirectoryReadUnconfirmed ||
      coldDirectoryReadFailed || unverifiedTrashEmpty || failedTrashEmpty || verifiedTrashEmpty)
  const zeroStateMessage = zeroStateLoading
    ? '正在查询…'
    : props.searchActive
      ? props.searchSummary?.error ? '搜索失败，请重试'
        : searchCountPending ? '正在查询…'
          : '未找到匹配的文件或文件夹'
      : props.trashActive ? '最近删除为空'
        : coldDirectoryReadFailed ? '文件夹内容尚未确认，请刷新页面后重试。'
          : '此文件夹为空'
  const inlineEnabled = showDirectory && !savedResumePending && !effectiveGrid && !props.trashActive &&
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
  const displayedCount = savedResumePending ? 0 : (inlineLayout?.itemCount ?? totalCount)
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
  // 'unverified' is not a real empty list. A failed first GET cannot claim
  // “暂无”; prior accepted contents remain mounted throughout refresh.
  const collectionReadState = section === 'recent'
    ? props.recentReadState ?? 'ready' : props.favoritesReadState ?? 'ready'
  const collectionLoading = section === 'recent'
    ? Boolean(props.recentLoading) : Boolean(props.favoritesLoading)
  const collectionFirstRead = section !== 'browse' && sectionItems.length === 0 &&
    (collectionReadState === 'unverified' ||
      (collectionReadState === 'error' && collectionLoading))
  const sortLabel = ({ name: '名称', updated: '修改日期', type: '类型', size: '大小' })[props.sort.key]
  const groupLabel = props.grouping?.groupBy === 'type' ? '类型' :
    props.grouping?.groupBy === 'modified' ? '修改日期' :
      props.grouping?.groupBy === 'size' ? '大小' : ''
  const arrangementLabel = `${sortLabel} ${props.sort.direction === 'asc' ? '↑' : '↓'} · ${effectiveGrid ? '图标' : '列表'}${groupLabel ? ` · 按${groupLabel}分组` : ''}`
  // Grouping is still the authoritative Server ordering/index. Never invent
  // local group membership from the loaded portion of a paged collection.
  const groupedLayout = useMemo(() => {
    // A pending saved resume must not paint the bootstrap root's group headers.
    if (savedResumePending || !props.grouping || props.trashActive) return null
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
  }, [savedResumePending, props.grouping?.groupBy, props.trashActive, props.virtualCollection?.groups,
    inlineLayout, directoryID, totalCount, displayedCount, effectiveGrid, columns, rowHeight])
  const groupedSegments = useMemo(() => groupedLayout
    ? xDriveFileExplorerVisibleGroupSegments(groupedLayout, scrollTop, Math.max(1, viewport.height), rowHeight * 4)
    : [], [groupedLayout, scrollTop, viewport.height, rowHeight])
  // Keep the authenticated virtualized list's newest geometry accessible to
  // a slow result without turning every scroll rerender into a second GET.
  const arrangeGeometryRef = useRef({ totalCount, groupedLayout, rowHeight, effectiveGrid, columns })
  arrangeGeometryRef.current = { totalCount, groupedLayout, rowHeight, effectiveGrid, columns }

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
    section: MobileFilesSection; folderID: number | null; scrollTop: number
    recentScrollTop: number; favoritesScrollTop: number; view: 'details' | 'grid'
  }>) => {
    if (typeof window === 'undefined') return
    try {
      const old = mobileFilesDecodeState(window.localStorage.getItem(storageKey))
      window.localStorage.setItem(storageKey, mobileFilesEncodeState({ ...old, ...next }))
    } catch { /* Private browsing must still work without persistent storage. */ }
  }, [storageKey])

  useEffect(() => {
    // Storage keys already include the authenticated Files lifecycle/account.
    // A second account must never inherit the first account's rail position.
    collectionScrollRef.current = {
      recent: initial.recentScrollTop ?? 0,
      favorites: initial.favoritesScrollTop ?? 0,
    }
    pendingCollectionScrollRef.current = null
    searchReturnSectionRef.current = 'browse'
    searchReturnHomeRef.current = initial.folderID === null
    searchClearPendingRef.current = false
    globalSearchPresentationRef.current = false
    pendingGlobalSearchRef.current = null
  }, [storageKey])

  useEffect(() => {
    // One historical app-tab preference must not supersede Q2's resume policy.
    if (initial.section !== 'browse') persist({ section: 'browse' })
  }, [initial.section, persist])

  useEffect(() => {
    if (initial.folderID === null || props.requestedDirectoryID) return
    const folderID = initial.folderID
    // StrictMode may replay an effect. Reuse only the SAME owner, folder and
    // navigation intent; a second account's identical numeric ID is distinct.
    if (restoreTaskRef.current?.id !== folderID ||
        restoreTaskRef.current.storageKey !== storageKey ||
        restoreTaskRef.current.intent !== navigationIntentRef.current) {
      restoreTaskRef.current = {
        id: folderID, storageKey, intent: navigationIntentRef.current,
        promise: Promise.resolve().then(() => restoreFolderRef.current(folderID)),
      }
    }
    let live = true
    const task = restoreTaskRef.current
    const canApplyFailure = () => live && restoreTaskRef.current === task &&
      navigationIntentRef.current === task.intent &&
      acceptedResumeRef.current !== storageKey + ':' + folderID
    const failCurrentResume = () => {
      if (!canApplyFailure()) return
      // Failed current restore may return to Browse Home. A superseded result
      // cannot erase a newer folder, section, account or saved scroll anchor.
      setBrowseHome(true)
      setReady(true)
      persist({ folderID: null, scrollTop: 0 })
    }
    void task.promise.then(accepted => {
      // Success is not a visual acknowledgement. The pre-paint receipt guard
      // below owns the ONLY saved-folder reveal; false is a terminal failure.
      if (accepted === false) failCurrentResume()
    }).catch(failCurrentResume)
    return () => { live = false }
  }, [storageKey, initial.folderID, props.requestedDirectoryID, persist])

  useLayoutEffect(() => {
    const requestedID = props.requestedDirectoryID
    if (!requestedID || requestedID === lastRequestedDirectoryRef.current) return
    lastRequestedDirectoryRef.current = requestedID
    // App mirroring a *just-accepted* saved resume to ?dir= is an
    // acknowledgement, not a second user navigation: never scroll it to 0.
    if (directoryID === requestedID &&
        acceptedResumeRef.current === storageKey + ':' + requestedID) {
      acceptedResumeRef.current = null
      return
    }
    navigationIntentRef.current += 1
    // The URL is an intent, NOT an authorized directory commit. While the
    // shared Web workspace awaits its first counted range, keep the old
    // folder's visible rows, scrollTop and saved Browse location unchanged.
    if (directoryID !== requestedID) return
    // Re-opening an already committed folder from Browse Home/Recent is the
    // only same-directory case that does not have a new crumb commit.
    if (section === 'browse' && !browseHome && ready && scrollTop === 0) return
    if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
    scrollSaveRef.current = null
    pendingScrollRef.current = null
    restoredScrollRef.current = true
    browseScrollRef.current = 0
    pendingSectionScrollRef.current = 0
    setSection('browse')
    setBrowseHome(false)
    setReady(true)
    setScrollTop(0)
    if (scrollHostRef.current) scrollHostRef.current.scrollTop = 0
    persist({ section: 'browse', folderID: requestedID, scrollTop: 0 })
  }, [props.requestedDirectoryID, directoryID, section, browseHome, ready, scrollTop, storageKey, persist])

  useLayoutEffect(() => {
    // CloudFiles GET is the receipt owner. "props.loading" also includes
    // Search and durable FileOperation busy: upload/copy/delete/sync progress
    // must NOT postpone a folder whose first counted Range already committed.
    const savedResumeTask = restoreTaskRef.current
    const savedResumeCommit = Boolean(
      !ready && section === 'browse' && !browseHome &&
      initial.folderID !== null && !props.requestedDirectoryID &&
      !props.trashActive && !props.searchActive &&
      savedResumeTask?.id === initial.folderID &&
      savedResumeTask.storageKey === storageKey &&
      savedResumeTask.intent === navigationIntentRef.current &&
      directoryID === initial.folderID &&
      props.virtualCollection && !ownerDirectoryLoading)
    if (savedResumeCommit) {
      acceptedResumeRef.current = storageKey + ':' + initial.folderID
      lastCommittedDirectoryRef.current = directoryID
      setSection('browse')
      setBrowseHome(false)
      setReady(true)
      // Do not perform a new-navigation scrollTo(0): the saved folder's
      // original scroll anchor is restored in its dedicated layout effect.
      return
    }
    const pendingRoot = pendingBrowseRootRef.current
    const homeRootCommit = Boolean(pendingRoot &&
      pendingRoot.intent === navigationIntentRef.current &&
      pendingRoot.rootID === directoryID &&
      props.virtualCollection && !ownerDirectoryLoading)
    const pendingExternal = pendingExternalDirectoryRef.current
    const externalDirectoryCommit = Boolean(pendingExternal &&
      pendingExternal.intent === navigationIntentRef.current &&
      pendingExternal.directoryID === directoryID &&
      !pendingExternal.alreadyCommitted &&
      !props.trashActive && !props.searchActive &&
      props.virtualCollection && !ownerDirectoryLoading)
    const pendingRow = pendingRowDirectoryRef.current
    const rowDirectoryCommit = Boolean(pendingRow &&
      pendingRow.intent === navigationIntentRef.current &&
      pendingRow.directoryID === directoryID &&
      !props.trashActive && !props.searchActive &&
      props.virtualCollection && !ownerDirectoryLoading &&
      props.virtualCollection.interactionKey !== pendingRow.previousRangeKey)
    // The new different-folder crumb commits only after the accepted first
    // Range. Same-directory paths cannot use interactionKey as a generation:
    // require the original shared Web navigation's success receipt instead.
    const pendingPath = pendingPathOriginRef.current
    const pathCommit = Boolean(pendingPath &&
      pendingPath.intent === navigationIntentRef.current &&
      !props.trashActive && !props.searchActive && !ownerDirectoryLoading &&
      (pendingPath.directoryID !== directoryID ||
       acceptedPathIntent === pendingPath.intent))
    // A Home/Recent/Quick Access/Search/path ticket must not reset the scroll
    // just because a Promise resolved or an obsolete range remains mounted.
    if (lastCommittedDirectoryRef.current === directoryID &&
        !homeRootCommit && !externalDirectoryCommit && !rowDirectoryCommit && !pathCommit) return
    lastCommittedDirectoryRef.current = directoryID
    if (homeRootCommit) pendingBrowseRootRef.current = null
    if (externalDirectoryCommit) pendingExternalDirectoryRef.current = null
    if (rowDirectoryCommit) pendingRowDirectoryRef.current = null
    const routedCommit = Boolean(props.requestedDirectoryID &&
      directoryID === props.requestedDirectoryID)
    if (pathCommit) pendingPathOriginRef.current = null
    const authorizedCommit = routedCommit || pathCommit || homeRootCommit || externalDirectoryCommit || rowDirectoryCommit
    // A deep link opened from Browse Home/Recent/Favorites must enter Browse
    // only AFTER its authorized directory is genuinely visible. This state
    // update is pre-paint, so no intermediate wrong-folder frame is exposed.
    if (authorizedCommit) {
      setSection('browse')
      setBrowseHome(false)
      setReady(true)
      if (homeRootCommit) {
        setEditBrowseHome(false)
        searchReturnHomeRef.current = false
      }
    }
    if ((!ready && !authorizedCommit) ||
        ((section !== 'browse' || browseHome) && !authorizedCommit) ||
        props.trashActive || props.searchActive) return
    // On normal last-folder restoration, keep its saved intra-row anchor.
    // An explicit fresh deep link to that same ID is a new top-of-folder
    // navigation, not a restoration of the previous 688px scroll position.
    if (!restoredScrollRef.current && initial.folderID !== null &&
        directoryID === initial.folderID && !authorizedCommit) return
    if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
    scrollSaveRef.current = null
    pendingScrollRef.current = null
    pendingSectionScrollRef.current = null
    browseScrollRef.current = 0
    restoredScrollRef.current = true
    const host = scrollHostRef.current
    if (host) host.scrollTop = 0
    setScrollTop(0)
    if (directoryID !== null) persist({ section: 'browse', folderID: directoryID, scrollTop: 0 })
  }, [directoryID, ready, section, browseHome, props.trashActive, props.searchActive,
    props.requestedDirectoryID, props.virtualCollection, ownerDirectoryLoading,
    acceptedPathIntent, initial.folderID, storageKey, persist])

  useLayoutEffect(() => {
    // An identical ResizeObserver delivery must not re-render the 100k
    // virtual collection or recalculate a newly mounted row window.
    const host = scrollHostRef.current
    if (!host) return
    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width <= 0 || height <= 0) return
      setViewport(previous => previous.width === width && previous.height === height
        ? previous : { width, height })
    }
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
    if (pendingCollectionScrollRef.current) {
      const { section: priorSection, scrollTop: pendingTop } = pendingCollectionScrollRef.current
      persist(priorSection === 'recent'
        ? { recentScrollTop: pendingTop } : { favoritesScrollTop: pendingTop })
    }
    pendingScrollRef.current = null
    pendingCollectionScrollRef.current = null
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

  useLayoutEffect(() => {
    const pending = pendingViewScrollRef.current
    if (!pending || pending.view !== viewPreference) return
    pendingViewScrollRef.current = null
    if (pending.scope !== viewPositionScope) return
    const host = scrollHostRef.current
    if (!host) return
    // Commit after the new row geometry is in the DOM, before painting. A
    // browser may clamp a deep offset if the new Grid is shorter than List.
    host.scrollTop = pending.top
    if (host.scrollTop !== pending.top) {
      setScrollTop(host.scrollTop)
      if (pending.browse) {
        browseScrollRef.current = host.scrollTop
        persist({ scrollTop: host.scrollTop })
      }
    }
  }, [viewPreference, viewPositionScope, persist])

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

  // On the first mount, a validated same-scope responsive selection seed is
  // intentional state, not stale state that should be cleared by an effect.
  // Only a *subsequent* account/folder/Search/Trash scope change resets it.
  const lastResetSelectionScopeRef = useRef(selectionScopeKey)
  useEffect(() => {
    if (lastResetSelectionScopeRef.current === selectionScopeKey) return
    lastResetSelectionScopeRef.current = selectionScopeKey
    selectionAbortRef.current?.abort()
    selectionAbortRef.current = null
    selectionIntentRef.current += 1
    setSelectionLoad(null)
    setSelected(new Map())
    setSelectionMode(false)
    setSelectionFeedback('')
    setSelectionMoreAnchor(null)
    setLocationMenuAnchor(null)
    setClearRecentConfirm(false)
    setItemMenu(null)
    setCollectionMenu(null)
    // A pending rename belongs to the original account/directory/Search
    // scope; the shared FileNameDialog fences any late Server response.
    setRenaming(null)
    // Owner/scope changes close the inspector and abort old Server stats
    // through the existing shared PropertiesController cleanup.
    setPropertiesItems([])
  }, [selectionScopeKey])

  // U09-D2c2: only an authorized new current-directory first Range may
  // validate a previous single Node/visible anchor. Search, Trash and inline
  // children have different ordinals and cannot borrow this lookup.
  useEffect(() => {
    const ticket = arrangeTicketRef.current
    if (!ticket) return
    if (ticket.scope !== arrangeScope || !showDirectory || !ready || browseHome ||
      props.searchActive || props.trashActive || directoryID !== ticket.parentID) {
      ticket.controller?.abort()
      arrangeTicketRef.current = null
      return
    }
    const verify = verifiedLocatorRef.current
    const targetGrouping = props.grouping
    if (ticket.targetSignature !== arrangeSignature ||
      ticket.sourceCollectionKey === props.virtualCollection?.interactionKey ||
      !props.virtualCollection || !verify || !targetGrouping) return
    const controller = new AbortController()
    ticket.controller = controller
    const current = () => !controller.signal.aborted &&
      arrangeTicketRef.current === ticket &&
      arrangeGenerationRef.current === ticket.generation &&
      arrangeScopeRef.current === ticket.scope &&
      arrangeSignatureRef.current === ticket.targetSignature
    void verify(
      ticket.parentID, ticket.nodeID, ticket.revision, totalCount,
      props.sort, targetGrouping, controller.signal,
    ).then(position => {
      if (!current()) return
      arrangeTicketRef.current = null
      const geometry = arrangeGeometryRef.current
      if (!position || !Number.isSafeInteger(position.index) ||
        position.index < 0 || position.index >= geometry.totalCount ||
        Number(position.item.id) !== ticket.nodeID ||
        Number(position.item.revision) !== ticket.revision ||
        ticket.userGesture !== arrangeUserGestureRef.current ||
        (ticket.selected && selectionIntentRef.current > ticket.selectionIntent + 1)) return
      // Group headers must be resolved from the new Server group index.
      // Never map an unknown group to pixel zero and claim it as an anchor.
      if (targetGrouping.groupBy !== 'none' &&
        !geometry.groupedLayout?.groups.some(group => position.index >= group.startIndex &&
          position.index < group.startIndex + group.itemCount)) return
      const host = scrollHostRef.current
      if (!host) return
      const top = mobileFilesViewportTop({
        index: position.index, fraction: ticket.fraction,
      }, geometry.rowHeight, geometry.effectiveGrid ? geometry.columns : 1, geometry.groupedLayout)
      host.scrollTop = top
      setScrollTop(host.scrollTop)
      browseScrollRef.current = host.scrollTop
      if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
      scrollSaveRef.current = null
      pendingScrollRef.current = null
      persist({ folderID: ticket.parentID, scrollTop: host.scrollTop })
      if (ticket.selected) {
        setSelected(new Map([[String(position.item.id), position.item]]))
        setSelectionMode(true)
      }
    }).catch(() => {
      if (current()) arrangeTicketRef.current = null
    })
    return () => controller.abort()
  }, [
    arrangeEpoch, arrangeScope, arrangeSignature, directoryID, ready,
    showDirectory, browseHome, props.searchActive, props.trashActive,
    props.virtualCollection?.interactionKey,
    props.grouping?.groupBy, props.grouping?.foldersFirst, persist,
  ])

  useEffect(() => () => {
    arrangeGenerationRef.current += 1
    arrangeTicketRef.current?.controller?.abort()
    arrangeTicketRef.current = null
  }, [])

  // Notify the same Web workspace of selected sparse Nodes before their pages
  // can be evicted by scrolling. The callback retains IDs/revisions only;
  // Mobile never owns a second API, permission check or mutation controller.
  useEffect(() => {
    props.onSelectedItemsChange?.([...selected.values()])
  }, [selected, props.onSelectedItemsChange])

  useEffect(() => {
    if (!ready || !showDirectory || globalSearchPresentationRef.current ||
      props.searchActive || props.trashActive || directoryID === null) return
    // Persist the committed folder's *matching* scroll snapshot together.
    // Otherwise a cold deep link into a different folder could inherit the
    // previous folder's stored anchor on the next responsive remount.
    persist({ folderID: directoryID, scrollTop: browseScrollRef.current })
  }, [ready, showDirectory, props.searchActive, props.trashActive, directoryID, persist])

  useLayoutEffect(() => {
    const ticket = pendingGlobalSearchRef.current
    if (!ticket || ticket.intent !== navigationIntentRef.current ||
        ticket.lifecycleKey !== props.lifecycleKey ||
        !props.searchActive || props.searchSummary?.loading ||
        props.searchSummary?.error ||
        !Number.isSafeInteger(props.searchSummary?.resultCount)) return
    // First counted Owner Search Range was accepted, including real zero.
    // Commit rail/title/scroll in one pre-paint frame, never show old root.
    pendingGlobalSearchRef.current = null
    if (section === 'recent' || section === 'favorites') {
      const departedTop = scrollHostRef.current?.scrollTop ?? scrollTop
      collectionScrollRef.current[section] = departedTop
      persist(section === 'recent'
        ? { recentScrollTop: departedTop } : { favoritesScrollTop: departedTop })
    }
    if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
    scrollSaveRef.current = null
    pendingSectionScrollRef.current = 0
    browseScrollRef.current = 0
    setSection('browse')
    setBrowseHome(false)
    setReady(true)
    setScrollTop(0)
    if (scrollHostRef.current) scrollHostRef.current.scrollTop = 0
    persist({ section: 'browse' })
  }, [props.lifecycleKey, props.searchActive, props.searchSummary?.resultCount,
    props.searchSummary?.loading, props.searchSummary?.error, section, scrollTop, persist])

  // An externally activated Search may arrive while Recent/Favorites is on
  // screen. Commit its rail switch before paint, not via a passive effect
  // that exposes a one-frame stale page after the Owner state changes.
  useLayoutEffect(() => {
    if (!props.searchActive) {
      searchClearPendingRef.current = false
      return
    }
    // Locally launched Search has a verified-first-Range pre-paint commit.
    // This effect only handles externally activated workspace Search.
    if (globalSearchPresentationRef.current ||
        section === 'browse' || searchClearPendingRef.current) return
    searchReturnSectionRef.current = section
    searchReturnHomeRef.current = browseHome
    globalSearchPresentationRef.current = true
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
    if (pendingCollectionScrollRef.current) {
      const { section: priorSection, scrollTop: pendingTop } = pendingCollectionScrollRef.current
      persist(priorSection === 'recent'
        ? { recentScrollTop: pendingTop } : { favoritesScrollTop: pendingTop })
      pendingCollectionScrollRef.current = null
    }
  }
  const abandonPendingGlobalSearch = () => {
    if (!pendingGlobalSearchRef.current) return false
    pendingGlobalSearchRef.current = null
    globalSearchPresentationRef.current = false
    searchClearPendingRef.current = true
    // Abort the real shared Search Owner; a later accepted Range cannot steal
    // a newer Browse/Recent/Favorites/folder navigation.
    props.onClearSearch()
    return true
  }
  const abandonSavedFolderResumeIfPending = () => {
    if (!ready && initial.folderID !== null && !props.requestedDirectoryID) {
      props.onAbandonSavedFolderRestore?.()
    }
  }
  const beginBrowse = (id: number | null = null) => {
    abandonSavedFolderResumeIfPending()
    abandonPendingGlobalSearch()
    pendingPathOriginRef.current = null
    pendingBrowseRootRef.current = null
    flushBrowseScroll()
    navigationIntentRef.current += 1
    setEditBrowseHome(false)
    setSection('browse')
    setBrowseHome(id === null)
    globalSearchPresentationRef.current = false
    searchReturnSectionRef.current = 'browse'
    searchReturnHomeRef.current = id === null
    setScrollTop(0)
    pendingSectionScrollRef.current = 0
    browseScrollRef.current = 0
    restoredScrollRef.current = true
    persist({ section: 'browse', folderID: id, scrollTop: 0 })
    scrollHostRef.current?.scrollTo({ top: 0 })
  }
  const openExternalDirectory = (id: number, activate: () => Promise<boolean>) => {
    abandonPendingGlobalSearch()
    const intent = ++navigationIntentRef.current
    // Composite loading also includes uploads/copies. Only the directory's
    // own Owner GET can invalidate an already-accepted same-folder Range.
    const alreadyCommitted = directoryID === id && Boolean(props.virtualCollection) && !ownerDirectoryLoading
    pendingExternalDirectoryRef.current = { directoryID: id, intent, alreadyCommitted }
    // Start the real Server/Agent navigation immediately. If completion beats
    // the authorized counted Range, keep the old rail and scroll intact.
    void activate().then(accepted => {
      if (intent !== navigationIntentRef.current) return
      if (!accepted) {
        if (pendingExternalDirectoryRef.current?.intent === intent) {
          pendingExternalDirectoryRef.current = null
        }
        return
      }
      // Reopening an already accepted SAME folder requires a successful
      // activation, but does not require a different breadcrumb to commit.
      if (alreadyCommitted && pendingExternalDirectoryRef.current?.intent === intent) {
        pendingExternalDirectoryRef.current = null
        beginBrowse(id)
      }
    }).catch(error => {
      if (intent !== navigationIntentRef.current) return
      if (pendingExternalDirectoryRef.current?.intent === intent) {
        pendingExternalDirectoryRef.current = null
      }
      props.onOpenError(error)
    })
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
    // Every path entry is just intent, including Browse Home while the old
    // root's counted Range is already mounted. Never call beginBrowse here:
    // doing so reveals the wrong directory and resets scroll before lookup.
    // The pre-paint effect owns the single destination commit after the
    // shared workspace accepts a new first Range/crumb scope.
    const intent = ++navigationIntentRef.current
    pendingPathOriginRef.current = { directoryID, intent }
    // A failed or superseded path must not later be revived by an unrelated
    // current-folder refresh with a different virtual range identity.
    let result: boolean | void | Promise<boolean | void>
    try {
      result = props.onPathSubmit(target)
    } catch (error) {
      if (pendingPathOriginRef.current?.intent === intent) pendingPathOriginRef.current = null
      props.onOpenError(error)
      return
    }
    void Promise.resolve(result).then(accepted => {
      if (navigationIntentRef.current !== intent ||
          pendingPathOriginRef.current?.intent !== intent) return
      if (accepted === true) setAcceptedPathIntent(intent)
      else if (accepted === false) pendingPathOriginRef.current = null
    }).catch(error => {
      if (navigationIntentRef.current !== intent ||
          pendingPathOriginRef.current?.intent !== intent) return
      pendingPathOriginRef.current = null
      props.onOpenError(error)
    })
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
    abandonPendingGlobalSearch()
    const intent = ++navigationIntentRef.current
    if (item.kind === 'dir') {
      pendingRowDirectoryRef.current = {
        directoryID: Number(item.id),
        intent,
        previousRangeKey: props.virtualCollection?.interactionKey ?? null,
      }
    }
    void Promise.resolve(props.onOpenItem(item, ownerID)).then(accepted => {
      // A failed activation must not authorize a later coincidental Range.
      // An accepted activation is still only intent: layout-effect commits it
      // once matching crumbs and the first counted Range arrive together.
      if (accepted === false && pendingRowDirectoryRef.current?.intent === intent) {
        pendingRowDirectoryRef.current = null
      }
    }).catch(error => {
      if (pendingRowDirectoryRef.current?.intent === intent) {
        pendingRowDirectoryRef.current = null
      }
      if (intent === navigationIntentRef.current) props.onOpenError(error)
    })
  }
  const changeSection = (next: MobileFilesSection) => {
    const abandonedGlobalSearch = abandonPendingGlobalSearch()
    pendingPathOriginRef.current = null
    pendingBrowseRootRef.current = null
    flushBrowseScroll()
    if (section === 'recent' || section === 'favorites') {
      const departingTop = scrollHostRef.current?.scrollTop ?? scrollTop
      collectionScrollRef.current[section] = departingTop
      persist(section === 'recent'
        ? { recentScrollTop: departingTop } : { favoritesScrollTop: departingTop })
    }
    navigationIntentRef.current += 1
    if (!ready && initial.folderID !== null) {
      abandonSavedFolderResumeIfPending()
      // Explicit rail selection abandons a cold saved-folder resume. Never
      // strand Browse on the old pending ticket or show its stale root data.
      // Keep the saved folder ID/anchor for the next genuine app opening.
      setReady(true)
      setBrowseHome(true)
    }
    if (props.trashActive) {
      props.onCloseTrash()
      if (next === 'browse') setBrowseHome(true)
    }
    if (!abandonedGlobalSearch && props.searchActive && next !== 'browse') {
      // The shared Search Owner must not later override this explicit rail.
      searchClearPendingRef.current = true
      props.onClearSearch()
    }
    globalSearchPresentationRef.current = false
    setSection(next)
    const top = next === 'browse'
      ? !ready && initial.folderID !== null
        ? 0
        : !browseHome && !props.trashActive ? browseScrollRef.current : 0
      : collectionScrollRef.current[next]
    setScrollTop(top)
    pendingSectionScrollRef.current = top
    // Commit the next section first; writing scroll on the previous short
    // collection would clamp and destroy a large directory's position.
    persist({ section: next })
  }
  const clearGlobalSearch = () => {
    pendingGlobalSearchRef.current = null
    navigationIntentRef.current += 1
    const returnSection = searchReturnSectionRef.current
    searchClearPendingRef.current = true
    globalSearchPresentationRef.current = false
    props.onClearSearch()
    setSection(returnSection)
    setBrowseHome(searchReturnHomeRef.current)
    const top = returnSection === 'browse'
      ? searchReturnHomeRef.current ? 0 : browseScrollRef.current
      : collectionScrollRef.current[returnSection]
    setScrollTop(top)
    pendingSectionScrollRef.current = top
    persist({ section: returnSection })
  }
  const launchGlobalSearch = (action: () => void) => {
    abandonSavedFolderResumeIfPending()
    flushBrowseScroll()
    if (!props.searchActive) {
      searchReturnHomeRef.current = browseHome
      searchReturnSectionRef.current = section
    }
    searchClearPendingRef.current = false
    globalSearchPresentationRef.current = true
    const intent = ++navigationIntentRef.current
    if (browseHome || section === 'recent' || section === 'favorites') {
      // Home and the independent Recent/Favorites virtual rails have their
      // own accepted content. Do not expose the old root or empty Search while
      // its first network Range is still unresolved.
      pendingGlobalSearchRef.current = { intent, lifecycleKey: props.lifecycleKey }
      action()
      return
    }
    // Already open folder Search still follows the existing shared owner.
    pendingGlobalSearchRef.current = null
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
    // The parent can fail or be superseded. Keep the current folder stable
    // until shared navigation actually commits its authorized range/crumbs.
    props.onGoUp()
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
  const mobileContextAction = (action: XDriveFileExplorerMenuItem) => {
    const reason = xDriveFileExplorerMenuDisabledReason(action)
    return (
      <MenuItem key={action.id} data-mobile-files-context-action={action.id}
        disabled={action.disabled}
        title={reason ?? undefined}
        aria-label={reason ? action.label + '：' + reason : action.label}
        sx={{ color: action.danger ? 'error.main' : undefined, minHeight: MIN_TOUCH }}
        onClick={() => { setItemMenu(null); action.onSelect() }}>
        {action.icon ? (
          <ListItemIcon sx={{ minWidth: 34, color: action.danger ? 'error.main' : 'inherit' }}>
            {action.icon}
          </ListItemIcon>
        ) : null}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2">{action.id === 'share' ? '分享链接' : action.label}</Typography>
          {xDriveFileExplorerMenuReasonLabel(action) ? (
            <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
              {xDriveFileExplorerMenuReasonLabel(action)}
            </Typography>
          ) : null}
        </Box>
      </MenuItem>
    )
  }
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
    // Match wide FileExplorer's renameDisabled gate during in-flight
    // operations; a disabled MUI MenuItem must not be invokable directly.
    if (props.trashActive || props.renameDisabled) return
    setItemMenu(null)
    if (props.onOpenRenameDialog) props.onOpenRenameDialog(item)
    else setRenaming(item)
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
  // The selected-items More menu must be readable even when every bulk
  // action is disabled (200/500/1000-item limits or an incomplete selection).
  // Only the existing Server-backed selection eligibility callback decides.
  const selectionMoreReason = (action: XDriveFileExplorerSelectionAction): string | null => (
    selectionLoad ? '正在读取所选项目，请稍后重试' : selectionDisabledReason(action)
  )
  const selectionMoreCommonReason: string | null = selectionLoad
    ? '正在读取所选项目，请稍后重试'
    : (!selection.length ? '请先选择项目' : null)
  const selectionMoreReasons = {
    cut: selectionMoreReason('cut'),
    copyTo: selectionMoreReason('copy-to'),
    download: selectionMoreReason('download'),
    manageTags: selectionMoreReason('manage-tags'),
    common: selectionMoreCommonReason,
  }
  const selectionMoreLabel = (label: string, reason: string | null) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2">{label}</Typography>
      {reason ? <Typography variant="caption" color="text.secondary"
        sx={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        {xDriveFileExplorerMenuReasonLabel({ disabled: true, disabledReason: reason })}
      </Typography> : null}
    </Box>
  )
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
      event.nativeEvent?.isComposing || xDriveFileExplorerIsComposingKey(event) || event.repeat ||
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
    ownerID = directoryID ?? 0, sourceIndex = -1, logicalPosition = -1,
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
        aria-description={mobileFilesLogicalPositionDescription(logicalPosition, displayedCount)}
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
          if (xDriveFileExplorerIsComposingKey(event)) return
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
          // Reserve a genuine 44px leading touch zone in List, whether a
          // directory can expand in place or the cell is an ordinary file.
          // Thumbnail/text columns therefore never shift between file types.
          gap: effectiveGrid ? 0.5 : selectionMode ? 1.5 : 0, py: effectiveGrid ? 1 : 0.6,
          px: effectiveGrid ? 0.5 : selectionMode ? 3.5 : 0,
          pl: !effectiveGrid && depth > 0
            ? 'calc(' + (selectionMode ? 28 : 0) + 'px + ' + Math.min(depth, 4) * 16 + 'px)'
            : undefined,
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
        {!effectiveGrid && !selectionMode ? (
          canDisclose ? (
            <IconButton data-mobile-files-folder-disclosure={String(item.id)}
              aria-label={inlineBranch?.error ? '重试展开 ' + item.name :
                inlineBranch ? '收起 ' + item.name : '展开 ' + item.name}
              aria-expanded={Boolean(inlineBranch)}
              aria-busy={Boolean(inlineBranch?.loading)}
              onClick={event => {
                event.stopPropagation()
                if (inlineBranch?.error) props.onRetryInlineFolder?.(Number(item.id))
                else props.onToggleInlineFolder?.(item, ownerID, sourceIndex)
              }}
              onPointerDown={event => event.stopPropagation()}
              onPointerUp={event => event.stopPropagation()}
              onKeyDown={event => event.stopPropagation()}
              sx={{ width: MIN_TOUCH, height: MIN_TOUCH, flexShrink: 0,
                position: 'relative',
                color: inlineBranch?.error ? 'error.main' : IOS_FILES_MOBILE_BLUE }}>
              <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15,
                transform: inlineBranch ? 'rotate(90deg)' : 'rotate(180deg)' }}/>
              <MobileInlineDisclosureProgress />
            </IconButton>
          ) : <Box data-mobile-files-leading-spacer aria-hidden="true"
              sx={{ width: MIN_TOUCH, height: MIN_TOUCH, flexShrink: 0 }} />
        ) : null}
        {selectionMode ? (
          <Box sx={{ color: chosen ? 'primary.main' : 'text.disabled', width: 24, height: 24,
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {chosen ? <CheckCircleRoundedIcon fontSize="small"/> : <RadioButtonUncheckedRoundedIcon fontSize="small"/>}
          </Box>
        ) : null}
        <Box data-mobile-files-thumbnail-slot sx={{
          flexShrink: 0, width: effectiveGrid ? 70 : selectionMode ? 44 : 40,
          height: effectiveGrid ? 70 : 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {item.kind === 'dir' ? <MobileFolderIcon size={effectiveGrid ? 62 : 38} /> : (
            <XDriveFileExplorerThumbnail item={item} eligible={xDriveFileSupportsThumbnail(item.name, item.kind)}
              fallback={<MobileDocumentIcon item={item} size={effectiveGrid ? 38 : 36}/>}
              sx={{ width: effectiveGrid ? 64 : selectionMode ? 42 : 40,
                height: effectiveGrid ? 64 : 42, borderRadius: 0 }}/>
          )}
        </Box>
        <Box sx={{ minWidth: 0, width: effectiveGrid ? '100%' : undefined, flex: effectiveGrid ? undefined : 1 }}>
          <Typography data-mobile-files-item-title variant="body2" fontWeight={500} noWrap
            dir="auto" title={item.name}
            sx={{ fontSize: effectiveGrid ? 14 : 16, unicodeBidi: 'plaintext' }}
            textAlign={effectiveGrid ? 'center' : 'left'}>{item.name}</Typography>
          <Typography data-mobile-files-item-meta variant="caption" color="text.secondary" noWrap display="block" sx={{ fontSize: effectiveGrid ? 12 : 13.5 }} textAlign={effectiveGrid ? 'center' : 'left'}>
            {inlineBranch?.error ?? (inlineBranch?.itemCount === 0 ? '空文件夹' :
              mobileFilesNativeMetadata(item) || labelOf(item))}
          </Typography>
        </Box>
        {!effectiveGrid && item.availability ? <XDriveFileExplorerAvailabilityBadge availability={item.availability} compact /> : null}
        {/* Native List expands only from its leading disclosure; row activation still opens. */}
      </Box>
    )
  }
  const mobileRow = (
    entry: SectionEntry, action: () => void, isFolder = false,
    owner?: 'recent' | 'favorites',
    locationKind?: 'cloud' | 'trash' | 'smart' | 'tag',
    logicalPosition = -1,
  ) => (
    <Box key={`${locationKind ?? owner ?? 'home'}:${String(entry.id)}`} role="button" tabIndex={0}
      data-mobile-files-collection-row={owner}
      aria-description={mobileFilesLogicalPositionDescription(logicalPosition, sectionItems.length)}
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
        if (xDriveFileExplorerIsComposingKey(event)) return
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
      sx={{ display: 'flex', alignItems: 'center', minHeight: MOBILE_FILES_ROW_HEIGHT, px: 3.5, gap: 1.5,
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
                      fallback={<MobileDocumentIcon item={entry} size={36}/>}
                      sx={{ width: 42, height: 42, borderRadius: 0 }}/>}
      </Box>
      <Box minWidth={0} flex={1}>
        <Typography data-mobile-files-collection-title variant="body2" noWrap
          dir="auto" title={entry.name} sx={{ unicodeBidi: 'plaintext' }}>{entry.name}</Typography>
        <Typography data-mobile-files-collection-meta variant="caption" color="text.secondary" noWrap display="block">{entry.subtitle ?? (owner ? mobileFilesNativeMetadata(entry) || (entry.kind === 'dir' ? '文件夹' : '文件')
          : (entry.kind === 'dir' ? '文件夹' : '文件'))}</Typography>
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
      inline?.depth ?? 0, inline?.ownerID ?? directoryID ?? 0, inline?.sourceIndex ?? index, index) : (
      // Unloaded sparse-range cells reserve geometry but never flash a
      // temporary "加载中…" filename; real thumbnail progress stays independent.
      <Box key={index} data-mobile-files-placeholder aria-hidden
        sx={{ minHeight: effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT,
          p: 2, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
        <Box sx={{ width: effectiveGrid ? '55%' : '36%', height: 10,
          bgcolor: 'action.hover', borderRadius: 0.75, opacity: 0.55 }} />
      </Box>
    )
  }
  const heading = props.trashActive ? '最近删除' : section === 'recent' ? '最近' : section === 'favorites' ? '收藏' :
    showDirectory ? (props.searchActive ? '搜索结果' : props.crumbs.at(-1)?.name ?? '云端文件') : '浏览'
  const editTitle = editBrowseHome && section === 'browse' && !showDirectory
  const compactTitleVisible = showDirectory || scrollTop > 48 || selectionActive || editTitle
  const hasFolderAncestors = !savedResumePending && showDirectory &&
    section === 'browse' && !props.trashActive &&
    !props.searchActive && !selectionActive && props.crumbs.length > 1
  const compactTitle = selectionActive ? `已选 ${selection.length} 项` : editTitle ? '整理浏览' : heading
  const overflowAction = (label: string, action: () => void, disabled = false, disabledReason?: string) => {
    const reason = xDriveFileExplorerMenuDisabledReason({ disabled, disabledReason })
    return (
      <MenuItem key={label} disabled={disabled}
        title={reason ?? undefined}
        aria-label={reason ? label + '：' + reason : undefined}
        onClick={() => { setMoreAnchor(null); action() }} sx={{ minHeight: MIN_TOUCH }}>
        {reason ? <Box sx={{ minWidth: 0 }}>
          {label}
          <Typography component="span" variant="caption" display="block"
            sx={{ overflowWrap: 'anywhere' }}>
            {xDriveFileExplorerMenuReasonLabel({ disabled, disabledReason })}
          </Typography>
        </Box> : label}
      </MenuItem>
    )
  }
  // iOS 27 Files displays both Icons and List as explicit radio-like actions
  // in More. This changes Mobile presentation only, not the shared Web/Desktop
  // list query, workspace, tabs, Server sort, or virtual scroll owner.
  // Capture before the shared Web navigation changes sort/group. Await the
  // same explicit committed-first-Range receipt used by wide Web/Desktop.
  const chooseMobileArrangement = (
    nextSort: XDriveFileExplorerSort,
    nextGrouping: XDriveFileExplorerGrouping | undefined,
    submit: () => boolean | void | Promise<boolean | void>,
  ) => {
    setArrangeAnchor(null)
    const generation = ++arrangeGenerationRef.current
    arrangeTicketRef.current?.controller?.abort()
    arrangeTicketRef.current = null
    const host = scrollHostRef.current
    const sourceCollectionKey = props.virtualCollection?.interactionKey
    let ticket: MobileFilesArrangeTicket | null = null
    if (host && sourceCollectionKey && props.locateVerifiedCurrentChild &&
      nextGrouping && ready && showDirectory && !browseHome &&
      !props.searchActive && !props.trashActive &&
      directoryID !== null && selection.length <= 1 && totalCount > 0 &&
      (!inlineLayout || inlineLayout.itemCount === totalCount)) {
      const anchor = mobileFilesViewportAnchor(
        displayedCount, host.scrollTop, rowHeight,
        effectiveGrid ? columns : 1, groupedLayout,
      )
      const item = selection.length === 1 ? selection[0] :
        props.virtualCollection?.itemAt(anchor.index) ?? props.items[anchor.index]
      const nodeID = Number(item?.id)
      const revision = Number(item?.revision)
      if (Number.isSafeInteger(nodeID) && nodeID > 0 &&
        Number.isSafeInteger(revision) && revision > 0) {
        ticket = {
          generation, scope: arrangeScope,
          sourceCollectionKey,
          targetSignature: JSON.stringify([
            nextSort.key, nextSort.direction,
            nextGrouping.groupBy, nextGrouping.foldersFirst,
          ]),
          parentID: directoryID, nodeID, revision,
          fraction: selection.length === 1 ? 0 : anchor.fraction,
          selected: selection.length === 1,
          selectionIntent: selectionIntentRef.current,
          userGesture: arrangeUserGestureRef.current,
        }
      }
    }
    const acknowledged = submit()
    if (!ticket) return
    const staged = ticket
    void Promise.resolve(acknowledged).then(accepted => {
      if (accepted !== true || staged.generation !== arrangeGenerationRef.current ||
        arrangeScopeRef.current !== staged.scope) return
      arrangeTicketRef.current = staged
      setArrangeEpoch(value => value + 1)
    }).catch(() => {
      // A denied, obsolete or failed first Range never authorizes reanchor.
    })
  }

  const chooseMobileView = (next: 'details' | 'grid') => {
    setMoreAnchor(null)
    if (next === viewPreference) return
    const nextGrid = next === 'grid'
    const nextColumns = nextGrid ? columns : 1
    const nextRowHeight = nextGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT
    const sourceTop = scrollHostRef.current?.scrollTop ?? scrollTop
    const anchor = mobileFilesViewportAnchor(
      displayedCount, sourceTop, rowHeight, effectiveGrid ? columns : 1, groupedLayout)
    const nextCount = nextGrid ? totalCount : displayedCount
    // Expanded child rows are visible only in List. When leaving an inline
    // child, keep its nearest preceding root folder instead of treating the
    // child's flat index as an unrelated root Node.
    if (nextGrid && inlineLayout && inlineLayout.itemCount !== totalCount && directoryID !== null) {
      const cell = xDriveFileExplorerInlineCellAt(inlineLayout, anchor.index)
      if (cell?.ownerID === directoryID) anchor.index = cell.sourceIndex
      else {
        const rootRun = [...inlineLayout.segments].reverse().find(
          segment => segment.ownerID === directoryID && segment.flatStart <= anchor.index)
        anchor.index = rootRun
          ? rootRun.sourceStart + rootRun.flatEnd - rootRun.flatStart - 1 : 0
      }
    }
    anchor.index = Math.max(0, Math.min(Math.max(0, nextCount - 1), anchor.index))
    const sourceGroups = nextGrid && inlineLayout && inlineLayout.itemCount !== totalCount
      ? props.virtualCollection?.groups ?? []
      : groupedLayout?.groups.map(group => ({
          key: group.key, item_count: group.itemCount, start_index: group.startIndex,
        })) ?? []
    const nextGrouped = groupedLayout && props.grouping
      ? xDriveCreateFileExplorerGroupLayout({
          groups: sourceGroups, groupBy: props.grouping.groupBy, itemCount: nextCount,
          columns: nextColumns, rowHeight: nextRowHeight,
          rowGap: groupedLayout.rowGap, padding: groupedLayout.padding,
          groupHeaderHeight: groupedLayout.groupHeaderHeight, groupGap: groupedLayout.groupGap,
        }) : null
    const targetTop = mobileFilesViewportTop(anchor, nextRowHeight, nextColumns, nextGrouped)
    const browse = section === 'browse' && !props.trashActive && !props.searchActive &&
      !browseHome && directoryID !== null
    // Update the sparse viewport synchronously with the view: no transient
    // first-page range or wrong-folder flash while awaiting the layout effect.
    pendingViewScrollRef.current = { view: next, scope: viewPositionScope, top: targetTop, browse }
    setViewPreference(next)
    setScrollTop(targetTop)
    if (browse) {
      browseScrollRef.current = targetTop
      pendingScrollRef.current = null
      if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
      scrollSaveRef.current = null
      persist({ view: next, scrollTop: targetTop })
    } else persist({ view: next })
  }

  return (
    <XDriveFileExplorerThumbnailProvider lifecycleKey={props.lifecycleKey} loadThumbnail={props.loadThumbnail}>
      <Box ref={ownerRef} data-xdrive-mobile-files onKeyDown={handleFilesKeyboard} sx={{
        minHeight: 0, minWidth: 0, height: '100%', flex: 1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        position: 'relative',
        bgcolor: theme => theme.palette.mode === 'dark' ? '#000000' : '#ffffff',
        fontFamily: IOS_FILES_MOBILE_FONT,
        '& .MuiTypography-root, & .MuiButton-root': { fontFamily: IOS_FILES_MOBILE_FONT },
      }}>
        <Stack data-mobile-files-navigation-bar direction="row" alignItems="center" sx={{
          px: 1.5, flexShrink: 0, minHeight: 56, gap: 1,
          bgcolor: theme => theme.palette.mode === 'dark' ? '#000000' : '#ffffff',
        }}>
          {showDirectory ? (
            <IconButton aria-label="返回" onClick={navigateUp} sx={{
              width: 48, height: 48, flexShrink: 0,
              color: theme => theme.palette.mode === 'dark' ? '#f7f7f7' : '#111111',
              bgcolor: theme => theme.palette.mode === 'dark' ? '#232326' : '#fafafa',
              boxShadow: '0 4px 20px rgba(0,0,0,0.035)',
            }}><ArrowBackIosNewRoundedIcon sx={{ fontSize: 23 }}/></IconButton>
          ) : <Box aria-hidden="true" sx={{ width: 48, height: 48, flexShrink: 0 }}/>}
          {hasFolderAncestors ? (
            <Button data-mobile-files-location-trigger
              aria-label={`查看文件夹位置：${compactTitle}`} aria-haspopup="menu"
              aria-expanded={Boolean(locationMenuAnchor)}
              onClick={event => setLocationMenuAnchor(event.currentTarget)}
              sx={{ flex: 1, minWidth: 0, minHeight: MIN_TOUCH, px: 0, gap: 0.25,
                color: 'text.primary', textTransform: 'none', justifyContent: 'center' }}>
              <Typography data-mobile-files-compact-title component="span" variant="subtitle1" noWrap
                aria-hidden={false} dir="auto" title={compactTitle}
                sx={{ minWidth: 0, fontSize: 17, fontWeight: 650, textAlign: 'center' }}>
                {compactTitle}
              </Typography>
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18, flexShrink: 0 }}/>
            </Button>
          ) : (
            <Typography data-mobile-files-compact-title component="span" variant="subtitle1" noWrap
              aria-hidden={!compactTitleVisible || savedResumePending} dir="auto" title={compactTitle}
              sx={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 650, textAlign: 'center',
                visibility: compactTitleVisible && !savedResumePending ? 'visible' : 'hidden' }}>
              {compactTitle}
            </Typography>
          )}
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
              sx={{ width: 48, height: 48, flexShrink: 0, color: 'text.primary', borderRadius: '50%',
                bgcolor: theme => theme.palette.mode === 'dark' ? '#232326' : '#fafafa',
                boxShadow: '0 4px 20px rgba(0,0,0,0.035)' }}><MoreHorizRoundedIcon sx={{ fontSize: 26 }}/></IconButton>
          )}
        </Stack>
        <Box ref={scrollHostRef} data-xdrive-mobile-files-scroll data-xdrive-file-explorer-scroll-host
          onPointerDownCapture={() => { arrangeUserGestureRef.current += 1 }}
          onWheelCapture={() => { arrangeUserGestureRef.current += 1 }}
          onTouchStartCapture={() => { arrangeUserGestureRef.current += 1 }}
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
            } else if (section === 'recent' || section === 'favorites') {
              collectionScrollRef.current[section] = top
              pendingCollectionScrollRef.current = { section, scrollTop: top }
              if (scrollSaveRef.current !== null) window.clearTimeout(scrollSaveRef.current)
              scrollSaveRef.current = window.setTimeout(() => flushBrowseScroll(), 200)
            }
          }}
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain',
            overflowAnchor: 'none' }}>
          {!selectionActive && !editTitle && !showDirectory ? (
            <Box data-mobile-files-large-title sx={{ px: 2, pt: 1.75, pb: 0.5 }}>
              <Typography component="h2" sx={{ fontSize: 34, fontWeight: 730,
                lineHeight: 1.22, letterSpacing: '-0.5px' }}>{heading}</Typography>
            </Box>
          ) : null}
          <Box data-mobile-files-search-region sx={{ position: 'relative', zIndex: 1,
            bgcolor: theme => theme.palette.mode === 'dark' ? '#000000' : '#ffffff',
            px: 2, py: 1 }}>
            {/* Search scrolls away naturally. Shrinking a sticky header's
                max-height at scrollTop=48 used to modify scrollTop itself,
                producing a visible bounce and repeat-triggering the collapse. */}
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
                bgcolor: theme => theme.palette.mode === 'dark' ? '#242427' : '#f9f9fa',
                borderRadius: '999px', minHeight: 48, boxShadow: '0 2px 16px rgba(0,0,0,0.035)',
                '& fieldset': { border: 0 },
              } }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small"/></InputAdornment>,
                endAdornment: props.searchValue ? <InputAdornment position="end"><IconButton size="small" aria-label="清除搜索文本" onClick={() => props.onSearchValueChange('')}><CloseRoundedIcon fontSize="small"/></IconButton></InputAdornment> : null }}}/>
            {props.filtersControl}
            </Stack>
            {(props.searchActive || props.searchSummary) &&
              !pendingGlobalSearchPresentation ? (
              <Stack data-mobile-files-search-summary
                direction="row" alignItems="center" spacing={1}
                aria-busy={Boolean(props.searchActive && props.searchSummary?.loading &&
                  props.searchSummary?.resultCount == null) || undefined}
                sx={{ mt: 1, minHeight: 44, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  全部文件 · <Box component="span" data-mobile-files-search-count-slot
                    sx={{ display: 'inline-block', minWidth: '12ch', whiteSpace: 'nowrap' }}>
                    {props.searchActive && props.searchSummary?.resultCount == null
                      ? (props.searchSummary?.error ? '搜索未完成' : '结果待确认')
                      : `${props.searchSummary?.resultCount ?? totalCount} 个结果`}
                  </Box>
                </Typography>
                <Button size="small" onClick={clearGlobalSearch}
                  sx={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}>清除</Button>
              </Stack>
            ) : null}
          </Box>
          {section === 'browse' && !showDirectory ? (
            <Box data-xdrive-mobile-files-home
              aria-busy={props.organizationLoading || pendingGlobalSearchPresentation || undefined}
              sx={{ position: 'relative' }}>
              <Typography variant="overline" sx={{ px: 2, color: 'text.secondary',
                display: 'block', pt: 1.5, pb: 0.5 }}>位置</Typography>
              <Box
                data-mobile-files-organization-loading
                aria-hidden="true"
                sx={{ position: 'absolute', top: 12, right: 16, width: 16, height: 16,
                  display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
              />
              <Box data-mobile-files-group="locations" sx={{ mx: 2, borderRadius: '13px',
                overflow: 'hidden', bgcolor: 'background.paper' }}>
              {mobileRow({ id: -1, name: '云端文件', kind: 'dir' }, () => {
                const rootID = Number(props.crumbs[0]?.id ?? 0)
                if (!Number.isSafeInteger(rootID) || rootID <= 0) {
                  props.onOpenError(new Error('云端根目录尚未确认，请重试。'))
                  return
                }
                // A previously accepted root (counted Range or visible legacy items)
                // opens immediately, without waiting for a redundant network frame.
                // Otherwise keep the Home visible through the real network GET.
                if (directoryID === rootID && !props.loading &&
                    (props.virtualCollection || props.items.length > 0)) {
                  beginBrowse(rootID)
                } else {
                  pendingBrowseRootRef.current = {
                    rootID, intent: ++navigationIntentRef.current,
                  }
                }
                props.onCloseTrash()
                props.onBrowseRoot()
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
                        openExternalDirectory(entry.id, () => props.onOpenQuickAccess(entry.id))
                      }, 'quick', index))}
                    </Box>
                  ) : null}
                </>
              ) : null}
              {/* A failed organization read is handled by the stable feedback overlay,
                  not inserted as a row between the Browse Home sections. */}
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
              <Typography data-mobile-files-arrangement-status variant="caption"
                color="text.secondary" role="status" aria-live="polite"
                sx={{ position: 'absolute', top: 117, right: 12, zIndex: 2,
                  pointerEvents: 'none', borderRadius: '999px',
                  bgcolor: 'background.paper', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                  px: 1.25, py: 0.5, display: showRangeLoading && showArrangementLoading && totalCount > 0 ? 'block' : 'none' }}>
                正在加载… · {arrangementLabel}{groupedLayout ? ' · 已分组' : ''}
              </Typography>
              {showZeroState ? (
                <Box data-mobile-files-zero-state
                  data-mobile-files-cold-read-slot={coldUnconfirmedBrowse || undefined}
                  aria-busy={zeroStatePending || coldDirectoryReadUnconfirmed || unverifiedTrashEmpty || undefined}
                  sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                  {unverifiedTrashEmpty ? (
                    <Box data-mobile-files-trash-first-read
                      aria-busy={props.loading || trashReadState === 'unverified' || undefined}
                      sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }} />
                  ) : failedTrashEmpty ? (
                    <Stack data-mobile-files-trash-read-error role="alert" alignItems="center" justifyContent="center"
                      sx={{ minHeight: 180, px: 2 }} spacing={1}>
                      <Typography variant="body2" color="error.main">最近删除读取失败，请重试。</Typography>
                      <Button onClick={props.onRefresh} sx={{ minHeight: MIN_TOUCH }}>重试</Button>
                    </Stack>
                  ) : (coldDirectoryFirstRead || coldDirectoryReadUnconfirmed ||
                        (props.searchActive && zeroStatePending)) && !zeroStateLoading ? (
                    // Directory remains silent until an authoritative reply;
                    // Search alone may show delayed progress in this same slot.
                    null
                  ) : (
                    <XDriveStatePanel variant="plain" loading={zeroStateLoading} message={zeroStateMessage} />
                  )}
                </Box>
              ) : null}
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
                  mx: 0, borderRadius: 0,
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
              {sectionItems.length === 0 ? (
                <Box
                  data-mobile-files-collection-state
                  aria-busy={collectionFirstRead && collectionLoading || undefined}
                  sx={{ minHeight: 180, px: 2, py: 2, display: 'grid', placeItems: 'center' }}
                >
                  {collectionFirstRead ? (
                    <Box data-mobile-files-collection-first-read aria-hidden="true" />
                  ) : collectionReadState === 'error' && !collectionLoading ? (
                    <Stack data-mobile-files-collection-error role="alert" alignItems="center" spacing={1}>
                      <Typography variant="body2" color="error.main">
                        {section === 'recent' ? '最近项目读取失败，请重试。' : '收藏读取失败，请重试。'}
                      </Typography>
                      <Button sx={{ minHeight: MIN_TOUCH }} onClick={section === 'recent' ? props.onRefreshRecent : props.onRefreshFavorites}>重试</Button>
                    </Stack>
                  ) : collectionReadState === 'ready' ? (
                    <Typography color="text.secondary">暂无{section === 'recent' ? '最近打开的项目' : '收藏的文件'}</Typography>
                  ) : null}
                </Box>
              ) : null}
              <Box data-mobile-files-group="collection" sx={{ mx: 2, mt: 1.5,
                borderRadius: '13px', overflow: 'hidden', bgcolor: 'background.paper' }}>
                <Box sx={{ height: sectionWindow.before }}/>
                {sectionItems.slice(sectionWindow.start, sectionWindow.end).map((entry, offset) => mobileRow(entry, () => {
                  const open = () => section === 'recent'
                    ? props.onOpenRecent(entry.id) : props.onOpenFavorite(entry.id)
                  if (entry.kind === 'dir') {
                    openExternalDirectory(entry.id, open)
                  } else {
                    navigationIntentRef.current += 1
                    void open().catch(props.onOpenError)
                  }
                }, false, section === 'recent' ? 'recent' : 'favorites', undefined, sectionWindow.start + offset))}
                <Box sx={{ height: sectionWindow.after }}/>
              </Box>
            </Box>
          )}
        </Box>
        {/* Transient action/selection feedback is truthful, but not a new
            navigation layout state. In-flow captions used to shrink the only
            virtual scroll host each time progress or an operation changed. */}
        <Box data-mobile-files-feedback-overlay sx={{
          position: 'absolute', left: 12, right: 12,
          bottom: selectionActive
            ? 'calc(env(safe-area-inset-bottom) + 64px)'
            : 'calc(env(safe-area-inset-bottom) + 88px)',
          zIndex: 5, display: 'flex', flexDirection: 'column', gap: 0.5,
          alignItems: 'stretch', pointerEvents: 'none',
          maxHeight: 'min(35dvh, 220px)',
        }}>
          {props.actionFeedback ? (
            <Box data-mobile-files-operation-feedback
              sx={{ pointerEvents: 'auto', minWidth: 0 }}>
              {props.actionFeedback}
            </Box>
          ) : null}
          {props.searchSummary?.error ? (
            <Stack data-mobile-files-search-error role="alert" direction="row" alignItems="center"
              sx={{
                pointerEvents: 'auto', px: 2, gap: 1, minHeight: MIN_TOUCH,
                minWidth: 0, maxHeight: 'min(30dvh, 180px)', overflowY: 'auto',
                borderRadius: 1.5, bgcolor: 'background.paper',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}>
              <Typography variant="caption" color="error" sx={{
                minWidth: 0, flex: 1, overflowWrap: 'anywhere',
              }}>{props.searchSummary.error}</Typography>
              {props.searchSummary.onRetry ? (
                <Button onClick={props.searchSummary.onRetry} sx={{
                  minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, whiteSpace: 'nowrap',
                }}>重试</Button>
              ) : null}
            </Stack>
          ) : null}
          {section === 'browse' && !showDirectory && !props.organizationLoading && props.organizationError ? (
            <Stack data-mobile-files-organization-error role="alert" direction="row" alignItems="center"
              sx={{
                pointerEvents: 'auto', px: 2, gap: 1, minHeight: MIN_TOUCH,
                borderRadius: 1.5, bgcolor: 'background.paper',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}>
              <Typography variant="caption" color="error" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                {props.organizationError}
              </Typography>
              {props.onRetryOrganization ? <Button onClick={props.onRetryOrganization} sx={{ minHeight: MIN_TOUCH }}>重试</Button> : null}
            </Stack>
          ) : null}
          {selectionLoad ? <Typography data-mobile-files-select-progress role="status"
            variant="caption" sx={{
              px: 2, py: 0.5, borderRadius: 1.5, bgcolor: 'background.paper',
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            }}>
            正在选择 {selectionLoad.loaded} / {selectionLoad.total} 项
          </Typography> : null}
          {selectionFeedback ? <Typography role="status" variant="caption" color="warning.main"
            sx={{
              px: 2, py: 0.5, borderRadius: 1.5, bgcolor: 'background.paper',
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            }}>{selectionFeedback}</Typography> : null}
          {selectionActive && !selectionLoad && selection.length > 0 &&
            (selectedMutationReason || selectedDownloadReason) ? (
            <Typography data-mobile-files-selection-limits role="status" variant="caption"
              color="text.secondary" sx={{
                px: 2, py: 0.5, borderRadius: 1.5, bgcolor: 'background.paper',
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}>
              {selectedMutationReason ? `批量操作：${selectedMutationReason}` : ''}
              {selectedMutationReason && selectedDownloadReason ? '；' : ''}
              {selectedDownloadReason ? `下载：${selectedDownloadReason}` : ''}
            </Typography>
          ) : null}
        </Box>
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
            flexShrink: 0, alignSelf: 'center', width: 'calc(100% - 24px)', maxWidth: 320,
            mt: 0.75,
            mb: 'max(env(safe-area-inset-bottom), 8px)',
            px: 0.75, py: 0.5, borderRadius: '999px',
            border: '1px solid', borderColor: 'divider',
            bgcolor: theme => theme.palette.mode === 'dark' ? 'rgba(42,42,45,0.92)' : 'rgba(249,249,253,0.94)',
            backdropFilter: 'blur(18px) saturate(160%)',
            boxShadow: '0 3px 16px rgba(0,0,0,0.10)',
          }} aria-label="文件分类">
            {([
              ['recent', <HistoryRoundedIcon/>, '最近项目'],
              ['favorites', <StarBorderRoundedIcon/>, '收藏'],
              ['browse', <FolderRoundedIcon/>, '浏览'],
            ] as const).map(([value, icon, label]) => (
              <Button key={value} data-mobile-files-section={value} aria-current={section === value ? 'page' : undefined}
                onClick={() => changeSection(value)} sx={{
                  flex: 1, flexDirection: 'column', minHeight: 52, gap: 0,
                  color: section === value ? IOS_FILES_MOBILE_BLUE : 'text.secondary',
                  fontSize: 11, borderRadius: '999px',
                  bgcolor: section === value ? 'action.selected' : 'transparent',
                }}>
                {icon}{label}
              </Button>
            ))}
          </Stack>
        )}
        <Menu data-mobile-files-location-menu anchorEl={locationMenuAnchor}
          open={Boolean(locationMenuAnchor) && hasFolderAncestors}
          onClose={() => setLocationMenuAnchor(null)}
          slotProps={{ paper: { sx: { ...MOBILE_FILES_MENU_TOUCH_SX, maxHeight: 'min(65dvh, 440px)' } } }}>
          {props.crumbs.map((crumb, index) => (
            <MenuItem key={String(crumb.id)} data-mobile-files-crumb-id={String(crumb.id)}
              aria-current={index === props.crumbs.length - 1 ? 'page' : undefined}
              sx={{ bgcolor: dropCrumbID === String(crumb.id) ? 'action.selected' : undefined }}
              onDragOver={event => externalDragOver(event, { kind: 'crumb', crumb })}
              onDrop={event => externalDrop(event, { kind: 'crumb', crumb })}
              onClick={() => {
                setLocationMenuAnchor(null)
                if (index === props.crumbs.length - 1) return
                // Do not scroll the still-visible child while an ancestor
                // navigation is awaiting its Server-authoritative commit.
                props.onCrumbClick(index)
              }}>
              <ListItemIcon><FolderRoundedIcon sx={{ color: IOS_FILES_MOBILE_BLUE }}/></ListItemIcon>
              <Typography noWrap dir="auto" title={crumb.name || '根目录'}
                sx={{ unicodeBidi: 'plaintext' }}>{crumb.name || '根目录'}</Typography>
              {index === props.crumbs.length - 1
                ? <CheckRoundedIcon sx={{ ml: 'auto', fontSize: 18, color: IOS_FILES_MOBILE_BLUE }}/> : null}
            </MenuItem>
          ))}
        </Menu>
        <Menu data-mobile-files-selection-menu anchorEl={selectionMoreAnchor} open={Boolean(selectionMoreAnchor)}
          onClose={() => setSelectionMoreAnchor(null)}
          slotProps={{ list: { disabledItemsFocusable: true }, paper: { sx: {
            ...MOBILE_FILES_MENU_TOUCH_SX, maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'min(70dvh, 560px)', overflowY: 'auto',
          } } }}>
          <MenuItem data-mobile-files-selection-action="cut"
            disabled={Boolean(selectionMoreReasons.cut)}
            title={selectionMoreReasons.cut ?? undefined}
            aria-label={selectionMoreReasons.cut ? `剪切所选：${selectionMoreReasons.cut}` : '剪切所选'}
            onClick={() => {
              if (selectionMoreReasons.cut) return
              setSelectionMoreAnchor(null); selectedAction('cut')
            }}>{selectionMoreLabel('剪切所选', selectionMoreReasons.cut)}</MenuItem>
          <MenuItem data-mobile-files-selection-action="copy-to"
            disabled={Boolean(selectionMoreReasons.copyTo)}
            title={selectionMoreReasons.copyTo ?? undefined}
            aria-label={selectionMoreReasons.copyTo ? `复制到：${selectionMoreReasons.copyTo}` : '复制到…'}
            onClick={() => {
              if (selectionMoreReasons.copyTo) return
              setSelectionMoreAnchor(null); selectedAction('copy-to')
            }}>{selectionMoreLabel('复制到…', selectionMoreReasons.copyTo)}</MenuItem>
          <MenuItem data-mobile-files-selection-action="download"
            disabled={Boolean(selectionMoreReasons.download)}
            title={selectionMoreReasons.download ?? undefined}
            aria-label={selectionMoreReasons.download ? `下载所选：${selectionMoreReasons.download}` : '下载所选'}
            onClick={() => {
              if (selectionMoreReasons.download) return
              setSelectionMoreAnchor(null); selectedAction('download')
            }}>{selectionMoreLabel('下载所选', selectionMoreReasons.download)}</MenuItem>
          {props.onCopyPaths ? <MenuItem data-mobile-files-selection-action="copy-paths"
            disabled={Boolean(selectionMoreReasons.common)}
            title={selectionMoreReasons.common ?? undefined}
            aria-label={selectionMoreReasons.common ? `复制所选路径：${selectionMoreReasons.common}` : '复制所选路径'}
            onClick={() => {
              if (selectionMoreReasons.common) return
              setSelectionMoreAnchor(null); props.onCopyPaths?.(selection)
            }}>{selectionMoreLabel('复制所选路径', selectionMoreReasons.common)}</MenuItem> : null}
          <MenuItem data-mobile-files-selection-action="manage-tags"
            disabled={Boolean(selectionMoreReasons.manageTags)}
            title={selectionMoreReasons.manageTags ?? undefined}
            aria-label={selectionMoreReasons.manageTags ? `添加/管理标签：${selectionMoreReasons.manageTags}` : '添加/管理标签'}
            onClick={() => {
              if (selectionMoreReasons.manageTags) return
              setSelectionMoreAnchor(null)
              props.onManageTags(selection)
            }}>{selectionMoreLabel('添加/管理标签', selectionMoreReasons.manageTags)}</MenuItem>
          <MenuItem data-mobile-files-batch-properties
            data-mobile-files-selection-action="properties"
            disabled={Boolean(selectionMoreReasons.common)}
            title={selectionMoreReasons.common ?? undefined}
            aria-label={selectionMoreReasons.common ? `所选项目属性：${selectionMoreReasons.common}` : '所选项目属性'}
            onClick={() => {
              if (selectionMoreReasons.common) return
              setSelectionMoreAnchor(null)
              setPropertiesItems([...selection])
            }}>{selectionMoreLabel('所选项目属性', selectionMoreReasons.common)}</MenuItem>
        </Menu>
        <Menu data-mobile-files-more-menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}
          slotProps={{ list: { disabledItemsFocusable: true },
            paper: { sx: { ...MOBILE_FILES_MENU_TOUCH_SX, maxHeight: 'min(70dvh, 520px)' } } }}>
          {showDirectory ? <MenuItem disabled data-mobile-files-arrangement-summary sx={{ minHeight: MIN_TOUCH }}>
            {`${totalCount} 个项目 · ${arrangementLabel}`}
          </MenuItem> : null}
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
          {showDirectory && !props.trashActive ? overflowAction('粘贴', props.onPaste, !props.canPaste,
            '当前目录暂不能粘贴，请检查剪贴板与目标目录') : null}
          {!props.trashActive && props.onPathSubmit
            ? overflowAction('前往文件夹路径…', openGoToPath) : null}
          {!props.trashActive ? <Divider sx={{ my: 0.5 }} /> : null}
          {!props.trashActive ? overflowAction('撤销', () => props.onUndo?.(), !props.canUndo || !props.onUndo,
            '当前没有可用的撤销操作') : null}
          {!props.trashActive ? overflowAction('重做', () => props.onRedo?.(), !props.canRedo || !props.onRedo,
            '当前没有可用的重做操作') : null}
          {showDirectory && !props.trashActive ? overflowAction('后退（浏览历史）', () => props.onHistoryBack?.(), !props.canHistoryBack || !props.onHistoryBack,
            '当前没有可用的浏览历史返回操作') : null}
          {showDirectory && !props.trashActive ? overflowAction('前进（浏览历史）', () => props.onHistoryForward?.(), !props.canHistoryForward || !props.onHistoryForward,
            '当前没有可用的浏览历史前进操作') : null}
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
          slotProps={{ paper: { sx: { ...MOBILE_FILES_MENU_TOUCH_SX, maxHeight: 'min(65dvh, 420px)' } } }}>
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
        <Menu data-mobile-files-arrange-menu anchorEl={arrangeAnchor} open={Boolean(arrangeAnchor)} onClose={() => setArrangeAnchor(null)}
          slotProps={{ paper: { sx: { ...MOBILE_FILES_MENU_TOUCH_SX, maxHeight: 'min(70dvh, 460px)' } } }}>
          {(['name', 'updated', 'type', 'size'] as const).map(key => (
            <MenuItem key={key} selected={props.sort.key === key} sx={{ minHeight: MIN_TOUCH }}
              onClick={() => {
                const nextSort = { ...props.sort, key }
                chooseMobileArrangement(nextSort, props.grouping, () => props.onSortChange(nextSort))
              }}>
              {({ name: '名称', updated: '修改日期', type: '类型', size: '大小' })[key]}
            </MenuItem>
          ))}
          <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const nextSort = { ...props.sort, direction: (props.sort.direction === 'asc' ? 'desc' : 'asc') as 'asc' | 'desc' }
            chooseMobileArrangement(nextSort, props.grouping, () => props.onSortChange(nextSort))
          }}>方向：{props.sort.direction === 'asc' ? '升序' : '降序'}</MenuItem>
          {props.grouping && props.onGroupingChange ? (['none', 'type', 'modified', 'size'] as const).map(kind => (
            <MenuItem key={kind} selected={props.grouping?.groupBy === kind} sx={{ minHeight: MIN_TOUCH }} onClick={() => {
              if (props.grouping) {
                const nextGrouping = { ...props.grouping, groupBy: kind }
                chooseMobileArrangement(props.sort, nextGrouping,
                  () => props.onGroupingChange?.(nextGrouping))
              }
            }}>{({ none: '不分组', type: '按类型分组', modified: '按修改日期分组', size: '按大小分组' })[kind]}</MenuItem>
          )) : null}
          {props.grouping && props.onGroupingChange ? (
            <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
              if (props.grouping) {
                const nextGrouping = { ...props.grouping, foldersFirst: !props.grouping.foldersFirst }
                chooseMobileArrangement(props.sort, nextGrouping,
                  () => props.onGroupingChange?.(nextGrouping))
              }
            }}>文件夹优先：{props.grouping.foldersFirst ? '开启' : '关闭'}</MenuItem>
          ) : null}
        </Menu>
        <Menu open={Boolean(itemMenu)} onClose={() => setItemMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={itemMenu ? { top: itemMenu.y, left: itemMenu.x } : undefined}
          slotProps={{ list: { disabledItemsFocusable: true }, paper: { sx: { borderRadius: '14px', minWidth: 218,
            maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(70dvh, 560px)',
            ...MOBILE_FILES_MENU_TOUCH_SX,
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
            disabled={Boolean(props.renameDisabled)}
            title={props.renameDisabled ? '当前不可重命名此文件' : undefined}
            aria-label={props.renameDisabled ? '重命名：当前不可重命名此文件' : '重命名'}
            onClick={() => beginRename(itemMenu.item)}
            sx={{ minHeight: MIN_TOUCH }}><ListItemIcon><EditRoundedIcon fontSize="small"/></ListItemIcon>
            <Box><Typography variant="body2">重命名</Typography>
              {props.renameDisabled ? <Typography variant="caption" color="text.secondary">
                不可用：当前不可重命名此文件
              </Typography> : null}
            </Box>
          </MenuItem> : null}
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
                  <ListItemIcon>{option.icon}</ListItemIcon>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{option.label}</Typography>
                    {reason ? <Typography variant="caption" color="text.secondary"
                      sx={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                      {'不可用：' + reason}
                    </Typography> : null}
                  </Box>
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
          slotProps={{ paper: { sx: { ...MOBILE_FILES_MENU_TOUCH_SX,
            borderRadius: '14px', minWidth: 218,
            maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(70dvh, 560px)' } } }}>
          {collectionMenu ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const selectedEntry = collectionMenu.entry
            const owner = collectionMenu.owner
            setCollectionMenu(null)
            const open = () => owner === 'recent'
              ? props.onOpenRecent(selectedEntry.id) : props.onOpenFavorite(selectedEntry.id)
            // P69: ContextMenu, Shift+F10 and long press must use the SAME
            // counted first-Range gate as tapping a collection folder row.
            if (selectedEntry.kind === 'dir') {
              openExternalDirectory(selectedEntry.id, open)
            } else {
              navigationIntentRef.current += 1
              void open().catch(props.onOpenError)
            }
          }}>打开</MenuItem> : null}
          {collectionMenu ? <MenuItem sx={{ minHeight: MIN_TOUCH }} onClick={() => {
            const entry = collectionMenu.entry
            setCollectionMenu(null)
            // The location lookup is an intent too: a newer rail/owner
            // interaction must win over its late completion.
            const lookupIntent = ++navigationIntentRef.current
            void props.loadNodeLocation(entry.id).then(location => {
              if (lookupIntent !== navigationIntentRef.current || !location.parent_id) return
              // A caller may return void, a boolean or a Promise. Only an
              // accepted counted directory Range may reveal Browse.
              openExternalDirectory(location.parent_id, async () =>
                (await props.onShowInFolder(location)) !== false)
            }).catch(error => {
              if (lookupIntent === navigationIntentRef.current) props.onOpenError(error)
            })
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
            if (props.renameDisabled || props.trashActive) {
              throw new Error('文件操作进行中，暂时无法重命名，请稍后重试。')
            }
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
