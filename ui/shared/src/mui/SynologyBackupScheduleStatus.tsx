import { useEffect, useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import {
  xDriveDSMBackupScheduleView,
  type XDriveDSMBackupScheduleView,
} from '../synology-task-status'

// One expanded Owner-verified DSM Source only. The existing Agent's schedule
// read is authoritative for SAVED configuration, never for execution readiness,
// last CAS verification, durable cooldown or an exact next-run time.
// Do not load all NAS Sources or grant new browser/Server write capabilities.
export function XDriveSynologyBackupScheduleStatus({
  client, sourceID, refreshEpoch,
}: {
  client: XDriveSynologyBackupLocalClient
  sourceID: number
  refreshEpoch: number
}) {
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const [schedule, setSchedule] = useState<XDriveDSMBackupScheduleView | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setReadFailed(false)
    setSchedule(null)
    void client.load(sourceID).then((raw) => {
      const verified = xDriveDSMBackupScheduleView(sourceID, raw)
      if (active) setSchedule(verified)
    }).catch(() => {
      if (active) {
        setSchedule(null)
        setReadFailed(true)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    // The owning Agent may not support aborting this already-bounded GET.
    // A Host/Source change still invalidates its result synchronously.
    return () => { active = false }
  }, [client, sourceID, refreshEpoch, retry])

  return (
    <Stack data-xdrive-dsm-schedule-status={sourceID} spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">自动增量备份计划</Typography>
        <Button size="small" variant="text" disabled={loading}
          onClick={() => setRetry(value => value + 1)}>刷新计划</Button>
      </Stack>
      {loading ? (
        <Typography variant="caption" role="status">正在读取所属 Agent 保存的计划…</Typography>
      ) : null}
      {readFailed ? (
        <Typography variant="caption" role="alert" color="text.secondary">
          当前本机自动计划无法核验，不能判定是否启用；请检查 Agent 后刷新。
        </Typography>
      ) : null}
      {schedule ? (
        <>
          <Typography variant="body2">{schedule.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {schedule.detail}（Source 版本 {schedule.sourceRevision}）
          </Typography>
          {schedule.enabled ? (
            <Typography variant="caption" color="text.secondary">
              下次实际执行时间：当前 Agent 尚未提供可核验的调度时间；
              不会根据浏览器时钟或上次历史记录猜测。
            </Typography>
          ) : null}
        </>
      ) : null}
    </Stack>
  )
}
