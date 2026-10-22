import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import type {
  MediaGalleryQuery, MediaPlaceHierarchyItem, MediaPlaceHierarchyPage,
  MediaPlaceHierarchyRequest,
} from '../models'
import type { MediaThumbnailLoader } from './MediaGallery'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import { xDriveValidMediaPlaceHierarchyPage } from '../media-gallery-places-hierarchy-validation'

type HierarchyLevel = MediaPlaceHierarchyRequest['level']
type HierarchyNavigation = {
  level: HierarchyLevel
  country?: string
  region?: string
  countryName?: string
  regionName?: string
  search: string
  cursor: string
  previous: string[]
  focusedID?: string
}
type HierarchySnapshot = { filterKey: string; state: HierarchyNavigation; datasetVersion: string }
const PAGE_LIMIT = 48
const SNAPSHOT_LIMIT = 32
// Only navigation identities are remembered, never Owner photos, covers,
// counts, or resolver responses. Restored pages always recheck Server ACL.
const rememberedPlaces = new Map<string, HierarchySnapshot>()
const root = (): HierarchyNavigation => ({
  level: 'country', search: '', cursor: '', previous: [],
})

function remember(scope: string, filterKey: string, state: HierarchyNavigation, datasetVersion = '') {
  if (!scope) return
  rememberedPlaces.delete(scope)
  rememberedPlaces.set(scope, { filterKey, datasetVersion, state: {
    ...state, previous: state.previous.slice(-128),
  } })
  if (rememberedPlaces.size > SNAPSHOT_LIMIT) {
    const oldest = rememberedPlaces.keys().next().value
    if (oldest !== undefined) rememberedPlaces.delete(oldest)
  }
}

function restore(scope: string, filterKey: string): HierarchyNavigation {
  const saved = rememberedPlaces.get(scope)
  return saved?.filterKey === filterKey
    ? { ...saved.state, previous: [...saved.state.previous] } : root()
}

/**
 * Shared Owner hierarchy for wide Web, compact Mobile Web and Electron.
 * Every level is one 48-item page, never a growing browser-side GPS list.
 */
