import type { ReactNode } from 'react'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'

/**
 * The mobile application owns its chrome. No global floating control is allowed
 * over its scroll host or status bar. Viewer overlays keep their own header.
 */
export function XDriveMobileAppHeader({
  title,
  canGoBack,
  disabled = false,
  onBack,
  onOpenApps,
  transferAction,
}: {
  title: string
  canGoBack: boolean
  disabled?: boolean
  onBack: () => void
  onOpenApps: () => void
  transferAction?: ReactNode
}) {
  return (
    <Box
      component="header"
      data-xdrive-mobile-app-header
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight: 'calc(52px + env(safe-area-inset-top))',
        flexShrink: 0,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: 'max(8px, env(safe-area-inset-left))',
        pr: 'max(8px, env(safe-area-inset-right))',
        pt: 'env(safe-area-inset-top)',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Tooltip title="返回上一个应用">
        <span>
          <IconButton
            aria-label="返回上一个应用"
            disabled={!canGoBack || disabled}
            onClick={onBack}
            sx={{ width: 44, height: 44 }}
          >
            <ArrowBackRoundedIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Typography component="h1" variant="subtitle1" fontWeight={600} noWrap
        sx={{ flex: 1, minWidth: 0, pl: 0.5 }}>
        {title}
      </Typography>
      {transferAction}
      <Tooltip title="切换应用">
        <IconButton
          data-xdrive-mobile-app-navigation-trigger
          aria-label="打开应用导航"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={onOpenApps}
          sx={{ width: 44, height: 44, flexShrink: 0 }}
        >
          <AppsRoundedIcon />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
