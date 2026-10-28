import { useLayoutEffect } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { xDriveEnterForegroundPage } from './ViewerForegroundPriority'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveStatePanel } from './StatePanel'
import { XDriveWorkspaceShell } from './WorkspaceShell'
import { XDriveWorkspaceSidebar } from './WorkspaceSidebar'
import {
  xDriveIsWorkspaceAppRoute,
  xDriveWorkspaceRouteRequiresAdmin,
  xDriveWorkspaceNavigationAllowed,
  type XDriveWorkspaceAppRoute,
} from './WorkspaceRoute'

// The UI application is host-neutral. Platform-specific filesystem access,
// credentials, IPC and service API clients belong in host adapters, never here.
export type XDriveWorkspaceHostAdapter = {
  readonly platform: 'desktop' | 'synology'
  /** DSM may only register working, authenticated Owner-scoped renderers. */
  readonly pages?: Readonly<Partial<Record<XDriveWorkspaceAppRoute, {
    readonly render: () => ReactNode
  }>>>
  /** Only set after the Server, not the DSM UI, verifies an admin role. */
  readonly adminRoleVerified?: boolean
  readonly unavailableMessage?: (view: XDriveWorkspaceAppRoute) => string
}

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
  // Both Desktop and DSM mount this same XDriveApp. Page identity is
  // accepted only AFTER the Host route/role admission; old disposable
  // background readers yield, while this Host's current page is admitted.
  // Desktop's earlier intent signal and this committed Host signal are
  // intentionally idempotent. DSM never invents an Electron/Agent action.
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

/**
 * Common page outlet for hosts with externally registered page renderers.
 * A missing adapter is a real unavailable state, never invented data or a
 * second host-specific page. Owner role and capability checks remain in
 * the actual DSM CGI / Agent / Server for every operation.
 */
export function XDriveAppPageOutlet({
  host,
  view,
}: {
  host: XDriveWorkspaceHostAdapter
  view: string
}) {
  if (!xDriveIsWorkspaceAppRoute(view)) {
    return <XDriveStatePanel message="未知的 xDrive 页面。" />
  }
  if (xDriveWorkspaceRouteRequiresAdmin(view) && host.adminRoleVerified !== true) {
    return <XDriveStatePanel message="此页面需要经过 xDrive Server 确认的管理员身份。" />
  }
  const page = host.pages?.[view]
  if (!page) {
    return (
      <XDriveStatePanel message={
        host.unavailableMessage?.(view) ??
        '此宿主尚未接通当前功能。界面与 Desktop 共用，操作需要真实的宿主能力。'
      } />
    )
  }
  return <>{page.render()}</>
}
