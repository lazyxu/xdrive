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
  DialogActions,
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
  setTags?: (nodeID: number, tags: string[]) => Promise<string[]>
  createAlbum?: (name: string) => Promise<MediaAlbum>
  createSmartAlbum?: (name: string, query: MediaGalleryQuery) => Promise<MediaAlbum>
  updateSmartAlbum?: (
    albumID: string,
    revision: number,
    input: { name?: string; query?: MediaGalleryQuery },
  ) => Promise<MediaAlbum>
  deleteSmartAlbum?: (albumID: string, revision: number) => Promise<void>
  renameAlbum?: (albumID: string, revision: number, name: string) => Promise<MediaAlbum>
  deleteAlbum?: (albumID: string, revision: number) => Promise<void>
  addToAlbum?: (albumID: string, revision: number, nodeIDs: number[]) => Promise<MediaAlbum>
  removeFromAlbum?: (albumID: string, revision: number, nodeID: number) => Promise<MediaAlbum>
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
  tag: string
}

const emptyMediaGalleryFilterDraft: MediaGalleryFilterDraft = {
  search: '',
  assetKind: '',
  capturedFrom: '',
  capturedTo: '',
  location: 'any',
  favorite: 'any',
  tag: '',
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
    ...(draft.tag.trim() ? { tag: draft.tag.trim() } : {}),
  }
}

function mediaGalleryDateInput(value?: string, exclusiveEnd = false) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  if (exclusiveEnd) date.setDate(date.getDate() - 1)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mediaGalleryDraftFromQuery(query: MediaGalleryQuery = {}): MediaGalleryFilterDraft {
  return {
    search: query.search || '',
    assetKind: query.asset_kind || '',
    capturedFrom: mediaGalleryDateInput(query.captured_from),
    capturedTo: mediaGalleryDateInput(query.captured_to, true),
    location: query.has_location === true
      ? 'with'
      : query.has_location === false
        ? 'without'
        : 'any',
    favorite: query.favorite === true
      ? 'favorite'
      : query.favorite === false
        ? 'not-favorite'
        : 'any',
    tag: query.tag || '',
  }
}

function hasMediaGalleryFilters(draft: MediaGalleryFilterDraft) {
  return Boolean(
    draft.search.trim() ||
    draft.assetKind ||
    draft.capturedFrom ||
    draft.capturedTo ||
    draft.location !== 'any' ||
    draft.favorite !== 'any' ||
    draft.tag.trim(),
  )
}

