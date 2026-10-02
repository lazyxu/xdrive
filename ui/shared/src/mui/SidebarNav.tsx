import type { ReactNode } from 'react'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded'
import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'

export const XDRIVE_SIDEBAR_WIDTH = 184
export const XDRIVE_SIDEBAR_COMPACT_WIDTH = 176

export type XDriveSidebarAppearance = 'light' | 'dark'

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
        height: '100%',
        display: responsive ? { xs: 'block', md: 'flex' } : 'flex',
        flexDirection: 'column',
        bgcolor: dark ? '#101827' : 'background.paper',
        color: dark ? '#e8eef9' : 'text.primary',
        borderRight: responsive ? { xs: 0, md: 1 } : 1,
        borderBottom: responsive ? { xs: 1, md: 0 } : 0,
        borderColor: dark ? 'rgba(255,255,255,.08)' : 'divider',
        px: responsive ? { xs: 1, md: 1.25 } : 1.25,
        pt: responsive ? { xs: 1, md: 1.25 } : 1.5,
        pb: responsive ? { xs: 1, md: 1.25 } : 1.25,
        overflowX: responsive ? { xs: 'auto', md: 'hidden' } : 'hidden',
        overflowY: 'auto',
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
      }}
    >
      {children}
    </List>
  )
}

export type XDriveCoreWorkspaceKey = 'files' | 'gallery' | 'sources' | 'transfers' | 'storage'

export function XDriveCoreWorkspaceNavItems({
  selected,
  transferBadge,
  appearance = 'light',
  onSelect,
}: {
  selected?: string
  transferBadge?: ReactNode
  appearance?: XDriveSidebarAppearance
  onSelect: (key: XDriveCoreWorkspaceKey) => void
}) {
  return (
    <>
      <XDriveSidebarNavItem
        selected={selected === 'files'}
        icon={<FolderRoundedIcon fontSize="small" />}
        primary="文件"
        appearance={appearance}
        onClick={() => onSelect('files')}
      />
      <XDriveSidebarNavItem
        selected={selected === 'gallery'}
        icon={<PhotoLibraryRoundedIcon fontSize="small" />}
        primary="图库"
        appearance={appearance}
        onClick={() => onSelect('gallery')}
      />
      <XDriveSidebarNavItem
        selected={selected === 'sources'}
        icon={<CloudSyncRoundedIcon fontSize="small" />}
        primary="同步文件夹"
        appearance={appearance}
        onClick={() => onSelect('sources')}
      />
      <XDriveSidebarNavItem
        selected={selected === 'transfers'}
        icon={<SwapVertRoundedIcon fontSize="small" />}
        primary="传输"
        badge={transferBadge}
        appearance={appearance}
        onClick={() => onSelect('transfers')}
      />
      <XDriveSidebarNavItem
        selected={selected === 'storage'}
        icon={<StorageRoundedIcon fontSize="small" />}
        primary="存储"
        appearance={appearance}
        onClick={() => onSelect('storage')}
      />
    </>
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
  badge?: ReactNode
  appearance?: XDriveSidebarAppearance
  className?: string
  onClick?: () => void
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
      {badge !== undefined && badge !== null ? (
        <Chip
          size="small"
          label={badge}
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
      ) : null}
    </ListItemButton>
  )
}
