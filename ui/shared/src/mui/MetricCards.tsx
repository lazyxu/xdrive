import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

export function XDriveMetricGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        gap: 2,
      }}
    >
      {children}
    </Box>
  )
}

export function XDriveMetricCard({
  title,
  value,
  suffix,
}: {
  title: ReactNode
  value: ReactNode
  suffix?: ReactNode
}) {
  return (
    <Box sx={{ minWidth: 0, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="h6" component="div" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {suffix ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35 }}>
          {suffix}
        </Typography>
      ) : null}
    </Box>
  )
}

