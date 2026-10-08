import type { ReactNode } from 'react'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import type { XDriveSidebarBadgeValue } from './SidebarNav'
import type { XDriveCoreWorkspaceKey } from './WorkspaceRoute'

export type XDriveSidebarDestinationModel = {
  key: string
  label: ReactNode
  compactLabel?: ReactNode
  icon: ReactNode
  badge?: XDriveSidebarBadgeValue
  secondary?: ReactNode
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
    { key: 'files', label: '文件', icon: <CloudOutlinedIcon fontSize="small" /> },
    { key: 'gallery', label: '图库', icon: <PhotoLibraryRoundedIcon fontSize="small" /> },
    { key: 'sources', label: '同步文件夹', icon: <CloudSyncRoundedIcon fontSize="small" /> },
    {
      key: 'transfers',
      label: '任务',
      compactLabel: '任务',
      icon: <TaskAltRoundedIcon fontSize="small" />,
      badge: transferBadge,
    },
    ...(showLocalStorage
      ? [{ key: 'local-storage' as const, label: '本地存储', icon: <StorageRoundedIcon fontSize="small" /> }]
      : []),
    { key: 'cloud-storage', label: '云端存储', icon: <CloudRoundedIcon fontSize="small" /> },
  ]
}

const compactPrimaryKeys = ['overview', 'files', 'gallery', 'transfers'] as const

export function xDriveCompactWorkspaceNavigation({
  sections = [],
  transferBadge,
  showLocalStorage = false,
}: {
  sections?: XDriveSidebarSectionModel[]
  transferBadge?: XDriveSidebarBadgeValue
  showLocalStorage?: boolean
} = {}): {
  primary: XDriveSidebarDestinationModel[]
  moreSections: XDriveSidebarSectionModel[]
} {
  const orderedSections: XDriveSidebarSectionModel[] = [
    ...sections.filter((section) => section.placement === 'before-core'),
    { key: 'core', items: xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage }) },
    ...sections.filter((section) => (section.placement ?? 'after-core') === 'after-core'),
    ...sections.filter((section) => section.placement === 'bottom'),
  ]
  const destinations = orderedSections.flatMap((section) => section.items)
  const primary = compactPrimaryKeys.flatMap((key) => {
    const destination = destinations.find((item) => item.key === key)
    return destination ? [destination] : []
  })
  const primaryKeys = new Set(primary.map((destination) => destination.key))
  const moreSections = orderedSections
    .map((section) => ({
      ...section,
      items: section.items.filter((destination) => !primaryKeys.has(destination.key)),
    }))
    .filter((section) => section.items.length > 0)

  return { primary, moreSections }
}
