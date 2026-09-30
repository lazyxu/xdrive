import { Box, Stack, Typography } from '@mui/material'
import type { BuildInfo } from '../models'

function buildInfoTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export function XDriveBuildInfoCard({
  title,
  info,
}: {
  title: string
  info?: BuildInfo | null
}) {
  return (
    <Box sx={{ flex: '1 1 360px', minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
      <Stack spacing={0.75}>
        <Typography variant="body2"><strong>版本：</strong>{info?.version || '未知'}</Typography>
        <Typography variant="body2"><strong>通道：</strong>{info?.channel || '—'}</Typography>
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}><strong>Commit：</strong>{info?.commit || '—'}</Typography>
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}><strong>Commit message：</strong>{info?.commit_message || '—'}</Typography>
        <Typography variant="body2"><strong>Commit 时间：</strong>{buildInfoTime(info?.commit_time)}</Typography>
        <Typography variant="body2"><strong>构建时间：</strong>{buildInfoTime(info?.build_time)}</Typography>
      </Stack>
    </Box>
  )
}
