import { Box, Paper, Stack, Typography } from '@mui/material'
import {
  XDriveActionButton,
  XDriveSectionHeader,
  XDriveWorkspaceSurface,
  XDriveStatePanel,
} from '@xdrive/ui/mui'

export function DesktopConflictsPage({
  conflicts,
  busy,
  onRefresh,
  onOpenBoth,
  onKeepServer,
  onKeepLocal,
}: {
  conflicts: AgentConflict[]
  busy: boolean
  onRefresh: () => void
  onOpenBoth: (item: AgentConflict) => void
  onKeepServer: (item: AgentConflict) => void
  onKeepLocal: (item: AgentConflict) => void
}) {
  return (
    <XDriveWorkspaceSurface presentation="page" title="冲突">
      <XDriveSectionHeader
        eyebrow="冲突副本"
        title="解决同步冲突"
        actions={<XDriveActionButton disabled={busy} onClick={onRefresh}>刷新</XDriveActionButton>}
      />
      {conflicts.length === 0 ? <XDriveStatePanel message="没有未解决的冲突。" /> : (
        <Stack spacing={1.25} sx={{ mt: 2.25 }}>
          {conflicts.map((item) => (
            <Paper
              key={item.id}
              variant="outlined"
              sx={{
                p: 1.75,
                display: 'flex',
                alignItems: { xs: 'flex-start', md: 'center' },
                flexDirection: { xs: 'column', md: 'row' },
                justifyContent: 'space-between',
                gap: 2.25,
                borderRadius: 1.5,
              }}
            >
              <Box sx={{ minWidth: 0, display: 'grid', gap: 0.35 }}>
                <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                  {item.original_path}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  冲突副本：{item.conflict_path}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(item.created_at).toLocaleString()}
                </Typography>
              </Box>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                sx={{ flexShrink: 0, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
              >
                <XDriveActionButton compact onClick={() => onOpenBoth(item)}>同时打开</XDriveActionButton>
                <XDriveActionButton compact onClick={() => onKeepServer(item)}>保留服务器版本</XDriveActionButton>
                <XDriveActionButton compact intent="primary" onClick={() => onKeepLocal(item)}>保留本地版本</XDriveActionButton>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </XDriveWorkspaceSurface>
  )
}
