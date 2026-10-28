import { useLayoutEffect } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { xDriveEnterForegroundPage } from './ViewerForegroundPriority'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceShell } from './WorkspaceShell'
import { XDriveWorkspaceSidebar } from './WorkspaceSidebar'
import { xDriveWorkspaceNavigationAllowed, type XDriveWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

export type XDriveAppSidebarProps = Omit<
  ComponentProps<typeof XDriveWorkspaceSidebar>, 'selected' | 'onSelect' | 'responsive'
>

/**
 * Canonical desktop/DSM application frame. Both hosts mount this component,
 * and provide only platform-specific data and native integrations.
 *
 * Children deliberately include the shared content and modal overlays while
 * Desktop's existing controller is being extracted in a later migration.
 */
export function XDriveApp({
  host,
  view,
  onNavigate: onRequestedNavigate,
  sidebar,
  shellSx,
  children,
}: {
  host: XDriveWorkspaceHostAdapter
  view: XDriveWorkspaceAppRoute
  onNavigate: (view: string) => void
  sidebar: XDriveAppSidebarProps
  shellSx?: SxProps<Theme>
  children: ReactNode
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
      {children}
    </XDriveWorkspaceShell>
  )
}
