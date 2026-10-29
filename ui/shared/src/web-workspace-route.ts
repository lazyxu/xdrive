import { XDRIVE_WEB_APP_IDS } from './web-app'
import type { XDriveWebAppID, XDriveWebAppRoute } from './web-app'
import {
  xDriveIsWorkspaceAppRoute,
  type XDriveWorkspaceAppRoute,
} from './mui/WorkspaceRoute'

// Keep Web's historical media/preview/deep-link IDs, but resolve the visible
// workspace from ONE Desktop/DSM authoritative registry. Never treat a Viewer,
// legacy hash, unknown string or unverified Host operation as a new route.
const webIDs = new Set<string>(XDRIVE_WEB_APP_IDS)

/** Web route -> canonical workspace; the server still resolves legacy Source IDs. */
export function xDriveWorkspaceKeyFromWebApp(
  app: XDriveWebAppID,
  params?: XDriveWebAppRoute['params'],
): XDriveWorkspaceAppRoute | undefined {
  if (app === 'sync-folders') return 'remote-pull'
  if (app === 'tasks') {
    return params && 'scope' in params && params.scope === 'global'
      ? 'global-tasks' : 'transfers'
  }
  return xDriveIsWorkspaceAppRoute(app) ? app : undefined
}

/** Canonical workspace -> browser program, without inventing unsupported pages. */
export function xDriveWebAppForWorkspaceRoute(key: string): XDriveWebAppID | null {
  if (!xDriveIsWorkspaceAppRoute(key)) return null
  if (key === 'transfers' || key === 'global-tasks') return 'tasks'
  return webIDs.has(key) ? key as XDriveWebAppID : null
}

/** Preserve stable task scope, browser hashes and Web's historic Viewer routing. */
export function xDriveWebRouteForWorkspaceRoute(key: string): XDriveWebAppRoute | null {
  const app = xDriveWebAppForWorkspaceRoute(key)
  if (!app) return null
  if (app === 'tasks') {
    return { app, params: { scope: key === 'global-tasks' ? 'global' : 'mine' } }
  }
  return { app, params: {} } as XDriveWebAppRoute
}
