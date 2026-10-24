import { useCallback, useEffect, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { MediaPlaceFacet, MediaBaiduNativeCellSelection, MediaPlacesViewportBounds, MediaAlbum, MediaGalleryQuery } from '../models'
import {
  xDriveNormalizeBaiduMapPhotoScope, xDriveEmptyBaiduMapPhotoScope,
  xDriveBaiduMapScopeSurvivesFullReload,
} from '../media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from '../media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from './MediaGalleryBaiduIsolatedPhotoSurface'
import { xDrivePlacesMapModeFromHref, xDrivePlacesMapModeNavigationURL, xDrivePlacesMapScopeHandoffURL } from '../media-gallery-places-map-mode'
import {
  xDriveRecordBaiduMapDiagnostic, xDriveClassifyBaiduMapRequestFailure,
  xDriveReadBaiduMapDiagnostic, xDriveSubscribeBaiduMapDiagnostics,
  xDriveBaiduMapDiagnosticDetails, XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnostic } from '../media-gallery-baidu-diagnostics'
import { XDriveMediaGalleryMapGPSCoverage } from './MediaGalleryMapGPSCoverage'

/** Two user-selected dynamic SDK runtimes. A denied signed release never
 * silently downgrades the isolated Child to the legacy direct prototype. */
export function XDriveMediaGalleryPlacesMap({
  places, totalCount, initialNativeCamera, onNativeCameraChange, onNativeCameraClear,
  listBaiduNativeCells, loadPhotoCoverThumbnail, getBaiduMapCoverage, getBaiduMapCoverageReasons, getBaiduJSAPI4Status,
  getBaiduJSAPIPrototype, mintBaiduIsolatedChildTicket, onOpenBaiduNativeCell, onOpenBaiduNativeViewport, onBaiduNativeCellInvalidated,
  onOpenSecureDesktopMap, diagnosticScope, onOpenDiagnostics,
  activePlaceID, focusPlaceID, onOpenPlace, onOpenPrototypePlace, onOpenNearby, compact = false,
  mapPhotoScope = xDriveEmptyBaiduMapPhotoScope, onMapPhotoScopeChange, onMapModeHandoff, mapAlbums = [],
}: {
  places: MediaPlaceFacet[]
  totalCount?: number | null
  initialNativeCamera?: XDriveBaiduNativeCameraSnapshot
  onNativeCameraChange?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onNativeCameraClear?: () => void
  listBaiduNativeCells?: import('./MediaGallery').MediaGalleryDataSource['listBaiduNativeCells']
  listPlacesMapOverview?: import('./MediaGallery').MediaGalleryDataSource['listPlacesMapOverview']
  getBaiduJSAPIPrototype?: import('./MediaGallery').MediaGalleryDataSource['getBaiduJSAPIPrototype']
  onOpenViewportPhotos?: (bounds: MediaPlacesViewportBounds) => void
  loadPhotoCoverThumbnail?: import('./MediaGallery').MediaThumbnailLoader
  getBaiduMapCoverage?: import('./MediaGallery').MediaGalleryDataSource['getBaiduMapCoverage']
  getBaiduMapCoverageReasons?: import('./MediaGallery').MediaGalleryDataSource['getBaiduMapCoverageReasons']
  getBaiduJSAPI4Status?: import('./MediaGallery').MediaGalleryDataSource['getBaiduJSAPI4Status']
  mintBaiduIsolatedChildTicket?: import('./MediaGallery').MediaGalleryDataSource['mintBaiduIsolatedChildTicket']
  onOpenBaiduNativeCell?: (selection: MediaBaiduNativeCellSelection,
    scope: XDriveBaiduMapPhotoScope) => void
  onOpenBaiduNativeViewport?: (bounds: import('../models').MediaBaiduNativeViewportBounds,
    scope: XDriveBaiduMapPhotoScope) => void
  onBaiduNativeCellInvalidated?: () => void
  onOpenSecureDesktopMap?: (scope: XDriveBaiduMapPhotoScope) => void
  diagnosticScope?: string
  onOpenDiagnostics?: () => void
  activePlaceID?: string
  focusPlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenPrototypePlace?: (place: MediaPlaceFacet) => void
  onOpenNearby?: (place: MediaPlaceFacet, radiusKM: number) => void
  mapPhotoScope?: XDriveBaiduMapPhotoScope
  onMapPhotoScopeChange?: (scope: XDriveBaiduMapPhotoScope) => void
  /** Web/Mobile only; Server-minted one-use authenticated Owner scope bridge. */
  onMapModeHandoff?: (scope: XDriveBaiduMapPhotoScope,
    target: 'prototype' | 'isolated', signal: AbortSignal,
    camera?: XDriveBaiduNativeCameraSnapshot) => Promise<string>
  mapAlbums?: MediaAlbum[]
  compact?: boolean
}) {
  const [selectedPlaceID, setSelectedPlaceID] = useState<string | null>(null)
  const selectedPlace = places.find(p => p.id === selectedPlaceID) ??
    places.find(p => p.id === focusPlaceID) ??
    places.find(p => p.id === activePlaceID) ?? places[0]
  const [nearbyRadiusKM, setNearbyRadiusKM] = useState(5)
  const [status, setStatus] = useState<'checking' | 'authorized' | 'blocked' | 'error' | 'unsupported'>('checking')
  const [childOrigin, setChildOrigin] = useState('')
  const [childFailed, setChildFailed] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [retry, setRetry] = useState(0)
  const [modeWarning, setModeWarning] = useState('')
  const [modeSwitching, setModeSwitching] = useState(false)
  const handoffAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { handoffAbort.current?.abort() }, [])
  const desktopOnly = Boolean(onOpenSecureDesktopMap)
  // Desktop file never loads third-party JSAPI; Web and PWA default to legacy.
  const mapMode = desktopOnly ? 'isolated' : xDrivePlacesMapModeFromHref(
    typeof window === 'undefined' ? '' : window.location.href,
  )
  const changeMapMode = (next: 'prototype' | 'isolated') => {
    if (desktopOnly || mapMode === next || modeSwitching || typeof window === 'undefined') return
    const scope = xDriveNormalizeBaiduMapPhotoScope(mapPhotoScope)
    if (!scope) {
      setModeWarning('当前照片范围无效，未切换到全图库。')
      return
    }
    if (xDriveBaiduMapScopeSurvivesFullReload(scope) &&
      !xDriveValidBaiduNativeCameraSnapshot(cameraRef.current)) {
      setModeWarning('')
      const href = xDrivePlacesMapModeNavigationURL(window.location.href, next)
      if (href) window.location.replace(href)
      return
    }
    // Preserve BOTH private filters and an already selected BD-09 camera.
    // The unrestricted gallery can navigate directly only before a camera
    // exists. Reuse the SAME one-use Server handoff for either SDK host.
    // No Album/GPS/Owner identifiers are written to URL, history or storage.
    if (!onMapModeHandoff) {
      setModeWarning('当前照片范围或地图位置无法安全交接，保持原地图，不会切换到全图库。')
      return
    }
    handoffAbort.current?.abort()
    const controller = new AbortController()
    handoffAbort.current = controller
    setModeSwitching(true)
    setModeWarning('')
    void onMapModeHandoff(scope, next, controller.signal,
      cameraRef.current ?? undefined).then(ticket => {
      if (controller.signal.aborted || handoffAbort.current !== controller) return
      const url = xDrivePlacesMapScopeHandoffURL(window.location.href, next, ticket)
      if (!url) throw new Error('invalid-handoff')
      window.location.replace(url)
    }).catch(() => {
      if (!controller.signal.aborted && handoffAbort.current === controller)
        setModeWarning('地图状态交接失败，已保留当前相机与照片筛选；不会打开全图库。')
    }).finally(() => {
      if (handoffAbort.current === controller) {
        handoffAbort.current = null
        if (!controller.signal.aborted) setModeSwitching(false)
      }
    })
  }
  // Legacy Places and nearby queries have different membership from a signed
  // filtered BD09 Cell/Camera. A restricted map must NEVER silently broaden
  // its Album/favorite/date/type scope using the legacy selector. For the
  // unrestricted Owner scope, preserve its freshly authorized singleton Viewer.
  const placeListScoped = !xDriveBaiduMapScopeSurvivesFullReload(mapPhotoScope)
  const openSelectedPlace = placeListScoped ? undefined
    : selectedPlace?.id.startsWith('place:')
      ? (onOpenPrototypePlace ?? onOpenPlace) : onOpenPlace
  const hasMapPorts = Boolean(!desktopOnly && getBaiduJSAPI4Status &&
    listBaiduNativeCells && onOpenBaiduNativeCell &&
    (mapMode === 'prototype' ? getBaiduJSAPIPrototype : mintBaiduIsolatedChildTicket))
  const cameraRef = useRef<XDriveBaiduNativeCameraSnapshot | null>(
    xDriveValidBaiduNativeCameraSnapshot(initialNativeCamera) ? { ...initialNativeCamera } : null,
  )
  const clearCamera = useCallback(() => {
    cameraRef.current = null
    onNativeCameraClear?.()
  }, [onNativeCameraClear])
  const rememberCamera = useCallback((camera: XDriveBaiduNativeCameraSnapshot) => {
    if (!xDriveValidBaiduNativeCameraSnapshot(camera)) return
    cameraRef.current = { coordinate_space: 'bd09ll', latitude: camera.latitude,
      longitude: camera.longitude, zoom: camera.zoom }
    onNativeCameraChange?.(camera)
  }, [onNativeCameraChange])
  const [diagnosis, setDiagnosis] = useState<{ scope: string; value: XDriveBaiduMapDiagnostic | null }>(
    { scope: diagnosticScope ?? '', value: null },
  )
  useEffect(() => {
    const scope = diagnosticScope ?? ''
    const read = () => setDiagnosis({ scope, value: xDriveReadBaiduMapDiagnostic(scope) })
    read()
    const off = xDriveSubscribeBaiduMapDiagnostics(read)
    const win = typeof window === 'undefined' ? null : window
    const doc = typeof document === 'undefined' ? null : document
    win?.addEventListener('focus', read)
    doc?.addEventListener('visibilitychange', read)
    return () => {
      off()
      win?.removeEventListener('focus', read)
      doc?.removeEventListener('visibilitychange', read)
    }
  }, [diagnosticScope])
  const latestDiagnosis = diagnosis.scope === (diagnosticScope ?? '') ? diagnosis.value : null
  useEffect(() => {
    if (!latestDiagnosis) return
    const scope = diagnosticScope ?? ''
    const remaining = XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS - (Date.now() - latestDiagnosis.recordedAt)
    const timer = window.setTimeout(() => setDiagnosis({
      scope, value: xDriveReadBaiduMapDiagnostic(scope),
    }), Math.max(1, remaining + 2))
    return () => window.clearTimeout(timer)
  }, [diagnosticScope, latestDiagnosis?.recordedAt])

  useEffect(() => {
    setChildOrigin('')
    setChildFailed(false)
    setMapReady(false)
    setStatus('checking')
    if (desktopOnly) return
    if (!hasMapPorts || !getBaiduJSAPI4Status) {
      setStatus('unsupported')
      if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(diagnosticScope, 'client_transport_missing')
      return
    }
    const controller = new AbortController()
    void getBaiduJSAPI4Status(controller.signal).then(result => {
      if (controller.signal.aborted) return
      const child = typeof result?.isolated_child_origin === 'string' &&
        result.isolated_child_origin.startsWith('https://')
        ? result.isolated_child_origin : ''
      const signed = result?.provider === 'baidu-jsapi-4.0' &&
        result.enabled === true &&
        result.activation_state === 'authorized_signed_release'
      if (signed && (mapMode === 'prototype' || child !== '')) {
        setChildOrigin(child)
        setStatus('authorized')
      } else {
        setStatus('blocked')
        if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(diagnosticScope,
          signed && mapMode === 'isolated' ? 'isolated_origin_unavailable' : 'server_release_blocked')
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      setStatus('error')
      if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(
        diagnosticScope, xDriveClassifyBaiduMapRequestFailure('status', error))
    })
    return () => controller.abort()
  }, [desktopOnly, mapMode, hasMapPorts, getBaiduJSAPI4Status, diagnosticScope, retry])
  const nativeEnabled = status === 'authorized' && !childFailed &&
    (mapMode === 'prototype' || childOrigin !== '')
  // Only the parent owns the selected Album/filters; nothing here is sent to
  // Baidu's Child, and the current SDK iframe does not remount on changes.
  const changeMapScope = (patch: Partial<MediaGalleryQuery>, albumKey = mapPhotoScope.albumKey) => {
    if (!onMapPhotoScopeChange || !mapReady || !nativeEnabled) return
    const next = xDriveNormalizeBaiduMapPhotoScope({
      filters: {...mapPhotoScope.filters,...patch},albumKey,
    })
    if (next) onMapPhotoScopeChange(next)
  }
  const sortValue = (mapPhotoScope.filters.sort_by ?? 'captured') + ':' +
    (mapPhotoScope.filters.sort_dir ?? 'desc')

  return (
    <Paper variant="outlined" data-xdrive-gallery-places-map
      sx={{ borderRadius: compact ? 0 : { xs: 0, sm: 2 }, borderWidth: compact ? 0 : 1, overflow: 'hidden' }}>
      {!compact ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
          alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            缩放百度动态地图浏览照片，点击聚集标记进入照片墙。
          </Typography>
          <Chip size="small" label={totalCount === null || totalCount === undefined
            ? `本页 ${places.length.toLocaleString('zh-CN')} 个地点`
            : `共 ${totalCount.toLocaleString('zh-CN')} 个地点 · 本页 ${places.length.toLocaleString('zh-CN')} 个`} />
        </Stack>
      ) : null}
      {!desktopOnly ? (
        <Stack data-xdrive-places-map-mode direction="row" spacing={1}
          sx={{ px: 1.5, py: 1, flexWrap: 'wrap' }}>
          <Button size="small" data-xdrive-map-mode-prototype
            disabled={modeSwitching}
            variant={mapMode === 'prototype' ? 'contained' : 'outlined'}
            aria-pressed={mapMode === 'prototype'}
            onClick={() => changeMapMode('prototype')}>同页原型（默认）</Button>
          <Button size="small" data-xdrive-map-mode-isolated
            disabled={modeSwitching}
            variant={mapMode === 'isolated' ? 'contained' : 'outlined'}
            aria-pressed={mapMode === 'isolated'}
            onClick={() => changeMapMode('isolated')}>安全隔离版</Button>
        </Stack>
      ) : null}
      {modeWarning ? <Typography data-xdrive-map-mode-scope-warning
        role="alert" variant="caption" color="text.secondary"
        sx={{display:'block',px:1.5,pb:1}}>
        {modeWarning}
      </Typography> : null}
      {mapMode === 'prototype' && !desktopOnly ? (
        <Typography variant="caption" color="text.secondary"
          data-xdrive-places-prototype-safety sx={{ display: 'block', px: 1.5, pb: 1 }}>
          同页地图与安全隔离版使用相同的已授权 BD-09 照片范围，但第三方百度脚本直接运行在图库主文档，不具备独立 Origin 隔离；切换安全版会重新加载页面。
        </Typography>
      ) : null}
      <Box component="details" data-xdrive-places-map-options sx={{ px: 1.5, pb: 1 }}>
        <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary',
          typography: 'caption', minHeight: 28 }}>地点筛选与更多操作</Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ py: 1 }}>
          <Autocomplete size="small" options={places} disabled={placeListScoped} getOptionLabel={p => p.name}
            isOptionEqualToValue={(a, b) => a.id === b.id} value={selectedPlace ?? null}
            onChange={(_event, p) => {
              // A different list selection must cancel an in-flight singleton
              // opened from a previous map pin, before changing the camera.
              onBaiduNativeCellInvalidated?.()
              clearCamera()
              setSelectedPlaceID(p?.id ?? null)
            }}
            renderInput={params => <TextField {...params} size="small" label="选择地点" />}
            sx={{ flex: 1, minWidth: 0 }} />
          {openSelectedPlace ? (
            <Button variant="outlined" size="small" disabled={!selectedPlace}
              onClick={() => { if (selectedPlace) openSelectedPlace(selectedPlace) }}>查看此地点照片</Button>
          ) : null}
          {onOpenNearby && !placeListScoped ? (
            <>
              <TextField select size="small" label="附近半径" value={nearbyRadiusKM}
                onChange={event => setNearbyRadiusKM(Number(event.target.value))} sx={{ minWidth: 120 }}>
                {[1, 5, 25, 100].map(km => <MenuItem key={km} value={km}>{km} 公里</MenuItem>)}
              </TextField>
              <Button variant="outlined" size="small"
                disabled={!selectedPlace || !Number.isFinite(selectedPlace.sample_latitude) ||
                  !Number.isFinite(selectedPlace.sample_longitude)}
                onClick={() => {
                  onBaiduNativeCellInvalidated?.()
                  if (selectedPlace) onOpenNearby(selectedPlace, nearbyRadiusKM)
                }}>查看附近照片</Button>
            </>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          两种模式只显示当前账户获授权且来源有效的 BD-09 照片；地图 Count、相册筛选、Cell/Camera 照片墙和 Viewer 均使用同一 Server Range。
        </Typography>
        {placeListScoped ? (
          <Typography variant="caption" color="text.secondary">
            当前相册或筛选已生效：请从地图标记或「查看此地图的全部照片」进入已授权照片范围；普通地点和附近操作暂不可用。
          </Typography>
        ) : null}
      </Box>
      <Box sx={{px:1.5,pb:1}}><XDriveMediaGalleryMapGPSCoverage
        getCoverage={getBaiduMapCoverage} getReasons={getBaiduMapCoverageReasons}
        ownerScope={diagnosticScope}/></Box>
      {onMapPhotoScopeChange && !desktopOnly ? (
        <Box data-xdrive-places-map-photo-filters sx={{ px: compact ? 1 : 1.5, pb: 1 }}>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ alignItems:'center' }}>
            <TextField select size="small" label="照片类型" value={mapPhotoScope.filters.asset_kind ?? 'all'}
              disabled={!mapReady || !nativeEnabled}
              onChange={event => changeMapScope({
                asset_kind: event.target.value === 'all' ? undefined :
                  event.target.value as 'image' | 'video',
              })} sx={{ minWidth:110, flex:'1 1 110px', maxWidth:180 }}>
              <MenuItem value="all">照片与视频</MenuItem>
              <MenuItem value="image">照片</MenuItem>
              <MenuItem value="video">视频</MenuItem>
            </TextField>
            <TextField select size="small" label="收藏" value={
              mapPhotoScope.filters.favorite === undefined ? 'all' :
                String(mapPhotoScope.filters.favorite)}
              disabled={!mapReady || !nativeEnabled}
              onChange={event => changeMapScope({
                favorite: event.target.value === 'all' ? undefined :
                  event.target.value === 'true',
              })} sx={{ minWidth:100, flex:'1 1 100px', maxWidth:150 }}>
              <MenuItem value="all">全部</MenuItem>
              <MenuItem value="true">已收藏</MenuItem>
              <MenuItem value="false">未收藏</MenuItem>
            </TextField>
            <TextField select size="small" label="相册" value={mapPhotoScope.albumKey}
              disabled={!mapReady || !nativeEnabled}
              onChange={event => changeMapScope({},event.target.value)}
              sx={{ minWidth:110, flex:'1 1 110px', maxWidth:210 }}>
              <MenuItem value="">全部相册</MenuItem>
              {mapAlbums.filter(a => /^(folder|source|manual|smart):.+/.test(a.id)).map(a =>
                <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="排序" value={sortValue}
              disabled={!mapReady || !nativeEnabled}
              onChange={event => {
                const [by,dir]=event.target.value.split(':')
                if ((by==='captured'||by==='added')&&(dir==='asc'||dir==='desc'))
                  changeMapScope({sort_by:by,sort_dir:dir})
              }} sx={{ minWidth:145, flex:'1 1 145px', maxWidth:190 }}>
              <MenuItem value="captured:desc">拍摄时间 · 新到旧</MenuItem>
              <MenuItem value="captured:asc">拍摄时间 · 旧到新</MenuItem>
              <MenuItem value="added:desc">添加时间 · 新到旧</MenuItem>
              <MenuItem value="added:asc">添加时间 · 旧到新</MenuItem>
            </TextField>
            <TextField type="date" size="small" label="拍摄开始日期" slotProps={{ inputLabel:{ shrink:true } }}
              value={mapPhotoScope.filters.captured_from ?? ''} disabled={!mapReady || !nativeEnabled}
              onChange={event => changeMapScope({captured_from:event.target.value || undefined})}
              sx={{ minWidth:150, flex:'1 1 150px', maxWidth:190 }}/>
            <TextField type="date" size="small" label="拍摄结束前" slotProps={{ inputLabel:{ shrink:true } }}
              value={mapPhotoScope.filters.captured_to ?? ''} disabled={!mapReady || !nativeEnabled}
              onChange={event => changeMapScope({captured_to:event.target.value || undefined})}
              sx={{ minWidth:150, flex:'1 1 150px', maxWidth:190 }}/>
            <Button size="small" variant="text" disabled={!mapReady || !nativeEnabled}
              onClick={() => {
                const next = xDriveNormalizeBaiduMapPhotoScope({
                  filters:{sort_by:'captured',sort_dir:'desc',
                    ...(mapPhotoScope.filters.time_zone ? {time_zone:mapPhotoScope.filters.time_zone}: {})},
                  albumKey:'',
                })
                if (next) onMapPhotoScopeChange(next)
              }}>清除筛选</Button>
          </Stack>
        </Box>
      ) : null}
      {nativeEnabled && !mapReady ? (
        <Typography variant="caption" role="status" color="text.secondary" sx={{ px: 1.5, pb: 1 }}>
          正在初始化百度动态地图…
        </Typography>
      ) : null}
      {desktopOnly ? (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Button variant="outlined" onClick={() => onOpenSecureDesktopMap?.(mapPhotoScope)}>在独立 HTTPS 安全窗口打开动态地图</Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            动态地图由 Server 签名发布，不在 Electron file 页面加载第三方脚本。
          </Typography>
        </Box>
      ) : nativeEnabled && listBaiduNativeCells && onOpenBaiduNativeCell &&
          (mapMode === 'prototype' ? getBaiduJSAPIPrototype : mintBaiduIsolatedChildTicket) ? (
        <XDriveMediaGalleryBaiduIsolatedPhotoSurface
          key={(diagnosticScope ?? '') + ':' + mapMode + ':' + childOrigin + ':' + retry}
          mode={mapMode === 'prototype' ? 'inline' : 'isolated'}
          childOrigin={childOrigin}
          getInlinePrototypeConfig={getBaiduJSAPIPrototype}
          getInlineSignedStatus={getBaiduJSAPI4Status}
          mintChildTicket={mintBaiduIsolatedChildTicket}
          listOwnerCells={listBaiduNativeCells} loadThumbnail={loadPhotoCoverThumbnail}
          edgeToEdge={compact} onOpenCell={onOpenBaiduNativeCell}
          onOpenViewport={onOpenBaiduNativeViewport}
          onInvalidated={onBaiduNativeCellInvalidated} onCamera={rememberCamera}
          onCameraClear={clearCamera} onReady={setMapReady}
          onFailure={() => setChildFailed(true)}
          initialCamera={cameraRef.current ?? undefined} scope={diagnosticScope}
          mapPhotoScope={mapPhotoScope}
        />
      ) : status === 'checking' ? (
        <Stack role="status" direction="row" alignItems="center" spacing={1.5} sx={{ p: 2, minHeight: 96 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">正在验证百度动态地图会话…</Typography>
        </Stack>
      ) : (
        <Box role="alert" data-xdrive-baidu-map-unavailable sx={{ px: 1.5, pb: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            百度动态照片地图暂不可用；地点列表和照片墙仍可使用。
          </Typography>
          {latestDiagnosis && xDriveBaiduMapDiagnosticDetails[latestDiagnosis.code] ? (
            <Typography variant="body2" color="text.secondary"
              data-xdrive-baidu-map-blocked-reason sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
              原因：{xDriveBaiduMapDiagnosticDetails[latestDiagnosis.code].title}
              {' · '}错误码：{latestDiagnosis.code}。
              {' '}处理：{xDriveBaiduMapDiagnosticDetails[latestDiagnosis.code].action}
            </Typography>
          ) : childFailed ? (
            <Typography variant="body2" color="text.secondary">动态地图 SDK 会话加载失败。</Typography>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
            {hasMapPorts ? <Button variant="outlined" size="small"
              onClick={() => setRetry(n => n + 1)}>重试动态地图</Button> : null}
            {onOpenDiagnostics ? <Button size="small" variant="text" onClick={onOpenDiagnostics}
              data-xdrive-baidu-map-diagnostics-link>查看原因与修复建议</Button> : null}
          </Stack>
        </Box>
      )}
    </Paper>
  )
}
