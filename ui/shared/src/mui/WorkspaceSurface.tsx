import type { ReactNode } from 'react'
import { Box, Dialog } from '@mui/material'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDrivePageHeader } from './PageHeader'

export type XDriveWorkspacePresentation = 'dialog' | 'page'

export function XDriveWorkspaceSurface({
  presentation = 'dialog',
  open = false,
  onClose,
  title,
  subtitle,
  pageActions,
  showPageHeader = true,
  maxWidth = 'lg',
  dialogActions,
  children,
}: {
  presentation?: XDriveWorkspacePresentation
  open?: boolean
  onClose?: () => void
  title: string
  subtitle?: ReactNode
  pageActions?: ReactNode
  showPageHeader?: boolean
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false
  dialogActions?: ReactNode
  children: ReactNode
}) {
  const close = onClose ?? (() => undefined)

  if (presentation === 'page') {
    return (
      <Box component="section" className="workspace-page-surface" sx={{ width: '100%', minWidth: 0 }}>
        {showPageHeader ? (
          <XDrivePageHeader title={title} subtitle={subtitle} actions={pageActions} />
        ) : null}
        <Box sx={{ mt: showPageHeader ? 2 : 0 }}>{children}</Box>
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
