import { useMemo, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { MediaAlbum } from '../models'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'

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
  allFavorite,
  albums,
  busy = false,
  onFavorite,
  onAddToAlbum,
  onAddTags,
  onDownload,
  onDelete,
  onClear,
}: {
  selectedCount: number
  allFavorite: boolean
  albums: MediaAlbum[]
  busy?: boolean
  onFavorite?: (favorite: boolean) => Promise<void>
  onAddToAlbum?: (album: MediaAlbum) => Promise<void>
  onAddTags?: (tags: string[]) => Promise<void>
  onDownload?: () => Promise<void>
  onDelete?: () => Promise<void>
  onClear: () => void
}) {
  const [albumID, setAlbumID] = useState('')
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagsInput, setTagsInput] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const manualAlbums = useMemo(
    () => albums.filter((album) => album.kind === 'manual'),
    [albums],
  )
  const tags = parseSelectionTags(tagsInput)
  const disabled = busy || selectedCount === 0

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
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <IconButton
            size="small"
            aria-label="退出选择"
            onClick={onClear}
            disabled={busy}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2" fontWeight={700} sx={{ mr: 0.5 }}>
            已选择 {selectedCount.toLocaleString('zh-CN')} 项
          </Typography>
          {busy ? <CircularProgress size={18} /> : null}
          {onFavorite ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={allFavorite ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
              onClick={() => { void onFavorite(!allFavorite).catch(() => undefined) }}
            >
              {allFavorite ? '取消收藏' : '收藏'}
            </Button>
          ) : null}
          {onAddToAlbum && manualAlbums.length > 0 ? (
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
          ) : null}
          {onAddTags ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<LabelOutlinedIcon />}
              onClick={() => setTagsOpen(true)}
            >
              标签
            </Button>
          ) : null}
          {onDownload ? (
            <Button
              size="small"
              disabled={disabled}
              startIcon={<DownloadRoundedIcon />}
              onClick={() => { void onDownload().catch(() => undefined) }}
            >
              下载
            </Button>
          ) : null}
          {onDelete ? (
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
        </Stack>
      </Paper>

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
