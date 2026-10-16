import { Box, Chip, Stack, Typography } from '@mui/material'
import type { ExternalSourceRunSkip } from '../external-sources'
import { externalSourceSkipReasonLabel, formatExternalSourceTime } from '../external-sources'
import { formatBytes } from '../format'

export function XDriveSourceRunSkipItem({ skip }: { skip: ExternalSourceRunSkip }) {
  return (
    <Box sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {skip.path || skip.external_id}
        </Typography>
        <Chip size="small" variant="outlined" label={externalSourceSkipReasonLabel(skip.reason)} />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
        {skip.external_id} · {formatBytes(skip.size)} · {formatExternalSourceTime(skip.skipped_at)}
      </Typography>
    </Box>
  )
}
