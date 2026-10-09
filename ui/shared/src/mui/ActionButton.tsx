import type { MouseEventHandler, ReactNode } from 'react'
import { Button, CircularProgress } from '@mui/material'

export type XDriveActionIntent = 'primary' | 'secondary' | 'danger' | 'warning'

export function XDriveActionButton({
  children,
  loading = false,
  loadingLabel,
  intent = 'secondary',
  disabled = false,
  type = 'button',
  form,
  fullWidth = false,
  compact = false,
  className,
  title,
  startIcon,
  onClick,
}: {
  children: ReactNode
  loading?: boolean
  loadingLabel?: ReactNode
  intent?: XDriveActionIntent
  disabled?: boolean
  type?: 'button' | 'submit'
  form?: string
  fullWidth?: boolean
  compact?: boolean
  className?: string
  title?: string
  startIcon?: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
}) {
  const primary = intent === 'primary'
  const danger = intent === 'danger'
  const warning = intent === 'warning'

  return (
    <Button
      className={className}
      size="small"
      variant={primary ? 'contained' : 'outlined'}
      color={danger ? 'error' : warning ? 'warning' : primary ? 'primary' : 'inherit'}
      disabled={disabled || loading}
      type={type}
      form={form}
      fullWidth={fullWidth}
      title={title}
      onClick={onClick}
      startIcon={loading ? <CircularProgress size={compact ? 12 : 14} thickness={5} color="inherit" /> : startIcon}
      sx={[
        compact
          ? { minHeight: 28, minWidth: 'auto', borderRadius: 1.5, px: 1.1, py: 0.25, fontSize: 11, whiteSpace: 'nowrap' }
          : { minHeight: 36, borderRadius: 2, whiteSpace: 'nowrap' },
        {
          '@media (max-width:899.95px) and (pointer: coarse)': {
            minHeight: 44,
            minWidth: compact ? 44 : 64,
          },
        },
      ]}
    >
      {loading ? (loadingLabel || children) : children}
    </Button>
  )
}
