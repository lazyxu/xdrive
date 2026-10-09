import { useEffect, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import type {
  MediaPlaceFacet,
  XDriveBaiduMapProviderInfo,
  XDriveBaiduStaticMapRequest,
} from '../models'

type ProviderResult =
  | { kind: 'checking' }
  | { kind: 'available'; info: XDriveBaiduMapProviderInfo }
  | { kind: 'unavailable' }

/** Baidu is the only map renderer; there is deliberately no offline renderer
 * or emergency fallback. Neither the AK nor the upstream URL reaches clients. */
export function XDriveMediaGalleryBaiduStaticMap({
  place,
  getProvider,
  loadStaticMap,
}: {
  place?: MediaPlaceFacet
  getProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
}) {
  const [provider, setProvider] = useState<ProviderResult>({ kind: 'checking' })
  const [imageURL, setImageURL] = useState('')
  const [zoom, setZoom] = useState(12)
  const [requestID, setRequestID] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setProvider({ kind: 'checking' })
    if (!getProvider) {
      setProvider({ kind: 'unavailable' })
    } else {
      void getProvider().then((info) => {
        if (active) setProvider({ kind: 'available', info })
      }).catch(() => {
        if (active) setProvider({ kind: 'unavailable' })
      })
    }
    return () => { active = false }
  }, [getProvider])

  const enabled = provider.kind === 'available' && provider.info.enabled
  const latitude = place?.latitude
  const longitude = place?.longitude

  useEffect(() => {
    const controller = new AbortController()
    let imageObjectURL = ''
    let active = true
    setImageURL('')
    setError('')
    setBusy(false)

    if (!enabled || !loadStaticMap || latitude === undefined || longitude === undefined) {
      return () => { active = false; controller.abort() }
    }
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 85 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      setError('地点坐标超出百度地图支持范围。')
      return () => { active = false; controller.abort() }
    }

    setBusy(true)
    void loadStaticMap({
      latitude,
      longitude,
      zoom,
      width: 480,
      height: 280,
    }, controller.signal).then((png) => {
      if (!active || controller.signal.aborted) return
      imageObjectURL = URL.createObjectURL(png)
      setImageURL(imageObjectURL)
    }).catch(() => {
      if (active && !controller.signal.aborted) {
        setError('百度地图加载失败，请检查网络、Server AK 和配额后重试。')
      }
    }).finally(() => {
      if (active && !controller.signal.aborted) setBusy(false)
    })
    return () => {
      active = false
      controller.abort()
      if (imageObjectURL) URL.revokeObjectURL(imageObjectURL)
    }
  }, [enabled, latitude, longitude, loadStaticMap, zoom, requestID])

  const message =
    provider.kind === 'checking' ? '正在检查百度地图服务…'
      : provider.kind === 'unavailable' ? '无法连接百度地图服务，请检查 Server 和客户端版本。'
      : !provider.info.enabled ? '百度地图未启用，请管理员在 Server 配置有效的百度地图 AK。'
      : !loadStaticMap ? '当前客户端不支持百度地图图片传输，请更新客户端。'
      : !place ? '没有可显示的地点。'
      : error || (busy ? '正在加载百度地图…' : '百度地图暂无可显示的图片。')

  return (
    <Box component="section" data-xdrive-baidu-static-map sx={{ px: { xs: 1.25, sm: 1.5 }, pb: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">百度地图{place ? ` · ${place.name}` : ''}</Typography>
          <Typography variant="caption" color="text.secondary">
            百度地图 Server API · {provider.kind === 'available' ? provider.info.attribution : '© 百度地图'}
          </Typography>
        </Box>
        <Tooltip title="缩小百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !place || busy || zoom <= 3}
              onClick={() => setZoom((value) => Math.max(3, value - 1))}
              aria-label="缩小百度地图">
              <ZoomOutRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="caption" color="text.secondary">{zoom}</Typography>
        <Tooltip title="放大百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !place || busy || zoom >= 18}
              onClick={() => setZoom((value) => Math.min(18, value + 1))}
              aria-label="放大百度地图">
              <ZoomInRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="重新加载百度地图">
          <span>
            <IconButton size="small" disabled={!enabled || !place || !loadStaticMap || busy}
              onClick={() => setRequestID((value) => value + 1)}
              aria-label="重新加载百度地图">
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Box sx={{
        bgcolor: 'action.hover',
        borderRadius: 1,
        mt: 1,
        mx: 'auto',
        width: '100%',
        maxWidth: 480,
        aspectRatio: '12 / 7',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}>
        {imageURL && !error ? (
          <Box component="img" src={imageURL} alt={`百度地图：${place?.name ?? ''}`}
            onError={() => setError('百度地图返回的图片无法显示，请重试。')}
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <Typography role="status" variant="body2" color="text.secondary" sx={{ px: 2, textAlign: 'center' }}>
            {message}
          </Typography>
        )}
      </Box>
      {provider.kind === 'available' && provider.info.enabled ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {provider.info.privacy}
        </Typography>
      ) : null}
    </Box>
  )
}
