import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import { XDriveMediaAsyncVideoPoster } from './MediaGalleryPreviewMedia'
import type { MediaThumbnailLoader } from './MediaGallery'
import type { XDriveTrustedProjectedMapCells } from '../media-gallery-baidu-isolated-frame-host'
import type { MediaBaiduNativeCellsPage, MediaBaiduNativeCellSelection, MediaItem } from '../models'
import { xDriveMountBaiduIsolatedFrame } from '../media-gallery-baidu-isolated-frame-host'
import { xDriveMountBaiduInlineMap } from '../media-gallery-baidu-inline-map-host'
import type { XDriveBaiduJSAPIPrototypeConfig } from '../models'
import type { XDriveBaiduIsolatedBounds } from '../media-gallery-baidu-isolated-origin-protocol'
import { xDriveValidBaiduNativeCellsPage } from '../media-gallery-baidu-jsapi4-cells'
import { xDriveSelectBaiduNativeCell } from '../media-gallery-baidu-jsapi4-cell-range'
import type { XDriveBaiduCellRangeSort } from '../media-gallery-baidu-jsapi4-cell-range'
import { xDriveBaiduCellReturnMatchesFreshSelection } from '../media-gallery-baidu-cell-return-session'
import {
  XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT, XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,
  xDrivePlacesDrawerValidRange,
  xDrivePlacesDrawerMatchesFresh, xDrivePlacesDrawerMatchesResizedCell,
  xDriveTakePlacesDrawerViewerReturn,
} from '../media-gallery-places-photo-drawer'
import type {
  XDrivePlacesDrawerReturn, XDrivePlacesDrawerPresentation,
} from '../media-gallery-places-photo-drawer'
import { xDriveAppendPlacesDrawerPage } from '../media-gallery-places-photo-paging'
import { XDriveMediaGalleryPlacesPhotoDrawer } from './MediaGalleryPlacesPhotoDrawer'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import {
  xDriveVerifiedMapPhotoProjections,
  xDriveSelectVisibleMapPhotoCovers,
} from '../media-gallery-places-map-pins'
import type { XDrivePlacesMapOverlayRect } from '../media-gallery-places-map-pins'
import {
  xDriveBaiduMapPhotoScopeKey, xDriveCopyBaiduMapPhotoScope,
} from '../media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from '../media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'

type Bounds = XDriveBaiduIsolatedBounds

/**
 * Third-party Baidu code and map DOM live only under the separate HTTPS Child.
 * The trusted Parent performs every Owner/PhotoScope/source-revision-fenced /cells query,
 * and an activation only opens the original authorized /cell-items Range.
 * Neither JWT, image URLs, blobs, PhotoAsset IDs nor original WGS84 coordinates
 * enter the iframe. All navigation/unmount/query cancellations abort requests.
 */
