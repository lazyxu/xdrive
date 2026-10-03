import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowBack as ArrowBackIcon,
  Collections as CollectionsIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  PlayCircleOutline as LivePhotoIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { MediaAlbum, MediaItem, MediaMetadata } from '../models'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveStatusAlert } from './StatusAlert'

export type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>
export type MediaMotionLoader = (nodeID: number) => Promise<string | null>

export interface MediaGalleryDataSource {
  listItems: (limit: number, offset: number) => Promise<MediaItem[]>
  listAlbums: () => Promise<MediaAlbum[]>
  listAlbumItems: (albumID: string, limit: number, offset: number) => Promise<MediaItem[]>
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
}

export interface XDriveMediaGalleryPageProps {
  source: MediaGalleryDataSource
  pageSize?: number
  onError?: (error: unknown) => void
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  const value = String(error ?? '').trim()
  return value && value !== '[object Object]' ? value : '图库加载失败'
}

export function XDriveMediaGalleryPage({
  source,
  pageSize = 100,
  onError,
}: XDriveMediaGalleryPageProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [currentAlbum, setCurrentAlbum] = useState<MediaAlbum | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)

  const loadFirstPage = useCallback(async (album: MediaAlbum | null) => {
    const request = ++requestID.current
    setLoading(true)
    setError('')
    try {
      if (album) {
        const nextItems = await source.listAlbumItems(album.id, pageSize + 1, 0)
        if (request !== requestID.current) return
        setCurrentAlbum(album)
        setItems(nextItems.slice(0, pageSize))
        setHasMore(nextItems.length > pageSize)
        return
      }
      const [nextItems, nextAlbums] = await Promise.all([
        source.listItems(pageSize + 1, 0),
        source.listAlbums(),
      ])
      if (request !== requestID.current) return
      setCurrentAlbum(null)
      setAlbums(nextAlbums)
      setItems(nextItems.slice(0, pageSize))
      setHasMore(nextItems.length > pageSize)
    } catch (loadError) {
      if (request !== requestID.current) return
      const message = errorMessage(loadError)
      setError(message)
      onError?.(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [onError, pageSize, source])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    const request = ++requestID.current
    setLoading(true)
    setError('')
    try {
      const nextItems = currentAlbum
        ? await source.listAlbumItems(currentAlbum.id, pageSize + 1, items.length)
        : await source.listItems(pageSize + 1, items.length)
      if (request !== requestID.current) return
      setItems((current) => [...current, ...nextItems.slice(0, pageSize)])
      setHasMore(nextItems.length > pageSize)
    } catch (loadError) {
      if (request !== requestID.current) return
      const message = errorMessage(loadError)
      setError(message)
      onError?.(loadError)
    } finally {
      if (request === requestID.current) setLoading(false)
    }
  }, [currentAlbum, hasMore, items.length, loading, onError, pageSize, source])

  useEffect(() => {
    void loadFirstPage(null)
    return () => {
      requestID.current += 1
    }
  }, [loadFirstPage])

  return (
    <XDriveMediaGallery
      items={items}
      albums={albums}
      currentAlbum={currentAlbum}
      loading={loading}
      hasMore={hasMore}
      error={error}
      loadThumbnail={source.loadThumbnail}
      loadLivePhotoMotion={source.loadLivePhotoMotion}
      onOpenAlbum={(album) => void loadFirstPage(album)}
      onBack={() => void loadFirstPage(null)}
      onLoadMore={() => void loadMore()}
      onRefresh={() => void loadFirstPage(currentAlbum)}
    />
  )
}

export interface XDriveMediaGalleryProps {
  items: MediaItem[]
  albums?: MediaAlbum[]
  currentAlbum?: MediaAlbum | null
  loading?: boolean
  hasMore?: boolean
  error?: string
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  onOpenAlbum?: (album: MediaAlbum) => void
  onBack?: () => void
  onLoadMore?: () => void
  onRefresh?: () => void
}

