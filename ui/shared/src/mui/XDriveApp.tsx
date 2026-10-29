import { useLayoutEffect } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { xDriveEnterForegroundPage } from './ViewerForegroundPriority'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceShell } from './WorkspaceShell'
import { XDriveWorkspaceSidebar } from './WorkspaceSidebar'
import { XDriveAppRouteContent } from './XDriveAppRouteContent'
import { xDriveWorkspaceNavigationAllowed, type XDriveWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

export type XDriveAppSidebarProps = Omit<
  ComponentProps<typeof XDriveWorkspaceSidebar>, 'selected' | 'onSelect' | 'responsive'
>

/**
 * Canonical desktop/DSM application frame. Both hosts mount this component,
 * and provide only platform-specific data and native integrations.
 *
 * The application owns route composition and the page outlet. Host controllers
 * provide authenticated data, optional legacy Files content and modal overlays.
 */
export function XDriveApp({
  host,
  view,
  onNavigate: onRequestedNavigate,
  sidebar,
  shellSx,
  pageSx,
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
  /** Transitional Desktop Files controller; shared outlet owns all other pages. */
  children?: ReactNode
}) {
  const responsive = host.platform === 'synology'
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
    <XDriveWorkspaceShell responsive={responsive} sx={shellSx}>
      <XDriveWorkspaceSidebar
        {...sidebar}
        selected={view}
        responsive={responsive}
        onSelect={onNavigate}
      />
      <XDriveAppRouteContent
        host={host}
        view={view}
        revision={revision}
        onNavigate={onNavigate}
        pageSx={pageSx}
      >
        {children}
      </XDriveAppRouteContent>
      {overlays}
    </XDriveWorkspaceShell>
  )
}
