import type { ReactNode } from 'react'
import { Box, Card, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { XDriveStatusTone } from './StatusBadge'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveStatusAlert } from './StatusAlert'

export function XDriveSourceSummaryCard({
  name,
  icon,
  modeLabel,
  statusTone,
  statusLabel,
  activity,
  stats,
  metaAction,
  error,
  actions,
  details,
  after,
  sx,
}: {
  name: ReactNode
  icon?: ReactNode
  modeLabel: ReactNode
  statusTone: XDriveStatusTone
  statusLabel: string
  activity: ReactNode
  stats: ReactNode
  metaAction?: ReactNode
  error?: ReactNode
  actions?: ReactNode
  details?: ReactNode
  after?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <>
      <Card
        variant="outlined"
        sx={[
          {
            p: 2.25,
            borderRadius: 2,
            minWidth: 0,
            boxShadow: '0 6px 18px rgba(15, 23, 42, 0.04)',
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
            {icon}
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h3" variant="h6" fontWeight={700} noWrap>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {modeLabel}
              </Typography>
            </Box>
          </Stack>
          <XDriveStatusBadge tone={statusTone} label={statusLabel} />
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          sx={{ mt: 2 }}
        >
          <Typography variant="caption" color="text.secondary">
            {activity}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {stats}
            </Typography>
            {metaAction}
          </Stack>
        </Stack>

        {error ? (
          <XDriveStatusAlert tone="bad" sx={{ mt: 1.5 }}>
            {error}
          </XDriveStatusAlert>
        ) : null}

        {actions ? (
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
            sx={{ mt: 1.5 }}
          >
            {actions}
          </Stack>
        ) : null}

        {details}
      </Card>
      {after}
    </>
  )
}
