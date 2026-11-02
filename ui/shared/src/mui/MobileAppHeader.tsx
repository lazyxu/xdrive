import type { ReactNode, Ref } from 'react'
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
  backLabel = '返回上一个应用',
  disabled = false,
  onBack,
  onOpenApps,
  focusAction,
  transferAction,
  pageNavigation = false,
  navigationSlotRef,
  actionsSlotRef,
}: {
  title: string
  canGoBack: boolean
  backLabel?: string
  disabled?: boolean
  onBack: () => void
  onOpenApps: () => void
  focusAction?: ReactNode
  transferAction?: ReactNode
  pageNavigation?: boolean
  navigationSlotRef?: Ref<HTMLDivElement>
  actionsSlotRef?: Ref<HTMLDivElement>
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
      {pageNavigation ? (
        <Box ref={navigationSlotRef} data-xdrive-mobile-header-page-slot
          sx={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', alignItems: 'center',
            '& > [data-xdrive-mobile-header-fallback]:not(:only-child)': {
              display: 'none',
            },
          }}>
          <Box data-xdrive-mobile-header-fallback
            sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
      <Tooltip title={backLabel}>
        <span>
          <IconButton
            aria-label={backLabel}
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
          </Box>
        </Box>
      ) : (
        <>
      <Tooltip title={backLabel}>
        <span>
          <IconButton
            aria-label={backLabel}
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
        </>
      )}
      <Box ref={actionsSlotRef} data-xdrive-mobile-header-page-actions
        sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }} />
      {focusAction}
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
