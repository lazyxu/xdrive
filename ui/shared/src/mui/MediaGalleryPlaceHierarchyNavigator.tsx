import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { XDriveMediaGalleryCoverThumbnail } from './MediaGalleryCoverThumbnail'
import type { MediaThumbnailLoader } from './MediaGallery'

export type MediaPlaceHierarchyLevel = 'country' | 'region' | 'city'

export interface MediaPlaceHierarchyRequest {
  level: MediaPlaceHierarchyLevel
  country?: string
  region?: string
  cursor?: string
  limit?: number
  search?: string
}

export interface MediaPlaceHierarchyItem {
  id: string
  name: string
  photo_count: number
  cover_node_id?: number
  match_kind: string
}

export interface MediaPlaceHierarchyPage {
  items: MediaPlaceHierarchyItem[]
  level: MediaPlaceHierarchyLevel
  has_more: boolean
  next_cursor?: string
  dataset_version?: string
  available: boolean
}

/** A single bounded Owner-authenticated page. No complete-GPS-library fetch. */
export type MediaPlaceHierarchyLoader = (
  request: MediaPlaceHierarchyRequest, signal?: AbortSignal,
) => Promise<MediaPlaceHierarchyPage>

export type MediaPlaceHierarchyParent = { level: MediaPlaceHierarchyLevel; country?: string; region?: string }
export interface MediaPlaceHierarchyNavigationSnapshot {
  expanded: boolean
  parent: MediaPlaceHierarchyParent
  search: string
  draftSearch: string
  cursor: string
  previousCursors: string[]
  datasetVersion: string
}
type Parent = MediaPlaceHierarchyParent
type Receipt = {
  scope: string
  loader: MediaPlaceHierarchyLoader
  requestKey: string
  page: MediaPlaceHierarchyPage
}

const PAGE_LIMIT = 48
const GEO_COUNTRY = /^[A-Z]{2}$/
const GEO_REGION = /^[A-Z0-9_-]{1,16}$/
const GEO_CITY = /^[1-9][0-9]*$/

/** Reject ambiguous Server responses instead of opening an untrusted collection. */
export function xDriveValidMediaPlaceHierarchyID(id: string, expected: MediaPlaceHierarchyLevel): boolean {
  const parts = id.split(':')
  if (expected === 'country') return parts.length === 2 && parts[0] === 'country' && GEO_COUNTRY.test(parts[1])
  if (expected === 'region') return parts.length === 3 && parts[0] === 'region' &&
    GEO_COUNTRY.test(parts[1]) && GEO_REGION.test(parts[2])
  if (expected !== 'city') return false
  if (parts.length !== 4 || parts[0] !== 'city' ||
    !GEO_COUNTRY.test(parts[1]) || !GEO_REGION.test(parts[2]) ||
    !GEO_CITY.test(parts[3])) return false
  const n = Number(parts[3])
  return Number.isSafeInteger(n) && n > 0 && String(n) === parts[3]
}

export function xDriveValidMediaPlaceHierarchyPage(
  response: MediaPlaceHierarchyPage, request: MediaPlaceHierarchyRequest,
): boolean {
  if (!response || response.level !== request.level ||
    typeof response.available !== 'boolean' ||
    typeof response.has_more !== 'boolean' ||
    !Array.isArray(response.items) || response.items.length > PAGE_LIMIT) return false
  if (!response.available && (response.items.length !== 0 || response.has_more)) return false
  if (response.has_more && (response.items.length === 0 ||
    response.next_cursor !== response.items[response.items.length - 1].id)) return false
  const seen = new Set<string>()
  for (const item of response.items) {
    if (!item || typeof item.name !== 'string' || item.name.length > 200 ||
      !Number.isSafeInteger(item.photo_count) || item.photo_count < 1 ||
      !xDriveValidMediaPlaceHierarchyID(item.id, request.level) ||
      seen.has(item.id)) return false
    const parts = item.id.split(':')
    if (request.country && parts[1] !== request.country) return false
    if (request.region && parts[2] !== request.region) return false
    if (item.cover_node_id !== undefined &&
      (!Number.isSafeInteger(item.cover_node_id) || item.cover_node_id < 1)) return false
    seen.add(item.id)
  }
  return true
}

export interface XDriveMediaGalleryPlaceHierarchyNavigatorProps {
  accountScope: string
  listPage?: MediaPlaceHierarchyLoader
  loadThumbnail: MediaThumbnailLoader
  onOpenCollection: (item: MediaPlaceHierarchyItem) => void
  initialNavigation?: MediaPlaceHierarchyNavigationSnapshot
  onNavigationChange?: (snapshot: MediaPlaceHierarchyNavigationSnapshot) => void
  focusPlaceID?: string
}

