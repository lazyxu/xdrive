import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceRouteSurface } from './WorkspaceRouteSurface'
import { XDriveAppPageOutlet } from './XDriveAppPageOutlet'
import {
  xDriveIsSharedHostPageRoute,
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
  // Only the existing Desktop Files child is transitional. Any Host without
  // that legacy controller uses the shared outlet, where a missing authorized
  // Owner Files port produces an explicit unavailable state (not a blank page).
  // No platform-specific Files route or second page registry is needed.
  const hasLegacyFilesContent = view === 'files' && children != null && children !== false
  const usesSharedOutlet = xDriveIsSharedHostPageRoute(view) ||
    (view === 'files' && !hasLegacyFilesContent)

  return (
    <XDriveWorkspaceRouteSurface
      view={view}
      sx={view === 'files' ? undefined : pageSx}
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
    </XDriveWorkspaceRouteSurface>
  )
}
