import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceContent } from './WorkspaceContent'
import { XDriveAppPageOutlet } from './XDriveAppPageOutlet'
import {
  xDriveIsSharedHostPageRoute,
  xDriveWorkspacePresentation,
  type XDriveWorkspaceAppRoute,
} from './WorkspaceRoute'
import type { XDriveWorkspaceHostAdapter } from './WorkspaceHostAdapter'

/**
 * The canonical route/content frame for Desktop and authenticated DSM.
 *
 * Migrated pages use one shared outlet; Desktop Files is the remaining
 * transitional Host controller (which already renders shared FileExplorer).
 * DSM Files uses its real, authenticated Owner cursor read port.
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
  const presentation = xDriveWorkspacePresentation(view)
  // Only Desktop's existing Files controller remains outside the outlet.
  // Never use this exception to create another Host-specific page registry.
  const usesSharedOutlet = xDriveIsSharedHostPageRoute(view) ||
    (view === 'files' && host.platform === 'synology')

  return (
    <XDriveWorkspaceContent
      presentation={presentation}
      responsive={host.platform === 'synology'}
      sx={presentation === 'files' ? undefined : pageSx}
    >
      {children}
      {usesSharedOutlet ? (
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
      ) : null}
    </XDriveWorkspaceContent>
  )
}
