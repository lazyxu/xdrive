import type { XDriveWorkspaceContentPresentation } from './WorkspaceContent'

export const XDRIVE_CORE_WORKSPACE_KEYS = [
  'files',
  'gallery',
  'device-backup',
  'remote-pull',
  'transfers',
  'global-tasks',
  'local-storage',
  'cloud-storage',
] as const

export type XDriveCoreWorkspaceKey = typeof XDRIVE_CORE_WORKSPACE_KEYS[number]
export type XDriveRemoteWorkspaceKey = Exclude<XDriveCoreWorkspaceKey, 'local-storage'>

export type XDriveWorkspaceViewKey<TExtension extends string = never> =
  | XDriveCoreWorkspaceKey
  | TExtension

export type XDriveRemoteWorkspaceViewKey<TExtension extends string = never> =
  | XDriveRemoteWorkspaceKey
  | TExtension

export function xDriveWorkspacePresentation(
  view: string,
): XDriveWorkspaceContentPresentation {
  return view === 'files' ? 'files' : 'page'
}

// The navigation vocabulary belongs to the application, not to Electron or DSM.
// Host-specific capabilities affect actions and readiness, not the page registry.
export const XDRIVE_APP_WORKSPACE_ROUTES = [
  'overview',
  ...XDRIVE_CORE_WORKSPACE_KEYS,
  'conflicts',
  'diagnostics',
  'admin-users',
  'admin-audit',
  'admin-storage',
  'admin-services',
  'admin-maintenance',
] as const

export type XDriveWorkspaceAppRoute = typeof XDRIVE_APP_WORKSPACE_ROUTES[number]

const workspaceAppRoutes = new Set<string>(XDRIVE_APP_WORKSPACE_ROUTES)

export function xDriveIsWorkspaceAppRoute(value: string): value is XDriveWorkspaceAppRoute {
  return workspaceAppRoutes.has(value)
}

export function xDriveWorkspaceRouteRequiresAdmin(view: string): boolean {
  return view === 'global-tasks' || view.startsWith('admin-')
}

// One UI route-admission policy for every Host. Backend checks remain mandatory.
export function xDriveWorkspaceNavigationAllowed(view: string, serverAdminVerified: boolean): boolean {
  // Settings is a dialog action, not a content page.
  if (view === 'settings') return true
  return xDriveIsWorkspaceAppRoute(view) &&
    (!xDriveWorkspaceRouteRequiresAdmin(view) || serverAdminVerified)
}


// Every route, including Files, belongs to the ONE canonical outlet.
// A Host's authorized controller/data capability affects only page contents,
// not route admission or the route registry.
export const XDRIVE_SHARED_HOST_PAGE_ROUTES = XDRIVE_APP_WORKSPACE_ROUTES
const sharedHostPages = new Set<string>(XDRIVE_SHARED_HOST_PAGE_ROUTES)
export function xDriveIsSharedHostPageRoute(view: string): boolean {
  return sharedHostPages.has(view)
}
