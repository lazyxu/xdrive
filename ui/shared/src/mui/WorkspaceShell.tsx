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
          height: '100%',
          display: responsive ? { xs: 'flex', md: 'grid' } : 'grid',
          flexDirection: 'column',
          gridTemplateColumns: responsive
            ? { md: `${XDRIVE_SIDEBAR_WIDTH}px minmax(0, 1fr)` }
            : `${XDRIVE_SIDEBAR_WIDTH}px minmax(0, 1fr)`,
          overflow: 'hidden',
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

/**
 * Canonical responsive workspace frame for Electron, authenticated DSM and
 * Web/PWA (also rendered by the iOS WKWebView Host). Hosts provide authenticated
 * navigation and page content, but not a second frame implementation. The
 * invisible browser resume input is a leading slot so it keeps its existing DOM
 * order and user-gesture handling. Viewer/PWA runtime stay outside this frame.
 */
export function XDriveWorkspaceFrame({
  sidebar,
  leading,
  children,
  overlays,
  className,
  sx,
}: {
  sidebar: ReactNode
  leading?: ReactNode
  children: ReactNode
  overlays?: ReactNode
  className?: string
  sx?: SxProps<Theme>
}) {
  return (
    <XDriveWorkspaceShell responsive className={className} sx={sx}>
      {leading}
      {sidebar}
      {children}
      {overlays}
    </XDriveWorkspaceShell>
  )
}
