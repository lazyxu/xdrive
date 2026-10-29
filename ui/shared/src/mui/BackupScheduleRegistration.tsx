import { Alert, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServerBackupPage } from '../server-backup-admin'

/** This is evidence of exactly one installer-managed crontab row, never
 * evidence of a completed backup, a next-run estimate or an external job. */
export function XDriveBackupScheduleRegistration({ inventory }: {
  inventory: XDriveServerBackupPage['inventory']
}) {
  const schedule = inventory.schedule
  const state = schedule?.state || 'unknown'
  const descriptions: Record<string, string> = {
    registered: '宿主机已核对当前配置与唯一的 xDrive 安装器托管 cron 记录一致。',
    not_detected: '当前配置包含定时表达式，但未找到对应的安装器托管 cron 记录。',
    mismatch: '检测到安装器托管 cron 记录，但与当前配置不匹配或存在重复记录。',
    not_configured: '当前未配置 xDrive 定时表达式，也没有检测到安装器托管的 cron 记录。',
    unknown: '当前无法获得可信的本机 cron 安装状态；不能推断备份会自动执行。',
  }
  const needsAttention = state === 'mismatch' || state === 'not_detected' || state === 'unknown'
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
      data-xdrive-admin-backup-schedule-evidence>
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={600}>定时备份实际安装状态</Typography>
        <Alert severity={needsAttention ? 'warning' : 'info'}>
          {descriptions[state] || descriptions.unknown}
        </Alert>
        {schedule?.expression ? (
          <Typography variant="body2" data-xdrive-backup-cron-expression>
            当前配置的定时表达式：{schedule.expression}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          仅确认安装器管理的本机 crontab 是否与当前配置一致；无法证明下一次任务一定执行成功，
          也不识别 systemd、DSM 或其他外部调度器。实际备份成功、失败与校验证据请以宿主机操作历史为准。
          不会在页面显示 cron 命令、Host 路径、凭据或任意计划任务内容。
        </Typography>
      </Stack>
    </Paper>
  )
}
