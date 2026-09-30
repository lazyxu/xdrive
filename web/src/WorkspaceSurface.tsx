import type { ReactNode } from 'react'
import { Box, Dialog, Typography } from '@mui/material'
import {
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'

export type WorkspacePresentation = 'dialog' | 'page'

export default function WorkspaceSurface({
  presentation = 'dialog',
  open = false,
  onClose,
  title,
  maxWidth = 'lg',
  dialogActions,
  children,
}: {
  presentation?: WorkspacePresentation
  open?: boolean
  onClose?: () => void
  title: string
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false
  dialogActions?: ReactNode
  children: ReactNode
}) {
  const close = onClose ?? (() => undefined)

  if (presentation === 'page') {
    return (
      <Box component="section" className="workspace-page-surface" sx={{ width: '100%', minWidth: 0 }}>
        <Typography component="h1" variant="h5" fontWeight={700}>
          {title}
        </Typography>
        <Box sx={{ mt: 2 }}>{children}</Box>
      </Box>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth={maxWidth}
      fullWidth
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
    >
      <XDriveDialogTitle title={title} onClose={close} />
      <XDriveDialogContent dividers>{children}</XDriveDialogContent>
      {dialogActions ? <XDriveDialogActions>{dialogActions}</XDriveDialogActions> : null}
    </Dialog>
  )
}
