import type { ReactNode } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'

export function XDriveStatePanel({
  message,
  loading = false,
  compact = false,
  variant = 'surface',
  align = 'center',
  borderTop = false,
  mt,
}: {
  message: ReactNode
  loading?: boolean
  compact?: boolean
  variant?: 'surface' | 'plain'
  align?: 'left' | 'center'
  borderTop?: boolean
  mt?: number
}) {
  const centered = align === 'center'
  return (
    <Box
      role={loading ? 'status' : undefined}
      aria-live={loading ? 'polite' : undefined}
      sx={{
        mt: mt ?? (variant === 'surface' ? 2 : 0),
        px: 2,
        py: compact ? 1.5 : 3,
        borderRadius: variant === 'surface' ? 2 : 0,
        bgcolor: variant === 'surface' ? 'action.hover' : 'transparent',
        borderTop: borderTop ? 1 : 0,
        borderColor: 'divider',
        color: 'text.secondary',
        textAlign: align,
      }}
    >
      <Stack
        direction={loading && !centered ? 'row' : 'column'}
        spacing={loading ? 0.8 : 0}
        alignItems={centered ? 'center' : 'flex-start'}
        justifyContent={centered ? 'center' : 'flex-start'}
      >
        {loading ? <CircularProgress size={compact ? 16 : 20} /> : null}
        <Typography variant={compact ? 'caption' : 'body2'} color="text.secondary">
          {message}
        </Typography>
      </Stack>
    </Box>
  )
}