function MediaGalleryFilterBar({
  draft,
  loading,
  applyLabel = '应用',
  clearLabel = '清除',
  onChange,
  onApply,
  onClear,
  onSaveSmart,
}: {
  draft: MediaGalleryFilterDraft
  loading: boolean
  applyLabel?: string
  clearLabel?: string
  onChange: (next: MediaGalleryFilterDraft) => void
  onApply: () => void
  onClear: () => void
  onSaveSmart?: () => void
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
          size="small"
          label="标签"
          placeholder="精确标签"
          value={draft.tag}
          onChange={(event) => onChange({ ...draft, tag: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply()
          }}
          sx={{ minWidth: 140 }}
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
            {applyLabel}
          </Button>
          <Button
            variant="text"
            onClick={onClear}
            disabled={loading || !hasMediaGalleryFilters(draft)}
          >
            {clearLabel}
          </Button>
          {onSaveSmart ? (
            <Button
              variant="outlined"
              onClick={onSaveSmart}
              disabled={loading || !hasMediaGalleryFilters(draft)}
            >
              保存为智能相册
            </Button>
          ) : null}
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
  const [smartDialogOpen, setSmartDialogOpen] = useState(false)
  const [smartAlbumName, setSmartAlbumName] = useState('')
  const [smartDialogBusy, setSmartDialogBusy] = useState(false)
  const [smartDialogError, setSmartDialogError] = useState('')
  const requestID = useRef(0)

  const replaceAlbum = useCallback((next: MediaAlbum) => {
    setAlbums((current) => current.map((album) => album.id === next.id ? next : album))
    setCurrentAlbum((current) => current?.id === next.id ? next : current)
  }, [])

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
    if (currentAlbum?.kind === 'smart') {
      if (!source.updateSmartAlbum || !currentAlbum.revision) {
        setError('当前客户端不支持编辑智能相册')
        return
      }
      if (!hasMediaGalleryFilters(draftFilters)) {
        setError('智能相册至少需要一个筛选条件')
        return
      }
      setError('')
      void source.updateSmartAlbum(
        currentAlbum.id,
        currentAlbum.revision,
        { query: nextQuery },
      ).then(async (updated) => {
        replaceAlbum(updated)
        setDraftFilters(mediaGalleryDraftFromQuery(updated.query))
        setQuery({})
        await loadFirstPage(updated, {})
      }).catch((updateError) => {
        const message = errorMessage(updateError)
        setError(message)
        onError?.(updateError)
      })
      return
    }
    setQuery(nextQuery)
    void loadFirstPage(currentAlbum, nextQuery)
  }, [
    currentAlbum,
    draftFilters,
    loadFirstPage,
    onError,
    replaceAlbum,
    source,
  ])

  const clearFilters = useCallback(() => {
    if (currentAlbum?.kind === 'smart') {
      setDraftFilters(mediaGalleryDraftFromQuery(currentAlbum.query))
      setQuery({})
      void loadFirstPage(currentAlbum, {})
      return
    }
    setDraftFilters(emptyMediaGalleryFilterDraft)
    setQuery({})
    void loadFirstPage(currentAlbum, {})
  }, [currentAlbum, loadFirstPage])

  const createAlbum = useCallback(async (name: string) => {
    if (!source.createAlbum) throw new Error('当前客户端不支持创建相册')
    const created = await source.createAlbum(name)
    setAlbums((current) => [created, ...current.filter((album) => album.id !== created.id)])
    return created
  }, [source])

  const renameAlbum = useCallback(async (album: MediaAlbum, name: string) => {
    if (!album.revision) throw new Error('当前相册不可重命名')
    const updated = album.kind === 'smart'
      ? source.updateSmartAlbum
        ? await source.updateSmartAlbum(album.id, album.revision, { name })
        : (() => { throw new Error('当前客户端不支持编辑智能相册') })()
      : source.renameAlbum
        ? await source.renameAlbum(album.id, album.revision, name)
        : (() => { throw new Error('当前相册不可重命名') })()
    replaceAlbum(updated)
    return updated
  }, [replaceAlbum, source])

  const deleteAlbum = useCallback(async (album: MediaAlbum) => {
    if (!album.revision) throw new Error('当前相册不可删除')
    if (album.kind === 'smart') {
      if (!source.deleteSmartAlbum) throw new Error('当前客户端不支持删除智能相册')
      await source.deleteSmartAlbum(album.id, album.revision)
    } else {
      if (!source.deleteAlbum) throw new Error('当前相册不可删除')
      await source.deleteAlbum(album.id, album.revision)
    }
    setAlbums((current) => current.filter((value) => value.id !== album.id))
    if (currentAlbum?.id === album.id) {
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      await loadFirstPage(null, {})
    }
  }, [currentAlbum?.id, loadFirstPage, source])

  const addToAlbum = useCallback(async (album: MediaAlbum, item: MediaItem) => {
    if (!source.addToAlbum || !album.revision) throw new Error('当前相册不可编辑')
    const updated = await source.addToAlbum(album.id, album.revision, [item.node.id])
    replaceAlbum(updated)
    return updated
  }, [replaceAlbum, source])

  const removeFromAlbum = useCallback(async (album: MediaAlbum, item: MediaItem) => {
    if (!source.removeFromAlbum || !album.revision) throw new Error('当前相册不可编辑')
    const updated = await source.removeFromAlbum(album.id, album.revision, item.node.id)
    replaceAlbum(updated)
    if (currentAlbum?.id === album.id) {
      await loadFirstPage(updated, query)
    }
    return updated
  }, [currentAlbum?.id, loadFirstPage, query, replaceAlbum, source])

  const createSmartAlbum = useCallback(async (name: string) => {
    if (!source.createSmartAlbum) throw new Error('当前客户端不支持智能相册')
    if (!hasMediaGalleryFilters(draftFilters)) {
      throw new Error('至少需要一个筛选条件才能创建智能相册')
    }
    const created = await source.createSmartAlbum(
      name,
      mediaGalleryQueryFromDraft(draftFilters),
    )
    setAlbums((current) => [
      created,
      ...current.filter((album) => album.id !== created.id),
    ])
    return created
  }, [draftFilters, source])

  const openAlbum = useCallback((album: MediaAlbum) => {
    if (album.kind === 'smart') {
      setDraftFilters(mediaGalleryDraftFromQuery(album.query))
      setQuery({})
      void loadFirstPage(album, {})
      return
    }
    void loadFirstPage(album, query)
  }, [loadFirstPage, query])

  const leaveAlbum = useCallback(() => {
    if (currentAlbum?.kind === 'smart') {
      setDraftFilters(emptyMediaGalleryFilterDraft)
      setQuery({})
      void loadFirstPage(null, {})
      return
    }
    void loadFirstPage(null, query)
  }, [currentAlbum?.kind, loadFirstPage, query])

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
      if (
        query.favorite !== undefined ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.favorite !== undefined)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
        )
      }
    } catch (favoriteError) {
      const message = errorMessage(favoriteError)
      setError(message)
      onError?.(favoriteError)
      throw favoriteError
    }
  }, [currentAlbum, loadFirstPage, onError, query, source])


  const setTags = useCallback(async (
    item: MediaItem,
    tags: string[],
  ) => {
    if (!source.setTags) return item.tags || []
    setError('')
    try {
      const normalized = await source.setTags(item.node.id, tags)
      setItems((current) => current.map((value) => (
        value.node.id === item.node.id
          ? { ...value, tags: normalized }
          : value
      )))
      if (
        query.tag ||
        (currentAlbum?.kind === 'smart' && currentAlbum.query?.tag)
      ) {
        await loadFirstPage(
          currentAlbum,
          currentAlbum?.kind === 'smart' ? {} : query,
        )
      }
      return normalized
    } catch (tagError) {
      const message = errorMessage(tagError)
      setError(message)
      onError?.(tagError)
      throw tagError
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
            applyLabel={currentAlbum?.kind === 'smart' ? '保存规则' : '应用'}
            clearLabel={currentAlbum?.kind === 'smart' ? '还原规则' : '清除'}
            onChange={setDraftFilters}
            onApply={applyFilters}
            onClear={clearFilters}
            onSaveSmart={
              !currentAlbum && source.createSmartAlbum
                ? () => {
                    setSmartAlbumName('')
                    setSmartDialogError('')
                    setSmartDialogOpen(true)
                  }
                : undefined
            }
          />
        )}
        loadThumbnail={source.loadThumbnail}
        loadLivePhotoMotion={source.loadLivePhotoMotion}
        loadVideo={source.loadVideo}
        onSetFavorite={source.setFavorite ? setFavorite : undefined}
        onSetTags={source.setTags ? setTags : undefined}
        onCreateAlbum={source.createAlbum ? createAlbum : undefined}
        onRenameAlbum={
          source.renameAlbum || source.updateSmartAlbum
            ? renameAlbum
            : undefined
        }
        onDeleteAlbum={
          source.deleteAlbum || source.deleteSmartAlbum
            ? deleteAlbum
            : undefined
        }
        onAddToAlbum={source.addToAlbum ? addToAlbum : undefined}
        onRemoveFromAlbum={source.removeFromAlbum ? removeFromAlbum : undefined}
        onOpenAlbum={openAlbum}
        onBack={leaveAlbum}
        onLoadMore={() => void loadMore()}
        onRefresh={() => void loadFirstPage(currentAlbum, query)}
      />
      <Dialog
        open={smartDialogOpen}
        onClose={() => !smartDialogBusy && setSmartDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="保存为智能相册"
          subtitle="保存当前筛选条件；内容会随图库变化自动更新。"
          onClose={() => !smartDialogBusy && setSmartDialogOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="智能相册名称"
              value={smartAlbumName}
              onChange={(event) => {
                setSmartAlbumName(event.target.value)
                setSmartDialogError('')
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !smartAlbumName.trim() || smartDialogBusy) return
                event.preventDefault()
                setSmartDialogBusy(true)
                void createSmartAlbum(smartAlbumName.trim())
                  .then(() => setSmartDialogOpen(false))
                  .catch((createError) => setSmartDialogError(errorMessage(createError)))
                  .finally(() => setSmartDialogBusy(false))
              }}
            />
            {smartDialogError ? (
              <XDriveStatusAlert tone="bad">{smartDialogError}</XDriveStatusAlert>
            ) : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setSmartDialogOpen(false)} disabled={smartDialogBusy}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={!smartAlbumName.trim() || smartDialogBusy}
            onClick={() => {
              setSmartDialogBusy(true)
              setSmartDialogError('')
              void createSmartAlbum(smartAlbumName.trim())
                .then(() => setSmartDialogOpen(false))
                .catch((createError) => setSmartDialogError(errorMessage(createError)))
                .finally(() => setSmartDialogBusy(false))
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
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
  onSetTags?: (item: MediaItem, tags: string[]) => Promise<string[]>
  onCreateAlbum?: (name: string) => Promise<MediaAlbum>
  onRenameAlbum?: (album: MediaAlbum, name: string) => Promise<MediaAlbum>
  onDeleteAlbum?: (album: MediaAlbum) => Promise<void>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
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

function parseMediaTagsInput(value: string) {
  return value
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
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

type MediaGalleryViewMode = 'grid' | 'timeline'

type MediaTimelineGroup = {
  key: string
  label: string
  items: MediaItem[]
}

function mediaTimelineDate(item: MediaItem) {
  if (!item.metadata.captured_at) return null
  const captured = new Date(item.metadata.captured_at)
  return Number.isNaN(captured.getTime()) ? null : captured
}

function mediaTimelineGroups(items: MediaItem[]): MediaTimelineGroup[] {
  const groups = new Map<string, MediaTimelineGroup>()
  const unknown: MediaItem[] = []
  for (const item of items) {
    const date = mediaTimelineDate(item)
    if (!date) {
      unknown.push(item)
      continue
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      continue
    }
    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
      }).format(date),
      items: [item],
    })
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key))
  if (unknown.length > 0) {
    ordered.push({ key: 'unknown', label: '日期未知', items: unknown })
  }
  return ordered
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
  albums,
  currentAlbum,
  onSetFavorite,
  onSetTags,
  onAddToAlbum,
  onRemoveFromAlbum,
  onClose,
}: {
  item: MediaItem | null
  loadThumbnail: MediaThumbnailLoader
  loadLivePhotoMotion?: MediaMotionLoader
  loadVideo?: MediaVideoLoader
  albums: MediaAlbum[]
  currentAlbum?: MediaAlbum | null
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onSetTags?: (item: MediaItem, tags: string[]) => Promise<string[]>
  onAddToAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onRemoveFromAlbum?: (album: MediaAlbum, item: MediaItem) => Promise<MediaAlbum>
  onClose: () => void
}) {
  const [playbackURL, setPlaybackURL] = useState('')
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackError, setPlaybackError] = useState('')
  const [targetAlbumID, setTargetAlbumID] = useState('')
  const [albumBusy, setAlbumBusy] = useState(false)
  const [albumError, setAlbumError] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [tagsBusy, setTagsBusy] = useState(false)
  const [tagsError, setTagsError] = useState('')
  const tagsKey = (item?.tags || []).join('\u0000')
  const livePhoto = Boolean(item?.live_photo || item?.asset_kind === 'live_photo')
  const ordinaryVideo = Boolean(item?.metadata.media_kind === 'video' && !livePhoto)
  const animatedImage = Boolean(
    item?.metadata.media_kind === 'image' &&
      ['image/gif', 'image/webp'].includes((item.metadata.mime_type || '').toLowerCase()),
  )

  useEffect(() => {
    setTagsInput((item?.tags || []).join(', '))
    setTagsBusy(false)
    setTagsError('')
  }, [item?.node.id, tagsKey])

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
      ['标签', item.tags?.length ? item.tags.join('、') : '—'],
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
            {onSetTags ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>标签</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    fullWidth
                    label="标签"
                    placeholder="家庭, 旅行, 工作"
                    value={tagsInput}
                    disabled={tagsBusy}
                    onChange={(event) => {
                      setTagsInput(event.target.value)
                      setTagsError('')
                    }}
                    helperText="使用逗号分隔；最多 32 个标签。"
                  />
                  <Button
                    variant="outlined"
                    disabled={tagsBusy}
                    onClick={() => {
                      setTagsBusy(true)
                      setTagsError('')
                      void onSetTags(item, parseMediaTagsInput(tagsInput))
                        .then((tags) => setTagsInput(tags.join(', ')))
                        .catch((tagError) => setTagsError(errorMessage(tagError)))
                        .finally(() => setTagsBusy(false))
                    }}
                  >
                    保存标签
                  </Button>
                </Stack>
                {tagsError ? (
                  <Box sx={{ mt: 1 }}>
                    <XDriveStatusAlert tone="bad">{tagsError}</XDriveStatusAlert>
                  </Box>
                ) : null}
              </Box>
            ) : null}
            {(onAddToAlbum || (currentAlbum?.kind === 'manual' && onRemoveFromAlbum)) ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>相册</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  {onAddToAlbum ? (
                    <>
                      <TextField
                        select
                        size="small"
                        label="添加到手动相册"
                        value={targetAlbumID}
                        onChange={(event) => {
                          setTargetAlbumID(event.target.value)
                          setAlbumError('')
                        }}
                        sx={{ minWidth: 220, flex: 1 }}
                      >
                        <MenuItem value="">选择相册</MenuItem>
                        {albums.filter((album) => album.kind === 'manual').map((album) => (
                          <MenuItem key={album.id} value={album.id}>
                            {album.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        variant="outlined"
                        disabled={!targetAlbumID || albumBusy}
                        onClick={() => {
                          const album = albums.find((value) => value.id === targetAlbumID)
                          if (!album) return
                          setAlbumBusy(true)
                          setAlbumError('')
                          void onAddToAlbum(album, item)
                            .then(() => setTargetAlbumID(''))
                            .catch((error) => setAlbumError(errorMessage(error)))
                            .finally(() => setAlbumBusy(false))
                        }}
                      >
                        添加
                      </Button>
                    </>
                  ) : null}
                  {currentAlbum?.kind === 'manual' && onRemoveFromAlbum ? (
                    <Button
                      color="error"
                      variant="outlined"
                      disabled={albumBusy}
                      onClick={() => {
                        setAlbumBusy(true)
                        setAlbumError('')
                        void onRemoveFromAlbum(currentAlbum, item)
                          .catch((error) => setAlbumError(errorMessage(error)))
                          .finally(() => setAlbumBusy(false))
                      }}
                    >
                      从当前相册移除
                    </Button>
                  ) : null}
                </Stack>
                {albumError ? (
                  <Box sx={{ mt: 1 }}>
                    <XDriveStatusAlert tone="bad">{albumError}</XDriveStatusAlert>
                  </Box>
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

type MediaTileProps = {
  item: MediaItem
  loadThumbnail: MediaThumbnailLoader
  loadVideo?: MediaVideoLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onOpen: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
}

function MediaTile({
  item,
  loadThumbnail,
  loadVideo,
  onSetFavorite,
  onOpen,
  onToggleFavorite,
}: MediaTileProps) {
  const video = item.metadata.media_kind === 'video'
  const livePhoto = Boolean(item.live_photo || item.asset_kind === 'live_photo')
  return (
    <Paper
      variant="outlined"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => keyboardActivate(event, () => onOpen(item))}
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
              onToggleFavorite(item)
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
        <Typography variant="caption" color="#fff" noWrap display="block">
          {item.node.name}
        </Typography>
      </Box>
    </Paper>
  )
}

function MediaTileGrid({
  items,
  loadThumbnail,
  loadVideo,
  onSetFavorite,
  onOpen,
  onToggleFavorite,
}: {
  items: MediaItem[]
  loadThumbnail: MediaThumbnailLoader
  loadVideo?: MediaVideoLoader
  onSetFavorite?: (item: MediaItem, favorite: boolean) => Promise<void>
  onOpen: (item: MediaItem) => void
  onToggleFavorite: (item: MediaItem) => void
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 1,
      }}
    >
      {items.map((item) => (
        <MediaTile
          key={item.node.id}
          item={item}
          loadThumbnail={loadThumbnail}
          loadVideo={loadVideo}
          onSetFavorite={onSetFavorite}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </Box>
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
  onSetTags,
  onCreateAlbum,
  onRenameAlbum,
  onDeleteAlbum,
  onAddToAlbum,
  onRemoveFromAlbum,
  onOpenAlbum,
  onBack,
  onLoadMore,
  onRefresh,
}: XDriveMediaGalleryProps) {
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [viewMode, setViewMode] = useState<MediaGalleryViewMode>('grid')
  const [albumDialog, setAlbumDialog] = useState<{ mode: 'create' | 'rename'; album?: MediaAlbum } | null>(null)
  const [albumName, setAlbumName] = useState('')
  const [albumDialogBusy, setAlbumDialogBusy] = useState(false)
  const [albumDialogError, setAlbumDialogError] = useState('')
  const [deleteAlbumOpen, setDeleteAlbumOpen] = useState(false)

  const openAlbumDialog = (mode: 'create' | 'rename', album?: MediaAlbum) => {
    setAlbumDialog({ mode, album })
    setAlbumName(album?.name || '')
    setAlbumDialogError('')
  }

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

  const timelineGroups = useMemo(() => mediaTimelineGroups(items), [items])
  const openMediaItem = useCallback((item: MediaItem) => setSelected(item), [])
  const toggleMediaFavorite = useCallback((item: MediaItem) => {
    void toggleFavorite(item).catch(() => undefined)
  }, [toggleFavorite])

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
        {!currentAlbum && onCreateAlbum ? (
          <Button size="small" variant="outlined" onClick={() => openAlbumDialog('create')}>
            新建相册
          </Button>
        ) : null}
        {(currentAlbum?.kind === 'manual' || currentAlbum?.kind === 'smart') && onRenameAlbum ? (
          <Button size="small" variant="text" onClick={() => openAlbumDialog('rename', currentAlbum)}>
            重命名
          </Button>
        ) : null}
        {(currentAlbum?.kind === 'manual' || currentAlbum?.kind === 'smart') && onDeleteAlbum ? (
          <Button size="small" color="error" variant="text" onClick={() => setDeleteAlbumOpen(true)}>
            删除相册
          </Button>
        ) : null}
        <Stack direction="row" spacing={0.5} aria-label="图库视图">
          <Button
            size="small"
            variant={viewMode === 'grid' ? 'contained' : 'text'}
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          >
            网格
          </Button>
          <Button
            size="small"
            variant={viewMode === 'timeline' ? 'contained' : 'text'}
            aria-pressed={viewMode === 'timeline'}
            onClick={() => setViewMode('timeline')}
          >
            时间轴
          </Button>
        </Stack>
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
                    {album.kind === 'imported'
                      ? ' · 导入相册'
                      : album.kind === 'manual'
                        ? ' · 手动相册'
                        : album.kind === 'smart'
                          ? ' · 智能相册'
                          : ''}
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
        ) : viewMode === 'timeline' ? (
          <Stack spacing={2.5}>
            {timelineGroups.map((group) => (
              <Box key={group.key}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="baseline"
                  sx={{ mb: 1 }}
                >
                  <Typography variant="subtitle1" fontWeight={700}>
                    {group.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {group.items.length.toLocaleString('zh-CN')} 项
                  </Typography>
                </Stack>
                <MediaTileGrid
                  items={group.items}
                  loadThumbnail={loadThumbnail}
                  loadVideo={loadVideo}
                  onSetFavorite={onSetFavorite}
                  onOpen={openMediaItem}
                  onToggleFavorite={toggleMediaFavorite}
                />
              </Box>
            ))}
          </Stack>
        ) : (
          <MediaTileGrid
            items={items}
            loadThumbnail={loadThumbnail}
            loadVideo={loadVideo}
            onSetFavorite={onSetFavorite}
            onOpen={openMediaItem}
            onToggleFavorite={toggleMediaFavorite}
          />
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
        albums={albums}
        currentAlbum={currentAlbum}
        onAddToAlbum={onAddToAlbum}
        onRemoveFromAlbum={onRemoveFromAlbum}
        onSetFavorite={onSetFavorite ? async (item, favorite) => {
          await onSetFavorite(item, favorite)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, favorite }
              : current
          ))
        } : undefined}
        onSetTags={onSetTags ? async (item, tags) => {
          const normalized = await onSetTags(item, tags)
          setSelected((current) => (
            current?.node.id === item.node.id
              ? { ...current, tags: normalized }
              : current
          ))
          return normalized
        } : undefined}
        onClose={() => setSelected(null)}
      />
      <Dialog
        open={Boolean(albumDialog)}
        onClose={() => !albumDialogBusy && setAlbumDialog(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={albumDialog?.mode === 'rename' ? '重命名相册' : '新建相册'}
          onClose={() => !albumDialogBusy && setAlbumDialog(null)}
        />
        <XDriveDialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="相册名称"
              value={albumName}
              onChange={(event) => {
                setAlbumName(event.target.value)
                setAlbumDialogError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && albumName.trim() && !albumDialogBusy) {
                  event.preventDefault()
                  const task = albumDialog?.mode === 'rename' && albumDialog.album && onRenameAlbum
                    ? onRenameAlbum(albumDialog.album, albumName.trim())
                    : onCreateAlbum
                      ? onCreateAlbum(albumName.trim())
                      : Promise.reject(new Error('当前客户端不支持相册编辑'))
                  setAlbumDialogBusy(true)
                  void task
                    .then(() => setAlbumDialog(null))
                    .catch((error) => setAlbumDialogError(errorMessage(error)))
                    .finally(() => setAlbumDialogBusy(false))
                }
              }}
            />
            {albumDialogError ? <XDriveStatusAlert tone="bad">{albumDialogError}</XDriveStatusAlert> : null}
          </Stack>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setAlbumDialog(null)} disabled={albumDialogBusy}>取消</Button>
          <Button
            variant="contained"
            disabled={!albumName.trim() || albumDialogBusy}
            onClick={() => {
              const task = albumDialog?.mode === 'rename' && albumDialog.album && onRenameAlbum
                ? onRenameAlbum(albumDialog.album, albumName.trim())
                : onCreateAlbum
                  ? onCreateAlbum(albumName.trim())
                  : Promise.reject(new Error('当前客户端不支持相册编辑'))
              setAlbumDialogBusy(true)
              setAlbumDialogError('')
              void task
                .then(() => setAlbumDialog(null))
                .catch((error) => setAlbumDialogError(errorMessage(error)))
                .finally(() => setAlbumDialogBusy(false))
            }}
          >
            {albumDialog?.mode === 'rename' ? '保存' : '创建'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteAlbumOpen}
        onClose={() => !albumDialogBusy && setDeleteAlbumOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="删除相册"
          onClose={() => !albumDialogBusy && setDeleteAlbumOpen(false)}
        />
        <XDriveDialogContent dividers>
          <Typography variant="body2">
            {currentAlbum?.kind === 'smart'
              ? `删除智能相册“${currentAlbum?.name || ''}”只会删除保存的筛选规则，不会删除照片或视频。`
              : `删除手动相册“${currentAlbum?.name || ''}”只会删除相册关系，不会删除其中的照片或视频。`}
          </Typography>
        </XDriveDialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAlbumOpen(false)} disabled={albumDialogBusy}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!currentAlbum || albumDialogBusy || !onDeleteAlbum}
            onClick={() => {
              if (!currentAlbum || !onDeleteAlbum) return
              setAlbumDialogBusy(true)
              void onDeleteAlbum(currentAlbum)
                .then(() => setDeleteAlbumOpen(false))
                .catch((error) => setAlbumDialogError(errorMessage(error)))
                .finally(() => setAlbumDialogBusy(false))
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

    </Stack>
  )
}
