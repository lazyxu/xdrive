import { Box, Chip, Stack, Typography } from '@mui/material'
import { formatExternalSourceTime } from '../external-sources'
import { XDriveStatusAlert } from './StatusAlert'

export function XDriveSourceFailureItem({
  title,
  externalID,
  sizeLabel,
  failedAt,
  error,
  compact = false,
}: {
  title: string
  externalID: string
  sizeLabel: string
  failedAt?: string
  error?: string
  compact?: boolean
}) {
  return (
    <Box sx={{ p: compact ? 1 : 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems={compact ? 'flex-start' : 'center'}
        justifyContent="space-between"
      >
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        <Chip size="small" label={sizeLabel} />
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: compact ? 0.25 : 0.5, overflowWrap: 'anywhere' }}
      >
        {failedAt
          ? `${externalID} · ${formatExternalSourceTime(failedAt)}`
          : `外部 ID：${externalID}`}
      </Typography>
      <XDriveStatusAlert tone="bad" sx={{ mt: compact ? 0.75 : 1 }}>
        {error || '未提供具体错误原因'}
      </XDriveStatusAlert>
    </Box>
  )
}
