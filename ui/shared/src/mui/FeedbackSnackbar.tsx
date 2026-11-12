import type { ReactNode } from 'react'
import { Snackbar } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { XDriveStatusTone } from './StatusBadge'
import { XDriveStatusAlert } from './StatusAlert'

export function XDriveFeedbackSnackbar({
  open,
  tone,
  message,
  onClose,
  autoHideDuration = 3500,
  variant = 'standard',
  dismissible = false,
  alertSx,
}: {
  open: boolean
  tone: XDriveStatusTone
  message: ReactNode
  onClose: () => void
  autoHideDuration?: number | null
  variant?: 'standard' | 'outlined' | 'filled'
  dismissible?: boolean
  alertSx?: SxProps<Theme>
}) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      sx={{
        // Keep passive feedback above the five-slot dock without intercepting
        // taps anywhere outside explicit action controls.
        bottom: { xs: 'calc(64px + env(safe-area-inset-bottom))', sm: '24px' },
        '@media (orientation: landscape) and (max-height: 500px)': {
          bottom: 'calc(52px + env(safe-area-inset-bottom))',
        },
        pointerEvents: 'none',
        '& > div': { pointerEvents: 'none' },
        '& a[href], & button, & [role="button"]': { pointerEvents: 'auto' },
      }}
      onClose={(_event, reason) => {
        if (reason !== 'clickaway') onClose()
      }}
    >
      <div>
        <XDriveStatusAlert
          tone={tone}
          variant={variant}
          onClose={dismissible ? onClose : undefined}
          sx={alertSx}
        >
          {message}
        </XDriveStatusAlert>
      </div>
    </Snackbar>
  )
}
