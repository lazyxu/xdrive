import { useCallback, useEffect, useRef, useState } from 'react'
import { xDriveEnterForegroundPage } from './ViewerForegroundPriority'
import {
  xDriveIsWorkspaceAppRoute,
  xDriveWorkspaceNavigationAllowed,
} from './WorkspaceRoute'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'

export type XDriveWorkspaceNavigationState = {
  readonly selected: XDriveWorkspaceAppRoute
  readonly pageRevision: number
}

/** Pure, Host-neutral route admission; a settings dialog is never a page. */
export function xDriveNextWorkspaceNavigationState(
  previous: XDriveWorkspaceNavigationState,
  destination: string,
  serverAdminVerified: boolean,
): XDriveWorkspaceNavigationState | null {
  if (!xDriveIsWorkspaceAppRoute(destination) ||
      !xDriveWorkspaceNavigationAllowed(destination, serverAdminVerified)) return null
  if (destination !== previous.selected) return { selected: destination, pageRevision: 0 }
  return {
    selected: destination,
    pageRevision: previous.pageRevision < Number.MAX_SAFE_INTEGER
      ? previous.pageRevision + 1 : 0,
  }
}

/**
 * Reusable application route state, never a DSM page registry. An admitted
 * route yields obsolete disposable reads before React mounts the new page.
 * Same-route requests remount only disposable page content; persistent
 * transfers, backup jobs, sync operations and Agent state are unaffected.
 *
 * Keep the latest state in a ref because rapid route intents may arrive before
 * React paints the preceding update. Role gating is independent of platform.
 */
export function useXDriveWorkspaceNavigationState({
  platform,
  adminRoleVerified,
  initialView = 'overview',
}: {
  platform: 'desktop' | 'synology'
  adminRoleVerified: boolean
  initialView?: XDriveWorkspaceAppRoute
}) {
  const [state, setState] = useState<XDriveWorkspaceNavigationState>(() => ({
    selected: xDriveWorkspaceNavigationAllowed(initialView, adminRoleVerified)
      ? initialView : 'overview',
    pageRevision: 0,
  }))
  const latest = useRef(state)
  const navigate = useCallback((destination: string) => {
    const old = latest.current
    const next = xDriveNextWorkspaceNavigationState(old, destination, adminRoleVerified)
    if (!next) return false
    latest.current = next
    if (next.selected !== old.selected) {
      xDriveEnterForegroundPage(`${platform}:${next.selected}`)
    }
    setState(next)
    return true
  }, [platform, adminRoleVerified])

  // If Server-verified privileges are revoked, retire the privileged page.
  // The shared outlet's independent role gate still denies it immediately.
  useEffect(() => {
    if (!xDriveWorkspaceNavigationAllowed(latest.current.selected, adminRoleVerified)) {
      navigate('overview')
    }
  }, [adminRoleVerified, navigate])

  return {
    selected: state.selected,
    pageRevision: state.pageRevision,
    navigate,
  }
}
