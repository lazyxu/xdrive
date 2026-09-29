import type { ReactNode } from 'react'
import { Box, DialogActions } from '@mui/material'

export function XDriveDialogActions({ children }: { children: ReactNode }) {
  return (
    <DialogActions
      sx={{
        minHeight: 58,
        px: { xs: 1.5, sm: 2 },
        py: 1.25,
        gap: 1,
        bgcolor: 'action.hover',
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
        '& > :not(style) ~ :not(style)': { ml: 0 },
      }}
    >
      {children}
    </DialogActions>
  )
}

export function XDriveDialogActionSpacer() {
  return (
    <Box
      aria-hidden
      sx={{
        flex: '1 1 auto',
        flexBasis: { xs: '100%', sm: 'auto' },
        height: { xs: 0, sm: 'auto' },
      }}
    />
  )
}
