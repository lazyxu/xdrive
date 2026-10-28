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
  XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT, xDrivePlacesDrawerValidRange,
  xDrivePlacesDrawerMatchesFresh, xDriveTakePlacesDrawerViewerReturn,
} from '../media-gallery-places-photo-drawer'
import type {
  XDrivePlacesDrawerReturn, XDrivePlacesDrawerPresentation,
} from '../media-gallery-places-photo-drawer'
import { XDriveMediaGalleryPlacesPhotoDrawer } from './MediaGalleryPlacesPhotoDrawer'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import {
  xDriveCurrentMapPhotoCollections, xDriveVerifiedMapPhotoProjections,
} from '../media-gallery-places-map-strip'
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
  const [error,setError] = useState(false)
  const [failedCellsScope,setFailedCellsScope] = useState<{owner:string;key:string} | null>(null)
  type DrawerView = {
    selection: MediaBaiduNativeCellSelection
    key: string
    phase: 'loading' | 'ready' | 'error'
    items: MediaItem[]
    total: number
    expanded: boolean
    returnPresentation?: XDrivePlacesDrawerPresentation
  }
  const [drawer,setDrawer] = useState<DrawerView | null>(null)
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
      total:cell.photo_count,expanded:presentation?.expanded ?? false,
      returnPresentation:presentation})
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
  const openDrawerAll = () => {
    const state=activeDrawer,approved=acceptedScope.current
    if (!state || state.phase!=='ready' || !approved ||
        approved.key!==filterRef.current.key) return
    opened.current(state.selection,approved.scope)
    closeDrawer()
  }
  const openDrawerPhoto = (item: MediaItem,
    presentation: XDrivePlacesDrawerPresentation) => {
    const state=activeDrawer,approved=acceptedScope.current
    if (!state || state.phase!=='ready' || !approved ||
        approved.key!==filterRef.current.key ||
        !state.items.some(source => source.node.id===item.node.id &&
          source.node.revision===item.node.revision)) return
    if (!photoOpener.current) { openDrawerAll();return }
    photoOpener.current(state.selection,approved.scope,item.node.id,item.node.revision,
      presentation)
  }
  const scopeIsCurrent = acceptedScope.current?.key === currentFilterKey
  const trustedSummary = scopeIsCurrent ? summary : null
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
    onReady(false)

    const cancel = () => {
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
      invalidated.current?.()
    }
    const failure = () => {
      if (lifetime.signal.aborted || failed) return
      failed = true
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
      onCancel:()=>{ cameraTouched=true; cancel() },
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

    const queryCells = async (bounds: Bounds, liveCamera = false): Promise<boolean> => {
      if (lifetime.signal.aborted) return false
      // Cancel the previous query and invalidate its Camera before recording
      // the newly requested bounds for possible same-camera filter refresh.
      cancel()
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
      cancel()
      lifetime.abort()
      if(refresh!==null)clearInterval(refresh)
      frame.dispose()
      onReady(false)
    }
  },[childOrigin,mintChildTicket,getInlinePrototypeConfig,getInlineSignedStatus,mode,listOwnerCells,onReady,scope])

  // Select the most informative visible covers and avoid overcrowding.
  // All 64 map numbers remain in the provider map; only 24 thumbnails load.
  const coverPins: Array<{selection:MediaBaiduNativeCellSelection;
    count:number;x:number;y:number}> = []
  // The worldwide Owner /cells bootstraps SDK fit only: photo cover clicks
  // must await a true camera viewport, which can regrid the 8x8 Cells.
  if (scopeIsCurrent && acceptedViewport && projected?.width && projected.height &&
      loadThumbnail && phase === 'ready') {
    // Revalidate untrusted SDK projections against the current signed Owner cells.
    const verifiedCoverCandidates = xDriveVerifiedMapPhotoProjections(
      trustedSummary, projected, accessible.map(cell => cell.selection))
    for (const candidate of verifiedCoverCandidates) {
      if (coverPins.length >= 24) break
      // Projected SDK coordinates never authorize obsolete Owner selections.
      if (!hasAcceptedCell(candidate.selection)) continue
      if (coverPins.some(pin => Math.hypot(pin.x-candidate.x,pin.y-candidate.y) < 88)) continue
      coverPins.push(candidate)
    }
  }
  // Only use a CURRENT Parent-owned /cells snapshot, never a Child-generated
  // key as private media authority. A pan/revoke clears both inputs.
  const photoStrip = scopeIsCurrent && acceptedViewport && phase === 'ready'
    ? xDriveCurrentMapPhotoCollections(trustedSummary, projected, accessible.map(cell => cell.selection)) : []
  // Only the authenticated Owner Cells DTO supplies representative media kind.
  // Both SDK Hosts still get anonymous map geometry, count and ephemeral key;
  // private media bytes, URLs and kind remain in this trusted React Parent.
  const ownerCover=(selection:MediaBaiduNativeCellSelection,
    alt:string,fallback:ReactNode):ReactNode=>{
    if(!loadThumbnail)return fallback
    const representative=trustedSummary?.cells.find(cell=>
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
        {coverPins.length > 0 && projected ? (
          <Box data-xdrive-places-trusted-photo-cover-pins
            sx={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2}}>
            {coverPins.map((pin) => (
              <Box key={pin.selection.node_id} component="button" type="button"
                data-xdrive-places-trusted-photo-cover={pin.selection.node_id}
                aria-label={`查看该区域 ${pin.count} 张照片`}
                onClick={() => openVerifiedCell(pin.selection)}
                sx={{position:'absolute',
                  left:`${pin.x/projected.width*100}%`,
                  top:`${pin.y/projected.height*100}%`,
                  transform:'translate(-50%,-50%)',width:{xs:64,sm:72},height:{xs:64,sm:72},p:0,
                  border:'3px solid white',borderRadius:2,overflow:'visible',
                  cursor:'pointer',pointerEvents:'auto',
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
        {!activeDrawer && loadThumbnail && photoStrip.length > 0 ? (
          <Box data-xdrive-places-photo-collection-strip
            aria-label="地图照片区域封面"
            sx={{position:'absolute',
              left:{xs:'max(8px, env(safe-area-inset-left))',sm:16},
              right:{xs:'max(8px, env(safe-area-inset-right))',sm:16},
              bottom:{xs:'max(10px, env(safe-area-inset-bottom))',sm:16},
              zIndex:5,pointerEvents:'none'}}>
            <Box data-xdrive-places-map-photo-strip-shell
              sx={{pointerEvents:'auto',p:edgeToEdge ? 0.4 : 0.8,
              px:edgeToEdge ? 0.6 : 1,
              borderRadius:edgeToEdge ? 3.5 : 2,
              bgcolor:edgeToEdge
                ? (theme => theme.palette.mode==='dark'
                  ? 'rgba(28,28,30,.86)' : 'rgba(255,255,255,.86)')
                : 'background.paper',
              boxShadow:'0 2px 12px rgba(15,23,42,.18)',
              border:'1px solid',borderColor:'divider',
              maxWidth:{xs:'100%',sm:720},
              mx:'auto',backdropFilter:'blur(18px)',
              WebkitBackdropFilter:'blur(18px)'}}>
              <Typography variant="caption" sx={{display:edgeToEdge ? 'none' : 'block',
                mb:0.5,fontWeight:700}}>
                照片地点 · 当前区域 {trustedSummary?.total_count.toLocaleString('zh-CN')} 张
              </Typography>
              <Box component="nav" aria-label="浏览地图当前聚合区域照片"
                sx={{display:'flex',gap:edgeToEdge ? 0.5 : 0.75,
                  overflowX:'auto',overflowY:'hidden',pb:edgeToEdge ? 0 : 0.25,
                  touchAction:'pan-x',scrollbarWidth:edgeToEdge ? 'none' : 'thin',
                  '&::-webkit-scrollbar':edgeToEdge ? {display:'none'} : undefined}}>
                {photoStrip.map(pin => (
                  <Button key={pin.selection.cell_x+':'+pin.selection.cell_y}
                    data-xdrive-places-collection-thumb={pin.selection.node_id}
                    aria-label={'查看区域 '+
                      (pin.selection.cell_y*8+pin.selection.cell_x+1)+
                      ' 的 '+pin.count.toLocaleString('zh-CN')+' 张照片'}
                    onClick={() => openVerifiedCell(pin.selection)}
                    sx={{position:'relative',display:'block',
                      flex:edgeToEdge ? '0 0 54px' : '0 0 76px',
                      width:edgeToEdge ? 54 : 76,minWidth:edgeToEdge ? 54 : 76,
                      height:edgeToEdge ? 54 : 78,p:edgeToEdge ? 0.25 : 0.5,
                      borderRadius:edgeToEdge ? 2 : 1.5,
                      border:'1px solid',borderColor:'divider',
                      bgcolor:'action.hover',textTransform:'none',
                      '&:focus-visible':{outline:'3px solid',
                        outlineColor:'primary.main',outlineOffset:2}}}>
                    <Box sx={{width:'100%',height:edgeToEdge ? 46 : 52,
                      borderRadius:edgeToEdge ? 1.5 : 1,
                      overflow:'hidden',bgcolor:'background.default'}}>
                      {ownerCover(pin.selection,
                        '区域 '+(pin.selection.cell_y*8+pin.selection.cell_x+1)+'代表照片',
                        <PhotoLibraryOutlinedIcon fontSize="small"/> )}
                    </Box>
                    <Typography variant="caption" component="span"
                      sx={{fontSize:10,fontWeight:700,display:'block',
                        lineHeight:'16px',
                        ...(edgeToEdge ? {position:'absolute',right:2,bottom:2,
                          px:0.5,borderRadius:'999px',bgcolor:'primary.main',
                          color:'primary.contrastText',
                          boxShadow:'0 1px 3px rgba(0,0,0,.2)'} : {})}}>
                      {pin.count.toLocaleString('zh-CN')} 张
                    </Typography>
                  </Button>
                ))}
              </Box>
            </Box>
          </Box>
        ) : null}
      {!activeDrawer && trustedSummary ? (
        <Box data-xdrive-places-map-photo-summary
          sx={{position:'absolute',
            left:{xs:'max(10px, env(safe-area-inset-left))',sm:16},
            right:{xs:'max(10px, env(safe-area-inset-right))',sm:16},
            bottom:photoStrip.length>0
              ? (edgeToEdge
                ? 'calc(82px + env(safe-area-inset-bottom, 0px))'
                : {xs:'calc(135px + env(safe-area-inset-bottom, 0px))',sm:145})
              : {xs:'max(12px, env(safe-area-inset-bottom))',sm:16},
            zIndex:5,display:'flex',alignItems:'center',justifyContent:'space-between',
            gap:1,flexWrap:'wrap',pointerEvents:'none'}}>
          <Typography variant="caption" color="text.primary"
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
          <Box role="alert" data-xdrive-places-cells-query-error
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
            initialPresentation={activeDrawer.returnPresentation}
            loadThumbnail={loadThumbnail}
            onClose={closeDrawer}
            onExpand={expanded => setDrawer(current => current
              ? {...current,expanded} : current)}
            onRetry={() => { closeDrawer();refreshFilteredCells.current?.() }}
            onOpenAll={openDrawerAll} onOpenPhoto={openDrawerPhoto}
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
        <Box component="details" data-xdrive-places-cluster-list>
          <Box component="summary" sx={{cursor:'pointer',typography:'caption',
            color:'text.secondary',minHeight:36}}>
            聚集点列表（{accessible.length}）
          </Box>
        <Box component="nav" aria-label="当前地图聚合区域"
          sx={{display:'flex',flexWrap:'wrap',gap:0.5,mt:0.5}}>
          {accessible.map((cell,index)=>(
            <Button key={index} size="small" variant="text"
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
