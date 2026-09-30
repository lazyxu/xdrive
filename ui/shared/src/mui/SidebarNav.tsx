import type { ReactNode } from 'react'
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
        borderRight: responsive ? { xs: 0, md: 1 } : 0,
        borderBottom: responsive ? { xs: 1, md: 0 } : 0,
        borderColor: dark ? 'rgba(255,255,255,.08)' : 'divider',
        px: responsive ? { xs: 1, md: 1.5 } : 1.5,
        pt: responsive ? { xs: 1, md: 1.5 } : 2.25,
        pb: responsive ? { xs: 1, md: 1.5 } : 1.5,
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
  const borderColor = dark ? 'rgba(255,255,255,.08)' : 'divider'

  return (
    <Box
      sx={{
        mt: pinnedBottom ? 'auto' : responsive ? { xs: 0, md: 1.5 } : 1.5,
        ml: responsive ? { xs: 1, md: 0 } : 0,
        pt: responsive ? { xs: 0, md: 1.5 } : 1.5,
        pl: responsive ? { xs: 1, md: 0 } : 0,
        borderTop: responsive ? { xs: 0, md: 1 } : 1,
        borderLeft: responsive ? { xs: 1, md: 0 } : 0,
        borderColor,
      }}
    >
      {label ? (
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{
            display: responsive ? { xs: 'none', md: 'block' } : 'block',
            px: 1.25,
            pb: 0.75,
            color: dark ? '#9baac2' : 'text.secondary',
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
        gap: 0.5,
        minWidth: responsive ? { xs: 'max-content', md: 0 } : 0,
      }}
    >
      {children}
    </List>
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
        minHeight: 40,
        borderRadius: 1.25,
        px: 1.25,
        color: dark ? '#9baac2' : 'text.secondary',
        '&:hover': dark
          ? { bgcolor: 'rgba(255,255,255,.055)', color: '#dfe8f7' }
          : { bgcolor: 'action.hover', color: 'text.primary' },
        '&.Mui-selected': dark
          ? { bgcolor: '#1c2940', color: '#fff' }
          : { bgcolor: 'action.selected', color: 'primary.main' },
        '&.Mui-selected:hover': dark
          ? { bgcolor: '#22314c' }
          : { bgcolor: 'action.selected' },
      }}
    >
      <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>{icon}</ListItemIcon>
      <ListItemText
        primary={primary}
        secondary={secondary}
        sx={{
          '& .MuiListItemText-primary': { fontSize: 13, fontWeight: 600 },
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
            minWidth: 22,
            height: 20,
            borderRadius: 1.25,
            bgcolor: '#d85c6a',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            '& .MuiChip-label': { px: 0.75 },
          }}
        />
      ) : null}
    </ListItemButton>
  )
}
