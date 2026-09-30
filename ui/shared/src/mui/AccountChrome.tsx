import type { MouseEventHandler } from 'react'
import { Avatar, Box, IconButton, Tooltip, Typography } from '@mui/material'

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
  const size = compact ? 24 : 28

  return (
    <Tooltip title={username ? `${username} · 账户` : '账户'}>
      <IconButton
        className={className}
        aria-label="账户菜单"
        size="small"
        onClick={onClick}
        sx={{ ml: compact ? 0 : 0.5, p: 0.5 }}
      >
        <Avatar sx={{ width: size, height: size, fontSize: compact ? 12 : 13, fontWeight: 700 }}>
          {initial}
        </Avatar>
      </IconButton>
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
