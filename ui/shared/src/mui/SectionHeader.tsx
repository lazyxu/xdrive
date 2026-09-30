import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

export type XDriveSectionHeaderLevel = 'h2' | 'h3'

export function XDriveSectionHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  level = 'h2',
  sx,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  level?: XDriveSectionHeaderLevel
  sx?: SxProps<Theme>
}) {
  const compact = level === 'h3'

  return (
    <Box
      component="header"
      sx={[
        {
          minWidth: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: compact ? 1.5 : 2.25,
          flexWrap: 'wrap',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        {eyebrow ? (
          <Typography
            variant="overline"
            color="primary.main"
            fontWeight={800}
            sx={{ display: 'block', mb: 0.5, fontSize: 11, lineHeight: 1.3, letterSpacing: '.14em' }}
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography
          component={level}
          variant={compact ? 'subtitle1' : 'h6'}
          fontWeight={700}
          sx={{ fontSize: compact ? undefined : 18, lineHeight: 1.3, overflowWrap: 'anywhere' }}
        >
          {title}
        </Typography>
        {subtitle ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.75,
              maxWidth: 760,
              fontSize: 12,
              lineHeight: 1.55,
              '& code': {
                px: 0.625,
                py: 0.25,
                borderRadius: 0.75,
                bgcolor: 'action.hover',
                color: 'text.secondary',
              },
            }}
          >
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
            alignItems: 'center',
          }}
        >
          {actions}
        </Stack>
      ) : null}
    </Box>
  )
}
