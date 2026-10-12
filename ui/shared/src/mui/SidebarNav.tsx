import type { MouseEvent, ReactNode } from 'react'
import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import type { XDriveCoreWorkspaceKey } from './WorkspaceRoute'
import { xDriveCoreWorkspaceDestinations } from './WorkspaceNavigation'

export const XDRIVE_SIDEBAR_WIDTH = 184
export const XDRIVE_SIDEBAR_COMPACT_WIDTH = 176

export type XDriveSidebarAppearance = 'light' | 'dark'
export type XDriveSidebarBadgeValue = string | number

export function XDriveSidebarSurface({
  children,
  ariaLabel,
  appearance = 'light',
  responsive = false,
  className,
}: {
  children: ReactNode
  ariaLabel: string
  appearance?: XDriveSidebarAppearance
  responsive?: boolean
  className?: string
}) {
  const dark = appearance === 'dark'

  return (
    <Box
      component="aside"
      aria-label={ariaLabel}
      className={className}
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: responsive ? { xs: 'auto', md: '100%' } : '100%',
        display: 'flex',
        flexDirection: responsive ? { xs: 'row', md: 'column' } : 'column',
        bgcolor: dark ? '#101827' : 'background.paper',
        color: dark ? '#e8eef9' : 'text.primary',
        borderRight: responsive ? { xs: 0, md: 1 } : 1,
        borderBottom: responsive ? { xs: 1, md: 0 } : 0,
        borderColor: dark ? 'rgba(255,255,255,.08)' : 'divider',
        px: responsive ? { xs: 1, md: 1.25 } : 1.25,
        pt: responsive ? { xs: 1, md: 1.25 } : 1.5,
        pb: responsive ? { xs: 1, md: 1.25 } : 1.25,
        overflowX: responsive ? { xs: 'auto', md: 'hidden' } : 'hidden',
        overflowY: responsive ? { xs: 'hidden', md: 'auto' } : 'auto',
      }}
    >
      {children}
    </Box>
  )
}

export function XDriveSidebarSection({
  children,
  label,
  appearance = 'light',
  responsive = false,
  pinnedBottom = false,
}: {
  children: ReactNode
  label?: ReactNode
  appearance?: XDriveSidebarAppearance
  responsive?: boolean
  pinnedBottom?: boolean
}) {
  const dark = appearance === 'dark'

  return (
    <Box
      sx={{
        display: responsive ? { xs: 'contents', md: 'block' } : 'block',
        mt: pinnedBottom ? 'auto' : responsive ? { xs: 0, md: 2 } : 2,
        ml: responsive ? { xs: 0.75, md: 0 } : 0,
        pt: pinnedBottom ? 1.25 : responsive ? { xs: 0, md: 0.5 } : 0.5,
        pl: responsive ? { xs: 0.75, md: 0 } : 0,
      }}
    >
      {label ? (
        <Typography
          variant="caption"
          fontWeight={600}
          sx={{
            display: responsive ? { xs: 'none', md: 'block' } : 'block',
            px: 1,
            pb: 0.5,
            fontSize: 11,
            lineHeight: 1.4,
            letterSpacing: '0.02em',
            color: dark ? '#8291a8' : 'text.secondary',
          }}
        >
          {label}
        </Typography>
      ) : null}
      {children}
    </Box>
  )
}

export function XDriveSidebarNavList({
  children,
  ariaLabel,
  responsive = false,
  className,
}: {
  children: ReactNode
  ariaLabel: string
  responsive?: boolean
  className?: string
}) {
  return (
    <List
      component="nav"
      aria-label={ariaLabel}
      disablePadding
      className={className}
      sx={{
        display: responsive ? { xs: 'flex', md: 'grid' } : 'grid',
        gap: 0.25,
        minWidth: responsive ? { xs: 'max-content', md: 0 } : 0,
        flexShrink: 0,
      }}
    >
      {children}
    </List>
  )
}


export function XDriveCoreWorkspaceNavItems({
  selected,
  transferBadge,
  appearance = 'light',
  showLocalStorage = false,
  onSelect,
}: {
  selected?: string
  transferBadge?: XDriveSidebarBadgeValue
  appearance?: XDriveSidebarAppearance
  showLocalStorage?: boolean
  onSelect: (key: XDriveCoreWorkspaceKey, event: MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <>
      {xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage }).map((destination) => (
        <XDriveSidebarNavItem
          key={destination.key}
          selected={selected === destination.key}
          icon={destination.icon}
          primary={destination.label}
          badge={destination.badge}
          appearance={appearance}
          onClick={(event) => onSelect(destination.key, event)}
        />
      ))}
    </>
  )
}

export function XDriveSidebarBadge({
  value,
}: {
  value?: XDriveSidebarBadgeValue
}) {
  let label: string | number | null = null

  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) {
      label = value > 99 ? '99+' : Math.floor(value)
    }
  } else if (typeof value === 'string' && value.trim()) {
    label = value
  }

  if (label === null) return null

  return (
    <Chip
      size="small"
      label={label}
      sx={{
        minWidth: 20,
        height: 18,
        borderRadius: 999,
        bgcolor: '#d85c6a',
        color: '#fff',
        fontSize: 10.5,
        fontWeight: 700,
        '& .MuiChip-label': { px: 0.7 },
      }}
    />
  )
}

export function XDriveSidebarNavItem({
  selected = false,
  icon,
  primary,
  secondary,
  badge,
  appearance = 'light',
  className,
  onClick,
}: {
  selected?: boolean
  icon: ReactNode
  primary: ReactNode
  secondary?: ReactNode
  badge?: XDriveSidebarBadgeValue
  appearance?: XDriveSidebarAppearance
  className?: string
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
}) {
  const dark = appearance === 'dark'

  return (
    <ListItemButton
      className={className}
      selected={selected}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
      sx={{
        minHeight: 36,
        position: 'relative',
        borderRadius: '8px',
        px: 1,
        color: dark ? '#9baac2' : 'text.secondary',
        transition: 'background-color 120ms ease, color 120ms ease',
        whiteSpace: 'nowrap',
        '&:hover': dark
          ? { bgcolor: 'rgba(255,255,255,.045)', color: '#dfe8f7' }
          : { bgcolor: 'action.hover', color: 'text.primary' },
        '&.Mui-selected': dark
          ? { bgcolor: 'rgba(95,143,244,.14)', color: '#eef4ff' }
          : { bgcolor: 'rgba(65,119,230,.08)', color: 'text.primary' },
        '&.Mui-selected:hover': dark
          ? { bgcolor: 'rgba(95,143,244,.18)' }
          : { bgcolor: 'rgba(65,119,230,.11)' },
        '&.Mui-selected::before': {
          content: '""',
          position: 'absolute',
          left: 2,
          top: 9,
          bottom: 9,
          width: 3,
          borderRadius: 999,
          bgcolor: dark ? '#7da2f4' : 'primary.main',
        },
        '&.Mui-selected .MuiListItemIcon-root': {
          color: dark ? '#8fb1ff' : 'primary.main',
        },
        '&.Mui-selected .MuiListItemText-primary': {
          fontWeight: 600,
        },
      }}
    >
      <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>{icon}</ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        sx={{
          '& .MuiListItemText-primary': { fontSize: 13, fontWeight: 500 },
          '& .MuiListItemText-secondary': {
            fontSize: 11,
            lineHeight: 1.25,
            color: dark ? '#7f90ab' : undefined,
          },
        }}
      />
      <XDriveSidebarBadge value={badge} />
    </ListItemButton>
  )
}
