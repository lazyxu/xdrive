import type { MouseEventHandler, ReactNode } from 'react'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import { Avatar, Box, ButtonBase, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from '@mui/material'

export function XDriveAccountAvatarButton({
  username,
  compact = false,
  className,
  onClick,
}: {
  username?: string | null
  compact?: boolean
  className?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
}) {
  const initial = username?.trim().slice(0, 1).toUpperCase() || '?'

  if (compact) {
    return (
      <Tooltip title={username ? `${username} · 账户` : '账户'}>
        <IconButton
          className={className}
          aria-label="账户菜单"
          size="small"
          onClick={onClick}
          sx={{ p: 0.5 }}
        >
          <Avatar sx={{ width: 24, height: 24, fontSize: 12, fontWeight: 700 }}>
            {initial}
          </Avatar>
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <Tooltip title="账户菜单">
      <ButtonBase
        className={className}
        aria-label="账户菜单"
        onClick={onClick}
        sx={{
          ml: 0.5,
          minWidth: 0,
          minHeight: 36,
          maxWidth: 220,
          px: 0.75,
          pr: 0.5,
          gap: 0.75,
          borderRadius: 1,
          color: 'text.primary',
          justifyContent: 'flex-start',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        }}
      >
        <Avatar sx={{ width: 28, height: 28, fontSize: 13, fontWeight: 700 }}>
          {initial}
        </Avatar>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 150 }}>
          {username || '账户'}
        </Typography>
        <ExpandMoreRoundedIcon sx={{ flexShrink: 0, fontSize: 18, color: 'text.secondary' }} />
      </ButtonBase>
    </Tooltip>
  )
}

export function XDriveAccountSummary({
  username,
  secondary,
  status,
}: {
  username?: string | null
  secondary?: string | null
  status?: string | null
}) {
  return (
    <Box sx={{ minWidth: 250, maxWidth: 320, px: 2, py: 1.25 }}>
      <Typography variant="body2" fontWeight={700} noWrap>
        {username || '已登录用户'}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" noWrap>
        {secondary || '服务器未提供'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {status || '已登录'}
      </Typography>
    </Box>
  )
}

export function XDriveAccountMenu({
  id,
  anchorEl,
  onClose,
  username,
  secondary,
  status,
  children,
}: {
  id: string
  anchorEl: HTMLElement | null
  onClose: () => void
  username?: string | null
  secondary?: string | null
  status?: string | null
  children?: ReactNode
}) {
  return (
    <Menu
      id={id}
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <XDriveAccountSummary username={username} secondary={secondary} status={status} />
      <Divider />
      {children}
    </Menu>
  )
}


export function XDriveAccountMenuActions({
  onClose,
  onSettings,
  onAbout,
  onLogout,
  settingsLabel = '设置',
  aboutLabel = '关于 xDrive',
  aboutSecondary,
  logoutLabel = '退出登录',
}: {
  onClose: () => void
  onSettings?: () => void
  onAbout?: () => void
  onLogout?: () => void
  settingsLabel?: string
  aboutLabel?: string
  aboutSecondary?: string
  logoutLabel?: string
}) {
  const run = (action?: () => void) => {
    onClose()
    action?.()
  }
  const hasPrimaryActions = Boolean(onSettings || onAbout)

  return (
    <>
      {onSettings ? (
        <MenuItem onClick={() => run(onSettings)}>
          <ListItemIcon><SettingsRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{settingsLabel}</ListItemText>
        </MenuItem>
      ) : null}
      {onAbout ? (
        <MenuItem onClick={() => run(onAbout)}>
          <ListItemIcon><InfoOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={aboutLabel} secondary={aboutSecondary} />
        </MenuItem>
      ) : null}
      {hasPrimaryActions && onLogout ? <Divider /> : null}
      {onLogout ? (
        <MenuItem sx={{ color: 'error.main' }} onClick={() => run(onLogout)}>
          <ListItemIcon sx={{ color: 'inherit' }}>
            <LogoutRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{logoutLabel}</ListItemText>
        </MenuItem>
      ) : null}
    </>
  )
}
