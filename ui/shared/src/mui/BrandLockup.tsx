import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

export type XDriveBrandLockupVariant = 'titlebar' | 'compact' | 'large'

export function XDriveBrandLockup({
  iconSrc,
  variant = 'compact',
  subtitle,
  meta,
  className,
}: {
  iconSrc: string
  variant?: XDriveBrandLockupVariant
  subtitle?: ReactNode
  meta?: ReactNode
  className?: string
}) {
  const titlebar = variant === 'titlebar'
  const large = variant === 'large'
  const iconSize = titlebar ? 20 : large ? 48 : 34

  return (
    <Box
      className={className}
      sx={{
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: titlebar ? 0.875 : large ? 1.75 : 1.25,
        mb: large ? 3.5 : 0,
      }}
    >
      <Box
        component="img"
        src={iconSrc}
        alt=""
        aria-hidden="true"
        sx={{ width: iconSize, height: iconSize, flex: '0 0 auto', display: 'block', objectFit: 'contain' }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component={large ? 'h1' : 'span'}
          variant={large ? 'h5' : titlebar ? 'body2' : 'h6'}
          fontWeight={700}
          sx={titlebar ? { fontSize: 12, lineHeight: 1.2 } : undefined}
        >
          xDrive
        </Typography>
        {subtitle ? <Typography variant="body2" color="text.secondary">{subtitle}</Typography> : null}
        {meta ? <Box sx={{ mt: 0.75 }}>{meta}</Box> : null}
      </Box>
    </Box>
  )
}
