import { Button, Stack } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import type { XDriveWorkspaceAppRoute } from './WorkspaceRoute'

/**
 * Host-neutral workspace notices. The shared app owns presentation; only a
 * verified Host can provide a real action. An absent callback means no button,
 * never a simulated resume/repair request or privileged Agent fallback.
 */
export type XDriveWorkspaceHostAlertsProps = {
  view: XDriveWorkspaceAppRoute
  lastError?: string | null
  paused?: boolean
  hasConflicts?: boolean
  conflictCount?: number
  resumeDisabled?: boolean
  onOpenDiagnostics?: () => void
  onResumeSync?: () => void
  onOpenConflicts?: () => void
}

export function XDriveWorkspaceHostAlerts({
  view,
  lastError,
  paused = false,
  hasConflicts = false,
  conflictCount = 0,
  resumeDisabled = false,
  onOpenDiagnostics,
  onResumeSync,
  onOpenConflicts,
}: XDriveWorkspaceHostAlertsProps) {
  if (!lastError && !paused && !hasConflicts) return null

  return (
    <Stack
      spacing={1}
      sx={{
        mt: view === 'files' ? 1.5 : 2,
        mx: view === 'files' ? 1.5 : 0,
        flexShrink: 0,
      }}
    >
      {lastError ? (
        <XDriveStatusAlert
          tone="bad"
          action={onOpenDiagnostics ? (
            <Button color="inherit" size="small" onClick={onOpenDiagnostics}>运行诊断</Button>
          ) : undefined}
        >
          同步异常：{lastError}
        </XDriveStatusAlert>
      ) : null}
      {paused ? (
        <XDriveStatusAlert
          tone="warning"
          action={onResumeSync ? (
            <Button color="inherit" size="small" disabled={resumeDisabled} onClick={onResumeSync}>
              恢复同步
            </Button>
          ) : undefined}
        >
          同步已暂停；此设备不会继续后台同步。
        </XDriveStatusAlert>
      ) : null}
      {hasConflicts ? (
        <XDriveStatusAlert
          tone="warning"
          action={onOpenConflicts ? (
            <Button color="inherit" size="small" onClick={onOpenConflicts}>处理冲突</Button>
          ) : undefined}
        >
          发现 {conflictCount || 0} 个同步冲突，请进入“冲突”页面处理。
        </XDriveStatusAlert>
      ) : null}
    </Stack>
  )
}
