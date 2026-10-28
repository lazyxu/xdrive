import type { ComponentProps, ReactNode } from 'react'
import { Box } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveVersionHistoryDialog } from './VersionHistoryDialog'
import { XDriveShareDialog } from './ShareDialog'

/**
 * Canonical Files page surface for every Host. A Host supplies its genuine
 * Owner-scoped controller and only supported dialog adapters, never a new
 * page implementation or generic privileged Agent/CGI proxy.
 *
 * The route frame provides full-bleed Files geometry. This nested section
 * bounds the real virtualized FileExplorer, including short viewports.
 */
export function XDriveFilesWorkspacePage({
  children,
  overQuota = false,
  historyDialog,
  shareDialog,
}: {
  children: ReactNode
  overQuota?: boolean
  historyDialog?: ComponentProps<typeof XDriveVersionHistoryDialog>
  shareDialog?: ComponentProps<typeof XDriveShareDialog>
}) {
  return (
    <Box
      component="section"
      data-xdrive-files-workspace
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        '& > [data-xdrive-file-explorer]': {
          flex: 1,
          minHeight: 0,
        },
      }}
    >
      {overQuota ? (
        <XDriveStatusAlert tone="bad" sx={{ m: 1.5 }}>
          存储空间已超出配额。请永久删除回收站内容，或联系管理员提高配额。
        </XDriveStatusAlert>
      ) : null}
      {children}
      {historyDialog ? <XDriveVersionHistoryDialog {...historyDialog} /> : null}
      {shareDialog ? <XDriveShareDialog {...shareDialog} /> : null}
    </Box>
  )
}
