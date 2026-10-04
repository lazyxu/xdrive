import type { FormEventHandler, ReactNode } from 'react'
import { Box, Paper } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export type XDriveAuthSurfaceSize = 'compact' | 'comfortable'

export function XDriveAuthShell({
  children,
  viewport = false,
  decorated = false,
  spacing = 'comfortable',
  className,
  sx,
}: {
  children: ReactNode
  viewport?: boolean
  decorated?: boolean
  spacing?: XDriveAuthSurfaceSize
  className?: string
  sx?: SxProps<Theme>
}) {
  const compact = spacing === 'compact'

  return (
    <Box
      className={className}
      sx={[
        (theme) => ({
          width: '100%',
          minWidth: 0,
          minHeight: viewport ? '100vh' : '100%',
          height: viewport ? 'auto' : '100%',
          overflow: 'auto',
          display: 'flex',
          p: compact ? 3 : 'clamp(28px, 6vh, 52px) 24px 32px',
          background: decorated
            ? theme.palette.mode === 'dark'
              ? 'radial-gradient(circle at top, #1b2940, #111822 46%, #0f141d)'
              : 'radial-gradient(circle at top, #eef4ff, #f7f8fb 46%, #f1f3f7)'
            : theme.palette.background.default,
          ...(!compact
            ? {
                '@media (max-width: 620px)': {
                  p: '20px 14px 24px',
                },
              }
            : {}),
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  )
}

export function XDriveAuthPanel({
  children,
  size = 'comfortable',
  maxWidth,
  bordered,
  form = false,
  onSubmit,
  className,
  sx,
}: {
  children: ReactNode
  size?: XDriveAuthSurfaceSize
  maxWidth?: number | string
  bordered?: boolean
  form?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
  className?: string
  sx?: SxProps<Theme>
}) {
  const compact = size === 'compact'
  const resolvedMaxWidth = maxWidth ?? (compact ? 430 : 560)
  const resolvedBordered = bordered ?? !compact
  const panelSx: SxProps<Theme> = [
    (theme) => ({
      width: '100%',
      maxWidth: typeof resolvedMaxWidth === 'number' ? `${resolvedMaxWidth}px` : resolvedMaxWidth,
      m: 'auto',
      p: compact ? 3 : '30px 32px 24px',
      border: resolvedBordered ? 1 : 0,
      borderColor: 'divider',
      borderRadius: compact ? 2 : '18px',
      bgcolor: 'background.paper',
      boxShadow: compact
        ? '0 16px 50px rgba(25, 52, 94, 0.09)'
        : theme.palette.mode === 'dark'
          ? '0 16px 42px rgba(0, 0, 0, 0.22)'
          : '0 16px 42px rgba(21, 37, 63, 0.07)',
      ...(!compact
        ? {
            '@media (max-width: 620px)': {
              p: '24px 20px 20px',
              borderRadius: '14px',
            },
          }
        : {}),
    }),
    ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
  ]

  if (form) {
    return (
      <Paper
        component="form"
        elevation={0}
        className={className}
        onSubmit={onSubmit}
        sx={panelSx}
      >
        {children}
      </Paper>
    )
  }

  return (
    <Paper elevation={0} className={className} sx={panelSx}>
      {children}
    </Paper>
  )
}
