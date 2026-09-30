import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export function XDriveDescriptionGrid({
  children,
  columns = 2,
  fullColumnsAt = 'lg',
  sx,
}: {
  children: ReactNode
  columns?: 2 | 3 | 4
  fullColumnsAt?: 'md' | 'lg'
  sx?: SxProps<Theme>
}) {
  const wideColumns = columns === 4 ? 4 : columns === 3 ? 3 : 2
  const gridTemplateColumns = columns === 2
    ? { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }
    : fullColumnsAt === 'md'
      ? { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: `repeat(${wideColumns}, minmax(0, 1fr))` }
      : { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: `repeat(${wideColumns}, minmax(0, 1fr))` }

  return (
    <Box
      sx={[
        {
          display: 'grid',
          gridTemplateColumns,
          gap: 1,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  )
}

export function XDriveDescriptionItem({
  label,
  children,
  fullWidth = false,
}: {
  label: ReactNode
  children: ReactNode
  fullWidth?: boolean
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        gridColumn: fullWidth ? '1 / -1' : undefined,
        px: 1.5,
        py: 1.25,
        borderRadius: 1.25,
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
        {label}
      </Typography>
      <Box sx={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere', color: 'text.primary' }}>
        {children}
      </Box>
    </Box>
  )
}
