import { useCallback, useEffect, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { MediaPlaceFacet, MediaBaiduNativeCellSelection } from '../models'
import type { XDriveBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { xDriveValidBaiduNativeCameraSnapshot } from '../media-gallery-baidu-native-camera-session'
import { XDriveMediaGalleryBaiduIsolatedPhotoSurface } from './MediaGalleryBaiduIsolatedPhotoSurface'
import {
  xDriveRecordBaiduMapDiagnostic, xDriveClassifyBaiduMapRequestFailure,
  xDriveReadBaiduMapDiagnostic, xDriveSubscribeBaiduMapDiagnostics,
  xDriveBaiduMapDiagnosticDetails, XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnostic } from '../media-gallery-baidu-diagnostics'

/** Signed, isolated HTTPS JSAPI4 Child is the only photo-map renderer.
 * A release denial or Child failure never falls back to a static map. */
export function XDriveMediaGalleryPlacesMap({
  places, totalCount, initialNativeCamera, onNativeCameraChange, onNativeCameraClear,
  listBaiduNativeCells, loadPhotoCoverThumbnail, getBaiduJSAPI4Status,
  mintBaiduIsolatedChildTicket, onOpenBaiduNativeCell, onOpenBaiduNativeViewport, onBaiduNativeCellInvalidated,
  onOpenSecureDesktopMap, diagnosticScope, onOpenDiagnostics,
  activePlaceID, focusPlaceID, onOpenPlace, onOpenNearby, compact = false,
}: {
  places: MediaPlaceFacet[]
  totalCount?: number | null
  initialNativeCamera?: XDriveBaiduNativeCameraSnapshot
  onNativeCameraChange?: (camera: XDriveBaiduNativeCameraSnapshot) => void
  onNativeCameraClear?: () => void
  listBaiduNativeCells?: import('./MediaGallery').MediaGalleryDataSource['listBaiduNativeCells']
  loadPhotoCoverThumbnail?: import('./MediaGallery').MediaThumbnailLoader
  getBaiduJSAPI4Status?: import('./MediaGallery').MediaGalleryDataSource['getBaiduJSAPI4Status']
  mintBaiduIsolatedChildTicket?: import('./MediaGallery').MediaGalleryDataSource['mintBaiduIsolatedChildTicket']
  onOpenBaiduNativeCell?: (selection: MediaBaiduNativeCellSelection) => void
  onOpenBaiduNativeViewport?: (bounds: import('../models').MediaBaiduNativeViewportBounds) => void
  onBaiduNativeCellInvalidated?: () => void
  onOpenSecureDesktopMap?: () => void
  diagnosticScope?: string
  onOpenDiagnostics?: () => void
  activePlaceID?: string
  focusPlaceID?: string
  onOpenPlace?: (place: MediaPlaceFacet) => void
  onOpenNearby?: (place: MediaPlaceFacet, radiusKM: number) => void
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
  const desktopOnly = Boolean(onOpenSecureDesktopMap)
  const hasChildPorts = Boolean(!desktopOnly && getBaiduJSAPI4Status &&
    mintBaiduIsolatedChildTicket && listBaiduNativeCells && onOpenBaiduNativeCell)
  const cameraRef = useRef<XDriveBaiduNativeCameraSnapshot | null>(
    xDriveValidBaiduNativeCameraSnapshot(initialNativeCamera) ? { ...initialNativeCamera } : null,
  )
  const clearCamera = useCallback(() => {
    cameraRef.current = null
    onNativeCameraClear?.()
  }, [onNativeCameraClear])
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
  }, [desktopOnly, hasChildPorts, getBaiduJSAPI4Status, diagnosticScope, retry])
  const nativeEnabled = status === 'authorized' && !childFailed && childOrigin !== ''

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
      <Box component="details" data-xdrive-places-map-options sx={{ px: 1.5, pb: 1 }}>
        <Box component="summary" sx={{ cursor: 'pointer', color: 'text.secondary',
          typography: 'caption', minHeight: 28 }}>地点筛选与更多操作</Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ py: 1 }}>
          <Autocomplete size="small" options={places} getOptionLabel={p => p.name}
            isOptionEqualToValue={(a, b) => a.id === b.id} value={selectedPlace ?? null}
            onChange={(_event, p) => { clearCamera(); setSelectedPlaceID(p?.id ?? null) }}
            renderInput={params => <TextField {...params} size="small" label="选择地点" />}
            sx={{ flex: 1, minWidth: 0 }} />
          {onOpenPlace ? (
            <Button variant="outlined" size="small" disabled={!selectedPlace}
              onClick={() => { if (selectedPlace) onOpenPlace(selectedPlace) }}>查看此地点照片</Button>
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
                onClick={() => { if (selectedPlace) onOpenNearby(selectedPlace, nearbyRadiusKM) }}>查看附近照片</Button>
            </>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          仅显示当前账户已授权的真实 GPS 照片；照片数量和 Viewer 使用同一 Server Range。
        </Typography>
      </Box>
      {nativeEnabled && !mapReady ? (
        <Typography variant="caption" role="status" color="text.secondary" sx={{ px: 1.5, pb: 1 }}>
          正在初始化百度动态地图…
        </Typography>
      ) : null}
      {desktopOnly ? (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Button variant="outlined" onClick={onOpenSecureDesktopMap}>在独立 HTTPS 安全窗口打开动态地图</Button>
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
          onInvalidated={onBaiduNativeCellInvalidated} onCamera={onNativeCameraChange}
          onCameraClear={clearCamera} onReady={setMapReady}
          onFailure={() => setChildFailed(true)}
          initialCamera={cameraRef.current ?? undefined} scope={diagnosticScope}
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
