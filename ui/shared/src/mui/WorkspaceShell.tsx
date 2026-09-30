import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDRIVE_SIDEBAR_COMPACT_WIDTH, XDRIVE_SIDEBAR_WIDTH } from './SidebarNav'

export function XDriveWorkspaceShell({
  children,
  responsive = false,
  className,
  sx,
}: {
  children: ReactNode
  responsive?: boolean
  className?: string
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      className={className}
      sx={[
        {
          width: '100%',
          minWidth: 0,
          minHeight: 0,
          height: responsive ? { xs: 'auto', md: '100%' } : '100%',
          display: responsive ? { xs: 'block', md: 'grid' } : 'grid',
          gridTemplateColumns: responsive
            ? { md: `${XDRIVE_SIDEBAR_WIDTH}px minmax(0, 1fr)` }
            : `${XDRIVE_SIDEBAR_WIDTH}px minmax(0, 1fr)`,
          overflow: responsive ? { xs: 'visible', md: 'hidden' } : 'hidden',
          bgcolor: 'background.default',
          ...(responsive
            ? {}
            : {
                '@media (max-width: 960px)': {
                  gridTemplateColumns: `${XDRIVE_SIDEBAR_COMPACT_WIDTH}px minmax(0, 1fr)`,
                },
              }),
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  )
}
