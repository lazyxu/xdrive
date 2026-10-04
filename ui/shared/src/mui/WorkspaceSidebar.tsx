import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import {
  XDriveCoreWorkspaceNavItems,
  XDriveSidebarNavItem,
  XDriveSidebarNavList,
  XDriveSidebarSection,
  XDriveSidebarSurface,
} from './SidebarNav'
import type { XDriveSidebarAppearance } from './SidebarNav'
import { XDriveSidebarStorageSummary } from './SidebarStorageSummary'

export type XDriveSidebarDestination = {
  key: string
  label: ReactNode
  icon: ReactNode
  badge?: ReactNode
  secondary?: ReactNode
}

export type XDriveWorkspaceSidebarSectionModel = {
  key: string
  label?: ReactNode
  ariaLabel: string
  items: XDriveSidebarDestination[]
  pinnedBottom?: boolean
}

export type XDriveWorkspaceSidebarStorageSummary = {
  usedBytes: number
  totalBytes: number
  diskTotalBytes?: number
  diskAvailableBytes?: number
}

function SidebarDestinationItem({
  destination,
  selected,
  appearance,
  onSelect,
}: {
  destination: XDriveSidebarDestination
  selected?: string
  appearance: XDriveSidebarAppearance
  onSelect: (key: string) => void
}) {
  return (
    <XDriveSidebarNavItem
      selected={selected === destination.key}
      icon={destination.icon}
      primary={destination.label}
      secondary={destination.secondary}
      badge={destination.badge}
      appearance={appearance}
      onClick={() => onSelect(destination.key)}
    />
  )
}

export function XDriveWorkspaceSidebar({
  selected,
  transferBadge,
  showLocalStorage = false,
  leadingItems = [],
  trailingItems = [],
  sections = [],
  storageSummary,
  appearance = 'light',
  responsive = false,
  className,
  ariaLabel,
  navAriaLabel,
  onSelect,
}: {
  selected?: string
  transferBadge?: ReactNode
  showLocalStorage?: boolean
  leadingItems?: XDriveSidebarDestination[]
  trailingItems?: XDriveSidebarDestination[]
  sections?: XDriveWorkspaceSidebarSectionModel[]
  storageSummary?: XDriveWorkspaceSidebarStorageSummary | null
  appearance?: XDriveSidebarAppearance
  responsive?: boolean
  className?: string
  ariaLabel: string
  navAriaLabel: string
  onSelect: (key: string) => void
}) {
  return (
    <XDriveSidebarSurface
      ariaLabel={ariaLabel}
      appearance={appearance}
      responsive={responsive}
      className={className}
    >
      <XDriveSidebarNavList ariaLabel={navAriaLabel} responsive={responsive}>
        {leadingItems.map((destination) => (
          <SidebarDestinationItem
            key={destination.key}
            destination={destination}
            selected={selected}
            appearance={appearance}
            onSelect={onSelect}
          />
        ))}
        <XDriveCoreWorkspaceNavItems
          selected={selected}
          transferBadge={transferBadge}
          appearance={appearance}
          showLocalStorage={showLocalStorage}
          onSelect={(key) => onSelect(key)}
        />
        {trailingItems.map((destination) => (
          <SidebarDestinationItem
            key={destination.key}
            destination={destination}
            selected={selected}
            appearance={appearance}
            onSelect={onSelect}
          />
        ))}
      </XDriveSidebarNavList>

      {sections.map((section) => (
        <XDriveSidebarSection
          key={section.key}
          label={section.label}
          appearance={appearance}
          responsive={responsive}
          pinnedBottom={section.pinnedBottom}
        >
          <XDriveSidebarNavList ariaLabel={section.ariaLabel} responsive={responsive}>
            {section.items.map((destination) => (
              <SidebarDestinationItem
                key={destination.key}
                destination={destination}
                selected={selected}
                appearance={appearance}
                onSelect={onSelect}
              />
            ))}
          </XDriveSidebarNavList>
        </XDriveSidebarSection>
      ))}

      {storageSummary ? (
        <Box
          sx={{
            display: responsive ? { xs: 'none', md: 'block' } : 'block',
            mt: sections.some((section) => section.pinnedBottom) ? 0 : 'auto',
            pt: 1.25,
          }}
        >
          <XDriveSidebarStorageSummary
            usedBytes={storageSummary.usedBytes}
            totalBytes={storageSummary.totalBytes}
            diskTotalBytes={storageSummary.diskTotalBytes}
            diskAvailableBytes={storageSummary.diskAvailableBytes}
            appearance={appearance}
          />
        </Box>
      ) : null}
    </XDriveSidebarSurface>
  )
}
