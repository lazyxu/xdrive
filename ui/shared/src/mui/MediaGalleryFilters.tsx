import { useState } from 'react'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
} from '@mui/material'
import type { MediaGalleryQuery } from '../models'

export type MediaGalleryFilterDraft = {
  search: string
  assetKind: string
  category: string
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
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return undefined
  if (exclusiveEnd) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export function mediaGalleryQueryFromDraft(draft: MediaGalleryFilterDraft): MediaGalleryQuery {
  const search = draft.search.trim()
  return {
    ...(search ? { search } : {}),
    ...(draft.assetKind ? { asset_kind: draft.assetKind } : {}),
    ...(draft.category ? { category: draft.category } : {}),
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
  if (Number.isNaN(date.getTime())) return ''
  if (exclusiveEnd) date.setDate(date.getDate() - 1)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function mediaGalleryDraftFromQuery(query: MediaGalleryQuery = {}): MediaGalleryFilterDraft {
  return {
    search: query.search || '',
    assetKind: query.asset_kind || '',
    category: query.category || '',
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
  lockedAssetKind = false,
  lockedFavorite = false,
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
  lockedAssetKind?: boolean
  lockedFavorite?: boolean
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
        {showSearch ? (
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


function mediaGalleryAdvancedFilterCount(draft: MediaGalleryFilterDraft) {
  return [
    draft.assetKind,
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
  loading,
  applyLabel = '应用',
  clearLabel = '清除',
  placeLabel,
  personIdentityLabel,
  personIdentityLocked = false,
  lockedAssetKind = false,
  lockedFavorite = false,
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
  lockedAssetKind?: boolean
  lockedFavorite?: boolean
  onChange: (next: MediaGalleryFilterDraft) => void
  onApply: () => void
  onClear: () => void
  onSaveSmart?: () => void
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const advancedCount = mediaGalleryAdvancedFilterCount(draft)

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        <TextField
          size="small"
          fullWidth
          aria-label="搜索图库"
          placeholder="搜索照片、文件名、相机或镜头"
          value={draft.search}
          onChange={(event) => onChange({ ...draft, search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply()
          }}
          sx={{ maxWidth: 520 }}
        />
        <Button
          size="small"
          variant={advancedCount > 0 ? 'contained' : 'outlined'}
          startIcon={<FilterAltOutlinedIcon />}
          aria-expanded={Boolean(anchorEl)}
          aria-haspopup="dialog"
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ flexShrink: 0 }}
        >
          {advancedCount > 0 ? `筛选 · ${advancedCount}` : '筛选'}
        </Button>
      </Stack>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.75, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ p: 1.5, width: { xs: 320, sm: 720, lg: 860 }, maxWidth: '100%' }}>
          <XDriveMediaGalleryFilterBar
            draft={draft}
            loading={loading}
            applyLabel={applyLabel}
            clearLabel={clearLabel}
            placeLabel={placeLabel}
            personIdentityLabel={personIdentityLabel}
            personIdentityLocked={personIdentityLocked}
            showSearch={false}
            lockedAssetKind={lockedAssetKind}
            lockedFavorite={lockedFavorite}
            onChange={onChange}
            onApply={() => {
              onApply()
              setAnchorEl(null)
            }}
            onClear={onClear}
            onSaveSmart={onSaveSmart}
          />
        </Box>
      </Popover>
    </>
  )
}
