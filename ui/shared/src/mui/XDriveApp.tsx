import { useLayoutEffect } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { xDriveEnterForegroundPage } from './ViewerForegroundPriority'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceFrame } from './WorkspaceShell'
import { XDriveWorkspaceSidebar } from './WorkspaceSidebar'
import { XDriveAppRouteContent } from './XDriveAppRouteContent'
import { xDriveWorkspaceNavigationAllowed, type XDriveWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

// All Hosts use the same viewport breakpoints and default content padding.
// Native titlebar and DSM session handling stay outside this shared layout.
const XDRIVE_SHARED_PAGE_SX: SxProps<Theme> = { p: { xs: 2, md: '34px 40px 48px' } }

export type XDriveAppSidebarProps = Omit<
  ComponentProps<typeof XDriveWorkspaceSidebar>, 'selected' | 'onSelect' | 'responsive'
>

/**
 * Canonical desktop/DSM application frame. Both hosts mount this component,
 * and provide only platform-specific data and native integrations.
 *
 * The application owns route composition and the page outlet. Host controllers
 * provide authenticated data, host-wide notices and modal overlays.
 */
export function XDriveApp({
  host,
  view,
  onNavigate: onRequestedNavigate,
  sidebar,
  shellSx,
  pageSx = XDRIVE_SHARED_PAGE_SX,
  revision = 0,
  overlays,
  children,
}: {
  host: XDriveWorkspaceHostAdapter
  view: XDriveWorkspaceAppRoute
  onNavigate: (view: string) => void
  sidebar: XDriveAppSidebarProps
  shellSx?: SxProps<Theme>
  pageSx?: SxProps<Theme>
  revision?: number
  /** Dialogs outside the scrollable page; never a Host-owned page registry. */
  overlays?: ReactNode
  /** Host-wide notices only; every route, including Files, uses the outlet. */
  children?: ReactNode
}) {
  // Responsive navigation is determined by MUI viewport width, never by Host identity.
  // The canonical Host renderer owns one page scope for every admitted route.
  // Desktop's earlier intent notification is idempotent; DSM shares this UI.
  useLayoutEffect(() => {
    xDriveEnterForegroundPage(`${host.platform}:${view}`)
  }, [host.platform, view])
  // Keep a single privileged-route gate before forwarding any sidebar action.
  // Unknown and admin-only destinations must never reach Host callbacks.
  const onNavigate = (destination: string) => {
    if (!xDriveWorkspaceNavigationAllowed(destination, host.adminRoleVerified === true)) return
    onRequestedNavigate(destination)
  }
  return (
    <XDriveWorkspaceFrame
      sx={shellSx}
      sidebar={
        <XDriveWorkspaceSidebar
          {...sidebar}
          selected={view}
          responsive
          onSelect={onNavigate}
        />
      }
      overlays={overlays}
    >
      <XDriveAppRouteContent
        host={host}
        view={view}
        revision={revision}
        onNavigate={onNavigate}
        pageSx={pageSx}
      >
        {children}
      </XDriveAppRouteContent>
    </XDriveWorkspaceFrame>
  )
}
