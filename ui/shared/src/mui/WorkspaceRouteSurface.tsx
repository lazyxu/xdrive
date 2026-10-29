import type { ReactNode } from 'react'
import type { SxProps, Theme } from '@mui/material/styles'
import { XDriveWorkspaceContent } from './WorkspaceContent'
import { xDriveWorkspacePresentation } from './WorkspaceRoute'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'

/**
 * One route-to-main presentation boundary for all React browser Hosts.
 * Desktop/DSM provide the canonical page outlet; Web/PWA supply their
 * existing authenticated controller until its typed data ports migrate.
 *
 * No additional DOM shell, Owner authority, network request, service worker,
 * background task, Viewer or native Host action is created here.
 */
export function XDriveWorkspaceRouteSurface({
  view,
  children,
  sx,
  className,
}: {
  view: XDriveWorkspaceAppRoute
  children: ReactNode
  sx?: SxProps<Theme>
  className?: string
}) {
  return (
    <XDriveWorkspaceContent
      responsive
      presentation={xDriveWorkspacePresentation(view)}
      className={className}
      sx={sx}
    >
      {children}
    </XDriveWorkspaceContent>
  )
}
