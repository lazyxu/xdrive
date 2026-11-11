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
        // The real five-slot mobile dock is 56px (+ iOS safe-area).
        // Position feedback *above* it, not over the Files destination.
        // Desktop keeps its regular bottom-right placement.
        bottom: { xs: 'calc(64px + env(safe-area-inset-bottom))', sm: '24px' },
        right: { xs: '8px', sm: '24px' },
        left: { xs: '8px', sm: 'auto' },
        '@media (orientation: landscape) and (max-height: 500px)': {
          bottom: 'calc(52px + env(safe-area-inset-bottom))',
        },
        // Snackbar's fixed 1400-z-index root must not steal navigation taps
        // outside the actual visible Alert. Explicit dismiss remains usable.
        pointerEvents: 'none',
        '& > div': { pointerEvents: 'none' },
        // A passive toast (even a tall/error toast) must not intercept the
        // persistent five-slot dock; only genuine actions may receive taps.
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
