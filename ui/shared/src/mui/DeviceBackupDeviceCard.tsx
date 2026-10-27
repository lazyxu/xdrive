import type { ReactNode } from 'react'
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded'
import { Box, Divider, Stack, Typography } from '@mui/material'

// The same device card frame in Desktop and DSM. Host adapters supply only
// genuinely known identity, status and connection facts; no fabricated ID.
export function XDriveDeviceBackupDeviceCard({
  name, details, subDetails, children,
}: {
  name: string
  details: ReactNode
  subDetails?: ReactNode
  children: ReactNode
}) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <DevicesRoundedIcon color="action" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700}>{name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {details}
          </Typography>
          {subDetails ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {subDetails}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      {children}
    </Box>
  )
}
