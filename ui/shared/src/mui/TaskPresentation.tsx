import type { ReactNode } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import type { BoxProps } from '@mui/material/Box'

/** Shared visual chrome; task identity and control permissions stay with the source. */
export function XDriveTaskCardSurface({
  children,
  focused = false,
  sx,
  ...props
}: BoxProps & { focused?: boolean }) {
  return (
    <Box {...props} sx={[
      {
        border: 1,
        borderColor: focused ? 'primary.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: focused ? 'action.selected' : 'background.paper',
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      },
      ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
    ]}>
      {children}
    </Box>
  )
}

/** Counts intentionally reflect loaded records, not server-wide task totals. */
export function XDriveTaskCenterSection({
  title,
  description,
  loadedCount,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  loadedCount?: number
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Box component="section" aria-label={title} data-xdrive-task-section={title} sx={{ minWidth: 0 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}
        justifyContent="space-between" sx={{ mb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap">
            <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
            {loadedCount === undefined ? null : (
              <Chip size="small" variant="outlined"
                label={'已加载 ' + loadedCount.toLocaleString('zh-CN') + ' 项'} />
            )}
          </Stack>
          {description ? (
            <Typography variant="caption" color="text.secondary">{description}</Typography>
          ) : null}
        </Box>
        {actions ?? null}
      </Stack>
      {children}
    </Box>
  )
}
