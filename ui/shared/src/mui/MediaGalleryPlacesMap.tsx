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
import { XDriveMediaGalleryBaiduPrototypeMap } from './MediaGalleryBaiduPrototypeMap'
import { xDrivePlacesMapModeFromHref, xDrivePlacesMapModeNavigationURL } from '../media-gallery-places-map-mode'
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
  listBaiduNativeCells, listPlacesMapOverview, loadPhotoCoverThumbnail, getBaiduMapCoverage, getBaiduMapCoverageReasons, getBaiduJSAPI4Status,
  getBaiduJSAPIPrototype, onOpenViewportPhotos,
  mintBaiduIsolatedChildTicket, onOpenBaiduNativeCell, onOpenBaiduNativeViewport, onBaiduNativeCellInvalidated,
  onOpenSecureDesktopMap, diagnosticScope, onOpenDiagnostics,
  activePlaceID, focusPlaceID, onOpenPlace, onOpenPrototypePlace, onOpenNearby, compact = false,
  mapPhotoScope = xDriveEmptyBaiduMapPhotoScope, onMapPhotoScopeChange, mapAlbums = [],
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
  const desktopOnly = Boolean(onOpenSecureDesktopMap)
  // Desktop file never loads third-party JSAPI; Web and PWA default to legacy.
  const mapMode = desktopOnly ? 'isolated' : xDrivePlacesMapModeFromHref(
    typeof window === 'undefined' ? '' : window.location.href,
  )
  const changeMapMode = (next: 'prototype' | 'isolated') => {
    if (desktopOnly || mapMode === next || typeof window === 'undefined') return
    // A full document reload destroys the Owner's in-memory authorized
    // scope. Both transitions must fail closed until an authenticated,
    // one-use Server handoff can restore the exact same scope. The legacy
    // same-document SDK must never read a private scope from URL/storage.
    if (!xDriveBaiduMapScopeSurvivesFullReload(mapPhotoScope)) {
      setModeWarning('当前地图包含相册或筛选范围，整页切换会丢失该范围；请先清除筛选。不会自动切换到全图库。')
      return
    }
    setModeWarning('')
    const href = xDrivePlacesMapModeNavigationURL(window.location.href, next)
    if (href) window.location.replace(href)
  }
  // The list selector and native map pins open the same current Owner place.
  // Only the legacy mode supports direct singleton Viewer; isolated mode
  // continues to use its authorized Cell/Viewport navigation.
  const openSelectedPlace = mapMode === 'prototype' && selectedPlace?.id.startsWith('place:')
    ? (onOpenPrototypePlace ?? onOpenPlace) : onOpenPlace
  const hasChildPorts = Boolean(!desktopOnly && getBaiduJSAPI4Status &&
    mintBaiduIsolatedChildTicket && listBaiduNativeCells && onOpenBaiduNativeCell)
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
    if (desktopOnly || mapMode === 'prototype') return
    if (!hasChildPorts || !getBaiduJSAPI4Status) {
      setStatus('unsupported')
      if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(diagnosticScope, 'client_transport_missing')
      return
    }
    const controller = new AbortController()
    void getBaiduJSAPI4Status(controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result?.provider === 'baidu-jsapi-4.0' && result.enabled === true &&
          result.activation_state === 'authorized_signed_release' &&
          typeof result.isolated_child_origin === 'string' &&
          result.isolated_child_origin.startsWith('https://')) {
        setChildOrigin(result.isolated_child_origin)
        setStatus('authorized')
      } else {
        setStatus('blocked')
        if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(diagnosticScope, 'server_release_blocked')
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      setStatus('error')
      if (diagnosticScope) xDriveRecordBaiduMapDiagnostic(
        diagnosticScope, xDriveClassifyBaiduMapRequestFailure('status', error))
    })
    return () => controller.abort()
  }, [desktopOnly, mapMode, hasChildPorts, getBaiduJSAPI4Status, diagnosticScope, retry])
  const nativeEnabled = mapMode === 'isolated' && status === 'authorized' && !childFailed && childOrigin !== ''
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
            variant={mapMode === 'prototype' ? 'contained' : 'outlined'}
            aria-pressed={mapMode === 'prototype'}
            onClick={() => changeMapMode('prototype')}>同页原型（默认）</Button>
          <Button size="small" data-xdrive-map-mode-isolated
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
          同页原型直接在图库页面执行百度第三方脚本，不具备独立 Origin 隔离；切换安全版会重新加载页面。
        </Typography>
      ) : null}
      <Box component="details" data-xdrive-places-map-options sx={{ px: 1.5, pb: 1 }}>
        <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary',
          typography: 'caption', minHeight: 28 }}>地点筛选与更多操作</Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ py: 1 }}>
          <Autocomplete size="small" options={places} getOptionLabel={p => p.name}
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
          {onOpenNearby ? (
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
          {mapMode === 'prototype'
            ? '同页原型使用当前账户的 GPS 聚合代表点；照片墙仍经 Server Owner 授权。高倍视窗附近范围不等于精确 BD-09 Range。'
            : '隔离版仅显示当前账户已授权的 GPS 媒体；照片数量和 Viewer 使用同一 Server Range。'}
        </Typography>
      </Box>
      <Box sx={{px:1.5,pb:1}}><XDriveMediaGalleryMapGPSCoverage
        getCoverage={getBaiduMapCoverage} getReasons={getBaiduMapCoverageReasons}
        ownerScope={diagnosticScope}/></Box>
      {onMapPhotoScopeChange && mapMode === 'isolated' && !desktopOnly ? (
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
      {mapMode === 'prototype' && !desktopOnly ? (
        getBaiduJSAPIPrototype && listPlacesMapOverview ? (
          <XDriveMediaGalleryBaiduPrototypeMap
            key={diagnosticScope ?? 'places-prototype'}
            getPrototypeConfig={getBaiduJSAPIPrototype}
            listPlacesMapOverview={listPlacesMapOverview}
            initialNativeCamera={cameraRef.current ?? undefined}
            onNativeCameraChange={rememberCamera}
            onOpenPlace={onOpenPrototypePlace ?? onOpenPlace}
            onInvalidated={onBaiduNativeCellInvalidated}
            onOpenViewportPhotos={onOpenViewportPhotos}
            loadThumbnail={loadPhotoCoverThumbnail}
            diagnosticScope={diagnosticScope}
          />
        ) : (
          <Box role="alert" data-xdrive-baidu-prototype-unavailable sx={{ px: 1.5, pb: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              当前 Web / Server 缺少同页原型接口；可切换安全隔离版，或更新到匹配版本。
            </Typography>
          </Box>
        )
      ) : desktopOnly ? (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Button variant="outlined" onClick={() => onOpenSecureDesktopMap?.(mapPhotoScope)}>在独立 HTTPS 安全窗口打开动态地图</Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            动态地图由 Server 签名发布，不在 Electron file 页面加载第三方脚本。
          </Typography>
        </Box>
      ) : nativeEnabled && mintBaiduIsolatedChildTicket && listBaiduNativeCells && onOpenBaiduNativeCell ? (
        <XDriveMediaGalleryBaiduIsolatedPhotoSurface
          key={(diagnosticScope ?? '') + ':' + childOrigin + ':' + retry}
          childOrigin={childOrigin} mintChildTicket={mintBaiduIsolatedChildTicket}
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
            <Typography variant="body2" color="text.secondary">独立动态地图会话加载失败。</Typography>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
            {hasChildPorts ? <Button variant="outlined" size="small"
              onClick={() => setRetry(n => n + 1)}>重试动态地图</Button> : null}
            {onOpenDiagnostics ? <Button size="small" variant="text" onClick={onOpenDiagnostics}
              data-xdrive-baidu-map-diagnostics-link>查看原因与修复建议</Button> : null}
          </Stack>
        </Box>
      )}
    </Paper>
  )
}
