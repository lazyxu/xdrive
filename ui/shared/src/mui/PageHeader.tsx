import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

export type XDrivePageHeaderSize = 'compact' | 'large'

export function XDrivePageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  size = 'compact',
  className,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  size?: XDrivePageHeaderSize
  className?: string
}) {
  const large = size === 'large'

  return (
    <Box
      component="header"
      className={className}
      sx={{
        minWidth: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: large ? 3.5 : 2,
        flexWrap: 'wrap',
      }}
    >
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        {eyebrow ? (
          <Typography
            variant="overline"
            color="primary.main"
            fontWeight={800}
            sx={{ display: 'block', mb: large ? 0.75 : 0.5, fontSize: 11, lineHeight: 1.3, letterSpacing: '.14em' }}
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography
          component="h1"
          variant={large ? 'h4' : 'h5'}
          fontWeight={700}
          sx={{ fontSize: large ? 30 : undefined, lineHeight: 1.15 }}
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 690, lineHeight: 1.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {actions ? (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          sx={{
            flexShrink: 0,
            width: { xs: '100%', sm: 'auto' },
            justifyContent: { xs: 'flex-start', sm: 'flex-end' },
          }}
        >
          {actions}
        </Stack>
      ) : null}
    </Box>
  )
}
