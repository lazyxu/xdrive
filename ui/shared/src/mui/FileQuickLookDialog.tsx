import type { KeyboardEvent, ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { Box, Dialog, DialogContent, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import type { XDriveFilePreviewTarget } from '../file-preview'
import { XDriveFilePreviewSurface } from './FilePreviewSurface'
import type {
  XDriveFilePreviewImageLoader,
  XDriveFilePreviewTextLoader,
  XDriveFilePreviewURLLoader,
} from './FilePreviewSurface'

export type XDriveFileQuickLookDialogProps<T extends XDriveFilePreviewTarget = XDriveFilePreviewTarget> = {
  open: boolean
  item: T | null
  positionLabel?: ReactNode
  loadTextPreview?: XDriveFilePreviewTextLoader<T>
  loadImagePreview?: XDriveFilePreviewImageLoader<T>
  loadPreviewURL?: XDriveFilePreviewURLLoader<T>
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}

export function XDriveFileQuickLookDialog<T extends XDriveFilePreviewTarget>({
  open,
  item,
  positionLabel,
  loadTextPreview,
  loadImagePreview,
  loadPreviewURL,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  onClose,
}: XDriveFileQuickLookDialogProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === ' ' || event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowLeft' && canPrevious && onPrevious) {
      event.preventDefault()
      onPrevious()
      return
    }
    if (event.key === 'ArrowRight' && canNext && onNext) {
      event.preventDefault()
      onNext()
    }
  }

  return (
    <Dialog
      open={open && Boolean(item)}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      maxWidth="lg"
      fullWidth
      aria-label="快速预览"
      data-xdrive-file-quick-look
      slotProps={{
        paper: {
          sx: {
            width: 'min(1080px, calc(100vw - 32px))',
            height: { xs: '78vh', sm: '82vh' },
            maxHeight: 820,
            borderRadius: { xs: 1.5, sm: 2 },
            overflow: 'hidden',
            backgroundImage: 'none',
          },
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 48, px: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {item?.name ?? ''}
        </Typography>
        {positionLabel ? <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{positionLabel}</Typography> : null}
        <Tooltip title="关闭（Space / Esc）">
          <IconButton size="small" aria-label="关闭快速预览" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <DialogContent sx={{ position: 'relative', p: 0, minHeight: 0, overflow: 'hidden', bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex' }}>
          <XDriveFilePreviewSurface
            target={item}
            loadTextPreview={loadTextPreview}
            loadImagePreview={loadImagePreview}
            loadPreviewURL={loadPreviewURL}
            fallback={(
              <Stack spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 4 }}>
                <InsertDriveFileRoundedIcon sx={{ fontSize: 64 }} />
                <Typography variant="body2">此文件暂无可用预览</Typography>
              </Stack>
            )}
            minHeight={320}
            maxHeight={760}
          />
        </Box>

        <Tooltip title="上一个">
          <span>
            <IconButton aria-label="预览上一个文件" disabled={!canPrevious} onClick={onPrevious} sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
              <KeyboardArrowLeftRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="下一个">
          <span>
            <IconButton aria-label="预览下一个文件" disabled={!canNext} onClick={onNext} sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', bgcolor: 'background.paper', boxShadow: 2, '&:hover': { bgcolor: 'background.paper' } }}>
              <KeyboardArrowRightRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </DialogContent>

      <Stack direction="row" alignItems="center" justifyContent="center" sx={{ minHeight: 32, px: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">Space / Esc 关闭 · ← / → 切换</Typography>
      </Stack>
    </Dialog>
  )
}
