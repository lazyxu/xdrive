import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowBack as ArrowBackIcon,
  Collections as CollectionsIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  PlayCircleOutline as LivePhotoIcon,
  Refresh as RefreshIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type {
  MediaAlbum,
  MediaGalleryQuery,
  MediaItem,
  MediaMetadata,
} from '../models'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export type MediaThumbnailLoader = (nodeID: number) => Promise<string | null>
export type MediaMotionLoader = (nodeID: number) => Promise<string | null>
export type MediaVideoLoader = (nodeID: number) => Promise<string | null>

export interface MediaGalleryDataSource {
  listItems: (
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  listAlbums: () => Promise<MediaAlbum[]>
  listAlbumItems: (
    albumID: string,
    limit: number,
    offset: number,
    query?: MediaGalleryQuery,
  ) => Promise<MediaItem[]>
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadVideo?: MediaVideoLoader
  setFavorite?: (nodeID: number, favorite: boolean) => Promise<void>
}

export interface XDriveMediaGalleryPageProps {
  source: MediaGalleryDataSource
  pageSize?: number
  onError?: (error: unknown) => void
}

type MediaGalleryFilterDraft = {
  search: string
  assetKind: string
  capturedFrom: string
  capturedTo: string
  location: 'any' | 'with' | 'without'
  favorite: 'any' | 'favorite' | 'not-favorite'
}

const emptyMediaGalleryFilterDraft: MediaGalleryFilterDraft = {
  search: '',
  assetKind: '',
  capturedFrom: '',
  capturedTo: '',
  location: 'any',
  favorite: 'any',
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  const value = String(error ?? '').trim()
  return value && value !== '[object Object]' ? value : '图库加载失败'
}

function localDateBoundaryISO(value: string, exclusiveEnd = false) {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return undefined
  if (exclusiveEnd) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function mediaGalleryQueryFromDraft(draft: MediaGalleryFilterDraft): MediaGalleryQuery {
  const search = draft.search.trim()
  return {
    ...(search ? { search } : {}),
    ...(draft.assetKind ? { asset_kind: draft.assetKind } : {}),
    ...(draft.capturedFrom
      ? { captured_from: localDateBoundaryISO(draft.capturedFrom) }
      : {}),
    ...(draft.capturedTo
      ? { captured_to: localDateBoundaryISO(draft.capturedTo, true) }
      : {}),
    ...(draft.location === 'with'
      ? { has_location: true }
      : draft.location === 'without'
        ? { has_location: false }
        : {}),
    ...(draft.favorite === 'favorite'
      ? { favorite: true }
      : draft.favorite === 'not-favorite'
        ? { favorite: false }
        : {}),
  }
}

function hasMediaGalleryFilters(draft: MediaGalleryFilterDraft) {
  return Boolean(
    draft.search.trim() ||
    draft.assetKind ||
    draft.capturedFrom ||
    draft.capturedTo ||
    draft.location !== 'any' ||
    draft.favorite !== 'any',
  )
}

function MediaGalleryFilterBar({
  draft,
  loading,
  onChange,
  onApply,
  onClear,
}: {
  draft: MediaGalleryFilterDraft
  loading: boolean
  onChange: (next: MediaGalleryFilterDraft) => void
  onApply: () => void
  onClear: () => void
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', lg: 'center' }}
      >
        <TextField
          size="small"
          label="搜索"
          placeholder="文件名、相机或镜头"
          value={draft.search}
          onChange={(event) => onChange({ ...draft, search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply()
          }}
          sx={{ minWidth: { lg: 240 }, flex: { lg: 1 } }}
        />
        <TextField
          select
          size="small"
          label="资产类型"
          value={draft.assetKind}
          onChange={(event) => onChange({ ...draft, assetKind: event.target.value })}
          sx={{ minWidth: 132 }}
        >
          <MenuItem value="">全部</MenuItem>
          <MenuItem value="image">图片</MenuItem>
          <MenuItem value="video">视频</MenuItem>
          <MenuItem value="live_photo">实况照片</MenuItem>
          <MenuItem value="raw_pair">RAW 组合</MenuItem>
          <MenuItem value="burst">连拍</MenuItem>
          <MenuItem value="sidecar">编辑组合</MenuItem>
        </TextField>
        <TextField
          size="small"
          type="date"
          label="拍摄自"
          value={draft.capturedFrom}
          onChange={(event) => onChange({ ...draft, capturedFrom: event.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 150 }}
        />
        <TextField
          size="small"
          type="date"
          label="拍摄至"
          value={draft.capturedTo}
          onChange={(event) => onChange({ ...draft, capturedTo: event.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ minWidth: 150 }}
        />
        <TextField
          select
          size="small"
          label="位置"
          value={draft.location}
          onChange={(event) => onChange({
            ...draft,
            location: event.target.value as MediaGalleryFilterDraft['location'],
          })}
          sx={{ minWidth: 116 }}
        >
          <MenuItem value="any">全部</MenuItem>
          <MenuItem value="with">有 GPS</MenuItem>
          <MenuItem value="without">无 GPS</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="收藏"
          value={draft.favorite}
          onChange={(event) => onChange({
            ...draft,
            favorite: event.target.value as MediaGalleryFilterDraft['favorite'],
          })}
          sx={{ minWidth: 116 }}
        >
          <MenuItem value="any">全部</MenuItem>
          <MenuItem value="favorite">已收藏</MenuItem>
          <MenuItem value="not-favorite">未收藏</MenuItem>
        </TextField>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={onApply} disabled={loading}>
            应用
          </Button>
          <Button
            variant="text"
            onClick={onClear}
            disabled={loading || !hasMediaGalleryFilters(draft)}
          >
            清除
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

export function XDriveMediaGalleryPage({
  source,
  pageSize = 100,
  onError,
}: XDriveMediaGalleryPageProps) {
  const [albums, setAlbums] = useState<MediaAlbum[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [currentAlbum, setCurrentAlbum] = useState<MediaAlbum | null>(null)
  const [draftFilters, setDraftFilters] = useState<MediaGalleryFilterDraft>(
    emptyMediaGalleryFilterDraft,
  )
  const [query, setQuery] = useState<MediaGalleryQuery>({})
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)

  const loadFirstPage = useCallback(async (
    album: MediaAlbum | null,
    nextQuery: MediaGalleryQuery,
  ) => {
    const request = ++requestID.current
    setLoading(true)
    setError('')
    try {
      if (album) {
        const nextItems = await source.listAlbumItems(
          album.id,
          pageSize + 1,
          0,
          nextQuery,
        )
        if (request !== requestID.current) return
        setCurrentAlbum(album)
        setItems(nextItems.slice(0, pageSize))
        setHasMore(nextItems.length > pageSize)
        return
      }
      const [nextItems, nextAlbums] = await Promise.all([
        source.listItems(pageSize + 1, 0, nextQuery),
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
        ? await source.listAlbumItems(
            currentAlbum.id,
            pageSize + 1,
            items.length,
            query,
          )
        : await source.listItems(pageSize + 1, items.length, query)
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
  }, [currentAlbum, hasMore, items.length, loading, onError, pageSize, query, source])

  const applyFilters = useCallback(() => {
    const nextQuery = mediaGalleryQueryFromDraft(draftFilters)
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery)
  }, [currentAlbum, draftFilters, loadFirstPage])

  const clearFilters = useCallback(() => {
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(currentAlbum, {})
  }, [currentAlbum, loadFirstPage])

  const setFavorite = useCallback(async (
    item: MediaItem,
    favorite: boolean,
  ) => {
    if (!source.setFavorite) return
    setError('')
    try {
      await source.setFavorite(item.node.id, favorite)
      setItems((current) => current.map((value) => (
        value.node.id === item.node.id
          ? { ...value, favorite }
          : value
      )))
      if (query.favorite !== undefined) {
        await loadFirstPage(currentAlbum, query)
      }
    } catch (favoriteError) {
      const message = errorMessage(favoriteError)
      setError(message)
      onError?.(favoriteError)
      throw favoriteError
    }
  }, [currentAlbum, loadFirstPage, onError, query, source])

  useEffect(() => {
    void loadFirstPage(null, {})
    return () => {
      requestID.current += 1
    }
  }, [loadFirstPage])

  return (
    <XDriveWorkspaceSurface presentation="page" title="图库">
      <XDriveMediaGallery
        items={items}
        albums={albums}
        currentAlbum={currentAlbum}
        loading={loading}
        hasMore={hasMore}
        error={error}
        filters={(
          <MediaGalleryFilterBar
            draft={draftFilters}
            loading={loading}
            onChange={setDraftFilters}
            onApply={applyFilters}
            onClear={clearFilters}
          />
        )}
        loadThumbnail={source.loadThumbnail}
        loadLivePhotoMotion={source.loadLivePhotoMotion}
        loadVideo={source.loadVideo}
        onSetFavorite={source.setFavorite ? setFavorite : undefined}
        onOpenAlbum={(album) => void loadFirstPage(album, query)}
        onBack={() => void loadFirstPage(null, query)}
        onLoadMore={() => void loadMore()}
        onRefresh={() => void loadFirstPage(currentAlbum, query)}
      />
    </XDriveWorkspaceSurface>
  )
}

export interface XDriveMediaGalleryProps {
  items: MediaItem[]
  albums?: MediaAlbum[]
  currentAlbum?: MediaAlbum | null
  loading?: boolean
  hasMore?: boolean
  error?: string
  filters?: ReactNode
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadVideo?: MediaVideoLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
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

const mediaPosterConcurrency = 3
let mediaPosterActive = 0
const mediaPosterQueue: Array<() => void> = []

function scheduleMediaPoster<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      mediaPosterActive += 1
      void task()
        .then(resolve, reject)
        .finally(() => {
          mediaPosterActive = Math.max(0, mediaPosterActive - 1)
          mediaPosterQueue.shift()?.()
        })
    }
    if (mediaPosterActive < mediaPosterConcurrency) run()
    else mediaPosterQueue.push(run)
  })
}

async function captureVideoPoster(
  nodeID: number,
  loadVideo: MediaVideoLoader,
): Promise<string | null> {
  const source = await loadVideo(nodeID)
  if (!source) return null

  return new Promise<string | null>((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      revokeIfBlob(source)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), 15_000)

    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('loadeddata', () => {
      try {
        if (video.videoWidth < 1 || video.videoHeight < 1) {
          finish(null)
          return
        }
        const maxEdge = 512
        const scale = Math.min(
          1,
          maxEdge / Math.max(video.videoWidth, video.videoHeight),
        )
        const width = Math.max(1, Math.round(video.videoWidth * scale))
        const height = Math.max(1, Math.round(video.videoHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          finish(null)
          return
        }
        context.drawImage(video, 0, 0, width, height)
        finish(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        finish(null)
      }
    }, { once: true })
    video.addEventListener('error', () => finish(null), { once: true })
    video.src = source
    video.load()
  })
}

function AsyncVideoPoster({
  nodeID,
  alt,
  loadVideo,
  fallback,
}: {
  nodeID: number
  alt: string
  loadVideo: MediaVideoLoader
  fallback: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState('')

  useEffect(() => {
    setVisible(false)
    const root = rootRef.current
    if (!root) return () => undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return () => undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(root)
    return () => observer.disconnect()
  }, [nodeID])

  useEffect(() => {
    let active = true
    setSrc('')
    if (!visible) return () => { active = false }

    void scheduleMediaPoster(() => captureVideoPoster(nodeID, loadVideo))
      .then((value) => {
        if (active && value) setSrc(value)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [loadVideo, nodeID, visible])

  return (
    <Box ref={rootRef} sx={{ width: '100%', height: '100%' }}>
      {src ? (
        <Box
          component="img"
          src={src}
          alt={alt}
          sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
        />
      ) : (
        fallback
      )}
    </Box>
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

function mediaAssetLabel(item: MediaItem) {
  if (item.live_photo || item.asset_kind === 'live_photo') return '实况照片'
  switch (item.asset_kind) {
    case 'raw_pair':
      return 'RAW 组合'
    case 'burst':
      return '连拍'
    case 'sidecar':
      return '编辑组合'
    case 'video':
      return '视频'
    case 'image':
      return '图片'
    default:
      return item.metadata.media_kind === 'video' ? '视频' : '图片'
  }
}

function mediaAssetChipLabel(item: MediaItem) {
  if (item.live_photo || item.asset_kind === 'live_photo') return '实况'
  switch (item.asset_kind) {
    case 'raw_pair':
      return 'RAW'
    case 'burst':
      return '连拍'
    case 'sidecar':
      return '组合'
    default:
      if (item.metadata.media_kind === 'video') {
        return item.metadata.duration_ms
          ? formatDuration(item.metadata.duration_ms)
          : '视频'
      }
      return '图片'
  }
}

function mediaResourceRoleLabel(role: string) {
  switch (role) {
    case 'primary':
      return '主资源'
    case 'still':
      return '静态照片'
    case 'motion':
      return '动态视频'
    case 'raw':
      return 'RAW'
    case 'rendered':
      return '渲染照片'
    case 'sidecar':
      return 'Sidecar'
    case 'container':
      return '原始容器'
    case 'auxiliary':
      return '辅助资源'
    default:
      return role || '资源'
  }
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
  loadVideo,
  onSetFavorite,
  onClose,
}: {
  item: MediaItem | null
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadVideo?: MediaVideoLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onClose: () => void
}) {
  const [playbackURL, setPlaybackURL] = useState('')
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackError, setPlaybackError] = useState('')
  const livePhoto = Boolean(item?.live_photo || item?.asset_kind === 'live_photo')
  const ordinaryVideo = Boolean(item?.metadata.media_kind === 'video' && !livePhoto)
  const animatedImage = Boolean(
    item?.metadata.media_kind === 'image' &&
      ['image/gif', 'image/webp'].includes((item.metadata.mime_type || '').toLowerCase()),
  )

  useEffect(() => {
    let active = true
    let resolved = ''
    setPlaybackURL('')
    setPlaybackError('')
    setPlaybackLoading(false)

    const loader = livePhoto
      ? loadLivePhotoMotion
      : ordinaryVideo || animatedImage
        ? loadVideo
        : undefined
    if (!item || !loader) return () => undefined

    setPlaybackLoading(true)
    void loader(item.node.id)
      .then((value) => {
        if (!value) {
          if (active) {
            setPlaybackError(
              livePhoto
                ? '实况视频暂不可用。'
                : ordinaryVideo
                  ? '视频暂不可播放。'
                  : '动图暂不可播放。',
            )
          }
          return
        }
        resolved = value
        if (active) setPlaybackURL(value)
        else revokeIfBlob(value)
      })
      .catch((loadError) => {
        if (active) setPlaybackError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setPlaybackLoading(false)
      })

    return () => {
      active = false
      if (resolved) revokeIfBlob(resolved)
    }
  }, [
    item,
    livePhoto,
    ordinaryVideo,
    animatedImage,
    loadLivePhotoMotion,
    loadVideo,
  ])

  const rows = useMemo(() => {
    if (!item) return []
    const metadata = item.metadata
    const result: Array<[string, string]> = [
      ['类型', mediaAssetLabel(item)],
      ['收藏', item.favorite ? '已收藏' : '未收藏'],
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
    if (item.resources && item.resources.length > 1) {
      result.push(['资源数', String(item.resources.length)])
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
            {(livePhoto && loadLivePhotoMotion) ||
            ((ordinaryVideo || animatedImage) && loadVideo) ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {livePhoto ? '实况视频' : ordinaryVideo ? '视频播放' : '动图预览'}
                </Typography>
                {playbackLoading ? (
                  <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                  </Box>
                ) : playbackURL ? (
                  livePhoto || ordinaryVideo ? (
                    <video
                      src={playbackURL}
                      controls
                      loop={livePhoto}
                      playsInline
                      preload="metadata"
                      style={{
                        width: '100%',
                        maxHeight: 420,
                        display: 'block',
                        borderRadius: 8,
                        background: '#000',
                      }}
                    />
                  ) : (
                    <Box
                      component="img"
                      src={playbackURL}
                      alt={item.node.name}
                      sx={{
                        width: '100%',
                        maxHeight: 420,
                        display: 'block',
                        objectFit: 'contain',
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                      }}
                    />
                  )
                ) : playbackError ? (
                  <XDriveStatusAlert tone="warning">{playbackError}</XDriveStatusAlert>
                ) : null}
              </Box>
            ) : null}
            {onSetFavorite ? (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  variant={item.favorite ? 'contained' : 'outlined'}
                  startIcon={item.favorite ? <StarIcon /> : <StarBorderIcon />}
                  onClick={() => {
                    void onSetFavorite(item, !item.favorite).catch(() => undefined)
                  }}
                >
                  {item.favorite ? '取消收藏' : '收藏'}
                </Button>
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
            {item.resources && item.resources.length > 1 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>资产资源</Typography>
                <Stack spacing={0.75}>
                  {item.resources.map((resource, index) => (
                    <Box
                      key={`${resource.kind}:${resource.node_id}:${resource.role}:${index}`}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '88px minmax(0, 1fr)', sm: '112px minmax(0, 1fr)' },
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {mediaResourceRoleLabel(resource.role)}
                      </Typography>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {resource.name}
                        {resource.mime_type ? ` · ${resource.mime_type}` : ''}
                        {resource.size > 0 ? ` · ${formatBytes(resource.size)}` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
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
  filters,
  loadThumbnail,
  loadLivePhotoMotion,
  loadVideo,
  onSetFavorite,
  onOpenAlbum,
  onBack,
  onLoadMore,
  onRefresh,
}: XDriveMediaGalleryProps) {
  const [selected, setSelected] = useState<MediaItem | null>(null)

  const toggleFavorite = useCallback(async (item: MediaItem) => {
    if (!onSetFavorite) return
    const favorite = !item.favorite
    await onSetFavorite(item, favorite)
    setSelected((current) => (
      current?.node.id === item.node.id
        ? { ...current, favorite }
        : current
    ))
  }, [onSetFavorite])

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

      {filters}

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
              const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
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
                  {video && !livePhoto && loadVideo ? (
                    <AsyncVideoPoster
                      nodeID={item.node.id}
                      alt={item.node.name}
                      loadVideo={loadVideo}
                      fallback={mediaFallback(item.metadata.media_kind)}
                    />
                  ) : (
                    <AsyncThumbnail
                      nodeID={item.metadata.has_thumbnail ? item.node.id : undefined}
                      alt={item.node.name}
                      loadThumbnail={loadThumbnail}
                      fallback={mediaFallback(item.metadata.media_kind)}
                    />
                  )}
                  {onSetFavorite ? (
                    <Tooltip title={item.favorite ? '取消收藏' : '收藏'}>
                      <IconButton
                        size="small"
                        aria-label={item.favorite ? '取消收藏' : '收藏'}
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleFavorite(item).catch(() => undefined)
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          bgcolor: 'rgba(0,0,0,.66)',
                          color: item.favorite ? 'warning.main' : '#fff',
                          '&:hover': { bgcolor: 'rgba(0,0,0,.78)' },
                        }}
                      >
                        {item.favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  <Chip
                    icon={livePhoto ? <LivePhotoIcon /> : video ? <MovieIcon /> : <ImageIcon />}
                    label={mediaAssetChipLabel(item)}
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
        loadVideo={loadVideo}
        onSetFavorite={onSetFavorite ? async (item, favorite) => {
          await onSetFavorite(item, favorite)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, favorite }
              : current
          ))
        } : undefined}
        onClose={() => setSelected(null)}
      />
    </Stack>
  )
}
