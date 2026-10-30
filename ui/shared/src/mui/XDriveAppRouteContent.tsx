import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceRouteSurface } from './WorkspaceRouteSurface'
import { XDriveAppPageOutlet } from './XDriveAppPageOutlet'
import { XDriveWorkspaceHostAlerts } from './WorkspaceHostAlerts'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

/**
 * The canonical route/content frame for Desktop and authenticated DSM.
 *
 * Every page, including Files, is dispatched by one shared outlet. The
 * Desktop Files controller remains a transitional, explicitly supplied Host
 * element inside that outlet; DSM Files uses an authenticated Owner cursor.
 *
 * The Files route must use the same edge-to-edge layout on both Hosts.
 * Ordinary page padding must never leak into the virtualized Files viewport.
 */
export function XDriveAppRouteContent({
  host,
  view,
  revision = 0,
  onNavigate,
  pageSx,
  children,
}: {
  host: XDriveWorkspaceHostAdapter
  view: XDriveWorkspaceAppRoute
  revision?: number
  onNavigate?: (view: XDriveWorkspaceAppRoute) => void
  pageSx?: SxProps<Theme>
  children?: ReactNode
}) {
  // Children are host-wide alerts (not page replacements). A single outlet
  // owns Files routing and page instance disposal on both Desktop and DSM.
  return (
    <XDriveWorkspaceRouteSurface
      view={view}
      sx={view === 'files' ? undefined : pageSx}
    >
      {children}
      {host.services?.workspaceAlerts ? (
        <XDriveWorkspaceHostAlerts view={view} {...host.services.workspaceAlerts} />
      ) : null}
      <XDriveAppPageOutlet
          // A React page instance belongs to one Host, route, role and refresh.
          // In particular, Mine/Global Tasks reuse a component type but must
          // never retain each other's async state; same-route DSM refresh must
          // remount and dispose old page reads before the successor loads.
          // Only this disposable UI subtree remounts: Agent/Server jobs persist.
          key={`${host.platform}:${view}:${host.adminRoleVerified === true ? 'admin' : 'user'}:${revision}`}
          host={host}
          view={view}
          revision={revision}
          onNavigate={onNavigate}
        />
    </XDriveWorkspaceRouteSurface>
  )
}
