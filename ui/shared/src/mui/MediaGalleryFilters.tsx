import { useCallback, useEffect, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'
import {
  xDriveMediaDayKey,
  xDriveMediaDayStartISO,
  xDriveMediaNextDayKey,
  xDriveReadMediaTimeZone,
} from '../media-timezone'
import type {
  MediaFacetOption,
  MediaGalleryFacets,
  MediaGalleryQuery,
} from '../models'

export type MediaGalleryFilterDraft = {
  search: string
  assetKind: string
  category: string
  cameras: string[]
  formats: string[]
  capturedFrom: string
  capturedTo: string
  location: 'any' | 'with' | 'without'
  favorite: 'any' | 'favorite' | 'not-favorite'
  tag: string
  person: string
  personIdentity: string
  place: string
}

export const emptyMediaGalleryFilterDraft: MediaGalleryFilterDraft = {
  search: '',
  assetKind: '',
  category: '',
  cameras: [],
  formats: [],
  capturedFrom: '',
  capturedTo: '',
  location: 'any',
  favorite: 'any',
  tag: '',
  person: '',
  personIdentity: '',
  place: '',
}

function localDateBoundaryISO(value: string, exclusiveEnd = false) {
  if (!value) return undefined
  const day = exclusiveEnd ? xDriveMediaNextDayKey(value) : value
  return xDriveMediaDayStartISO(day, xDriveReadMediaTimeZone())
}

function normalizedFacetValues(values: readonly string[]) {
  return Array.from(new Set(
    values.map((value) => value.trim().toLowerCase()).filter(Boolean),
  )).sort()
}

function selectedFacetOptions(
  options: readonly MediaFacetOption[],
  values: readonly string[],
) {
  const byValue = new Map(options.map((option) => [option.value, option]))
  return values.map((value) => (
    byValue.get(value) ?? { value, label: value, item_count: 0 }
  ))
}

export function mediaGalleryQueryFromDraft(draft: MediaGalleryFilterDraft): MediaGalleryQuery {
  const search = draft.search.trim()
  const cameras = normalizedFacetValues(draft.cameras)
  const formats = normalizedFacetValues(draft.formats)
  return {
    ...(search ? { search } : {}),
    ...(draft.assetKind ? { asset_kind: draft.assetKind } : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(cameras.length > 0 ? { cameras } : {}),
    ...(formats.length > 0 ? { formats } : {}),
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
    ...(draft.person.trim() ? { person: draft.person.trim() } : {}),
    ...(draft.personIdentity.trim()
      ? { person_identity: draft.personIdentity.trim() }
      : {}),
    ...(draft.place.trim() ? { place: draft.place.trim() } : {}),
  }
}

function mediaGalleryDateInput(value?: string, exclusiveEnd = false) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return xDriveMediaDayKey(
    exclusiveEnd ? new Date(date.getTime() - 1) : date,
    xDriveReadMediaTimeZone(),
  )
}

export function mediaGalleryDraftFromQuery(query: MediaGalleryQuery = {}): MediaGalleryFilterDraft {
  return {
    search: query.search || '',
    assetKind: query.asset_kind || '',
    category: query.category || '',
    cameras: normalizedFacetValues(query.cameras ?? []),
    formats: normalizedFacetValues(query.formats ?? []),
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
    person: query.person || '',
    personIdentity: query.person_identity || '',
    place: query.place || '',
  }
}

export function hasMediaGalleryFilters(draft: MediaGalleryFilterDraft) {
  return Boolean(
    draft.search.trim() ||
    draft.assetKind ||
    draft.category ||
    draft.cameras.length > 0 ||
    draft.formats.length > 0 ||
    draft.capturedFrom ||
    draft.capturedTo ||
    draft.location !== 'any' ||
    draft.favorite !== 'any' ||
    draft.tag.trim() ||
    draft.person.trim() ||
    draft.personIdentity.trim() ||
    draft.place.trim(),
  )
}

export function XDriveMediaGalleryFilterBar({
  draft,
  loading,
  applyLabel = '应用',
  clearLabel = '清除',
  placeLabel,
  personIdentityLabel,
  personIdentityLocked = false,
  showSearch = true,
  compactScrollable = false,
  lockedAssetKind = false,
  lockedFavorite = false,
  facets,
  facetsLoading = false,
  facetsError = '',
  facetsAvailable = false,
  onRequestFacets,
  onChange,
  onApply,
  onClear,
  onSaveSmart,
}: {
  draft: MediaGalleryFilterDraft
  loading: boolean
  applyLabel?: string
  clearLabel?: string
  placeLabel?: string
  personIdentityLabel?: string
  personIdentityLocked?: boolean
  showSearch?: boolean
  compactScrollable?: boolean
  lockedAssetKind?: boolean
  lockedFavorite?: boolean
  facets?: MediaGalleryFacets
  facetsLoading?: boolean
  facetsError?: string
  facetsAvailable?: boolean
  onRequestFacets?: (nextDraft?: MediaGalleryFilterDraft) => void
  onChange: (next: MediaGalleryFilterDraft) => void
  onApply: () => void
  onClear: () => void
  onSaveSmart?: () => void
}) {
  return (
    <Paper variant="outlined" sx={compactScrollable ? {
      p: 1.25, boxSizing: 'border-box', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    } : { p: 1.25 }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', lg: 'center' }}
        sx={compactScrollable ? {
          flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
          overscrollBehavior: 'contain', pb: 0.5,
        } : undefined}
      >
        {showSearch ? (
          <TextField
            size="small"
            label="搜索"
            placeholder="文件名、对象、场景、文字或相机"
            slotProps={{ htmlInput: { 'aria-label': '搜索' } }}
            value={draft.search}
            onChange={(event) => onChange({ ...draft, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onApply()
            }}
            sx={{ minWidth: { lg: 240 }, flex: { lg: 1 } }}
          />
        ) : null}
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
          size="small"
          label="人物"
          placeholder="精确人物标签"
          value={draft.person}
          onChange={(event) => onChange({ ...draft, person: event.target.value })}
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
          disabled={lockedAssetKind}
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
        {facetsAvailable ? (
          <>
            <Autocomplete
              multiple
              disableCloseOnSelect
              limitTags={1}
              options={facets?.cameras ?? []}
              value={selectedFacetOptions(facets?.cameras ?? [], draft.cameras)}
              loading={facetsLoading}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              getOptionLabel={(option) => option.label}
              onChange={(_event, values) => {
                const nextDraft = {
                  ...draft,
                  cameras: values.map((option) => option.value),
                }
                onChange(nextDraft)
                onRequestFacets?.(nextDraft)
              }}
              noOptionsText={facetsLoading ? '正在加载设备…' : '没有可用设备'}
              renderOption={(props, option, state) => (
                <li {...props} key={option.value}>
                  <Checkbox size="small" checked={state.selected} sx={{ mr: 0.5, p: 0.5 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{option.label}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {option.item_count.toLocaleString('zh-CN')} 项
                  </Typography>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} size="small" label="拍摄设备"
                  placeholder={draft.cameras.length === 0 ? '全部设备' : undefined} />
              )}
              sx={{ minWidth: { xs: '100%', lg: 220 } }}
            />
            <Autocomplete
              multiple
              disableCloseOnSelect
              limitTags={2}
              options={facets?.formats ?? []}
              value={selectedFacetOptions(facets?.formats ?? [], draft.formats)}
              loading={facetsLoading}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              getOptionLabel={(option) => option.label}
              onChange={(_event, values) => {
                const nextDraft = {
                  ...draft,
                  formats: values.map((option) => option.value),
                }
                onChange(nextDraft)
                onRequestFacets?.(nextDraft)
              }}
              noOptionsText={facetsLoading ? '正在加载格式…' : '没有可用格式'}
              renderOption={(props, option, state) => (
                <li {...props} key={option.value}>
                  <Checkbox size="small" checked={state.selected} sx={{ mr: 0.5, p: 0.5 }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>{option.label}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {option.item_count.toLocaleString('zh-CN')} 项
                  </Typography>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} size="small" label="文件格式"
                  placeholder={draft.formats.length === 0 ? '全部格式' : undefined} />
              )}
              sx={{ minWidth: { xs: '100%', lg: 180 } }}
            />
          </>
        ) : null}
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
          onChange={(event) => {
            const location = event.target.value as MediaGalleryFilterDraft['location']
            onChange({
              ...draft,
              location,
              ...(location === 'with' ? {} : { place: '' }),
            })
          }}
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
          disabled={lockedFavorite}
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
        {facetsAvailable && facetsError ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" color="warning.main">设备/格式统计加载失败</Typography>
            {onRequestFacets ? (
              <Button size="small" variant="text" onClick={() => onRequestFacets()}>
                重试
              </Button>
            ) : null}
          </Stack>
        ) : null}
        {draft.personIdentity ? (
          <Chip
            label={`人物 · ${personIdentityLabel || '未命名人物'}`}
            onDelete={personIdentityLocked
              ? undefined
              : () => onChange({ ...draft, personIdentity: '' })}
            variant="outlined"
            size="small"
          />
        ) : null}
        {draft.place && placeLabel ? (
          <Chip
            label={`地点 · ${placeLabel}`}
            onDelete={() => onChange({ ...draft, place: '', location: 'any' })}
            variant="outlined"
            size="small"
          />
        ) : null}
        <Stack direction="row" spacing={1} useFlexGap flexWrap={compactScrollable ? 'wrap' : 'nowrap'}
          sx={compactScrollable ? {
            bgcolor: 'background.paper',
            flexShrink: 0, px: 0.5, py: 1, borderTop: 1, borderColor: 'divider',
            '& .MuiButton-root': {
              minHeight: 44, flex: '1 1 auto', whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            },
          } : undefined}
        >
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


function mediaGalleryAdvancedFilterCount(draft: MediaGalleryFilterDraft) {
  return [
    draft.assetKind,
    draft.cameras.length > 0 ? 'cameras' : '',
    draft.formats.length > 0 ? 'formats' : '',
    draft.capturedFrom,
    draft.capturedTo,
    draft.location !== 'any' ? draft.location : '',
    draft.favorite !== 'any' ? draft.favorite : '',
    draft.tag.trim(),
    draft.person.trim(),
    draft.personIdentity.trim(),
    draft.place.trim(),
  ].filter(Boolean).length
}

export function XDriveMediaGalleryFilterToolbar({
  draft,
  recentSearches = [],
  loading,
  applyLabel = '应用',
  clearLabel = '清除',
  placeLabel,
  personIdentityLabel,
  personIdentityLocked = false,
  lockedAssetKind = false,
  lockedFavorite = false,
  facets,
  facetsLoading = false,
  facetsError = '',
  facetsAvailable = false,
  onRequestFacets,
  onChange,
  onApply,
  onClear,
  onSaveSmart,
  mobileEmbedded = false,
}: {
  draft: MediaGalleryFilterDraft
  recentSearches?: string[]
  loading: boolean
  applyLabel?: string
  clearLabel?: string
  placeLabel?: string
  personIdentityLabel?: string
  personIdentityLocked?: boolean
  lockedAssetKind?: boolean
  lockedFavorite?: boolean
  facets?: MediaGalleryFacets
  facetsLoading?: boolean
  facetsError?: string
  facetsAvailable?: boolean
  onRequestFacets?: (nextDraft?: MediaGalleryFilterDraft) => void
  onChange: (next: MediaGalleryFilterDraft) => void
  onApply: () => void
  onClear: () => void
  onSaveSmart?: () => void
  mobileEmbedded?: boolean
}) {
  const compactViewport = useMediaQuery('(max-width:899.95px)')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [openedCompact, setOpenedCompact] = useState(compactViewport)
  const panelOpen = Boolean(anchorEl) && compactViewport === openedCompact
  const panelViewport = useXDriveMobilePanelViewport(compactViewport && panelOpen)
  const advancedCount = mediaGalleryAdvancedFilterCount(draft)
  const closePanel = useCallback(() => setAnchorEl(null), [])

  useEffect(() => {
    if (!anchorEl || openedCompact === compactViewport) return
    closePanel()
    triggerRef.current?.focus()
  }, [anchorEl, closePanel, compactViewport, openedCompact])

  const filterContent = (mobile: boolean) => (
    <XDriveMediaGalleryFilterBar
      draft={draft}
      loading={loading}
      applyLabel={applyLabel}
      clearLabel={clearLabel}
      placeLabel={placeLabel}
      personIdentityLabel={personIdentityLabel}
      personIdentityLocked={personIdentityLocked}
      showSearch={mobileEmbedded && mobile}
      compactScrollable={mobile}
      lockedAssetKind={lockedAssetKind}
      lockedFavorite={lockedFavorite}
      facets={facets}
      facetsLoading={facetsLoading}
      facetsError={facetsError}
      facetsAvailable={facetsAvailable}
      onRequestFacets={onRequestFacets}
      onChange={onChange}
      onApply={() => {
        onApply()
        closePanel()
      }}
      onClear={onClear}
      onSaveSmart={onSaveSmart}
    />
  )

  if (mobileEmbedded && compactViewport) return filterContent(true)

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Autocomplete
          freeSolo
          fullWidth
          options={recentSearches.filter((text) => text !== draft.search)}
          inputValue={draft.search}
          onInputChange={(_event, value, reason) => {
            if (reason === 'input' || reason === 'clear') {
              onChange({ ...draft, search: value })
            }
          }}
          onChange={(_event, value) => {
            if (typeof value === 'string') onChange({ ...draft, search: value })
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              aria-label="搜索图库"
              placeholder="搜索照片、对象、场景或文字"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApply()
              }}
              inputProps={{
                ...params.inputProps,
                'data-xdrive-gallery-recent-search': 'true',
              }}
            />
          )}
          sx={{ maxWidth: 520 }}
        />
        <Button
          ref={triggerRef}
          size="small"
          variant={advancedCount > 0 ? 'contained' : 'outlined'}
          startIcon={<FilterAltOutlinedIcon />}
          aria-expanded={panelOpen}
          aria-haspopup="dialog"
          aria-label={advancedCount > 0 ? '图库筛选，' + advancedCount + ' 个条件' : '图库筛选'}
          onClick={(event) => {
            setOpenedCompact(compactViewport)
            setAnchorEl(event.currentTarget)
            onRequestFacets?.(draft)
          }}
          sx={{ flexShrink: 0, minHeight: compactViewport ? 44 : undefined }}
        >
          {advancedCount > 0 ? '筛选 · ' + advancedCount : '筛选'}
        </Button>
      </Stack>
      {compactViewport ? (
        <Drawer
          anchor="bottom"
          open={panelOpen}
          onClose={closePanel}
          slotProps={{ paper: {
            role: 'dialog',
            'aria-label': '图库筛选',
            sx: {
              bottom: panelViewport ? panelViewport.bottom + 'px' : undefined,
              height: panelViewport
                ? 'min(640px, ' + panelViewport.height + 'px)'
                : 'min(640px, calc(100dvh - env(safe-area-inset-top, 0px)))',
              maxHeight: panelViewport
                ? panelViewport.height + 'px'
                : 'calc(100dvh - env(safe-area-inset-top, 0px))',
              minHeight: 0, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
            },
          } }}
        >
          <Stack direction="row" spacing={1} alignItems="center"
            data-xdrive-gallery-mobile-filters-header
            sx={{ px: 1.5, minHeight: 52, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>筛选图库</Typography>
            <IconButton aria-label="关闭图库筛选" onClick={closePanel}
              sx={{ width: 44, height: 44, flex: '0 0 44px' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box
            data-xdrive-gallery-mobile-filters
            sx={{
              flex: '1 1 auto', minHeight: 0, px: 1, pt: 1,
              pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
              overflow: 'hidden',
            }}
          >
            {filterContent(true)}
          </Box>
        </Drawer>
      ) : (
        <Popover
          open={panelOpen}
          anchorEl={panelOpen ? anchorEl : null}
          onClose={closePanel}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: {
            mt: 0.75, maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
          } } }}
        >
          <Box sx={{ p: 1.5, width: { xs: 320, sm: 720, lg: 860 }, maxWidth: '100%' }}>
            {filterContent(false)}
          </Box>
        </Popover>
      )}
    </>
  )
}
