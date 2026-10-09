import { useEffect, useMemo, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import MovieCreationOutlinedIcon from '@mui/icons-material/MovieCreationOutlined'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Drawer,
  List,
  ListItemButton,
  DialogActions,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { MediaAlbum } from '../models'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { xDriveMediaGalleryErrorMessage } from './MediaGalleryUtils'
import { useXDriveMobilePanelViewport } from './useMobilePanelViewport'

function parseSelectionTags(value: string) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(',')) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out.slice(0, 32)
}

export function XDriveMediaGallerySelectionToolbar({
  selectedCount,
  selectionIdentity,
  allFavorite,
  albums,
  trashRootCount = 0,
  trashIncludesFolderRoot = false,
  busy = false,
  onFavorite,
  onAddToAlbum,
  onAddTags,
  onDownload,
  onCreateCollage,
  onCreateMovie,
  onDelete,
  onRestore,
  onPermanentDelete,
  onClear,
}: {
  selectedCount: number
  selectionIdentity?: unknown
  allFavorite: boolean
  albums: MediaAlbum[]
  trashRootCount?: number
  trashIncludesFolderRoot?: boolean
  busy?: boolean
  onFavorite?: (favorite: boolean) => Promise<void>
  onAddToAlbum?: (album: MediaAlbum) => Promise<void>
  onAddTags?: (tags: string[]) => Promise<void>
  onDownload?: () => Promise<void>
  onCreateCollage?: () => void
  onCreateMovie?: () => void
  onDelete?: () => Promise<void>
  onRestore?: () => Promise<void>
  onPermanentDelete?: () => Promise<void>
  onClear: () => void
}) {
  const compactViewport = useMediaQuery('(max-width:899.95px)')
  const albumTriggerRef = useRef<HTMLButtonElement | null>(null)
  const albumSubmitRef = useRef(false)
  const [albumID, setAlbumID] = useState('')
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false)
  const [albumQuery, setAlbumQuery] = useState('')
  const [albumError, setAlbumError] = useState('')
  const [albumBusy, setAlbumBusy] = useState(false)
  const [albumSelectionCount, setAlbumSelectionCount] = useState(selectedCount)
  const [albumSelectionIdentity, setAlbumSelectionIdentity] = useState(selectionIdentity)
  const albumViewport = useXDriveMobilePanelViewport(compactViewport && albumPickerOpen)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagsInput, setTagsInput] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false)
  const trashMode = Boolean(onRestore || onPermanentDelete)
  const manualAlbums = useMemo(
    () => albums.filter((album) => album.kind === 'manual'),
    [albums],
  )
  const tags = parseSelectionTags(tagsInput)
  const disabled = busy || selectedCount === 0
  const filteredAlbums = useMemo(
    () => manualAlbums.filter((album) => album.name.toLocaleLowerCase('zh-CN')
      .includes(albumQuery.trim().toLocaleLowerCase('zh-CN'))),
    [manualAlbums, albumQuery],
  )
  const albumSelectionChanged = selectedCount !== albumSelectionCount ||
    albumSelectionIdentity !== selectionIdentity
  useEffect(() => {
    if (compactViewport || !albumPickerOpen) return
    setAlbumPickerOpen(false)
  }, [compactViewport, albumPickerOpen])

  const openAlbumPicker = () => {
    setAlbumSelectionCount(selectedCount)
    setAlbumSelectionIdentity(selectionIdentity)
    setAlbumID('')
    setAlbumQuery('')
    setAlbumError('')
    setAlbumPickerOpen(true)
  }
  const closeAlbumPicker = () => {
    if (albumBusy) return
    setAlbumPickerOpen(false)
    setAlbumError('')
  }
  const confirmAlbumPicker = async () => {
    if (!onAddToAlbum || busy || albumBusy || albumSubmitRef.current ||
        albumSelectionChanged || selectedCount === 0) return
    const album = manualAlbums.find((entry) => entry.id === albumID)
    if (!album) return
    albumSubmitRef.current = true
    setAlbumBusy(true)
    setAlbumError('')
    try {
      await onAddToAlbum(album)
      setAlbumID('')
      setAlbumPickerOpen(false)
    } catch (reason) {
      setAlbumError(xDriveMediaGalleryErrorMessage(reason))
    } finally {
      albumSubmitRef.current = false
      setAlbumBusy(false)
    }
  }

  return (
    <>
      <Paper
        variant="outlined"
        data-xdrive-gallery-selection-toolbar
        sx={{
          position: 'sticky',
          top: 8,
          zIndex: 4,
          px: 1.25,
          py: 0.75,
          borderRadius: 2,
          bgcolor: 'background.paper',
          boxShadow: 1,
          '& .MuiButton-root, & .MuiIconButton-root': compactViewport ? { minHeight: 44 } : undefined,
        }}
      >
        <Stack direction={compactViewport ? 'column' : 'row'} spacing={1}
          alignItems={compactViewport ? 'stretch' : 'center'}
          useFlexGap flexWrap={compactViewport ? 'nowrap' : 'wrap'}
          sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center"
            sx={{ minHeight: compactViewport ? 44 : undefined, minWidth: 0 }}>
          <IconButton
            size="small"
            aria-label="退出选择"
            onClick={onClear}
            disabled={busy}
            sx={compactViewport ? { width: 44, height: 44, flex: '0 0 44px' } : undefined}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <Typography role="status" variant="body2" fontWeight={700}
            sx={{ mr: 0.5, minWidth: 0, overflowWrap: 'anywhere' }}>
            已选择 {selectedCount.toLocaleString('zh-CN')} 项
          </Typography>
          {trashMode ? (
            <Typography variant="caption" color="text.secondary">
              对应 {trashRootCount.toLocaleString('zh-CN')} 个回收站条目
              {trashIncludesFolderRoot ? ' · 包含已删除文件夹' : ''}
            </Typography>
          ) : null}
          {busy ? <CircularProgress size={18} /> : null}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center"
            sx={compactViewport ? {
              minWidth: 0, overflowX: 'auto', overflowY: 'hidden',
              flexWrap: 'nowrap', overscrollBehaviorX: 'contain',
              pb: 0.5, '& .MuiButton-root': {
                minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap',
              },
            } : { minWidth: 0 }}
          >
          {onRestore ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<RestoreFromTrashRoundedIcon />}
              onClick={() => { void onRestore().catch(() => undefined) }}
            >
              恢复
            </Button>
          ) : null}
          {onFavorite && !trashMode ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={allFavorite ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
              onClick={() => { void onFavorite(!allFavorite).catch(() => undefined) }}
            >
              {allFavorite ? '取消收藏' : '收藏'}
            </Button>
          ) : null}
          {onAddToAlbum && !trashMode && (compactViewport || manualAlbums.length > 0) ? (
            compactViewport ? (
              <Button ref={albumTriggerRef} size="small" disabled={disabled}
                onClick={openAlbumPicker}>
                加入相册
              </Button>
            ) : (
              <TextField
                select
                size="small"
                label="添加到相册"
                value={albumID}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.value
                  setAlbumID(next)
                  const album = manualAlbums.find((item) => item.id === next)
                  if (!album) return
                  void onAddToAlbum(album).catch(() => undefined).finally(() => setAlbumID(''))
                }}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">选择相册</MenuItem>
                {manualAlbums.map((album) => (
                  <MenuItem key={album.id} value={album.id}>{album.name}</MenuItem>
                ))}
              </TextField>
            )
          ) : null}
          {onAddTags && !trashMode ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<LabelOutlinedIcon />}
              onClick={() => setTagsOpen(true)}
            >
              标签
            </Button>
          ) : null}
          {onDownload && !trashMode ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<DownloadRoundedIcon />}
              onClick={() => { void onDownload().catch(() => undefined) }}
            >
              下载
            </Button>
          ) : null}
          {onCreateCollage && !trashMode ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<GridViewRoundedIcon />}
              onClick={onCreateCollage}
            >
              拼图
            </Button>
          ) : null}
          {onCreateMovie && !trashMode ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<MovieCreationOutlinedIcon />}
              onClick={onCreateMovie}
            >
              自动电影
            </Button>
          ) : null}
          {onDelete && !trashMode ? (
            <Button
              size="small"
              color="error"
              disabled={disabled}
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => setDeleteOpen(true)}
            >
              删除
            </Button>
          ) : null}
          {onPermanentDelete ? (
            <Button
              size="small"
              color="error"
              disabled={disabled}
              startIcon={<DeleteForeverRoundedIcon />}
              onClick={() => setPermanentDeleteOpen(true)}
            >
              永久删除
            </Button>
          ) : null}
          </Stack>
        </Stack>
      </Paper>

      <Drawer anchor="bottom" open={compactViewport && albumPickerOpen}
        onClose={closeAlbumPicker}
        slotProps={{ paper: {
          role: 'dialog',
          'aria-label': '选择手动相册',
          sx: {
            bottom: albumViewport ? albumViewport.bottom + 'px' : undefined,
            maxHeight: albumViewport ? albumViewport.height + 'px' :
              'calc(100dvh - env(safe-area-inset-top, 0px))',
            height: albumViewport ? 'min(540px, ' + albumViewport.height + 'px)' : 'min(540px, 100dvh)',
            minHeight: 0, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
          },
        } }}
      >
        <Stack direction="row" alignItems="center" spacing={1}
          sx={{ minHeight: 52, px: 1.5, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap',
            alignItems: 'baseline', columnGap: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>加入手动相册</Typography>
            <Typography variant="caption" role="status">
              已选择 {selectedCount.toLocaleString('zh-CN')} 项
            </Typography>
          </Box>
          <IconButton aria-label="关闭相册选择" onClick={closeAlbumPicker}
            disabled={albumBusy} sx={{ width: 44, height: 44 }}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box data-xdrive-gallery-album-picker-content
          sx={{ minHeight: 0, flex: '1 1 auto', overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <Box sx={{ p: 1.5, flexShrink: 0 }}>
            <TextField fullWidth size="small" label="搜索相册"
              placeholder="输入手动相册名称" value={albumQuery}
              disabled={albumBusy}
              onChange={(event) => setAlbumQuery(event.target.value)} />
          </Box>
          <List data-xdrive-gallery-album-picker
            sx={{ py: 0 }}>
            {filteredAlbums.length === 0 ? (
              <Typography variant="body2" role="status" color="text.secondary"
                sx={{ px: 1.5, py: 2 }}>
                {manualAlbums.length === 0 ? '暂无手动相册，请先在相册页面创建。' : '没有匹配的手动相册'}
              </Typography>
            ) : filteredAlbums.map((album) => (
              <ListItemButton key={album.id} selected={albumID === album.id}
                disabled={albumBusy || busy || albumSelectionChanged}
                onClick={() => {
                  setAlbumID(album.id)
                  setAlbumError('')
                }}
                sx={{ minHeight: 44, gap: 1.5, px: 2 }}>
                <Typography variant="body2" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                  {album.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {album.item_count.toLocaleString('zh-CN')} 项
                </Typography>
              </ListItemButton>
            ))}
          </List>
          {albumSelectionChanged ? (
            <Typography color="warning.main" role="alert" sx={{ px: 1.5, pt: 0.5 }}>
              选择范围已变化，请关闭后重新打开相册选择器。
            </Typography>
          ) : null}
          {albumError ? (
            <Typography color="error" role="alert"
              sx={{ px: 1.5, pt: 0.5, overflowWrap: 'anywhere' }}>
              {albumError}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1}
            sx={{ px: 1.5, py: 1, pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
              borderTop: 1, borderColor: 'divider', flexShrink: 0,
              '& .MuiButton-root': { minHeight: 44, flex: 1 } }}>
            <Button disabled={albumBusy} onClick={closeAlbumPicker}>取消</Button>
            <Button variant="contained"
              disabled={albumBusy || busy || albumSelectionChanged || !albumID}
              onClick={() => { void confirmAlbumPicker() }}>
              {albumBusy ? '正在添加…' : '添加到相册'}
            </Button>
          </Stack>
        </Box>
      </Drawer>

      <Dialog
        open={tagsOpen}
        onClose={() => !busy && setTagsOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="添加标签"
          subtitle="标签会追加到所有已选择项目，不会覆盖已有标签。"
          onClose={() => !busy && setTagsOpen(false)}
        />
        <XDriveDialogContent dividers>
          <TextField
            autoFocus
            fullWidth
            label="标签"
            placeholder="家庭, 旅行"
            value={tagsInput}
            disabled={busy}
            onChange={(event) => setTagsInput(event.target.value)}
            helperText="使用逗号分隔；最多 32 个标签。"
          />
        </XDriveDialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setTagsOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={busy || tags.length === 0}
            onClick={() => {
              if (!onAddTags) return
              void onAddTags(tags).then(() => {
                setTagsInput('')
                setTagsOpen(false)
              }).catch(() => undefined)
            }}
          >
            添加
          </Button>
        </DialogActions>
      </Dialog>

      <XDriveConfirmDialog
        open={permanentDeleteOpen}
        title="永久删除所选照片或视频？"
        description={
          trashIncludesFolderRoot
            ? `将永久删除 ${trashRootCount.toLocaleString('zh-CN')} 个回收站条目；其中包含已删除文件夹，文件夹内的全部内容也会一起删除。此操作无法撤销。`
            : `将永久删除 ${trashRootCount.toLocaleString('zh-CN')} 个回收站条目。此操作无法撤销。`
        }
        confirmLabel="永久删除"
        confirmIntent="danger"
        loading={busy}
        onCancel={() => setPermanentDeleteOpen(false)}
        onConfirm={() => {
          if (!onPermanentDelete) return
          void onPermanentDelete()
            .then(() => setPermanentDeleteOpen(false))
            .catch(() => undefined)
        }}
      />

      <XDriveConfirmDialog
        open={deleteOpen}
        title="删除所选照片或视频？"
        description={`将 ${selectedCount.toLocaleString('zh-CN')} 个项目移到回收站。删除任务可在任务中心查看和取消。`}
        confirmLabel="删除"
        confirmIntent="danger"
        loading={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!onDelete) return
          void onDelete().then(() => setDeleteOpen(false)).catch(() => undefined)
        }}
      />
    </>
  )
}
