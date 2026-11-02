import type { ReactNode } from 'react'
import { Box, Dialog, Typography } from '@mui/material'
import { XDriveMobileHeaderPageActions, useXDriveMobileHeaderMode } from './MobileHeaderPortal'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDrivePageHeader } from './PageHeader'

export type XDriveWorkspacePresentation = 'dialog' | 'page'

export function XDriveWorkspaceSurface({
  presentation = 'dialog',
  fillHeight = false,
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
  /** Constrain a full-screen Files workspace without affecting ordinary pages. */
  fillHeight?: boolean
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
  const mobileShell = useXDriveMobileHeaderMode() === 'shell'

  if (presentation === 'page') {
    return (
      <Box component="section" className="workspace-page-surface" sx={{
        width: '100%',
        minWidth: 0,
        ...(mobileShell ? { px: 2, pt: 1.5 } : {}),
        ...(fillHeight ? {
          flex: 1,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        } : {}),
      }}>
        {showPageHeader && !mobileShell ? (
          <XDrivePageHeader title={title} subtitle={subtitle} actions={pageActions} />
        ) : null}
        {showPageHeader && mobileShell ? (
          <>
            <XDriveMobileHeaderPageActions title={title} actions={pageActions} />
            {subtitle ? (
              <Typography data-xdrive-mobile-page-subtitle variant="body2"
                color="text.secondary">{subtitle}</Typography>
            ) : null}
          </>
        ) : null}
        <Box sx={{
          mt: showPageHeader ? (mobileShell ? (subtitle ? 1.5 : 0) : 2) : 0,
          ...(fillHeight ? {
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          } : {}),
        }}>{children}</Box>
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
