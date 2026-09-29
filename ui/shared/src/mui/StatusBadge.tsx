import type { MouseEventHandler } from 'react'
import { Chip, CircularProgress } from '@mui/material'

export type XDriveStatusTone = 'neutral' | 'good' | 'warning' | 'bad' | 'busy'

function statusColor(tone: XDriveStatusTone) {
  if (tone === 'good') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'bad') return 'error'
  if (tone === 'busy') return 'info'
  return 'default'
}

export function XDriveStatusBadge({
  tone,
  label,
  variant = 'auto',
  ariaLabel,
  title,
  onClick,
}: {
  tone: XDriveStatusTone
  label: string
  variant?: 'auto' | 'filled' | 'outlined'
  ariaLabel?: string
  title?: string
  onClick?: MouseEventHandler<HTMLDivElement>
}) {
  const busy = tone === 'busy'
  return (
    <Chip
      size="small"
      variant={variant === 'auto' ? (tone === 'neutral' ? 'outlined' : 'filled') : variant}
      color={statusColor(tone)}
      label={label}
      icon={busy ? <CircularProgress size={12} thickness={5} color="inherit" /> : undefined}
      aria-label={ariaLabel}
      title={title}
      clickable={Boolean(onClick)}
      onClick={onClick}
      sx={{
        minHeight: 26,
        fontWeight: 600,
        '& .MuiChip-label': { px: 1 },
        '& .MuiChip-icon': { ml: 0.8 },
      }}
    />
  )
}
