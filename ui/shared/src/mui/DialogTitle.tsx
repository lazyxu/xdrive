import type { ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Box, DialogTitle, IconButton, Typography, useMediaQuery } from '@mui/material'

export const xDriveDialogPaperProps = {
  sx: {
    maxHeight: { xs: '92vh', sm: '84vh' },
    borderRadius: { xs: 1.5, sm: 2 },
    overflow: 'hidden',
    backgroundImage: 'none',
    boxShadow: 6,
  },
} as const

export function useXDriveCompactTouchDialog() {
  const compactTouch = useMediaQuery('(max-width:899.95px) and (pointer: coarse)')
  const dialogPaper = compactTouch
    ? {
        sx: {
          ...xDriveDialogPaperProps.sx,
          width: '100vw',
          height: '100dvh',
          // Do not let the large/layout viewport outgrow the dynamic visual viewport.
          minHeight: '100dvh',
          maxHeight: 'none',
          m: 0,
          borderRadius: 0,
          boxSizing: 'border-box',
          pt: 'env(safe-area-inset-top)',
          pb: 'env(safe-area-inset-bottom)',
          '& .MuiDialogTitle-root .MuiIconButton-root': {
            width: 44,
            height: 44,
          },
        },
      }
    : xDriveDialogPaperProps

  return { compactTouch, dialogPaper }
}

export function XDriveDialogTitle({
  title,
  titleId,
  subtitle,
  onClose,
  closeDisabled = false,
}: {
  title: ReactNode
  titleId?: string
  subtitle?: ReactNode
  onClose: () => void
  closeDisabled?: boolean
}) {
  // DialogTitle normally inherits the Paper label ID through MUI context.
  // When the caller labels Paper from the inner text-only Typography, give
  // this outer wrapper a different ID so the close button cannot enter the
  // accessible name through a duplicate-ID collision.
  return (
    <DialogTitle
      id={titleId ? `${titleId}-container` : undefined}
      sx={{
        minHeight: 64,
        px: 2.5,
        py: 1.75,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography id={titleId} component="div" variant="h6" fontWeight={700} sx={{ lineHeight: 1.35, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 0.4, overflowWrap: 'anywhere' }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      <IconButton
        aria-label="关闭弹窗"
        title="关闭"
        size="small"
        disabled={closeDisabled}
        onClick={onClose}
        sx={{
          flex: '0 0 auto', mt: -0.4, mr: -0.5,
          '@media (max-width:899.95px) and (pointer: coarse)': { width: 44, height: 44 },
        }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </DialogTitle>
  )
}
