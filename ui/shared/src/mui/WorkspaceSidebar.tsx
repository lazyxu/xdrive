import type { MouseEvent, ReactNode } from 'react'
import type { QuotaUsage } from '../models'
import { Box, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { XDriveCoreWorkspaceKey } from './WorkspaceRoute'
import {
  XDriveCoreWorkspaceNavItems,
  XDriveSidebarNavItem,
  XDriveSidebarNavList,
  XDriveSidebarSection,
  XDriveSidebarSurface,
} from './SidebarNav'
import type { XDriveSidebarAppearance, XDriveSidebarBadgeValue } from './SidebarNav'
import { XDriveSidebarStorageSummary } from './SidebarStorageSummary'
import { XDriveWorkspaceCompactNavigation } from './WorkspaceCompactNavigation'
import { xDriveCompactWorkspaceNavigation } from './WorkspaceNavigation'
import type { XDriveSidebarDestinationModel, XDriveSidebarSectionModel, XDriveSidebarSectionPlacement } from './WorkspaceNavigation'

export type { XDriveSidebarDestinationModel, XDriveSidebarSectionModel, XDriveSidebarSectionPlacement } from './WorkspaceNavigation'

export type XDriveWorkspaceSidebarStorageSummary = {
  usedBytes: number
  totalBytes: number
  diskTotalBytes?: number
  diskAvailableBytes?: number
}

export function xDriveWorkspaceStorageSummary(
  quota: Pick<
    QuotaUsage,
    'physical_used_bytes' | 'quota_bytes' | 'disk_total_bytes' | 'disk_available_bytes'
  > | null | undefined,
): XDriveWorkspaceSidebarStorageSummary | null {
  if (!quota) return null
  return {
    usedBytes: quota.physical_used_bytes,
    totalBytes: quota.quota_bytes,
    diskTotalBytes: quota.disk_total_bytes,
    diskAvailableBytes: quota.disk_available_bytes,
  }
}

function sectionPlacement(section: XDriveSidebarSectionModel): XDriveSidebarSectionPlacement {
  return section.placement ?? 'after-core'
}

function sectionIsInline(section: XDriveSidebarSectionModel) {
  return sectionPlacement(section) !== 'bottom' && section.label == null
}

function SidebarDestinationItem({
  destination,
  selected,
  appearance,
  disabled = false,
  onSelect,
}: {
  destination: XDriveSidebarDestinationModel
  selected?: string
  appearance: XDriveSidebarAppearance
  disabled?: boolean
  onSelect: (key: string, event: MouseEvent<HTMLElement>) => void
}) {
  return (
    <XDriveSidebarNavItem
      selected={selected === destination.key}
      icon={destination.icon}
      primary={destination.label}
      secondary={destination.secondary}
      badge={destination.badge}
      appearance={appearance}
      disabled={disabled}
      onClick={(event) => { if (!disabled) onSelect(destination.key, event) }}
    />
  )
}

function SidebarSectionBlock({
  section,
  selected,
  appearance,
  responsive,
  pinnedBottom = false,
  disabled = false,
  fallbackAriaLabel,
  onSelect,
}: {
  section: XDriveSidebarSectionModel
  selected?: string
  appearance: XDriveSidebarAppearance
  responsive: boolean
  pinnedBottom?: boolean
  disabled?: boolean
  fallbackAriaLabel: string
  onSelect: (key: string, event: MouseEvent<HTMLElement>) => void
}) {
  return (
    <XDriveSidebarSection
      label={section.label}
      appearance={appearance}
      responsive={responsive}
      pinnedBottom={pinnedBottom}
    >
      <XDriveSidebarNavList ariaLabel={section.ariaLabel ?? fallbackAriaLabel} responsive={responsive}>
        {section.items.map((destination) => (
          <SidebarDestinationItem
            key={destination.key}
            destination={destination}
            selected={selected}
            appearance={appearance}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </XDriveSidebarNavList>
    </XDriveSidebarSection>
  )
}

export function XDriveWorkspaceSidebar({
  selected,
  transferBadge,
  showLocalStorage = false,
  coreKeys,
  compactPrimaryKeys,
  sections = [],
  storageSummary,
  appearance = 'light',
  responsive = false,
  compactFullscreen = false,
  compactOpen,
  onCompactOpenChange,
  compactActions,
  disabled = false,
  className,
  ariaLabel,
  navAriaLabel,
  onSelect,
}: {
  selected?: string
  transferBadge?: XDriveSidebarBadgeValue
  showLocalStorage?: boolean
  coreKeys?: readonly XDriveCoreWorkspaceKey[]
  compactPrimaryKeys?: readonly string[]
  sections?: XDriveSidebarSectionModel[]
  storageSummary?: XDriveWorkspaceSidebarStorageSummary | null
  appearance?: XDriveSidebarAppearance
  responsive?: boolean
  compactFullscreen?: boolean
  compactOpen?: boolean
  onCompactOpenChange?: (open: boolean) => void
  compactActions?: ReactNode
  disabled?: boolean
  className?: string
  ariaLabel: string
  navAriaLabel: string
  onSelect: (key: string, event: MouseEvent<HTMLElement>) => void
}) {
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'))
  if (responsive && narrow) {
    const navigation = xDriveCompactWorkspaceNavigation({
      sections, transferBadge, showLocalStorage, coreKeys, primaryKeys: compactPrimaryKeys,
    })
    return (
      <XDriveWorkspaceCompactNavigation
        {...navigation}
        selected={selected}
        storageSummary={storageSummary}
        appearance={appearance}
        className={className}
        ariaLabel={ariaLabel}
        navAriaLabel={navAriaLabel}
        disabled={disabled}
        fullscreen={compactFullscreen}
        open={compactOpen}
        onOpenChange={onCompactOpenChange}
        actions={compactActions}
        onSelect={onSelect}
      />
    )
  }

  const beforeCoreSections = sections.filter((section) => sectionPlacement(section) === 'before-core')
  const afterCoreSections = sections.filter((section) => sectionPlacement(section) === 'after-core')
  const bottomSections = sections.filter((section) => sectionPlacement(section) === 'bottom')
  const beforeCoreInlineItems = beforeCoreSections.filter(sectionIsInline).flatMap((section) => section.items)
  const afterCoreInlineItems = afterCoreSections.filter(sectionIsInline).flatMap((section) => section.items)
  const beforeCoreBlocks = beforeCoreSections.filter((section) => !sectionIsInline(section))
  const afterCoreBlocks = afterCoreSections.filter((section) => !sectionIsInline(section))

  return (
    <XDriveSidebarSurface
      ariaLabel={ariaLabel}
      appearance={appearance}
      responsive={responsive}
      className={className}
    >
      {beforeCoreBlocks.map((section) => (
        <SidebarSectionBlock
          key={section.key}
          section={section}
          selected={selected}
          appearance={appearance}
          responsive={responsive}
          disabled={disabled}
          fallbackAriaLabel={navAriaLabel}
          onSelect={onSelect}
        />
      ))}

      <XDriveSidebarNavList ariaLabel={navAriaLabel} responsive={responsive}>
        {beforeCoreInlineItems.map((destination) => (
          <SidebarDestinationItem
            key={destination.key}
            destination={destination}
            selected={selected}
            appearance={appearance}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
        <XDriveCoreWorkspaceNavItems
          selected={selected}
          transferBadge={transferBadge}
          appearance={appearance}
          showLocalStorage={showLocalStorage}
          coreKeys={coreKeys}
          disabled={disabled}
          onSelect={(key, event) => { if (!disabled) onSelect(key, event) }}
        />
        {afterCoreInlineItems.map((destination) => (
          <SidebarDestinationItem
            key={destination.key}
            destination={destination}
            selected={selected}
            appearance={appearance}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </XDriveSidebarNavList>

      {afterCoreBlocks.map((section) => (
        <SidebarSectionBlock
          key={section.key}
          section={section}
          selected={selected}
          appearance={appearance}
          responsive={responsive}
          disabled={disabled}
          fallbackAriaLabel={navAriaLabel}
          onSelect={onSelect}
        />
      ))}

      {bottomSections.map((section, index) => (
        <SidebarSectionBlock
          key={section.key}
          section={section}
          selected={selected}
          appearance={appearance}
          responsive={responsive}
          pinnedBottom={index === 0}
          disabled={disabled}
          fallbackAriaLabel={navAriaLabel}
          onSelect={onSelect}
        />
      ))}

      {storageSummary ? (
        <Box
          sx={{
            display: responsive ? { xs: 'none', md: 'block' } : 'block',
            mt: bottomSections.length > 0 ? 0 : 'auto',
            pt: 1.25,
          }}
        >
          <XDriveSidebarStorageSummary
            label="我的云端存储"
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
