import type { ReactNode } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Box, DialogTitle, IconButton, Typography } from '@mui/material'

export const xDriveDialogPaperProps = {
  sx: {
    maxHeight: { xs: '92vh', sm: '84vh' },
    borderRadius: { xs: 1.5, sm: 2 },
    overflow: 'hidden',
    backgroundImage: 'none',
    boxShadow: 6,
  },
} as const

export function XDriveDialogTitle({
  title,
  subtitle,
  onClose,
  closeDisabled = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  closeDisabled?: boolean
}) {
  return (
    <DialogTitle
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
        <Typography component="div" variant="h6" fontWeight={700} sx={{ lineHeight: 1.35 }}>
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
        sx={{ flex: '0 0 auto', mt: -0.4, mr: -0.5 }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </DialogTitle>
  )
}
