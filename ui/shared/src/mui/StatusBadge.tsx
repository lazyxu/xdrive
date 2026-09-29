import { Chip, CircularProgress } from '@mui/material'
import type { ExternalSourceStateTone } from '../external-sources'

function statusColor(tone: ExternalSourceStateTone) {
  if (tone === 'good') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'bad') return 'error'
  if (tone === 'busy') return 'info'
  return 'default'
}

export function XDriveStatusBadge({
  tone,
  label,
}: {
  tone: ExternalSourceStateTone
  label: string
}) {
  const busy = tone === 'busy'
  return (
    <Chip
      size="small"
      variant={tone === 'neutral' ? 'outlined' : 'filled'}
      color={statusColor(tone)}
      label={label}
      icon={busy ? <CircularProgress size={12} thickness={5} color="inherit" /> : undefined}
      sx={{
        minHeight: 26,
        fontWeight: 600,
        '& .MuiChip-label': { px: 1 },
        '& .MuiChip-icon': { ml: 0.8 },
      }}
    />
  )
}
