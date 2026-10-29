import type { ReactNode } from 'react'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import BackupRoundedIcon from '@mui/icons-material/BackupRounded'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'
import type { XDriveSidebarBadgeValue } from './SidebarNav'
import type { XDriveCoreWorkspaceKey } from './WorkspaceRoute'
import { xDriveWorkspaceRouteTitle } from './WorkspaceRouteTitles'

export type XDriveSidebarDestinationModel = {
  key: string
  label: ReactNode
  compactLabel?: ReactNode
  icon: ReactNode
  badge?: XDriveSidebarBadgeValue
  secondary?: ReactNode
}

export function xDriveDiagnosticsSidebarDestination(): XDriveSidebarDestinationModel {
  return { key: 'diagnostics', label: xDriveWorkspaceRouteTitle('diagnostics'), icon: <BuildRoundedIcon fontSize="small" /> }
}

// The same settings entry may open the canonical shared SettingsDialog.
export function xDriveSettingsSidebarDestination(): XDriveSidebarDestinationModel {
  return { key: 'settings', label: '设置', icon: <SettingsRoundedIcon fontSize="small" /> }
}

export type XDriveSidebarSectionPlacement = 'before-core' | 'after-core' | 'bottom'

export type XDriveSidebarSectionModel = {
  key: string
  label?: ReactNode
  ariaLabel?: string
  placement?: XDriveSidebarSectionPlacement
  items: XDriveSidebarDestinationModel[]
}

export function xDriveCoreWorkspaceDestinations({
  transferBadge,
  showLocalStorage = false,
}: {
  transferBadge?: XDriveSidebarBadgeValue
  showLocalStorage?: boolean
} = {}): (XDriveSidebarDestinationModel & { key: XDriveCoreWorkspaceKey })[] {
  return [
    { key: 'files', label: xDriveWorkspaceRouteTitle('files'), icon: <CloudOutlinedIcon fontSize="small" /> },
    { key: 'gallery', label: xDriveWorkspaceRouteTitle('gallery'), icon: <PhotoLibraryRoundedIcon fontSize="small" /> },
    { key: 'device-backup', label: xDriveWorkspaceRouteTitle('device-backup'), icon: <BackupRoundedIcon fontSize="small" /> },
    { key: 'remote-pull', label: xDriveWorkspaceRouteTitle('remote-pull'), icon: <CloudDownloadRoundedIcon fontSize="small" /> },
    {
      key: 'transfers',
      label: xDriveWorkspaceRouteTitle('transfers'),
      compactLabel: xDriveWorkspaceRouteTitle('transfers'),
      icon: <AssignmentOutlinedIcon fontSize="small" />,
      badge: transferBadge,
    },
    ...(showLocalStorage
      ? [{ key: 'local-storage' as const, label: xDriveWorkspaceRouteTitle('local-storage'), icon: <StorageRoundedIcon fontSize="small" /> }]
      : []),
    { key: 'cloud-storage', label: xDriveWorkspaceRouteTitle('cloud-storage'), icon: <CloudRoundedIcon fontSize="small" /> },
  ]
}

const compactPrimaryKeys = ['overview', 'files', 'gallery', 'transfers'] as const

export function xDriveCompactWorkspaceNavigation({
  sections = [],
  transferBadge,
  showLocalStorage = false,
  coreKeys,
  primaryKeys,
}: {
  sections?: XDriveSidebarSectionModel[]
  transferBadge?: XDriveSidebarBadgeValue
  showLocalStorage?: boolean
  coreKeys?: readonly XDriveCoreWorkspaceKey[]
  /** Host-specific compact order, including honest extension destinations. */
  primaryKeys?: readonly string[]
} = {}): {
  primary: XDriveSidebarDestinationModel[]
  moreSections: XDriveSidebarSectionModel[]
} {
  const orderedSections: XDriveSidebarSectionModel[] = [
    ...sections.filter((section) => section.placement === 'before-core'),
    { key: 'core', items: xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage })
      .filter((item) => coreKeys === undefined || coreKeys.includes(item.key)) },
    ...sections.filter((section) => (section.placement ?? 'after-core') === 'after-core'),
    ...sections.filter((section) => section.placement === 'bottom'),
  ]
  const destinations = orderedSections.flatMap((section) => section.items)
  // Only authentic capabilities are navigable in a narrowly scoped DSM host.
  const activePrimaryKeys = primaryKeys ?? (coreKeys === undefined ? compactPrimaryKeys : coreKeys)
  const primary = activePrimaryKeys.flatMap((key) => {
    const destination = destinations.find((item) => item.key === key)
    return destination ? [destination] : []
  })
  const promotedDestinationKeys = new Set(primary.map((destination) => destination.key))
  const moreSections = orderedSections
    .map((section) => ({
      ...section,
      items: section.items.filter((destination) => !promotedDestinationKeys.has(destination.key)),
    }))
    .filter((section) => section.items.length > 0)

  return { primary, moreSections }
}
