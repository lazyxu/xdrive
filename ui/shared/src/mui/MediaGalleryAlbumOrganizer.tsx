import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  Collections as CollectionsIcon,
  PushPin as PushPinIcon,
  PushPinOutlined as PushPinOutlinedIcon,
} from '@mui/icons-material'
import {
  Box, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import type { MediaAlbum } from '../models'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'
import {
  changeAlbumPin, moveAlbum, readMediaAlbumPreferences,
  sortedMediaAlbums, writeMediaAlbumPreferences,
} from './MediaGalleryAlbumOrganization'
import type { MediaAlbumOrganizePreferences, MediaAlbumSortOrder } from './MediaGalleryAlbumOrganization'

type Props = {
  albums: MediaAlbum[]
  accountScope: string
  loadThumbnail: (nodeID: number) => Promise<string | null>
  onOpenAlbum?: (album: MediaAlbum) => void
}

function albumCategory(album: MediaAlbum) {
  switch (album.kind) {
    case 'imported': return '导入相册'
    case 'manual': return '手动相册'
    case 'smart': return '智能相册'
    default: return '相册'
  }
}

function AlbumCard({
  album,
  accountPreferences,
  groupIndex,
  groupLength,
  editableOrder,
  onOpenAlbum,
  onTogglePin,
  onMove,
  loadThumbnail,
}: {
  album: MediaAlbum
  accountPreferences: MediaAlbumOrganizePreferences
  groupIndex: number
  groupLength: number
  editableOrder: boolean
  onOpenAlbum?: (album: MediaAlbum) => void
  onTogglePin: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  loadThumbnail: Props['loadThumbnail']
}) {
  const pinned = accountPreferences.pinned.includes(album.id)
  const stop = (event: MouseEvent<HTMLElement>) => event.stopPropagation()
  const openOnKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !onOpenAlbum) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpenAlbum(album)
    }
  }
  return (
    <Paper
      variant="outlined"
      data-xdrive-gallery-album={album.id}
      role={onOpenAlbum ? 'button' : undefined}
      tabIndex={onOpenAlbum ? 0 : undefined}
      onClick={() => onOpenAlbum?.(album)}
      onKeyDown={openOnKey}
      sx={{
        overflow: 'hidden', position: 'relative',
        cursor: onOpenAlbum ? 'pointer' : 'default',
        '&:hover': { boxShadow: 2 },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box sx={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
        <XDriveMediaAsyncThumbnail
          nodeID={album.cover_node_id}
          alt={album.name}
          loadThumbnail={loadThumbnail}
          fallback={(
            <Box sx={{
              height: '100%', width: '100%', bgcolor: 'action.hover', color: 'text.secondary',
              display: 'grid', placeItems: 'center',
            }}>
              <CollectionsIcon sx={{ fontSize: 44 }} />
            </Box>
          )}
        />
      </Box>
      <Box sx={{ p: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={650} noWrap>{album.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {album.item_count.toLocaleString('zh-CN')} 项 · {albumCategory(album)}
        </Typography>
        <Stack direction="row" spacing={0.25} justifyContent="flex-end" sx={{ mt: 0.5 }}>
          {editableOrder && (
            <>
              <Tooltip title="向前移动">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`向前移动${album.name}`}
                    disabled={groupIndex === 0}
                    onClick={(event) => { stop(event); onMove(album.id, -1) }}
                    onKeyDown={(event) => event.stopPropagation()}
                    data-xdrive-gallery-album-move-up
                  ><ArrowUpwardIcon fontSize="small" /></IconButton>
                </span>
              </Tooltip>
              <Tooltip title="向后移动">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`向后移动${album.name}`}
                    disabled={groupIndex === groupLength - 1}
                    onClick={(event) => { stop(event); onMove(album.id, 1) }}
                    onKeyDown={(event) => event.stopPropagation()}
                    data-xdrive-gallery-album-move-down
                  ><ArrowDownwardIcon fontSize="small" /></IconButton>
                </span>
              </Tooltip>
            </>
          )}
          <Tooltip title={pinned ? '取消固定相册' : '固定为常用相册'}>
            <IconButton
              size="small"
              aria-label={pinned ? `取消固定${album.name}` : `固定${album.name}`}
              aria-pressed={pinned}
              onClick={(event) => { stop(event); onTogglePin(album.id) }}
              onKeyDown={(event) => event.stopPropagation()}
              data-xdrive-gallery-album-pin
            >
              {pinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
    </Paper>
  )
}

export function XDriveMediaGalleryAlbumOrganizer({
  albums,
  accountScope,
  loadThumbnail,
  onOpenAlbum,
}: Props) {
  const [search, setSearch] = useState('')
  const [prefs, setPrefs] = useState<MediaAlbumOrganizePreferences>(() =>
    readMediaAlbumPreferences(accountScope))
  useEffect(() => setPrefs(readMediaAlbumPreferences(accountScope)), [accountScope])
  const grouped = useMemo(
    () => sortedMediaAlbums(albums, prefs, search),
    [albums, prefs, search],
  )
  const store = (next: MediaAlbumOrganizePreferences) => {
    setPrefs(next)
    writeMediaAlbumPreferences(accountScope, next)
  }
  const togglePin = (id: string) => store(changeAlbumPin(albums, prefs, id))
  const move = (id: string, step: -1 | 1) =>
    store(moveAlbum(albums, prefs, id, step))
  const displayedCount = grouped.pinned.length + grouped.other.length
  const editableOrder = !search.trim()
  const cards = (entries: MediaAlbum[]) => (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 1.5,
    }}>
      {entries.map((album, index) => (
        <AlbumCard
          key={album.id}
          album={album}
          accountPreferences={prefs}
          groupIndex={index}
          groupLength={entries.length}
          editableOrder={editableOrder && (prefs.pinned.includes(album.id) || prefs.sort === 'manual')}
          onOpenAlbum={onOpenAlbum}
          onTogglePin={togglePin}
          onMove={move}
          loadThumbnail={loadThumbnail}
        />
      ))}
    </Box>
  )
  return (
    <Stack spacing={1.75} data-xdrive-gallery-album-organizer>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>相册</Typography>
        <TextField
          size="small"
          label="搜索相册"
          placeholder="相册名称"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ minWidth: 180 }}
          inputProps={{ 'data-xdrive-gallery-album-search': true }}
        />
        <TextField
          select
          size="small"
          label="相册排序"
          value={prefs.sort}
          onChange={(event) => store({ ...prefs, sort: event.target.value as MediaAlbumSortOrder })}
          sx={{ minWidth: 164 }}
          data-xdrive-gallery-album-sort
        >
          <MenuItem value="name">名称</MenuItem>
          <MenuItem value="recent">最近更新</MenuItem>
          <MenuItem value="count">照片数量</MenuItem>
          <MenuItem value="manual">自定义顺序</MenuItem>
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        显示 {displayedCount.toLocaleString('zh-CN')} / {albums.length.toLocaleString('zh-CN')} 个相册 · 固定和自定义顺序仅影响此账号在本设备的展示
      </Typography>
      {grouped.pinned.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>常用相册</Typography>
          {cards(grouped.pinned)}
        </Stack>
      )}
      {grouped.other.length > 0 && (
        <Stack spacing={1}>
          {grouped.pinned.length > 0 && (
            <Typography variant="subtitle2" fontWeight={700}>其他相册</Typography>
          )}
          {cards(grouped.other)}
        </Stack>
      )}
      {displayedCount === 0 && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {albums.length > 0 ? '没有匹配的相册' : '还没有相册'}
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}