function revokeIfBlob(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

function AsyncThumbnail({
  nodeID,
  alt,
  loadThumbnail,
  fallback,
}: {
  nodeID?: number
  alt: string
  loadThumbnail: MediaThumbnailLoader
  fallback: ReactNode
}) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let resolved = ''
    setSrc('')
    setFailed(false)
    if (!nodeID) return () => undefined

    void loadThumbnail(nodeID)
      .then((value) => {
        if (!value) {
          if (active) setFailed(true)
          return
        }
        resolved = value
        if (active) setSrc(value)
        else revokeIfBlob(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (resolved) revokeIfBlob(resolved)
    }
  }, [loadThumbnail, nodeID])

  if (!nodeID || failed) return <>{fallback}</>
  if (!src) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      loading="lazy"
      sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
    />
  )
}

function mediaFallback(kind: MediaMetadata['media_kind']) {
  const Icon = kind === 'video' ? MovieIcon : ImageIcon
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: 'text.secondary',
        bgcolor: 'action.hover',
      }}
    >
      <Icon sx={{ fontSize: 42 }} />
    </Box>
  )
}

function formatDuration(durationMS?: number) {
  if (!durationMS || durationMS < 0) return ''
  const total = Math.round(durationMS / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

function orientationLabel(orientation?: number) {
  const labels: Record<number, string> = {
    1: '正常',
    2: '水平镜像',
    3: '旋转 180°',
    4: '垂直镜像',
    5: '转置',
    6: '顺时针 90°',
    7: '横向转置',
    8: '逆时针 90°',
  }
  return orientation ? (labels[orientation] || `EXIF ${orientation}`) : '—'
}

function keyboardActivate(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function MediaDetails({
  item,
  loadThumbnail,
  loadLivePhotoMotion,
  onClose,
}: {
  item: MediaItem | null
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  onClose: () => void
}) {
  const [motionURL, setMotionURL] = useState('')
  const [motionLoading, setMotionLoading] = useState(false)
  const [motionError, setMotionError] = useState('')

  useEffect(() => {
    let active = true
    let resolved = ''
    setMotionURL('')
    setMotionError('')
    setMotionLoading(false)
    if (!item?.live_photo || !loadLivePhotoMotion) return () => undefined

    setMotionLoading(true)
    void loadLivePhotoMotion(item.node.id)
      .then((value) => {
        if (!value) {
          if (active) setMotionError('实况视频暂不可用。')
          return
        }
        resolved = value
        if (active) setMotionURL(value)
        else revokeIfBlob(value)
      })
      .catch((loadError) => {
        if (active) setMotionError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setMotionLoading(false)
      })

    return () => {
      active = false
      if (resolved) revokeIfBlob(resolved)
    }
  }, [item?.live_photo, item?.node.id, loadLivePhotoMotion])

  const rows = useMemo(() => {
    if (!item) return []
    const metadata = item.metadata
    const result: Array<[string, string]> = [
      ['类型', item.live_photo ? '实况照片' : metadata.media_kind === 'video' ? '视频' : '图片'],
      ['文件名', item.node.name],
      ['大小', formatBytes(item.node.size)],
      ['格式', metadata.mime_type || '—'],
      [
        '分辨率',
        metadata.width && metadata.height
          ? `${metadata.width} × ${metadata.height}`
          : '—',
      ],
      ['方向', orientationLabel(metadata.orientation)],
      [
        '拍摄时间',
        metadata.captured_at
          ? new Date(metadata.captured_at).toLocaleString()
          : '—',
      ],
    ]
    if (metadata.media_kind === 'video') {
      result.push(
        ['视频旋转', metadata.rotation_degrees ? `${metadata.rotation_degrees}°` : '0°'],
        ['时长', formatDuration(metadata.duration_ms) || '—'],
        ['帧率', metadata.frame_rate ? `${metadata.frame_rate.toFixed(2)} fps` : '—'],
        ['码率', metadata.bit_rate ? `${(metadata.bit_rate / 1_000_000).toFixed(2)} Mbps` : '—'],
        ['视频编码', metadata.video_codec || '—'],
        ['音频编码', metadata.audio_codec || '—'],
      )
    }
    if (metadata.camera_make || metadata.camera_model) {
      result.push([
        '相机',
        [metadata.camera_make, metadata.camera_model].filter(Boolean).join(' '),
      ])
    }
    if (metadata.lens_model) result.push(['镜头', metadata.lens_model])
    if (metadata.latitude != null && metadata.longitude != null) {
      result.push([
        'GPS',
        `${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`,
      ])
    }
    if (metadata.altitude_m != null) {
      result.push(['海拔', `${metadata.altitude_m.toFixed(1)} m`])
    }
    if (metadata.thumbnail_width && metadata.thumbnail_height) {
      result.push([
        '缩略图',
        `${metadata.thumbnail_width} × ${metadata.thumbnail_height} · ${metadata.thumbnail_mime_type || 'image/jpeg'}`,
      ])
    }
    return result
  }, [item])

  return (
    <Dialog
      open={Boolean(item)}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle
        title="媒体信息"
        subtitle={item?.node.name}
        onClose={onClose}
      />
      <XDriveDialogContent dividers>
        {item ? (
          <Stack spacing={2}>
            <Box
              sx={{
                height: { xs: 220, sm: 320 },
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                overflow: 'hidden',
              }}
            >
              <AsyncThumbnail
                nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
                alt={item.node.name}
                loadThumbnail={loadThumbnail}
                fallback={mediaFallback(item.metadata.media_kind)}
              />
            </Box>
            {item.live_photo && loadLivePhotoMotion ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>实况视频</Typography>
                {motionLoading ? (
                  <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                ) : motionURL ? (
                  <video
                    src={motionURL}
                    controls
                    loop
                    playsInline
                    preload="metadata"
                    style={{
                      width: '100%',
                      maxHeight: 360,
                      display: 'block',
                      borderRadius: 8,
                      background: '#000',
                    }}
                  />
                ) : motionError ? (
                  <XDriveStatusAlert tone="warning">{motionError}</XDriveStatusAlert>
                ) : null}
              </Box>
            ) : null}
            {item.metadata.index_error ? (
              <XDriveStatusAlert tone="warning">
                部分媒体元数据未能解析：{item.metadata.index_error}
              </XDriveStatusAlert>
            ) : null}
            <Stack spacing={1.1}>
              {rows.map(([label, value]) => (
                <Box
                  key={label}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '88px minmax(0, 1fr)', sm: '112px minmax(0, 1fr)' },
                    gap: 2,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
                </Box>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </XDriveDialogContent>
    </Dialog>
  )
}

export function XDriveMediaGallery({
  items,
  albums = [],
  currentAlbum = null,
  loading = false,
  hasMore = false,
  error = '',
  loadThumbnail,
  loadLivePhotoMotion,
  onOpenAlbum,
  onBack,
  onLoadMore,
  onRefresh,
}: XDriveMediaGalleryProps) {
  const [selected, setSelected] = useState<MediaItem | null>(null)

  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {currentAlbum && onBack ? (
          <Tooltip title="返回全部图库">
            <IconButton onClick={onBack} size="small" aria-label="返回全部图库">
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" fontWeight={700} noWrap>
            {currentAlbum?.name || '图库'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {currentAlbum
              ? `${currentAlbum.item_count.toLocaleString('zh-CN')} 个项目`
              : '所有 xDrive 图片和视频，包括普通上传和同步文件夹文件'}
          </Typography>
        </Box>
        {onRefresh ? (
          <Tooltip title="刷新">
            <span>
              <IconButton
                onClick={onRefresh}
                disabled={loading}
                aria-label="刷新图库"
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>

      {error ? (
        <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>
      ) : null}

      {!currentAlbum && albums.length > 0 ? (
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
            相册
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 1.5,
            }}
          >
            {albums.map((album) => (
              <Paper
                key={album.id}
                variant="outlined"
                role={onOpenAlbum ? 'button' : undefined}
                tabIndex={onOpenAlbum ? 0 : undefined}
                onClick={() => onOpenAlbum?.(album)}
                onKeyDown={(event) => {
                  if (onOpenAlbum) keyboardActivate(event, () => onOpenAlbum(album))
                }}
                sx={{
                  overflow: 'hidden',
                  cursor: onOpenAlbum ? 'pointer' : 'default',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  '&:hover': onOpenAlbum
                    ? { transform: 'translateY(-1px)', boxShadow: 2 }
                    : undefined,
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  },
                }}
              >
                <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
                  <AsyncThumbnail
                    nodeID={album.cover_node_id}
                    alt={album.name}
                    loadThumbnail={loadThumbnail}
                    fallback={(
                      <Box
                        sx={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'action.hover',
                          color: 'text.secondary',
                        }}
                      >
                        <CollectionsIcon sx={{ fontSize: 44 }} />
                      </Box>
                    )}
                  />
                </Box>
                <Box sx={{ px: 1.5, py: 1.2 }}>
                  <Typography variant="body2" fontWeight={650} noWrap>
                    {album.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {album.item_count.toLocaleString('zh-CN')} 个项目
                    {album.kind === 'imported' ? ' · 导入相册' : ''}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : null}

      <Box>
        {!currentAlbum ? (
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
            所有照片和视频
          </Typography>
        ) : null}
        {loading && items.length === 0 ? (
          <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Paper
            variant="outlined"
            sx={{ minHeight: 180, display: 'grid', placeItems: 'center', p: 3 }}
          >
            <Stack alignItems="center" spacing={1}>
              <ImageIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography color="text.secondary">
                没有可显示的图片或视频
              </Typography>
            </Stack>
          </Paper>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 1,
            }}
          >
            {items.map((item) => {
              const video = item.metadata.media_kind === 'video'
              const livePhoto = Boolean(item.live_photo)
              return (
                <Paper
                  key={item.node.id}
                  variant="outlined"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(item)}
                  onKeyDown={(event) => keyboardActivate(event, () => setSelected(item))}
                  sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    aspectRatio: '1 / 1',
                    cursor: 'pointer',
                    bgcolor: 'action.hover',
                    '&:hover .media-name': { opacity: 1 },
                    '&:focus-visible': {
                      outline: '2px solid',
                      outlineColor: 'primary.main',
                      outlineOffset: 2,
                    },
                  }}
                >
                  <AsyncThumbnail
                    nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
                    alt={item.node.name}
                    loadThumbnail={loadThumbnail}
                    fallback={mediaFallback(item.metadata.media_kind)}
                  />
                  <Chip
                    icon={livePhoto ? <LivePhotoIcon /> : video ? <MovieIcon /> : <ImageIcon />}
                    label={
                      livePhoto
                        ? '实况'
                        : video && item.metadata.duration_ms
                          ? formatDuration(item.metadata.duration_ms)
                          : video
                            ? '视频'
                            : '图片'
                    }
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      bgcolor: 'rgba(0,0,0,.66)',
                      color: '#fff',
                      '& .MuiChip-icon': { color: '#fff' },
                    }}
                  />
                  <Box
                    className="media-name"
                    sx={{
                      position: 'absolute',
                      inset: 'auto 0 0',
                      px: 1,
                      pt: 2.5,
                      pb: 0.75,
                      opacity: { xs: 1, md: 0 },
                      transition: 'opacity 120ms ease',
                      background: 'linear-gradient(transparent, rgba(0,0,0,.72))',
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="#fff"
                      noWrap
                      display="block"
                    >
                      {item.node.name}
                    </Typography>
                  </Box>
                </Paper>
              )
            })}
          </Box>
        )}
      </Box>

      {hasMore && onLoadMore ? (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button variant="outlined" onClick={onLoadMore} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </Button>
        </Box>
      ) : null}

      <MediaDetails
        item={selected}
        loadThumbnail={loadThumbnail}
        loadLivePhotoMotion={loadLivePhotoMotion}
        onClose={() => setSelected(null)}
      />
    </Stack>
  )
}