export function XDriveMediaGalleryPlacesHierarchy({
  scope, listPage, query, loadThumbnail, onOpenPhotoRange,
}: {
  scope: string
  listPage: (
    request: MediaPlaceHierarchyRequest, filters?: MediaGalleryQuery, signal?: AbortSignal,
  ) => Promise<MediaPlaceHierarchyPage>
  query?: MediaGalleryQuery
  loadThumbnail: MediaThumbnailLoader
  onOpenPhotoRange: (place: MediaPlaceHierarchyItem) => void
}) {
  const filters = useMemo<MediaGalleryQuery>(() => ({
    ...query,
    place: undefined, place_hierarchy: undefined, nearby: undefined,
    bbox: undefined, anchor_node_id: undefined, initial_position: undefined,
    has_location: true,
  }), [query])
  const filterKey = JSON.stringify(filters)
  const first = useRef<HierarchyNavigation | null>(null)
  if (first.current === null) first.current = restore(scope, filterKey)
  const [navigation, setNavigation] = useState<HierarchyNavigation>(first.current)
  const [expanded, setExpanded] = useState(Boolean(rememberedPlaces.get(scope)))
  const [searchText, setSearchText] = useState(navigation.search)
  const [items, setItems] = useState<MediaPlaceHierarchyItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState('')
  const [available, setAvailable] = useState(true)
  const [version, setVersion] = useState(() => {
    const saved = rememberedPlaces.get(scope)
    return saved?.filterKey === filterKey ? saved.datasetVersion : ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  // React cancels the precise HTTP request on every page, filter, owner or
  // component change. No obsolete response can overwrite a newer page.
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setItems([])
    setHasMore(false)
    setNextCursor('')
    const request: MediaPlaceHierarchyRequest = {
      level: navigation.level,
      country: navigation.country,
      region: navigation.region,
      search: navigation.search,
      cursor: navigation.cursor || undefined,
      limit: PAGE_LIMIT,
    }
    void listPage(request, filters, controller.signal).then(page => {
      if (controller.signal.aborted) return
      if (!xDriveValidMediaPlaceHierarchyPage(page, request) ||
          (page.has_more && page.next_cursor === navigation.cursor)) {
        throw new Error('地点分页响应无效，请重新查询')
      }
      if (navigation.cursor && version && page.dataset_version !== version) {
        throw new Error('GeoNames 数据版本已改变，请从第一页重新查询')
      }
      setItems(page.items)
      setHasMore(page.has_more)
      setNextCursor(page.next_cursor ?? '')
      setAvailable(page.available)
      setVersion(page.dataset_version ?? '')
      remember(scope, filterKey, navigation, page.dataset_version ?? '')
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '地点加载失败')
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  // Stable filter signature deliberately controls when to re-fetch; the
  // parent may supply a new but equivalent query object on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, filterKey, listPage, expanded, navigation, reload])

  useEffect(() => {
    if (loading || !navigation.focusedID || !items.length) return
    const frame = window.requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items, loading, navigation.focusedID])

  // A change in the active Gallery selection discards obsolete cursors,
  // avoiding another Owner/filter's prior position.
  const previousFilterKey = useRef(filterKey)
  useEffect(() => {
    if (previousFilterKey.current === filterKey) return
    previousFilterKey.current = filterKey
    setNavigation(root())
    setSearchText('')
    setVersion('')
  }, [filterKey])

  const navigate = (next: HierarchyNavigation, keepVersion = false) => {
    setNavigation(next)
    setSearchText(next.search)
    if (!keepVersion) setVersion('')
    remember(scope, filterKey, next, keepVersion ? version : '')
  }
  const select = (item: MediaPlaceHierarchyItem) => {
    if (navigation.level === 'country') {
      const match = /^country:([A-Z]{2})$/.exec(item.id)
      if (match) navigate({
        level: 'region', country: match[1], countryName: item.name,
        search: '', cursor: '', previous: [],
      })
    } else if (navigation.level === 'region') {
      const match = /^region:([A-Z]{2}):([A-Z0-9_-]{1,16})$/.exec(item.id)
      if (match && match[1] === navigation.country) navigate({
        level: 'city', country: match[1], region: match[2],
        countryName: navigation.countryName, regionName: item.name,
        search: '', cursor: '', previous: [],
      })
    } else {
      openPhotos(item)
    }
  }
  const openPhotos = (item: MediaPlaceHierarchyItem) => {
    if (!/^(country:[A-Z]{2}|region:[A-Z]{2}:[A-Z0-9_-]{1,16}|city:[A-Z]{2}:[A-Z0-9_-]{1,16}:[1-9][0-9]*)$/.test(item.id)) return
    const current = { ...navigation, focusedID: item.id }
    remember(scope, filterKey, current, version)
    onOpenPhotoRange(item)
  }
  const changePage = (cursor: string, previous: string[]) => navigate({
    ...navigation, cursor, previous, focusedID: undefined,
  }, true)

  return (
    <Paper variant="outlined" data-xdrive-places-hierarchy sx={{
      borderRadius: 2, overflow: 'hidden',
    }}>
      <Button size="large" fullWidth color="inherit" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        sx={{ minHeight: 48, px: 2, justifyContent: 'space-between' }}>
        按国家／地区／附近城市浏览
        <Box component="span">{expanded ? '收起' : '展开'}</Box>
      </Button>
      {expanded ? (
        <Box sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center"
            flexWrap="wrap" sx={{ mb: 1, rowGap: 1 }}
            data-xdrive-places-hierarchy-breadcrumb>
            <Button size="small" onClick={() => navigate(root())}>国家</Button>
            {navigation.country ? (
              <Button size="small" onClick={() => navigate({
                level: 'region', country: navigation.country,
                countryName: navigation.countryName,
                search: '', cursor: '', previous: [],
              })}>{navigation.countryName || navigation.country}</Button>
            ) : null}
            {navigation.region ? (
              <Typography variant="body2">{navigation.regionName || navigation.region}</Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {navigation.level === 'city'
                ? '附近城市（不是精确行政边界）'
                : navigation.level === 'region' ? '地区' : '国家'}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
            <TextField label="搜索当前层级" size="small" fullWidth
              value={searchText} inputProps={{ maxLength: 80 }}
              onChange={event => setSearchText(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') navigate({
                ...navigation, search: searchText.trim(), cursor: '', previous: [],
              }) }} />
            <Button variant="outlined" onClick={() => navigate({
              ...navigation, search: searchText.trim(), cursor: '', previous: [],
            })}>搜索</Button>
            <Button variant="text" onClick={() => {
              setVersion('')
              setReload(value => value + 1)
            }}>刷新</Button>
          </Stack>
          {!available ? (
            <Typography role="status" color="text.secondary">
              GeoNames 地点数据不可用；GPS 地图与旧照片墙仍可使用。
            </Typography>
          ) : null}
          {error ? (
            <Stack spacing={0.5} alignItems="flex-start" sx={{ mb: 1 }}>
              <Typography role="alert" color="error">{error}</Typography>
              {navigation.cursor ? (
                <Button size="small" onClick={() => navigate({
                  ...navigation, cursor: '', previous: [], focusedID: undefined,
                })}>返回第一页重新查询</Button>
              ) : null}
            </Stack>
          ) : null}
          {loading ? (
            <Stack role="status" direction="row" spacing={1} alignItems="center"
              sx={{ minHeight: 64 }}>
              <CircularProgress size={20} /><Typography>加载地点…</Typography>
            </Stack>
          ) : null}
          {!loading && !error && available && !items.length ? (
            <Typography role="status" color="text.secondary">
              此层级暂无符合条件的照片地点。
            </Typography>
          ) : null}
          <Box sx={{ display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
            gap: 1 }}>
            {items.map(item => (
              <Paper key={item.id} variant="outlined" sx={{
                display: 'flex', p: 0.5, minWidth: 0,
                alignItems: 'center', gap: 0.5,
              }}>
                <Button ref={navigation.focusedID === item.id ? selectedRef : undefined}
                  onClick={() => select(item)} color="inherit"
                  data-xdrive-places-hierarchy-item={item.id}
                  sx={{ display: 'flex', flex: 1, minWidth: 0,
                    justifyContent: 'flex-start', textAlign: 'left',
                    minHeight: 72, p: 0.5 }}>
                  <Box sx={{ width: 60, height: 60, flexShrink: 0,
                    bgcolor: 'action.hover', borderRadius: 1,
                    overflow: 'hidden' }}>
                    <XDriveMediaGalleryCoverThumbnail
                      nodeID={item.cover_node_id} alt={item.name}
                      loadThumbnail={loadThumbnail}
                      fallback={<Box sx={{
                        width: '100%', height: '100%', display: 'grid',
                        placeItems: 'center',
                      }}>📍</Box>}
                    />
                  </Box>
                  <Box sx={{ ml: 1, flex: 1, minWidth: 0 }}>
                    <Typography noWrap fontWeight={650} variant="body2">{item.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.photo_count.toLocaleString('zh-CN')} 张照片
                    </Typography>
                  </Box>
                </Button>
                {navigation.level !== 'city' ? (
                  <Button size="small" variant="text" sx={{ flexShrink: 0 }}
                    onClick={() => openPhotos(item)}
                    aria-label={item.name + '的照片'}>
                    照片
                  </Button>
                ) : null}
              </Paper>
            ))}
          </Box>
          {(navigation.previous.length > 0 || hasMore) ? (
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
              <Button disabled={loading || !navigation.previous.length}
                onClick={() => {
                  const back = navigation.previous.slice()
                  const cursor = back.pop() ?? ''
                  changePage(cursor, back)
                }}>上一页</Button>
              <Typography variant="caption" color="text.secondary"
                sx={{ alignSelf: 'center' }}>
                每页最多 {PAGE_LIMIT} 个地点
              </Typography>
              <Button disabled={loading || !hasMore || !nextCursor}
                onClick={() => changePage(nextCursor, [
                  ...navigation.previous.slice(-127), navigation.cursor,
                ])}>下一页</Button>
            </Stack>
          ) : null}
          {version ? (
            <Typography variant="caption" color="text.secondary"
              sx={{ display: 'block', mt: 1 }}>
              GeoNames 数据版本已校验 · 城市名称为最近城市参考
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Paper>
  )
}