export function XDriveMediaGalleryBaiduIsolatedPhotoSurface({
  childOrigin,
  mintChildTicket,
  getInlinePrototypeConfig,
  getInlineSignedStatus,
  mode = 'isolated',
  listOwnerCells,
  listOwnerCellItems,
  loadThumbnail,
  loadPreviewURL,
  saveVideoPoster,
  edgeToEdge = false,
  onOpenCell,
  onOpenCellPhoto,
  onOpenViewport,
  onInvalidated,
  onCamera,
  onCameraClear,
  onReady,
  onFailure,
  initialCamera,
  scope,
  mapPhotoScope,
}: {
  childOrigin: string
  mintChildTicket?: (signal: AbortSignal) => Promise<{provider:'baidu-jsapi-4.0';child_origin:string;ticket:string}>
  getInlinePrototypeConfig?: (signal: AbortSignal) => Promise<XDriveBaiduJSAPIPrototypeConfig>
  getInlineSignedStatus?: (signal: AbortSignal) => Promise<{
    provider:'baidu-jsapi-4.0';enabled:boolean;activation_state:string;
    isolated_child_origin?:string
  }>
  mode?: 'inline' | 'isolated'
  listOwnerCells: (bounds: Bounds, signal: AbortSignal,
    filters?: XDriveBaiduMapPhotoScope['filters'], albumKey?: string) => Promise<MediaBaiduNativeCellsPage>
  listOwnerCellItems?: (selection: MediaBaiduNativeCellSelection,
    limit: number, offset: number, sort: XDriveBaiduCellRangeSort,
    signal: AbortSignal) => Promise<import('../models').MediaItemRange>
  loadThumbnail?: MediaThumbnailLoader
  loadPreviewURL?: import('./MediaGallery').MediaPreviewURLLoader
  saveVideoPoster?: import('./MediaGallery').MediaVideoPosterSaver
  edgeToEdge?: boolean
  onOpenCell: (selection: MediaBaiduNativeCellSelection, scope: XDriveBaiduMapPhotoScope) => void
  onOpenCellPhoto?: (selection: MediaBaiduNativeCellSelection,
    scope: XDriveBaiduMapPhotoScope, nodeID: number, revision: number,
    presentation: XDrivePlacesDrawerPresentation) => void
  onOpenViewport?: (bounds: Bounds, scope: XDriveBaiduMapPhotoScope) => void
  onInvalidated?: () => void
  onCamera?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onCameraClear?: () => void
  onReady: (ready: boolean) => void
  onFailure?: () => void
  initialCamera?: XDriveBaiduNativeCameraSnapshot
  scope?: string
  mapPhotoScope: XDriveBaiduMapPhotoScope
}) {
  const mount = useRef<HTMLDivElement | null>(null)
  const summaryElement = useRef<HTMLDivElement | null>(null)
  const clusterListRef = useRef<HTMLDetailsElement | null>(null)
  const errorElement = useRef<HTMLDivElement | null>(null)
  const mapFrameRef = useRef<{
    setPhotoCoverSelections(selections: readonly MediaBaiduNativeCellSelection[]): boolean
  } | null>(null)
  const failureCallback = useRef(onFailure)
  failureCallback.current = onFailure
  const opened = useRef(onOpenCell)
  const photoOpener = useRef(onOpenCellPhoto)
  const previewPort = useRef(listOwnerCellItems)
  const selectCellRef = useRef<(selection: MediaBaiduNativeCellSelection,
    presentation?: XDrivePlacesDrawerPresentation) => void>(() => {})
  const drawerFetch = useRef<AbortController | null>(null)
  const restoreOwner = useRef<string | null>(null)
  const restoreHint = useRef<XDrivePlacesDrawerReturn | null>(null)
  // Consume only after commit, not during speculative React renders.
  // The map's mount effect runs after this earlier effect.
  useEffect(() => {
    if (restoreOwner.current === (scope ?? '')) return
    restoreOwner.current = scope ?? ''
    restoreHint.current = scope ? (xDriveTakePlacesDrawerViewerReturn(scope) ?? null) : null
  }, [scope])
  const openViewport = useRef(onOpenViewport)
  const latestAcceptedViewport = useRef<Bounds | null>(null)
  // Owner-approved cells, their camera and filter signature form one scope.
  const currentFilterKey = xDriveBaiduMapPhotoScopeKey(mapPhotoScope)
  // A true empty filtered Owner range is not necessarily a missing GPS/BD09
  // derivative. Both SDK Hosts share this one honest empty-state distinction.
  const hasMembershipFilters = Boolean(mapPhotoScope.albumKey ||
    mapPhotoScope.filters.favorite !== undefined ||
    mapPhotoScope.filters.asset_kind ||
    mapPhotoScope.filters.captured_from || mapPhotoScope.filters.captured_to)
  const scopeSnapshot = xDriveCopyBaiduMapPhotoScope(mapPhotoScope)
  const filterRef = useRef({key:currentFilterKey,snapshot:scopeSnapshot})
  filterRef.current = {key:currentFilterKey,snapshot:scopeSnapshot}
  const acceptedScope = useRef<{key:string;scope:XDriveBaiduMapPhotoScope}|null>(null)
  const failedCellsScopeRef = useRef<{owner:string;key:string} | null>(null)
  const acceptedCells = useRef<MediaBaiduNativeCellSelection[]>([])
  const lastViewport = useRef<{bounds:Bounds;live:boolean}|null>(null)
  const refreshFilteredCells = useRef<((skipPending?:boolean) => void) | null>(null)
  const lastFilterKey = useRef(currentFilterKey)
  const invalidated = useRef(onInvalidated)
  const cameraUpdate = useRef(onCamera)
  const cameraClear = useRef(onCameraClear)
  opened.current = onOpenCell
  photoOpener.current = onOpenCellPhoto
  previewPort.current = listOwnerCellItems
  openViewport.current = onOpenViewport
  invalidated.current = onInvalidated
  cameraUpdate.current = onCamera
  cameraClear.current = onCameraClear
  const [summary,setSummary] = useState<MediaBaiduNativeCellsPage | null>(null)
  const [acceptedViewport, setAcceptedViewport] = useState<Bounds | null>(null)
  const [accessible,setAccessible] = useState<Array<{label:string;selection:MediaBaiduNativeCellSelection}>>([])
  const [phase,setPhase] = useState<'loading'|'ready'|'unavailable'>('loading')
  // Only the trusted Gallery Parent owns photo identity and Blob URLs.
  const [projected,setProjected] = useState<
    XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection> | null>(null)
  // The previous authenticated photo layer remains visible ONLY as an
  // inert, bounded visual overlay during a same-Owner camera gesture.
  // Fresh /cells and /cell-items are still required for every click.
  type GesturePresentation = {
    owner:string;key:string;summary:MediaBaiduNativeCellsPage
    cells:Array<{label:string;selection:MediaBaiduNativeCellSelection}>
    positions:XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection>
  }
  const [gesturePresentation,setGesturePresentation] = useState<GesturePresentation|null>(null)
  const gesturePresentationRef = useRef<GesturePresentation|null>(null)
  const committedPresentation = useRef<GesturePresentation|null>(null)
  const clearGesturePresentation = () => {
    gesturePresentationRef.current=null
    setGesturePresentation(null)
  }
  // Cosmetic control geometry only. Never send it to the SDK, bind it to
  // media identity, or use it to authorize an Owner resource.
  const [overlayRects,setOverlayRects] =
    useState<readonly XDrivePlacesMapOverlayRect[] | null>(null)
  const [error,setError] = useState(false)
  const [failedCellsScope,setFailedCellsScope] = useState<{owner:string;key:string} | null>(null)
  type DrawerView = {
    selection: MediaBaiduNativeCellSelection
    key: string
    phase: 'loading' | 'ready' | 'error'
    items: MediaItem[]
    total: number
    expanded: boolean
    loadingMore: boolean
    pageError: boolean
    returnPresentation?: XDrivePlacesDrawerPresentation
  }
  const [drawer,setDrawer] = useState<DrawerView | null>(null)
  // A resize return is a short-lived trusted Parent UI intent. It never
  // authorizes media, crosses the isolated Child, or reuses the old Cell
  // selector. Both Hosts can use the same Parent DOM/Owner check.
  const committedDrawer = useRef<DrawerView | null>(null)
  const pendingResizeDrawer = useRef<{
    owner:string; key:string; hint:XDrivePlacesDrawerReturn
  } | null>(null)
  const closeDrawer = () => {
    drawerFetch.current?.abort()
    drawerFetch.current = null
    setDrawer(null)
  }
  const hasAcceptedCell = (selection: MediaBaiduNativeCellSelection): boolean =>
    acceptedCells.current.some(fresh =>
      xDriveBaiduCellReturnMatchesFreshSelection(selection, fresh))
  const selectCell = (selection: MediaBaiduNativeCellSelection,
    presentation?: XDrivePlacesDrawerPresentation) => {
    const approved=acceptedScope.current
    if (!approved || approved.key !== filterRef.current.key ||
        !hasAcceptedCell(selection)) return
    pendingResizeDrawer.current=null
    const preview=previewPort.current
    if (!preview || !loadThumbnail) {
      opened.current(selection, approved.scope)
      return
    }
    const scopeCopy=xDriveCopyBaiduMapPhotoScope(approved.scope)
    if (!scopeCopy) return
    closeDrawer()
    const controller=new AbortController()
    drawerFetch.current=controller
    const cell={...selection,bounds:{...selection.bounds}}
    const key=approved.key
    setDrawer({selection:cell,key,phase:'loading',items:[],
      total:cell.photo_count,expanded:presentation?.expanded ?? true,
      loadingMore:false,pageError:false,returnPresentation:presentation})
    void preview(cell,XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,0,{
      by:scopeCopy.filters.sort_by ?? 'captured',
      dir:scopeCopy.filters.sort_dir ?? 'desc',
      filters:scopeCopy.filters,albumKey:scopeCopy.albumKey,
    },controller.signal).then(range => {
      if (controller.signal.aborted || drawerFetch.current !== controller ||
          acceptedScope.current?.key !== key || !hasAcceptedCell(cell)) return
      const valid=xDrivePlacesDrawerValidRange(cell,range)
      setDrawer(current => current && current.key===key &&
        xDriveBaiduCellReturnMatchesFreshSelection(current.selection,cell)
        ? { ...current,phase:valid?'ready':'error',
            items:valid?[...range.items]:[],
            total:valid?range.total_count:cell.photo_count }
        : current)
    }).catch(() => {
      if (!controller.signal.aborted && drawerFetch.current===controller &&
          acceptedScope.current?.key===key) {
        setDrawer(current => current && current.key===key
          ? { ...current,phase:'error',items:[] } : current)
      }
    }).finally(() => {
      if (drawerFetch.current===controller)drawerFetch.current=null
    })
  }
  selectCellRef.current=selectCell
  const activeDrawer = drawer && phase === 'ready' &&
    acceptedScope.current?.key === drawer.key && hasAcceptedCell(drawer.selection)
    ? drawer : null
  // Never capture a speculative React render as the previous visible sheet.
  useLayoutEffect(() => { committedDrawer.current=activeDrawer },[activeDrawer])
  // A failed first page is not a reason to lose the selected location.
  // Re-read exactly the same currently accepted Owner Cell through the
  // original signed /cell-items port. The source's current revision, scope and
  // ACL are checked anew; no previous page or media bytes are trusted.
  const retryDrawer = () => {
    const state=activeDrawer
    if (!state || state.phase!=='error' ||
        acceptedScope.current?.key!==filterRef.current.key ||
        !hasAcceptedCell(state.selection)) return
    selectCellRef.current(state.selection,state.returnPresentation)
  }
  const openDrawerAll = () => {
    const state=activeDrawer,approved=acceptedScope.current
    if (!state || state.phase!=='ready' || !approved ||
        approved.key!==filterRef.current.key) return
    opened.current(state.selection,approved.scope)
    closeDrawer()
  }
  const loadDrawerMore = () => {
    const state=activeDrawer, approved=acceptedScope.current
    if (!state || state.phase!=='ready' || state.loadingMore ||
        state.items.length>=state.total || drawerFetch.current ||
        !approved || approved.key!==filterRef.current.key ||
        !hasAcceptedCell(state.selection)) return
    const preview=previewPort.current
    const pageScope=xDriveCopyBaiduMapPhotoScope(approved.scope)
    if (!preview || !pageScope) return
    const selection={...state.selection,bounds:{...state.selection.bounds}}
    const key=approved.key
    const offset=state.items.length
    const controller=new AbortController()
    drawerFetch.current=controller
    setDrawer(current => current && current.key===key &&
      xDriveBaiduCellReturnMatchesFreshSelection(current.selection,selection)
      ? {...current,loadingMore:true,pageError:false} : current)
    void preview(selection,XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,offset,{
      by:pageScope.filters.sort_by ?? 'captured',
      dir:pageScope.filters.sort_dir ?? 'desc',
      filters:pageScope.filters,albumKey:pageScope.albumKey,
    },controller.signal).then(range => {
      if (controller.signal.aborted || drawerFetch.current!==controller ||
          acceptedScope.current?.key !== key ||
          filterRef.current.key!==key || !hasAcceptedCell(selection)) return
      setDrawer(current => {
        if (!current || current.key!==key || current.phase!=='ready' ||
            current.items.length!==offset ||
            !xDriveBaiduCellReturnMatchesFreshSelection(current.selection,selection))
          return current
        const merged=xDriveAppendPlacesDrawerPage(selection,current.items,current.total,range)
        return {...current,loadingMore:false,pageError:!merged,
          items:merged ?? current.items}
      })
    }).catch(() => {
      if (controller.signal.aborted || drawerFetch.current!==controller ||
          acceptedScope.current?.key !== key || filterRef.current.key!==key ||
          !hasAcceptedCell(selection)) return
      setDrawer(current => current && current.key===key &&
        xDriveBaiduCellReturnMatchesFreshSelection(current.selection,selection)
        ? {...current,loadingMore:false,pageError:true} : current)
    }).finally(() => {
      if(drawerFetch.current===controller)drawerFetch.current=null
    })
  }
  const openDrawerPhoto = (item: MediaItem,
    presentation: XDrivePlacesDrawerPresentation) => {
    const state=activeDrawer,approved=acceptedScope.current
    if (!state || state.phase!=='ready' || !approved ||
        approved.key!==filterRef.current.key ||
        !state.items.some(source => source.node.id===item.node.id &&
          source.node.revision===item.node.revision)) return
    if (!photoOpener.current) { openDrawerAll();return }
    // The Viewer opens through its own newly authorized Owner Cell Range.
    // Dismiss this Gallery modal now: its focus trap/backdrop must never
    // obscure the foreground Viewer, but the bounded presentation return
    // intent has already been handed to the original Gallery callback.
    photoOpener.current(state.selection,approved.scope,item.node.id,item.node.revision,
      presentation)
    closeDrawer()
  }
  const scopeIsCurrent = acceptedScope.current?.key === currentFilterKey
  const trustedSummary = scopeIsCurrent ? summary : null
  // Commit only a real, current, fully signed Owner camera presentation.
  // The old representative IDs stay in this trusted Parent; the isolated
  // Child sees anonymous pixel positions and one-use map Cell keys only.
  useLayoutEffect(()=>{
    if (scopeIsCurrent && summary && acceptedViewport &&
        projected?.width && projected.height && phase==='ready') {
      committedPresentation.current={
        owner:scope??'',key:currentFilterKey,summary,
        cells:accessible,positions:projected,
      }
      // Fresh current camera pixels replace the inert gesture snapshot.
      if (gesturePresentationRef.current)clearGesturePresentation()
    }
  },[scopeIsCurrent,summary,acceptedViewport,projected,accessible,
    phase,currentFilterKey,scope])
  // An already-open map must notice GPS→BD-09 backfill without a user
  // gesture. Poll only the current authenticated EMPTY /cells snapshot,
  // at most once per 2 minutes while the Parent document is visible.
  // Both SDK Hosts reuse this one Parent. The existing request cancellation
  // and Owner/PhotoScope fences are authoritative; no new map SDK session,
  // original EXIF transfer, or provider geoconv occurs here.
  const recheckEmptyMap = phase === 'ready' && scopeIsCurrent &&
    trustedSummary?.total_count === 0 && !activeDrawer
  useEffect(() => {
    if (!recheckEmptyMap) return
    const timer = setInterval(() => {
      if (mount.current?.ownerDocument.visibilityState === 'hidden') return
      refreshFilteredCells.current?.(true)
    }, 120_000)
    return () => clearInterval(timer)
  }, [recheckEmptyMap, currentFilterKey])
  // Revoke stale SDK pins before the browser can paint a changed Owner
  // Album/favorite/date/type scope. queryCells synchronously cancels the old
  // Camera/Cells and clears the Child markers before awaiting the new Owner
  // Range. Both inline and isolated Hosts use this exact trusted Parent.
  // Reuse the existing map frame instead of remounting its third-party SDK.
  useLayoutEffect(() => {
    if(lastFilterKey.current===currentFilterKey)return
    lastFilterKey.current=currentFilterKey
    pendingResizeDrawer.current=null
    committedPresentation.current=null
    clearGesturePresentation()
    refreshFilteredCells.current?.()
  },[currentFilterKey])

  useEffect(() => {
    const node = mount.current
    const win = node?.ownerDocument.defaultView
    if (!node || !win) return
    const lifetime = new AbortController()
    let generation = 0
    let activeQuery: AbortController | null = null
    let refresh: ReturnType<typeof setInterval> | null = null
    let failed = false
    let lastCanvasSize: {width:number;height:number} | null = null
    const canvasSize = () => {
      const width = Math.round(node.clientWidth)
      const height = Math.round(node.clientHeight)
      return width>=120 && height>=120 && width<=4096 && height<=4096
        ? {width,height} : null
    }
    // Freeze the Owner-local camera return hint for this iframe lifetime.
    let returnCamera = xDriveValidBaiduNativeCameraSnapshot(initialCamera)
      ? { coordinate_space: 'bd09ll' as const,
          latitude: initialCamera.latitude, longitude: initialCamera.longitude,
          zoom: initialCamera.zoom }
      : null
    // The first worldwide /cells request may be empty while Server backfill
    // is still converting the Owner's GPS. Preserve worldwide discovery until
    // the first real derived cell appears, unless a user has changed the SDK
    // camera or this map is restoring an explicit Viewer camera.
    let cameraTouched = Boolean(returnCamera)
    let initialWorldEmpty = false
    setPhase('loading')
    setError(false)
    setSummary(null)
    setAcceptedViewport(null)
    latestAcceptedViewport.current = null
    setAccessible([])
    setProjected(null)
    committedPresentation.current=null
    clearGesturePresentation()
    onReady(false)

    const cancel = (keepGestureVisual = false) => {
      generation++
      // An SDK gesture invalidates the previous camera as well as its Cells.
      // A filter change during pan/zoom must not resurrect that old viewport.
      lastViewport.current = null
      activeQuery?.abort()
      activeQuery = null
      acceptedScope.current = null
      acceptedCells.current = []
      failedCellsScopeRef.current = null
      setFailedCellsScope(null)
      closeDrawer()
      setAccessible([])
      setSummary(null)
      setAcceptedViewport(null)
      latestAcceptedViewport.current = null
      setProjected(null)
      if (!keepGestureVisual) {
        committedPresentation.current=null
        clearGesturePresentation()
      }
      invalidated.current?.()
    }
    const failure = () => {
      if (lifetime.signal.aborted || failed) return
      failed = true
      pendingResizeDrawer.current=null
      cancel()
      lifetime.abort()
      if (refresh !== null) clearInterval(refresh)
      setPhase('unavailable')
      setError(true)
      setSummary(null)
      frame?.dispose()
      cameraClear.current?.()
      onReady(false)
      failureCallback.current?.()
    }
    const commonMapOptions = {
      host:node,parentWindow:win,
      onActivateCell:(selection:MediaBaiduNativeCellSelection) => {
        const approved=acceptedScope.current
        if(!lifetime.signal.aborted && latestAcceptedViewport.current &&
          approved && approved.key===filterRef.current.key &&
          acceptedCells.current.some(cell=>cell.node_id===selection.node_id &&
            cell.asset_id===selection.asset_id && cell.node_revision===selection.node_revision &&
            cell.cell_x===selection.cell_x && cell.cell_y===selection.cell_y &&
            cell.photo_count===selection.photo_count)) {
          selectCellRef.current(selection)
        }
      },
      onCancel:()=>{
        cameraTouched=true
        const nextSize=canvasSize(), before=lastCanvasSize
        const resized=Boolean(before && nextSize &&
          (before.width!==nextSize.width || before.height!==nextSize.height))
        if(resized && nextSize) {
          lastCanvasSize=nextSize
          const state=committedDrawer.current
          const approved=acceptedScope.current
          const photoScope=approved
            ? xDriveCopyBaiduMapPhotoScope(approved.scope) : null
          if(state?.phase==='ready' && photoScope && approved &&
             approved.key===filterRef.current.key &&
             state.key===approved.key && latestAcceptedViewport.current) {
            const list=node.ownerDocument.querySelector<HTMLElement>(
              '[data-xdrive-places-album-dialog] [data-xdrive-places-photo-drawer-items]')
            const bounded=(value:number)=>Number.isFinite(value)
              ? Math.max(0,Math.min(10_000,Math.floor(value))) : 0
            pendingResizeDrawer.current={owner:scope??'',key:approved.key,
              hint:{selection:{...state.selection,
                bounds:{...state.selection.bounds}},photoScope,
                presentation:{expanded:state.expanded,
                  scrollTop:bounded(list?.scrollTop??0),
                  scrollLeft:bounded(list?.scrollLeft??0),
                  // Keep the already-viewed signed page depth on rotation.
                  // The new camera must still reauthorize every page, capped
                  // at the same 10-page limit as Viewer Back.
                  loadedCount:Math.min(XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,
                    state.items.length)}}}
          }
          // When several CSS resize frames precede one /cells response,
          // preserve only the first valid intent. Native Hosts coalesce the
          // repeated resize notifications; a gesture of unchanged size below
          // still revokes this visual intent.
        } else pendingResizeDrawer.current=null
        const previous=committedPresentation.current
        const keepVisual=!resized && previous &&
          previous.owner===(scope??'') && previous.key===filterRef.current.key
        if (keepVisual) {
          gesturePresentationRef.current=previous
          setGesturePresentation(previous)
        }
        // Revoke ALL previous Cell click authority synchronously. Only
        // non-interactive photo pixels remain, correctly repositioned by
        // the two SDK Hosts' bounded gesture-only projections.
        cancel(Boolean(keepVisual))
      },
      onCamera:(camera:XDriveBaiduNativeCameraSnapshot) => { if(!lifetime.signal.aborted) cameraUpdate.current?.(camera) },
      onMapReady:() => {
        if(lifetime.signal.aborted)return
        if (returnCamera) {
          const camera = returnCamera
          returnCamera = null
          if (!frame?.restoreCamera(camera)) { failure(); return }
        }
        setPhase('ready')
        onReady(true)
      },
      onMapFailure:failure,
      onProjectedCells:(positions:XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection>) => {
        if (!lifetime.signal.aborted) setProjected(positions)
      },
      onGestureProjectedCells:(positions:XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection>)=>{
        const prior=gesturePresentationRef.current
        if (lifetime.signal.aborted || !prior || prior.owner!==(scope??'') ||
            prior.key!==filterRef.current.key || !positions.width ||
            !positions.height || positions.cells.length>64) return
        const moved={...prior,positions}
        gesturePresentationRef.current=moved
        setGesturePresentation(moved)
      },
      onViewport: (bounds:Bounds) => { void queryCells(bounds, true) },
      onReady:() => {
        const world: Bounds = {coordinate_space:'bd09ll',west:-180,south:-85,east:180,north:85}
        // An initial viewport request must not race away the worldwide
        // anonymous Owner-scoped derived-position summary before the SDK can fit to it.
        void queryCells(world).then(ok => {
          if (lifetime.signal.aborted || failed) return
          if (!ok) { failure(); return }
          void acquireTicket()
        })
      },
    }
    // Business/Owner Cells/Wall/Viewer stay in this SAME trusted React Parent.
    // Only the map SDK host changes: same document or independent HTTPS Child.
    const frame = mode === 'inline'
      ? (getInlinePrototypeConfig && getInlineSignedStatus
        ? xDriveMountBaiduInlineMap<MediaBaiduNativeCellSelection>({
          ...commonMapOptions,
          getPrototypeConfig:getInlinePrototypeConfig,
          getSignedStatus:getInlineSignedStatus,
        })
        : null)
      : xDriveMountBaiduIsolatedFrame<MediaBaiduNativeCellSelection>({
        ...commonMapOptions,childOrigin,
      })
    if (!frame) { failure(); return }
    mapFrameRef.current = frame

    const queryCells = async (bounds: Bounds, liveCamera = false): Promise<boolean> => {
      if (lifetime.signal.aborted) return false
      // Cancel the previous query and invalidate its Camera before recording
      // the newly requested bounds for possible same-camera filter refresh.
      const keepVisual=gesturePresentationRef.current?.owner===(scope??'') &&
        gesturePresentationRef.current?.key===filterRef.current.key
      cancel(Boolean(keepVisual))
      lastViewport.current={bounds:{...bounds},live:liveCamera}
      frame.replaceAuthorizedCells([])
      const approved=filterRef.current
      // Preserve the current Owner-approved scope for the async callback.
      const verifiedScope=approved.snapshot
      if(!verifiedScope)return false
      const request = new AbortController()
      const onLifetime = () => request.abort()
      lifetime.signal.addEventListener('abort',onLifetime,{once:true})
      activeQuery=request
      const run = generation
      try {
        const page = await listOwnerCells(bounds,request.signal,
          verifiedScope.filters,verifiedScope.albumKey)
        if(request.signal.aborted || lifetime.signal.aborted || run!==generation ||
           approved.key!==filterRef.current.key)return false
        if(!xDriveValidBaiduNativeCellsPage(page,bounds) ||
            page.cells.some(cell => !Number.isSafeInteger(cell.node_revision) || (cell.node_revision ?? 0)<=0)) {
          throw new Error('map_cells_invalid')
        }
        const cells: Array<{latitude:number;longitude:number;count:number;selection:MediaBaiduNativeCellSelection}> = []
        for(const cell of page.cells) {
          const selection=xDriveSelectBaiduNativeCell(page,bounds,cell)
          if(!selection)throw new Error('map_cell_revoked')
          cells.push({latitude:cell.latitude,longitude:cell.longitude,
            count:cell.photo_count,selection})
        }
        if(!frame.replaceAuthorizedCells(cells)) throw new Error('map_cells_unavailable')
        if(approved.key!==filterRef.current.key || run!==generation)return false
        acceptedScope.current={key:approved.key,scope:verifiedScope}
        acceptedCells.current=cells.map(item=>item.selection)
        lastCanvasSize=canvasSize()
        // The old camera Cell cannot survive rotation. Only a new signed
        // Owner /cells with SAME representative asset+node+revision and
        // unchanged PhotoScope may restore the sheet, and even then it uses
        // the fresh Cell for an independent Owner /cell-items read.
        if (liveCamera && pendingResizeDrawer.current) {
          const intent=pendingResizeDrawer.current
          pendingResizeDrawer.current=null // one-shot, fail closed
          if(intent.owner===(scope??'') && intent.key===approved.key) {
            const matched=cells.find(item=>
              xDrivePlacesDrawerMatchesResizedCell(
                intent.hint,verifiedScope,item.selection))
            if(matched) selectCellRef.current(
              matched.selection,intent.hint.presentation)
          }
        }
        // A one-shot Viewer hint never grants media access. Restore only if
        // THIS freshly authenticated Owner /cells response contains precisely
        // the same scope, bounds, Cell identity, revision and photo count.
        // The initial worldwide query can also be the original selected
        // Cell; requiring a later SDK viewport here loses that valid return.
        // Conversely, retain a nonmatching hint until the first true camera
        // Range can check it. That Range must fail closed when different.
        if (restoreHint.current) {
          const hint=restoreHint.current
          const current=cells.find(entry =>
            xDrivePlacesDrawerMatchesFresh(hint,verifiedScope,entry.selection))
          if (current) {
            restoreHint.current=null
            selectCellRef.current(current.selection, hint.presentation)
          } else if (liveCamera) {
            restoreHint.current=null
          }
        }
        setAccessible(cells.map((item,index)=>({
          label:'区域 '+(page.cells[index].cell_y*8+page.cells[index].cell_x+1)+
            ' · '+page.cells[index].photo_count.toLocaleString('zh-CN'),
          selection:item.selection,
        })))
        // The initial worldwide empty result is distinct from an empty
        // camera viewport. Its later automatic recheck must query the bounded
        // worldwide Owner Cells, not keep polling the SDK's arbitrary default
        // center which might be thousands of km from the photo locations.
        const refocus = !liveCamera && initialWorldEmpty && !cameraTouched &&
          page.total_count > 0 && cells.length > 0
        if (!liveCamera) initialWorldEmpty = page.total_count === 0 && !cameraTouched
        setSummary(page)
        // Only a live, Owner-verified SDK viewport can open the full photo
        // wall. The bootstrapping worldwide /cells query is not a camera.
        const accepted = liveCamera ? { ...bounds } : null
        latestAcceptedViewport.current = accepted
        setAcceptedViewport(accepted)
        if (refocus) {
          const representative = cells[0]
          // Defer camera movement until the Parent has accepted this exact
          // Owner response. The SDK move cancels it and requests a fresh
          // live-camera Range; it never carries unsigned media permission.
          queueMicrotask(() => {
            if (lifetime.signal.aborted || failed || cameraTouched ||
                run !== generation || approved.key!==filterRef.current.key ||
                acceptedScope.current?.key!==approved.key) return
            frame.restoreCamera({coordinate_space:'bd09ll',
              latitude:representative.latitude,longitude:representative.longitude,
              zoom:8})
          })
        }
        return true
      } catch {
        if (run===generation) pendingResizeDrawer.current=null
        if(!request.signal.aborted && !lifetime.signal.aborted && run===generation &&
            approved.key===filterRef.current.key) {
          // A failed/invalid Owner Cells response has NO media authority.
          // Preserve only the scope identity for an explicit guarded retry.
          const failureScope = {owner:scope ?? '',key:approved.key}
          failedCellsScopeRef.current = failureScope
          setFailedCellsScope(failureScope)
          frame.replaceAuthorizedCells([])
          setSummary(null)
          latestAcceptedViewport.current = null
          setAcceptedViewport(null)
          setAccessible([])
          clearGesturePresentation()
        }
        return false
      } finally {
        lifetime.signal.removeEventListener('abort',onLifetime)
        if(activeQuery===request)activeQuery=null
      }
    }
    refreshFilteredCells.current=(skipPending=false)=>{
      if(lifetime.signal.aborted || failed || !lastViewport.current ||
         (skipPending && (activeQuery ||
           (acceptedScope.current?.key!==filterRef.current.key &&
             (failedCellsScopeRef.current?.owner!==(scope ?? '') ||
               failedCellsScopeRef.current?.key!==filterRef.current.key)))))return
      const last=lastViewport.current
      const worldwideDiscovery = skipPending && initialWorldEmpty && !cameraTouched
      const bounds = worldwideDiscovery
        ? {...last.bounds,west:-180,south:-85,east:180,north:85}
        : {...last.bounds}
      void queryCells(bounds,worldwideDiscovery ? false : last.live)
    }
    const acquireTicket=async() => {
      if(lifetime.signal.aborted || failed) return
      try {
        if(mode==='inline') {
          if(!frame || !('beginAuthorizedInlineSession' in frame) ||
              !await frame.beginAuthorizedInlineSession(lifetime.signal))
            throw new Error('map_session_denied')
          return
        }
        if(!mintChildTicket || !frame || !('bootstrapMapSession' in frame))
          throw new Error('map_session_denied')
        const receipt=await mintChildTicket(lifetime.signal)
        if(lifetime.signal.aborted || receipt?.provider!=='baidu-jsapi-4.0' ||
            receipt.child_origin!==childOrigin || !/^[a-f0-9]{64}$/.test(receipt.ticket) ||
            !frame.bootstrapMapSession(receipt.ticket)) throw new Error('map_session_denied')
      } catch { failure() }
    }
    // Restore only the validated BD-09 camera after Child map-ready.
    // Original WGS84 photo EXIF never enters the isolated document.
    refresh=setInterval(() => { if(!lifetime.signal.aborted)void acquireTicket() },65_000)
    return () => {
      refreshFilteredCells.current=null
      pendingResizeDrawer.current=null
      cancel()
      lifetime.abort()
      if(refresh!==null)clearInterval(refresh)
      if (mapFrameRef.current === frame) mapFrameRef.current = null
      frame.dispose()
      onReady(false)
    }
  },[childOrigin,mintChildTicket,getInlinePrototypeConfig,getInlineSignedStatus,mode,listOwnerCells,onReady,scope])


  // Both SDK Hosts share this trusted Parent's real map chrome. Fixed
  // bottom offsets cannot account for wrapped labels, landscape safe area,
  // large fonts or the retry alert. This measurement changes only marker
  // presentation, not the camera, signed Owner /cells or SDK session.
  useLayoutEffect(() => {
    const canvas=mount.current
    const win=canvas?.ownerDocument.defaultView
    if (!canvas || !win) return
    const toolbar=canvas.closest('[data-xdrive-gallery-places-map]')
      ?.querySelector<HTMLElement>('[data-xdrive-places-map-toolbar]') ?? null
    const controls: Element[]=[
      ...(toolbar ? [toolbar] : []),
      ...(summaryElement.current ? Array.from(summaryElement.current.children) : []),
      ...(errorElement.current ? [errorElement.current] : []),
    ]
    const measure=()=>{
      const mapRect=canvas.getBoundingClientRect()
      const width=Math.round(mapRect.width),height=Math.round(mapRect.height)
      if (![width,height].every(Number.isSafeInteger) ||
          width < 120 || height < 120 || width > 4096 || height > 4096) {
        setOverlayRects(old=>old===null ? old : null)
        return
      }
      const rects: XDrivePlacesMapOverlayRect[]=[]
      for (const element of controls) {
        if (element.getClientRects().length===0) continue
        const box=element.getBoundingClientRect()
        if (![box.left,box.right,box.top,box.bottom].every(Number.isFinite)) continue
        const left=Math.max(0,Math.floor(box.left-mapRect.left))
        const top=Math.max(0,Math.floor(box.top-mapRect.top))
        const right=Math.min(width,Math.ceil(box.right-mapRect.left))
        const bottom=Math.min(height,Math.ceil(box.bottom-mapRect.top))
        if (right>left && bottom>top)rects.push({left,top,right,bottom})
      }
      // Reuse the previous array if browser geometry has not changed;
      // avoid marker re-renders and extra Host label updates on a no-op.
      setOverlayRects(old=>old && old.length===rects.length &&
        old.every((rect,i)=>rect.left===rects[i].left &&
          rect.top===rects[i].top && rect.right===rects[i].right &&
          rect.bottom===rects[i].bottom) ? old : rects)
    }
    const observer=typeof win.ResizeObserver==='function'
      ? new win.ResizeObserver(measure) : null
    for (const element of [canvas,summaryElement.current,...controls]) {
      if (element)observer?.observe(element)
    }
    win.addEventListener('resize',measure)
    measure()
    return ()=>{
      win.removeEventListener('resize',measure)
      observer?.disconnect()
    }
  },[trustedSummary,activeDrawer,failedCellsScope,phase,edgeToEdge])

  // Both Inline and isolated HTTPS Child share the exact same verified
  // Owner projections and photo-first collision/edge/overlay rules. Do not
  // show a clipped or map-controls-covered button just because an SDK point
  // remains visible at the map border. All Cells remain in the accessible list.
  const coverPins = scopeIsCurrent && acceptedViewport &&
      projected?.width && projected.height && loadThumbnail && phase === 'ready'
    ? xDriveSelectVisibleMapPhotoCovers(
        xDriveVerifiedMapPhotoProjections(
          trustedSummary, projected, accessible.map(cell => cell.selection))
          .filter(candidate => hasAcceptedCell(candidate.selection)),
        projected.width, projected.height, edgeToEdge, overlayRects)
    : []
  // Collision/edge/toolbar decluttering can hide an otherwise current, signed
  // Owner Cell's photo cover. The Cell itself is still accessible and must
  // never be confused with missing media or a revoked Owner permission.
  // This disclosure belongs to the ONE React Parent shared by both SDK Hosts.
  const unpaintedCellCount = scopeIsCurrent && trustedSummary && acceptedViewport &&
      phase === 'ready'
    ? Math.max(0, accessible.length - coverPins.length) : 0
  // During a move, the last signed layer is projected by the SDK as a
  // VISUAL-ONLY overlay. It cannot open a Cell and is discarded on new
  // Owner evidence, filter/Owner revision or any map failure. Never treat
  // a previous camera receipt as a newly authorized Camera Range.
  const gesturePins=gesturePresentation &&
      gesturePresentation.owner===(scope??'') &&
      gesturePresentation.key===currentFilterKey &&
      gesturePresentation.positions.width>0 && gesturePresentation.positions.height>0
    ? xDriveSelectVisibleMapPhotoCovers(
        xDriveVerifiedMapPhotoProjections(gesturePresentation.summary,
          gesturePresentation.positions,
          gesturePresentation.cells.map(cell=>cell.selection)),
        gesturePresentation.positions.width,gesturePresentation.positions.height,
        edgeToEdge,overlayRects)
    : []
  const currentCoverActive=coverPins.length>0
  const paintedCovers=currentCoverActive ? coverPins : gesturePins
  const paintedProjection=currentCoverActive ? projected : gesturePresentation?.positions
  const coverSummary=currentCoverActive ? trustedSummary : gesturePresentation?.summary
  // Two SDK Hosts receive only the current visible React cover selections.
  // While at least one verified Parent photo cover is visible, it owns the
  // complete marker presentation: no competing native numeric Labels appear.
  // If no photo cover fits the camera, existing native Labels are the fallback.
  // Every signed Cell stays accessible through the separate full Cell list and
  // original Owner Range; unshown cells are never silently excluded from Count.
  useLayoutEffect(() => {
    mapFrameRef.current?.setPhotoCoverSelections?.(
      coverPins.map(pin => pin.selection))
  },[projected,accessible,acceptedViewport,currentFilterKey,phase,
    summary,edgeToEdge,loadThumbnail,overlayRects])
  // Only the authenticated Owner Cells DTO supplies representative media kind.
  // Both SDK Hosts still get anonymous map geometry, count and ephemeral key;
  // private media bytes, URLs and kind remain in this trusted React Parent.
  const ownerCover=(selection:MediaBaiduNativeCellSelection,
    alt:string,fallback:ReactNode):ReactNode=>{
    if(!loadThumbnail)return fallback
    const representative=coverSummary?.cells.find(cell=>
      cell.cell_x===selection.cell_x && cell.cell_y===selection.cell_y &&
      cell.asset_id===selection.asset_id && cell.node_id===selection.node_id &&
      cell.node_revision===selection.node_revision &&
      cell.photo_count===selection.photo_count)
    if(representative?.media_kind==='video' && loadPreviewURL){
      // Reuse the Gallery's existing bounded poster queue, server cache,
      // cold video capture and revision-fenced cache writer. Viewer suspend
      // already cancels background poster work via the same shared context.
      return <XDriveMediaAsyncVideoPoster
        nodeID={selection.node_id} revision={selection.node_revision}
        alt={alt} loadThumbnail={loadThumbnail} loadPreviewURL={loadPreviewURL}
        saveVideoPoster={saveVideoPoster} fallback={fallback}/>
    }
    return <XDriveMediaGalleryCoverThumbnail
      nodeID={selection.node_id} revision={selection.node_revision}
      alt={alt} loadThumbnail={loadThumbnail} fallback={fallback}/>
  }
  const openVerifiedCell=(selection:MediaBaiduNativeCellSelection)=>{
    selectCellRef.current(selection)
  }
  // Reuse the same signed Owner camera wall as the existing map action.
  // Never derive an unsigned radius or fall back to a generic Gallery query.
  const openVerifiedCameraNearby = () => {
    const accepted=latestAcceptedViewport.current
    const approved=acceptedScope.current
    if (!accepted || !acceptedViewport || phase!=='ready' ||
        !scopeIsCurrent || !approved ||
        approved.key!==filterRef.current.key || !openViewport.current ||
        accepted.west!==acceptedViewport.west ||
        accepted.east!==acceptedViewport.east ||
        accepted.south!==acceptedViewport.south ||
        accepted.north!==acceptedViewport.north) return
    openViewport.current({...accepted},approved.scope)
  }
  return (
    <Box component="section" data-xdrive-baidu-isolated-photo-map
      sx={{px:edgeToEdge ? 0 : {xs:1.25,sm:1.5},pb:edgeToEdge ? 0 : 1.5,minWidth:0}}>
      <Box data-xdrive-places-cluster-overview role="region" aria-label="定位照片聚集地图"
        data-xdrive-places-ios-map-canvas={edgeToEdge ? '1' : undefined}
        sx={{position:'relative',width:'100%',height:edgeToEdge
          ? 'max(460px, calc(100dvh - 124px))'
          : {xs:'max(520px, calc(100dvh - 148px))',
             sm:'max(640px, calc(100dvh - 165px))'},
          // The 52px app header and the compact Gallery map/list switch
          // remain outside the canvas; the map's own header now overlays it.
          // Do not impose a desktop floor in short iPhone landscape.
          '@media (orientation: landscape) and (max-height: 600px)':{
            height:edgeToEdge
              ? 'max(192px, calc(100dvh - 124px))'
              : 'max(200px, calc(100dvh - 165px))',
          },
          maxHeight:1400,borderRadius:edgeToEdge ? 0 : 1.5,
          overflow:'hidden',backgroundColor:'background.default'}}>
        <Box ref={mount} sx={{position:'absolute',inset:0,
          '& iframe':{width:'100%',height:'100%',display:'block',border:0}}}/>
        {paintedCovers.length > 0 && paintedProjection ? (
          <Box data-xdrive-places-trusted-photo-cover-pins
            sx={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2}}>
            {paintedCovers.map((pin) => (
              <Box key={pin.selection.node_id} component="button" type="button"
                disabled={!currentCoverActive}
                // Stale gesture covers are visual-only, with no screen-reader
                // announcement, focus stop or stale Owner Cell activation.
                aria-hidden={!currentCoverActive}
                tabIndex={currentCoverActive ? 0 : -1}
                data-xdrive-places-trusted-photo-cover={currentCoverActive
                  ? pin.selection.node_id : undefined}
                data-xdrive-places-gesture-photo-cover={!currentCoverActive
                  ? pin.selection.node_id : undefined}
                aria-label={currentCoverActive
                  ? `查看该区域 ${pin.count} 张照片` : undefined}
                onClick={currentCoverActive
                  ? () => openVerifiedCell(pin.selection) : undefined}
                sx={{position:'absolute',
                  left:`${pin.x/paintedProjection.width*100}%`,
                  top:`${pin.y/paintedProjection.height*100}%`,
                  transform:'translate(-50%,-50%)',width:{xs:64,sm:72},height:{xs:64,sm:72},p:0,
                  border:'3px solid white',borderRadius:2,overflow:'visible',
                  cursor:currentCoverActive?'pointer':'default',
                  pointerEvents:currentCoverActive?'auto':'none',
                  '&:disabled':{opacity:1},
                  bgcolor:'background.paper',boxShadow:'0 3px 12px rgba(15,23,42,.28)',
                  isolation:'isolate',
                  '&:focus-visible':{outline:'3px solid',outlineColor:'primary.main',
                    outlineOffset:3}}}>

                <Box sx={{width:'100%',height:'100%',borderRadius:1,overflow:'hidden',
                  bgcolor:'action.hover'}}>
                  {loadThumbnail ? ownerCover(pin.selection,'地图聚集点代表照片',
                    <Box sx={{width:'100%',height:'100%',display:'grid',
                      placeItems:'center',color:'text.secondary'}}>
                      <PhotoLibraryOutlinedIcon fontSize="small"/>
                    </Box>) : null}
                </Box>
                {pin.count > 1 ? (
                  <Box component="span" data-xdrive-places-photo-count-badge
                    aria-hidden="true"
                    sx={{position:'absolute',top:-8,right:-8,minWidth:24,
                      height:24,maxWidth:100,px:0.75,display:'grid',placeItems:'center',
                      border:'2px solid white',borderRadius:'999px',
                      bgcolor:theme => theme.palette.mode === 'dark' ? '#0A84FF' : '#007AFF',
                      color:'#fff',
                      boxShadow:'0 2px 6px rgba(15,23,42,.25)',
                      fontSize:11,fontWeight:700,lineHeight:1,
                      whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {pin.count.toLocaleString('zh-CN')}
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
        ) : null}
      {!activeDrawer && trustedSummary ? (
        <Box ref={summaryElement} data-xdrive-places-map-photo-summary
          sx={{position:'absolute',
            left:{xs:'max(10px, env(safe-area-inset-left))',sm:16},
            right:{xs:'max(10px, env(safe-area-inset-right))',sm:16},
            bottom:{xs:'max(12px, env(safe-area-inset-bottom))',sm:16},
            zIndex:5,display:'flex',alignItems:'center',justifyContent:'space-between',
            gap:1,flexWrap:'wrap',pointerEvents:'none'}}>
          <Typography variant="caption" color="text.primary"
            role="status" aria-live="polite" aria-atomic="true"
            sx={{bgcolor:edgeToEdge
                ? (theme => theme.palette.mode==='dark'
                  ? 'rgba(28,28,30,.86)' : 'rgba(255,255,255,.86)')
                : 'background.paper',
              px:1.25,py:0.75,borderRadius:edgeToEdge ? '999px' : 2,
              boxShadow:2,
              backdropFilter:edgeToEdge ? 'blur(18px)' : undefined,
              WebkitBackdropFilter:edgeToEdge ? 'blur(18px)' : undefined}}>
            {trustedSummary.total_count > 0
              ? `当前地图可查看 ${trustedSummary.total_count.toLocaleString('zh-CN')} 张照片`
              : hasMembershipFilters
                ? '当前筛选条件下暂无定位照片；可调整筛选或手动刷新。'
                : '当前地图暂无可显示的定位照片；位置派生完成后会自动重查，也可手动刷新。'}
          </Typography>
          {phase === 'ready' && trustedSummary.total_count === 0 &&
              acceptedScope.current?.key === currentFilterKey ? (
            <Button size="small" variant="outlined"
              data-xdrive-places-empty-map-recheck
              sx={{minHeight:44,textTransform:'none',pointerEvents:'auto',
                bgcolor:'background.paper',boxShadow:2}}
              onClick={() => refreshFilteredCells.current?.(true)}>
              刷新定位照片
            </Button>
          ) : null}
          {unpaintedCellCount > 0 ? (
            <Button size="small" variant="outlined"
              data-xdrive-places-reveal-hidden-cells
              sx={{minHeight:44,textTransform:'none',pointerEvents:'auto',
                bgcolor:'background.paper',boxShadow:2}}
              onClick={() => {
                // Only reveal existing Owner-signed Cell actions. This is a
                // Parent-only UI navigation, not a new SDK or Owner read.
                const list=clusterListRef.current
                if (!list) return
                list.open=true
                list.scrollIntoView({block:'nearest'})
                list.querySelector<HTMLElement>('summary')?.focus({preventScroll:true})
              }}>
              查看其他 {unpaintedCellCount} 个地点
            </Button>
          ) : null}
          {acceptedViewport && phase === 'ready' && openViewport.current && trustedSummary.total_count > 0 ? (
            <Button size="small" variant="outlined"
              data-xdrive-places-full-camera-wall
              sx={{minHeight:44,textTransform:'none',pointerEvents:'auto',
                bgcolor:'background.paper',boxShadow:2}}
              onClick={openVerifiedCameraNearby}>
              查看此地图的全部照片
            </Button>
          ) : null}
        </Box>
      ):null}
        {phase === 'ready' && failedCellsScope?.owner === (scope ?? '') &&
            failedCellsScope.key === currentFilterKey &&
            !activeDrawer ? (
          <Box ref={errorElement} role="alert" data-xdrive-places-cells-query-error
            sx={{position:'absolute',left:{xs:'max(10px, env(safe-area-inset-left))',sm:16},
              right:{xs:'max(10px, env(safe-area-inset-right))',sm:16},
              bottom:{xs:'max(12px, env(safe-area-inset-bottom))',sm:16},
              zIndex:6,display:'flex',alignItems:'center',gap:1,flexWrap:'wrap',
              p:1,bgcolor:'background.paper',borderRadius:2,boxShadow:3}}>
            <Typography variant="caption" color="text.secondary">
              定位照片范围读取或校验失败，未显示未经确认的照片。
            </Typography>
            <Button size="small" variant="outlined"
              data-xdrive-places-cells-query-retry
              sx={{minHeight:44,textTransform:'none'}}
              onClick={() => refreshFilteredCells.current?.(true)}>
              重试定位照片
            </Button>
          </Box>
        ) : null}
        {activeDrawer && loadThumbnail ? (
          <XDriveMediaGalleryPlacesPhotoDrawer
            items={activeDrawer.items} total={activeDrawer.total}
            phase={activeDrawer.phase} expanded={activeDrawer.expanded}
            loadingMore={activeDrawer.loadingMore} pageError={activeDrawer.pageError}
            initialPresentation={activeDrawer.returnPresentation}
            loadThumbnail={loadThumbnail}
            onClose={() => { pendingResizeDrawer.current=null;closeDrawer() }}
            onExpand={expanded => setDrawer(current => current
              ? {...current,expanded} : current)}
            onRetry={retryDrawer}
            onRefreshMap={() => { closeDrawer();refreshFilteredCells.current?.() }}
            onOpenAll={openDrawerAll} onOpenPhoto={openDrawerPhoto}
            onLoadMore={loadDrawerMore}
            onOpenNearby={acceptedViewport && activeDrawer.phase==='ready' &&
              openViewport.current && trustedSummary && trustedSummary.total_count>0
              ? openVerifiedCameraNearby : undefined}
          />
        ) : null}
      </Box>
      {phase==='unavailable' ? (
        <Typography role="alert" variant="caption" color="text.secondary">
          {mode === 'inline'
            ? '同页地图 SDK 不可用；地点列表与照片墙仍可使用。'
            : '动态地图隔离会话不可用；地点列表与照片墙仍可使用。'}
        </Typography>
      ):null}
      {scopeIsCurrent && accessible.length>0 ? (
        <Box component="details" data-xdrive-places-cluster-list ref={clusterListRef}>
          <Box component="summary" sx={{cursor:'pointer',typography:'caption',
            color:'text.secondary',minHeight:44,display:'flex',alignItems:'center',
            flexWrap:'wrap',gap:0.5,
            '&:focus-visible':{outline:'2px solid',outlineColor:'primary.main'}}}>
            聚集点列表（{accessible.length}）
            {unpaintedCellCount > 0 ? (
              <Box component="span" data-xdrive-places-unpainted-cell-count
                sx={{fontWeight:500}}>
                · {unpaintedCellCount} 个聚集点未显示照片封面，可从这里查看
              </Box>
            ) : null}
          </Box>
        <Box component="nav" aria-label="当前地图聚合区域"
          sx={{display:'flex',flexWrap:'wrap',gap:0.5,mt:0.5}}>
          {accessible.map((cell,index)=>(
            <Button key={index} size="small" variant="text"
              aria-label={`查看${cell.label} 张照片`} sx={{minHeight:44}}
              onClick={()=>openVerifiedCell(cell.selection)} disabled={phase!=='ready'}>
              {cell.label}
            </Button>
          ))}
        </Box>
        </Box>
      ):null}
      {error ? <Typography role="alert" variant="caption" color="text.secondary">动态地图加载失败，请查看地图诊断并重试。</Typography> : null}
    </Box>
  )

}
