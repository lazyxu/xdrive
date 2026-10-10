import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  Collections as CollectionsIcon,
  PushPin as PushPinIcon,
  PushPinOutlined as PushPinOutlinedIcon,
  FolderOutlined as FolderOutlinedIcon,
  DriveFileMoveOutlined as DriveFileMoveOutlinedIcon,
  EditOutlined as EditOutlinedIcon,
  DeleteOutline as DeleteOutlineIcon,
} from '@mui/icons-material'
import {
  Alert, Box, Breadcrumbs, Button, CircularProgress,
  Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import type { MediaAlbum, MediaAlbumFolder } from '../models'
import { XDriveMediaAsyncThumbnail } from './MediaGalleryPreviewMedia'
import {
  changeAlbumPin, moveAlbum, readMediaAlbumPreferences,
  sortedMediaAlbums, writeMediaAlbumPreferences,
} from './MediaGalleryAlbumOrganization'
import type { MediaAlbumOrganizePreferences, MediaAlbumSortOrder } from './MediaGalleryAlbumOrganization'
import {
  mediaAlbumFolderCanDelete, mediaAlbumFolderChildren, mediaAlbumFolderDestinations,
  mediaAlbumFolderPath, mediaAlbumsInFolder,
} from './MediaGalleryAlbumFolderModel'

export type XDriveMediaGalleryAlbumFolderActions = {
  list: () => Promise<MediaAlbumFolder[]>
  create?: (name: string, parentID: number) => Promise<MediaAlbumFolder>
  update?: (
    folderID: number, revision: number, change: { name?: string; parent_id?: number },
  ) => Promise<MediaAlbumFolder>
  remove?: (folderID: number, revision: number) => Promise<void>
  moveAlbum?: (albumID: string, revision: number, folderID: number) => Promise<MediaAlbum>
  onAlbumMoved?: (album: MediaAlbum) => void
}

type Props = {
  albums: MediaAlbum[]
  accountScope: string
  loadThumbnail: (nodeID: number) => Promise<string | null>
  onOpenAlbum?: (album: MediaAlbum) => void
  folderActions?: XDriveMediaGalleryAlbumFolderActions
}

type FolderDialog =
  | { kind: 'create'; parentID: number }
  | { kind: 'rename' | 'move-folder' | 'delete'; folder: MediaAlbumFolder }
  | { kind: 'move-album'; album: MediaAlbum }

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
  onMoveToFolder,
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
  onMoveToFolder?: (album: MediaAlbum) => void
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
          {onMoveToFolder && (album.kind === 'manual' || album.kind === 'smart') && (
            <Tooltip title="移动到相册文件夹">
              <IconButton
                size="small"
                aria-label={`移动相册${album.name}到文件夹`}
                onClick={(event) => { stop(event); onMoveToFolder(album) }}
                onKeyDown={(event) => event.stopPropagation()}
                data-xdrive-gallery-album-file-into-folder
              >
                <DriveFileMoveOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
  folderActions,
}: Props) {
  const [search, setSearch] = useState('')
  const [activeFolderID, setActiveFolderID] = useState(0)
  const [folders, setFolders] = useState<MediaAlbumFolder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null)
  const [folderName, setFolderName] = useState('')
  const [targetFolderID, setTargetFolderID] = useState(0)
  const [folderBusy, setFolderBusy] = useState(false)
  const folderBusyRef = useRef(false)
  // A Server folder read is valid only until a newer read or committed write.
  // React rendering Busy alone cannot protect an older Promise completion.
  const folderListVersionRef = useRef(0)
  const [prefs, setPrefs] = useState<MediaAlbumOrganizePreferences>(() =>
    readMediaAlbumPreferences(accountScope))
  useEffect(() => setPrefs(readMediaAlbumPreferences(accountScope)), [accountScope])
  useEffect(() => {
    const load = folderActions?.list
    const readVersion = ++folderListVersionRef.current
    if (!load) { setFolders([]); setFolderError(''); return }
    let active = true
    setFoldersLoading(true)
    setFolderError('')
    void load().then((nextFolders) => {
      if (!active || readVersion !== folderListVersionRef.current) return
      setFolders(nextFolders)
      setActiveFolderID((current) => (
        current === 0 || nextFolders.some(folder => folder.id === current) ? current : 0
      ))
    }).catch((error: unknown) => {
      if (active && readVersion === folderListVersionRef.current) {
        setFolderError(error instanceof Error ? error.message : String(error))
      }
    }).finally(() => {
      if (active && readVersion === folderListVersionRef.current) {
        setFoldersLoading(false)
      }
    })
    return () => { active = false }
  }, [accountScope, folderActions?.list])

  const folderPath = useMemo(
    () => mediaAlbumFolderPath(folders, activeFolderID),
    [folders, activeFolderID],
  )
  const visibleAlbumItems = useMemo(
    () => mediaAlbumsInFolder(albums, activeFolderID, Boolean(search.trim())),
    [albums, activeFolderID, search],
  )
  const grouped = useMemo(
    () => sortedMediaAlbums(visibleAlbumItems, prefs, search),
    [visibleAlbumItems, prefs, search],
  )
  const visibleFolders = useMemo(() => (
    search.trim()
      ? folders.filter(folder => folder.name.toLocaleLowerCase('zh-CN')
        .includes(search.trim().toLocaleLowerCase('zh-CN')))
      : mediaAlbumFolderChildren(folders, activeFolderID)
  ), [folders, activeFolderID, search])
  const destinations = mediaAlbumFolderDestinations(
    folders,
    folderDialog?.kind === 'move-folder' ? folderDialog.folder.id : 0,
  )
  const beginDialog = (next: FolderDialog) => {
    setFolderError('')
    setFolderDialog(next)
    setFolderName(next.kind === 'create' ? '' : ('folder' in next ? next.folder.name : ''))
    setTargetFolderID(next.kind === 'move-album'
      ? next.album.album_folder_id ?? 0
      : next.kind === 'move-folder' ? next.folder.parent_id : activeFolderID)
  }
  const confirmFolderDialog = async () => {
    if (!folderDialog || folderBusyRef.current) return
    folderBusyRef.current = true
    setFolderBusy(true)
    setFolderError('')
    let folderHierarchyChanged = false
    try {
      if (folderDialog.kind === 'create' && folderActions?.create) {
        const created = await folderActions.create(folderName.trim(), folderDialog.parentID)
        folderHierarchyChanged = true
        setFolders((current) => [...current, created])
      } else if (folderDialog.kind === 'rename' && folderActions?.update) {
        const updated = await folderActions.update(
          folderDialog.folder.id, folderDialog.folder.revision, { name: folderName.trim() },
        )
        folderHierarchyChanged = true
        setFolders((current) => current.map(folder => folder.id === updated.id ? updated : folder))
      } else if (folderDialog.kind === 'move-folder' && folderActions?.update) {
        const updated = await folderActions.update(
          folderDialog.folder.id, folderDialog.folder.revision, { parent_id: targetFolderID },
        )
        folderHierarchyChanged = true
        setFolders((current) => current.map(folder => folder.id === updated.id ? updated : folder))
      } else if (folderDialog.kind === 'delete' && folderActions?.remove) {
        await folderActions.remove(folderDialog.folder.id, folderDialog.folder.revision)
        folderHierarchyChanged = true
        setFolders((current) => current.filter(folder => folder.id !== folderDialog.folder.id))
        setActiveFolderID((current) => current === folderDialog.folder.id ? folderDialog.folder.parent_id : current)
      } else if (folderDialog.kind === 'move-album' && folderActions?.moveAlbum) {
        if (!folderDialog.album.revision) throw new Error('相册版本不可用')
        const moved = await folderActions.moveAlbum(
          folderDialog.album.id, folderDialog.album.revision, targetFolderID,
        )
        folderActions.onAlbumMoved?.(moved)
      } else {
        throw new Error('当前客户端不支持该相册文件夹操作')
      }
      if (folderHierarchyChanged) {
        // An earlier list may contain a pre-write snapshot. Invalidate it
        // even if the pending response or error arrives after this commit.
        folderListVersionRef.current += 1
        setFoldersLoading(false)
        setFolderError('')
      }
      setFolderDialog(null)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error))
      // After a revision conflict, refresh canonical folder revisions if possible.
      if (folderActions?.list) {
        const readVersion = ++folderListVersionRef.current
        void folderActions.list().then((nextFolders) => {
          if (readVersion === folderListVersionRef.current) setFolders(nextFolders)
        }).catch(() => undefined)
      }
    } finally {
      folderBusyRef.current = false
      setFolderBusy(false)
    }
  }
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
          onMoveToFolder={folderActions?.moveAlbum
            ? (album) => beginDialog({ kind: 'move-album', album })
            : undefined}
          loadThumbnail={loadThumbnail}
        />
      ))}
    </Box>
  )
  return (
    <Stack spacing={1.75} data-xdrive-gallery-album-organizer>
      {folderActions && (
        <Stack spacing={1} data-xdrive-gallery-album-folders>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Breadcrumbs aria-label="相册文件夹路径" sx={{ flex: 1, minWidth: 0 }}>
              <Button size="small" onClick={() => { setActiveFolderID(0); setSearch('') }}>
                所有相册
              </Button>
              {folderPath.map(folder => (
                <Button key={folder.id} size="small" onClick={() => {
                  setActiveFolderID(folder.id); setSearch('')
                }}>{folder.name}</Button>
              ))}
            </Breadcrumbs>
            {folderActions.create && (
              <Button size="small" variant="outlined" onClick={() =>
                beginDialog({ kind: 'create', parentID: activeFolderID })}>
                新建相册文件夹
              </Button>
            )}
          </Stack>
          {foldersLoading && <Stack direction="row" alignItems="center" spacing={1}>
            <CircularProgress size={18} /><Typography variant="caption">加载相册文件夹…</Typography>
          </Stack>}
          {folderError && <Alert severity="error" role="alert">{folderError}</Alert>}
          {visibleFolders.length > 0 && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1 }}>
              {visibleFolders.map(folder => (
                <Paper
                  key={folder.id}
                  variant="outlined"
                  data-xdrive-gallery-album-folder={folder.id}
                  sx={{ display: 'flex', alignItems: 'center', p: 0.75, gap: 0.25, minWidth: 0 }}
                >
                  <Button
                    fullWidth
                    size="small"
                    startIcon={<FolderOutlinedIcon />}
                    sx={{ justifyContent: 'flex-start', minHeight: 44, minWidth: 0, textTransform: 'none' }}
                    onClick={() => { setActiveFolderID(folder.id); setSearch('') }}
                  >
                    <Typography variant="body2" noWrap>{folder.name}</Typography>
                  </Button>
                  {folderActions.update && (
                    <>
                      <Tooltip title="重命名文件夹"><IconButton size="small" aria-label={`重命名${folder.name}`}
                        onClick={() => beginDialog({ kind: 'rename', folder })}>
                        <EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="移动文件夹"><IconButton size="small" aria-label={`移动${folder.name}`}
                        onClick={() => beginDialog({ kind: 'move-folder', folder })}>
                        <DriveFileMoveOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                    </>
                  )}
                  {folderActions.remove && (
                    <Tooltip title="删除空文件夹"><span><IconButton size="small"
                      disabled={!mediaAlbumFolderCanDelete(folders, albums, folder.id)}
                      aria-label={`删除${folder.name}`}
                      onClick={() => beginDialog({ kind: 'delete', folder })}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton></span></Tooltip>
                  )}
                </Paper>
              ))}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            {search.trim() ? '搜索覆盖所有相册文件夹' : `当前文件夹：${visibleFolders.length} 个子文件夹`}
          </Typography>
        </Stack>
      )}
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
        显示 {displayedCount.toLocaleString('zh-CN')} / {visibleAlbumItems.length.toLocaleString('zh-CN')} 个相册 · 固定和自定义顺序仅影响此账号在本设备的展示
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
      {displayedCount === 0 && visibleFolders.length === 0 && !foldersLoading && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {albums.length > 0 ? '当前文件夹没有匹配的相册' : '还没有相册'}
          </Typography>
        </Paper>
      )}
      <Dialog open={Boolean(folderDialog)} onClose={() => { if (!folderBusy) setFolderDialog(null) }}
        fullWidth maxWidth="xs" aria-labelledby="gallery-folder-dialog-title">
        <DialogTitle id="gallery-folder-dialog-title">
          {folderDialog?.kind === 'create' ? '新建相册文件夹'
            : folderDialog?.kind === 'rename' ? '重命名相册文件夹'
              : folderDialog?.kind === 'move-folder' ? '移动相册文件夹'
                : folderDialog?.kind === 'move-album' ? '将相册移入文件夹'
                  : '删除相册文件夹'}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {folderDialog?.kind === 'create' || folderDialog?.kind === 'rename' ? (
            <TextField fullWidth size="small" label="文件夹名称" autoFocus
              value={folderName} onChange={(event) => setFolderName(event.target.value)}
              inputProps={{ maxLength: 200 }} sx={{ mt: 1 }} />
          ) : null}
          {folderDialog?.kind === 'move-folder' || folderDialog?.kind === 'move-album' ? (
            <TextField fullWidth select size="small" label="目标相册文件夹"
              value={targetFolderID} sx={{ mt: 1 }}
              onChange={(event) => setTargetFolderID(Number(event.target.value))}>
              <MenuItem value={0}>所有相册（根目录）</MenuItem>
              {destinations.map(folder => (
                <MenuItem key={folder.id} value={folder.id}>
                  {mediaAlbumFolderPath(folders, folder.id).map(part => part.name).join(' / ')}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {folderDialog?.kind === 'delete' && (
            <Typography sx={{ mt: 1 }}>只能删除没有子文件夹和相册的空文件夹，删除不会移除照片。</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderDialog(null)} disabled={folderBusy}>取消</Button>
          <Button
            variant="contained"
            color={folderDialog?.kind === 'delete' ? 'error' : 'primary'}
            disabled={folderBusy || (
              (folderDialog?.kind === 'create' || folderDialog?.kind === 'rename') &&
              !folderName.trim()
            )}
            onClick={() => { void confirmFolderDialog() }}>
            {folderBusy ? '处理中…' : '确认'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
