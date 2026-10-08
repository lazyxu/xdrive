import { useEffect, useId, useState } from 'react'
import type { MouseEvent } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import {
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material'
import { XDriveSidebarBadge } from './SidebarNav'
import type { XDriveSidebarAppearance } from './SidebarNav'
import { XDriveSidebarStorageSummary } from './SidebarStorageSummary'
import type { XDriveSidebarDestinationModel, XDriveSidebarSectionModel } from './WorkspaceNavigation'
import type { XDriveWorkspaceSidebarStorageSummary } from './WorkspaceSidebar'

export function XDriveWorkspaceCompactNavigation({
  primary,
  moreSections,
  selected,
  storageSummary,
  appearance = 'light',
  className,
  ariaLabel,
  navAriaLabel,
  disabled = false,
  onSelect,
}: {
  primary: XDriveSidebarDestinationModel[]
  moreSections: XDriveSidebarSectionModel[]
  selected?: string
  storageSummary?: XDriveWorkspaceSidebarStorageSummary | null
  appearance?: XDriveSidebarAppearance
  className?: string
  ariaLabel: string
  navAriaLabel: string
  disabled?: boolean
  onSelect: (key: string, event: MouseEvent<HTMLElement>) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const drawerID = useId()
  const titleID = useId()
  const dark = appearance === 'dark'
  const selectedInMore = moreSections.some((section) => section.items.some((item) => item.key === selected))
  const value = primary.some((item) => item.key === selected) ? selected : selectedInMore ? 'more' : false

  useEffect(() => {
    setMoreOpen(false)
  }, [selected, disabled])

  const selectDestination = (key: string, event: MouseEvent<HTMLElement>) => {
    if (disabled) return
    setMoreOpen(false)
    onSelect(key, event)
  }

  return (
    <Box
      component="aside"
      aria-label={ariaLabel}
      className={className}
      sx={{
        order: 1,
        flexShrink: 0,
        minWidth: 0,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: dark ? '#101827' : 'background.paper',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation
        component="nav"
        aria-label={navAriaLabel}
        showLabels
        value={value}
        sx={{
          height: 56,
          bgcolor: 'transparent',
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            maxWidth: 'none',
            minHeight: 56,
            px: 0.5,
            color: dark ? '#9baac2' : 'text.secondary',
          },
          '& .MuiBottomNavigationAction-root.Mui-selected': { color: dark ? '#8fb1ff' : 'primary.main' },
          '& .MuiBottomNavigationAction-label, & .MuiBottomNavigationAction-label.Mui-selected': { fontSize: 11 },
        }}
      >
        {primary.map((destination) => (
          <BottomNavigationAction
            key={destination.key}
            value={destination.key}
            label={destination.compactLabel ?? destination.label}
            aria-current={selected === destination.key ? 'page' : undefined}
            disabled={disabled}
            icon={(
              <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', height: 24 }}>
                {destination.icon}
                <Box component="span" sx={{ position: 'absolute', left: 16, top: -7 }}>
                  <XDriveSidebarBadge value={destination.badge} />
                </Box>
              </Box>
            )}
            onClick={(event) => selectDestination(destination.key, event)}
          />
        ))}
        <BottomNavigationAction
          value="more"
          label="更多"
          icon={<MoreHorizRoundedIcon />}
          aria-haspopup="dialog"
          aria-expanded={moreOpen && !disabled}
          aria-controls={moreOpen && !disabled ? drawerID : undefined}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setMoreOpen(true)
          }}
        />
      </BottomNavigation>
      <Drawer
        anchor="bottom"
        open={moreOpen && !disabled}
        onClose={() => setMoreOpen(false)}
        slotProps={{
          paper: {
            id: drawerID,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': titleID,
            sx: {
              maxHeight: '80vh',
              '@supports (height: 100dvh)': { maxHeight: '80dvh' },
              bgcolor: dark ? '#101827' : 'background.paper',
              color: dark ? '#e8eef9' : 'text.primary',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              pl: 'max(16px, env(safe-area-inset-left))',
              pr: 'max(16px, env(safe-area-inset-right))',
              pb: 'max(12px, env(safe-area-inset-bottom))',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1, flexShrink: 0 }}>
          <Typography id={titleID} component="h2" variant="subtitle1" fontWeight={600}>更多</Typography>
          <IconButton aria-label="关闭更多导航" onClick={() => setMoreOpen(false)} sx={{ width: 44, height: 44, color: 'inherit' }}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>
        <Box sx={{ minHeight: 0, overflowY: 'auto' }}>
          {moreSections.map((section) => (
            <Box key={section.key} sx={{ pt: section.label ? 1 : 0 }}>
              {section.label ? (
                <Typography variant="caption" sx={{ px: 1, color: dark ? '#9baac2' : 'text.secondary' }}>
                  {section.label}
                </Typography>
              ) : null}
              <List component="nav" aria-label={section.ariaLabel ?? navAriaLabel} disablePadding>
                {section.items.map((destination) => (
                  <ListItemButton
                    key={destination.key}
                    component="button"
                    selected={selected === destination.key}
                    aria-current={selected === destination.key ? 'page' : undefined}
                    disabled={disabled}
                    onClick={(event) => selectDestination(destination.key, event)}
                    sx={{ minHeight: 48, width: '100%', borderRadius: 1, color: 'inherit' }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>{destination.icon}</ListItemIcon>
                    <ListItemText primary={destination.label} secondary={destination.secondary} />
                    <XDriveSidebarBadge value={destination.badge} />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ))}
          {storageSummary ? (
            <Box sx={{ pt: 2, pb: 1 }}>
              <XDriveSidebarStorageSummary {...storageSummary} appearance={appearance} />
            </Box>
          ) : null}
        </Box>
      </Drawer>
    </Box>
  )
}