/**
 * Shared Web / Mobile Web / Desktop navigator. Mounted under the native map:
 * optional opening avoids delaying the initial SDK map and the legacy GPS grid.
 * Owner + data-source + requestKey are verified before rendering a receipt.
 */
export function XDriveMediaGalleryPlaceHierarchyNavigator({
  accountScope, listPage, loadThumbnail, onOpenCollection,
  initialNavigation, onNavigationChange, focusPlaceID,
}: XDriveMediaGalleryPlaceHierarchyNavigatorProps) {
  const [expanded, setExpanded] = useState(initialNavigation?.expanded ?? false)
  const [parent, setParent] = useState<Parent>(initialNavigation?.parent ?? { level: 'country' })
  const [draftSearch, setDraftSearch] = useState(initialNavigation?.draftSearch ?? '')
  const [search, setSearch] = useState(initialNavigation?.search ?? '')
  const [cursor, setCursor] = useState(initialNavigation?.cursor ?? '')
  const [previousCursors, setPreviousCursors] = useState<string[]>(initialNavigation?.previousCursors ?? [])
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const datasetVersion = useRef(initialNavigation?.datasetVersion ?? '')
  const [reload, setReload] = useState(0)
  const focusButtonRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    onNavigationChange?.({ expanded, parent, search, draftSearch, cursor,
      previousCursors: [...previousCursors], datasetVersion: datasetVersion.current })
  }, [expanded, parent, search, draftSearch, cursor, previousCursors, onNavigationChange])

  const request = useMemo<MediaPlaceHierarchyRequest>(() => ({
    ...parent, limit: PAGE_LIMIT,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
  }), [parent, cursor, search])
  const requestKey = JSON.stringify([request, reload])
  const current = receipt?.scope === accountScope && receipt.loader === listPage &&
    receipt.requestKey === requestKey ? receipt.page : null
  useEffect(() => {
    if (!current?.available || !focusPlaceID || !expanded ||
        !current.items.some((item) => item.id === focusPlaceID)) return
    const frame = window.requestAnimationFrame(() => {
      focusButtonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [current, expanded, focusPlaceID])

  useEffect(() => {
    if (!expanded || !listPage || !accountScope) return
    const abort = new AbortController()
    setPending(true)
    setError('')
    void listPage(request, abort.signal).then((page) => {
      if (abort.signal.aborted) return
      if (!xDriveValidMediaPlaceHierarchyPage(page, request)) throw new Error('bad_hierarchy_page')
      if (cursor && datasetVersion.current && page.dataset_version !== datasetVersion.current) {
        throw new Error('dataset_changed')
      }
      setReceipt({ scope: accountScope, loader: listPage, requestKey, page })
      if (!cursor) datasetVersion.current = page.dataset_version || ''
    }).catch((cause: unknown) => {
      if (abort.signal.aborted) return
      setError(cause instanceof Error && cause.message === 'dataset_changed'
        ? '地点数据集已更新，请返回第一页重新浏览'
        : '地点层级暂不可用，请重试')
    }).finally(() => {
      if (!abort.signal.aborted) setPending(false)
    })
    return () => abort.abort()
  }, [accountScope, cursor, expanded, listPage, request, requestKey])

  const resetPage = () => {
    setCursor('')
    setPreviousCursors([])
    datasetVersion.current = ''
  }
  const navigate = (next: Parent) => {
    setParent(next)
    setDraftSearch('')
    setSearch('')
    resetPage()
  }
  const enter = (item: MediaPlaceHierarchyItem) => {
    const parts = item.id.split(':')
    if (parent.level === 'country') {
      navigate({ level: 'region', country: parts[1] })
    } else if (parent.level === 'region') {
      navigate({ level: 'city', country: parts[1], region: parts[2] })
    }
  }
  const parentLabel = parent.level === 'country'
    ? '国家'
    : parent.level === 'region'
      ? parent.country + ' · 地区'
      : parent.country + ' / ' + parent.region + ' · 附近城市'

  return (
    <Paper variant="outlined" data-xdrive-places-hierarchy sx={{ p: 1.5, borderRadius: 2 }}>
      <Button
        size="small" onClick={() => setExpanded((prior) => !prior)}
        aria-expanded={expanded} aria-controls="xdrive-places-hierarchy-panel"
        sx={{ minHeight: 44, fontWeight: 700, justifyContent: 'flex-start' }}
      >
        按国家、地区和附近城市浏览
      </Button>
      {expanded ? (
        <Stack id="xdrive-places-hierarchy-panel" spacing={1.25}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button size="small" variant="text"
              onClick={() => navigate({ level: 'country' })}
              disabled={parent.level === 'country'}>国家</Button>
            {parent.country ? (
              <Button size="small" variant="text"
                onClick={() => navigate({ level: 'region', country: parent.country })}
                disabled={parent.level === 'region'}>
                {parent.country} · 地区
              </Button>
            ) : null}
            {parent.level === 'city' ? <Typography variant="body2">{parent.region} · 附近城市</Typography> : null}
          </Stack>
          <Box component="form" onSubmit={(event) => {
            event.preventDefault()
            setSearch(draftSearch.trim())
            resetPage()
            setReload((n) => n + 1)
          }} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" fullWidth
              value={draftSearch}
              inputProps={{ maxLength: 160, 'aria-label': '搜索当前地点层级' }}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder={parentLabel + '搜索'}
            />
            <Button type="submit" variant="outlined" sx={{ minHeight: 40 }}>搜索</Button>
          </Box>
          {!listPage ? (
            <Typography role="status" variant="body2" color="text.secondary">
              当前客户端暂不支持分层地点，请更新 Server 和 Agent。
            </Typography>
          ) : !accountScope ? (
            <Typography role="status" variant="body2" color="text.secondary">
              正在确认当前账户。
            </Typography>
          ) : null}
          {pending ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status">
              <CircularProgress size={16} /> <Typography variant="caption">加载当前层级…</Typography>
            </Stack>
          ) : null}
          {error ? <Typography variant="body2" color="error" role="alert">{error}</Typography> : null}
          {current?.available === false ? (
            <Typography variant="body2" color="text.secondary">
              当前 GeoNames 地点数据尚未准备好；不会使用旧 GPS 网格冒充可信行政层级。
            </Typography>
          ) : null}
          {current?.available && current.items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">当前层级没有匹配的已分析照片。</Typography>
          ) : null}
          {current?.available ? (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))',
              gap: 1.25,
            }}>
              {current.items.map((item) => (
                <Paper variant="outlined" key={item.id} sx={{ overflow: 'hidden' }}>
                  <Button size="small" fullWidth onClick={() => onOpenCollection(item)}
                    ref={item.id === focusPlaceID ? focusButtonRef : undefined}
                    data-xdrive-places-hierarchy-return-anchor={item.id === focusPlaceID ? 'true' : undefined}
                    sx={{ display: 'block', p: 0, textTransform: 'none', textAlign: 'left' }}
                    aria-label={item.name + ' · ' + item.photo_count + ' 张照片'}>
                    <Box sx={{ aspectRatio: '16 / 10', bgcolor: 'action.hover' }}>
                      <XDriveMediaGalleryCoverThumbnail
                        nodeID={item.cover_node_id} alt={item.name}
                        loadThumbnail={loadThumbnail}
                        fallback={<PlaceOutlinedIcon color="disabled" />}
                      />
                    </Box>
                    <Box sx={{ px: 1.25, py: 1 }}>
                      <Typography variant="body2" fontWeight={650} noWrap>{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.photo_count.toLocaleString('zh-CN')} 张 · 查看照片
                      </Typography>
                    </Box>
                  </Button>
                  {parent.level !== 'city' ? (
                    <Button fullWidth size="small" endIcon={<ChevronRightRoundedIcon />}
                      onClick={() => enter(item)} sx={{ minHeight: 38 }}>
                      {parent.level === 'country' ? '进入地区' : '查看附近城市'}
                    </Button>
                  ) : null}
                </Paper>
              ))}
            </Box>
          ) : null}
          {current?.available ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" variant="outlined"
                disabled={pending || previousCursors.length === 0}
                onClick={() => {
                  const past = previousCursors[previousCursors.length - 1]
                  setPreviousCursors((keys) => keys.slice(0, -1))
                  setCursor(past)
                }}>上一页</Button>
              <Button size="small" variant="outlined"
                disabled={pending || !current.has_more || !current.next_cursor}
                onClick={() => {
                  setPreviousCursors((keys) => [...keys.slice(-79), cursor])
                  setCursor(current.next_cursor || '')
                }}>下一页</Button>
              <Typography variant="caption" color="text.secondary">
                每页至多 {PAGE_LIMIT} 组 · GeoNames {current.dataset_version || '未指定版本'}
              </Typography>
            </Stack>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            最近城市按 GeoNames 最近点归类，不代表精确行政区边界；数量为当前账户真实媒体资产数。
          </Typography>
        </Stack>
      ) : null}
    </Paper>
  )
}
