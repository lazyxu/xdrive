import type { KeyboardEvent, ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import KeyboardArrowLeftRoundedIcon from '@mui/icons-material/KeyboardArrowLeftRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { Box, Dialog, DialogContent, IconButton, Stack, Tooltip, Typography } from '@mui/material'

export type XDriveOpenPreviewDialogProps = {
  open: boolean
  title?: ReactNode
  positionLabel?: ReactNode
  quickLook?: boolean
  canPrevious?: boolean
  canNext?: boolean
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  children: ReactNode
}

export function XDriveOpenPreviewDialog({
  open,
  title,
  positionLabel,
  quickLook = false,
  canPrevious = false,
  canNext = false,
  onPrevious,
  onNext,
  onClose,
  children,
}: XDriveOpenPreviewDialogProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape' || (quickLook && event.key === ' ')) {
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
      open={open}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      maxWidth="lg"
      fullWidth
      aria-label={quickLook ? '快速预览' : '打开预览'}
      data-xdrive-open-preview-dialog
      data-xdrive-file-quick-look={quickLook || undefined}
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
          {title}
        </Typography>
        {positionLabel ? (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {positionLabel}
          </Typography>
        ) : null}
        <Tooltip title={quickLook ? '关闭（Space / Esc）' : '关闭（Esc）'}>
          <IconButton size="small" aria-label="关闭预览" onClick={onClose}>
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <DialogContent sx={{ position: 'relative', p: 0, minHeight: 0, overflow: 'hidden', bgcolor: 'background.default' }}>
        <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex' }}>
          {children}
        </Box>

        <Tooltip title="上一个">
          <span>
            <IconButton
              aria-label="预览上一个项目"
              disabled={!canPrevious}
              onClick={onPrevious}
              sx={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                bgcolor: 'background.paper',
                boxShadow: 2,
                '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <KeyboardArrowLeftRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="下一个">
          <span>
            <IconButton
              aria-label="预览下一个项目"
              disabled={!canNext}
              onClick={onNext}
              sx={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                bgcolor: 'background.paper',
                boxShadow: 2,
                '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <KeyboardArrowRightRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </DialogContent>

      <Stack direction="row" alignItems="center" justifyContent="center" sx={{ minHeight: 32, px: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {quickLook ? 'Space / Esc 关闭 · ← / → 切换' : 'Esc 关闭 · ← / → 切换'}
        </Typography>
      </Stack>
    </Dialog>
  )
}
