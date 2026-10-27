import { Button, Stack } from '@mui/material'

/**
 * Canonical local-only run/schedule actions for both Desktop and DSM.
 * Undefined actions are entirely absent, never inert. The adapter MUST
 * verify local Source ownership before passing either callback.
 */
export function XDriveDeviceBackupLocalPrimaryActions({
  onRun, onSchedule,
}: {
  onRun?: () => void
  onSchedule?: () => void
}) {
  if (!onRun && !onSchedule) return null
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {onRun ? (
        <Button size="small" variant="contained" onClick={onRun}>
          手动增量备份（试用）
        </Button>
      ) : null}
      {onSchedule ? (
        <Button size="small" variant="outlined" onClick={onSchedule}>
          配置本机同步计划
        </Button>
      ) : null}
    </Stack>
  )
}
