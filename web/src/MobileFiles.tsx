import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react'
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
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
  IconButton, InputAdornment, Menu, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { formatBytes, xDriveFileExplorerDragAutoScrollDelta } from '../../ui/shared/src'
import type { MediaItem, NodeLocation, XDriveFileExplorerGrouping } from '../../ui/shared/src'
import {
  XDriveFileExplorerAvailabilityBadge, XDriveFileExplorerItemIcon,
  XDriveFileExplorerThumbnail, XDriveFileExplorerThumbnailProvider,
  XDriveFilePropertiesDialog, XDriveMediaDetailsInspector, xDriveFileSupportsThumbnail,
  xDriveFileKind, xDriveFileTypeLabel,
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

type SectionEntry = { id: number; name: string; kind: 'dir' | 'file'; subtitle?: string; size?: number; revision?: number }
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
  onClearRecent: () => void | boolean | Promise<void | boolean>
  onUnfavorite: (id: number) => void | boolean | Promise<void | boolean>
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

const BLUE_FOLDER = '#2677e8'
const MIN_TOUCH = 44
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
  const [section, setSection] = useState<MobileFilesSection>(initial.section)
  const [browseHome, setBrowseHome] = useState(initial.folderID === null)
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
    props.virtualCollection.onRangeChange(start, Math.max(start, end - 1))
  }, [ready, showDirectory, props.virtualCollection, start, end, totalCount])

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

  const menuFor = (item: XDriveFileExplorerItem) => {
    const common = props.getItemMenuItems(item).filter(action => !['open-new-tab', 'open-browser-tab'].includes(action.id))
    return common
  }
  const openProperties = (item: XDriveFileExplorerItem) => { setItemMenu(null); setProperties(item) }
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
        aria-label={item.name}
        aria-selected={selectionMode ? chosen : undefined}
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
          borderBottom: effectiveGrid ? 0 : 1, borderColor: 'divider', cursor: 'pointer',
          bgcolor: chosen || dropFolderID === String(item.id) ? 'action.selected' : 'transparent',
          outline: dropFolderID === String(item.id) ? '2px solid' : 'none',
          outlineColor: 'primary.main', outlineOffset: -2,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        {selectionMode ? (
          <Box sx={{ color: chosen ? 'primary.main' : 'text.disabled' }}><CheckRoundedIcon fontSize="small"/></Box>
        ) : null}
        <Box sx={{ flexShrink: 0, width: effectiveGrid ? 70 : 44, height: effectiveGrid ? 70 : 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {item.kind === 'dir' ? <FolderRoundedIcon sx={{ fontSize: effectiveGrid ? 62 : 38, color: BLUE_FOLDER }} /> : (
            <XDriveFileExplorerThumbnail item={item} eligible={xDriveFileSupportsThumbnail(item.name, item.kind)}
              fallback={<XDriveFileExplorerItemIcon item={item} size={effectiveGrid ? 38 : 28}/>}
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
  ) => (
    <Box key={String(entry.id)} role="button" tabIndex={0}
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
        borderBottom: 1, borderColor: 'divider',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      {isFolder || entry.kind === 'dir'
        ? <FolderRoundedIcon sx={{ color: BLUE_FOLDER, fontSize: 35 }}/>
        : <XDriveFileExplorerItemIcon item={entry} size={29}/>}
      <Box minWidth={0} flex={1}>
        <Typography variant="body2" noWrap>{entry.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">{entry.subtitle ?? (entry.kind === 'dir' ? '文件夹' : '文件')}</Typography>
      </Box>
    </Box>
  )
  const heading = props.trashActive ? '最近删除' : section === 'recent' ? '最近' : section === 'favorites' ? '收藏' :
    showDirectory ? (props.searchActive ? '搜索结果' : props.crumbs.at(-1)?.name ?? '云端文件') : '浏览'
  const overflowAction = (label: string, action: () => void, disabled = false) => (
    <MenuItem key={label} disabled={disabled} onClick={() => { setMoreAnchor(null); action() }} sx={{ minHeight: MIN_TOUCH }}>{label}</MenuItem>
  )

  return (
    <XDriveFileExplorerThumbnailProvider lifecycleKey={props.lifecycleKey} loadThumbnail={props.loadThumbnail}>
      <Box ref={ownerRef} data-xdrive-mobile-files sx={{
        minHeight: 0, minWidth: 0, height: '100%', flex: 1,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper',
      }}>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, flexShrink: 0, minHeight: 56, gap: 1 }}>
          {showDirectory ? (
            <Button size="small" onClick={navigateUp} startIcon={<ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }}/>}
              sx={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, px: 1 }}>返回</Button>
          ) : null}
          <Typography variant="h5" fontWeight={750} noWrap sx={{ flex: 1, minWidth: 0 }}>{heading}</Typography>
          <IconButton aria-label="文件操作菜单" onClick={event => setMoreAnchor(event.currentTarget)}
            sx={{ width: MIN_TOUCH, height: MIN_TOUCH }}><MoreHorizRoundedIcon/></IconButton>
        </Stack>
        <Box ref={scrollHostRef} data-xdrive-mobile-files-scroll
          onScroll={(event: UIEvent<HTMLDivElement>) => {
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
          <Box sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', px: 2,
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
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'action.hover', borderRadius: 2, minHeight: MIN_TOUCH } }}
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
              <Typography variant="overline" sx={{ px: 2, color: 'text.secondary' }}>位置</Typography>
              {mobileRow({ id: -1, name: '云端文件', kind: 'dir' }, () => {
                props.onCloseTrash()
                props.onBrowseRoot()
                beginBrowse(Number(props.crumbs[0]?.id ?? 0) || null)
                setBrowseHome(false)
              }, true)}
              {mobileRow({ id: -2, name: '最近删除', kind: 'dir' }, () => {
                props.onOpenTrash(); beginBrowse(null)
              }, true)}
              {props.quickAccess.length > 0 ? (
                <>
                  <Typography variant="overline" sx={{ px: 2, pt: 2, color: 'text.secondary' }}>个人收藏文件夹</Typography>
                  {props.quickAccess.map(entry => mobileRow(entry, () => {
                    const intent = ++navigationIntentRef.current
                    void props.onOpenQuickAccess(entry.id).then(accepted => {
                      if (accepted && intent === navigationIntentRef.current) beginBrowse(entry.id)
                    }).catch(props.onOpenError)
                  }, true))}
                </>
              ) : null}
              {props.savedSearches.length > 0 || props.tags.length > 0 ? (
                <>
                  <Typography variant="overline" sx={{ px: 2, pt: 2, color: 'text.secondary' }}>整理</Typography>
                  {props.savedSearches.map(entry => mobileRow({ ...entry, kind: 'dir', subtitle: '智能文件夹' }, () => {
                    launchGlobalSearch(() => props.onOpenSavedSearch(entry.id))
                  }, true))}
                  {props.tags.map(entry => mobileRow({ ...entry, kind: 'dir', subtitle: '标签' }, () => {
                    launchGlobalSearch(() => props.onOpenTag(entry.id))
                  }))}
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
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, display: 'block', pb: 1 }}>
                {props.loading ? '正在加载…' : `${totalCount} 个项目`}{props.grouping?.groupBy && props.grouping.groupBy !== 'none' ? ' · 已分组' : ''}
              </Typography>
              {props.loading && totalCount === 0 ? <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24}/></Box> : null}
              {totalCount === 0 && !props.loading ? <Typography sx={{ p: 4 }} color="text.secondary">这里还没有文件</Typography> : null}
              <Box sx={{ height: windowRows.before }} />
              <Box sx={effectiveGrid ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
                {Array.from({ length: end - start }, (_, offset) => {
                  const index = start + offset
                  const item = props.virtualCollection?.itemAt(index) ?? props.items[index]
                  return item ? renderEntry(item, `${index}:${mobileItemKey(item)}`) : (
                    <Box key={index} data-mobile-files-placeholder aria-label="正在加载文件"
                      sx={{ minHeight: effectiveGrid ? MOBILE_FILES_GRID_ROW_HEIGHT : MOBILE_FILES_ROW_HEIGHT, p: 2, color: 'text.disabled' }}>
                      <Typography variant="caption">加载中…</Typography>
                    </Box>
                  )
                })}
              </Box>
              <Box sx={{ height: windowRows.after }}/>
            </>
          ) : (
            <Box data-xdrive-mobile-files-collection>
              {sectionItems.length === 0 ? <Typography color="text.secondary" sx={{ p: 3 }}>暂无{section === 'recent' ? '最近打开的项目' : '收藏的文件'}</Typography> : null}
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
          )}
        </Box>
        {props.actionFeedback ? <Box data-mobile-files-operation-feedback sx={{ flexShrink: 0 }}>{props.actionFeedback}</Box> : null}
        {selectionFeedback ? <Typography role="status" variant="caption" color="warning.main"
          sx={{ px: 2, py: 0.5, flexShrink: 0 }}>{selectionFeedback}</Typography> : null}
        {selectionMode && showDirectory ? (
          <Stack direction="row" gap={0.5} sx={{ px: 1, minHeight: 54, alignItems: 'center', borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>已选 {selection.length} 项</Typography>
            <Button size="small" onClick={() => void selectAllCurrent()}
              disabled={props.loading || totalCount === 0} sx={{ minWidth: MIN_TOUCH }}>
              全选
            </Button>
            <IconButton aria-label="复制已选" disabled={!selection.length} onClick={() => selectedAction('copy')}><ContentCopyOutlinedIcon/></IconButton>
            <IconButton aria-label="移动已选" disabled={!selection.length} onClick={() => selectedAction('move')}><DriveFileMoveOutlinedIcon/></IconButton>
            <IconButton aria-label="删除已选" disabled={!selection.length} onClick={() => selectedAction('delete')}><DeleteOutlineRoundedIcon/></IconButton>
            <IconButton aria-label="更多已选操作" disabled={!selection.length}
              onClick={event => setSelectionMoreAnchor(event.currentTarget)}><MoreHorizRoundedIcon/></IconButton>
            <Button onClick={() => {
              setSelectionMode(false); setSelected(new Map())
              setSelectionFeedback(''); setSelectionMoreAnchor(null)
            }}>完成</Button>
          </Stack>
        ) : null}
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
                color: section === value ? 'primary.main' : 'text.secondary',
                fontSize: 11, borderRadius: 0,
              }}>
              {icon}{label}
            </Button>
          ))}
        </Stack>
        <Menu anchorEl={selectionMoreAnchor} open={Boolean(selectionMoreAnchor)}
          onClose={() => setSelectionMoreAnchor(null)}>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('cut') }}>剪切所选</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('copy-to') }}>复制到…</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); selectedAction('download') }}>下载所选</MenuItem>
          <MenuItem onClick={() => { setSelectionMoreAnchor(null); props.onManageTags(selection) }}>添加/管理标签</MenuItem>
        </Menu>
        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}
          slotProps={{ paper: { sx: { maxHeight: 'min(70dvh, 520px)' } } }}>
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
          anchorPosition={itemMenu ? { top: itemMenu.y, left: itemMenu.x } : undefined}>
          {itemMenu ? menuFor(itemMenu.item).map(item => (
            <MenuItem key={item.id} disabled={item.disabled}
              sx={{ color: item.danger ? 'error.main' : undefined, minHeight: 44 }}
              onClick={() => { setItemMenu(null); item.onSelect() }}>{item.label}</MenuItem>
          )) : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => beginRename(itemMenu.item)}>重命名</MenuItem> : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => { props.onMove([itemMenu.item]); setItemMenu(null) }}>移动到…</MenuItem> : null}
          {itemMenu && !props.trashActive ? <MenuItem onClick={() => { props.onCopyTo([itemMenu.item]); setItemMenu(null) }}>复制到…</MenuItem> : null}
          {itemMenu ? <MenuItem onClick={() => openProperties(itemMenu.item)}>属性</MenuItem> : null}
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
        </Menu>
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
