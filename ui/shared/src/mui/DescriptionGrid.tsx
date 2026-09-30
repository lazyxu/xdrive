import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export function XDriveDescriptionGrid({
  children,
  columns = 2,
  sx,
}: {
  children: ReactNode
  columns?: 2 | 4
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      sx={[
        {
          display: 'grid',
          gridTemplateColumns: columns === 4
            ? { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }
            : { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
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
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
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
