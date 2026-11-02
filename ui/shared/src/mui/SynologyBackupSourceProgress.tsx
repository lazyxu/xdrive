import { useEffect, useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupCommonBatch } from '../device-backups'
import type { XDriveSynologyBackupLocalClient } from '../synology-backup-adapter'
import { formatBytes } from '../format'
import { xDriveValidateSynologyLocalBatch } from '../synology-task-status'
import { xDriveDeviceBackupRunLabel } from './DeviceBackupFolderSummary'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'

// Mounted ONLY inside an expanded Source card in the shared Device Backup
// page. The original owning Agent supplies the status; DSM has no second
// Runner, cross-device Source lookup or private Root/path projection.
export function XDriveSynologyBackupSourceProgress({
  client, sourceID, refreshEpoch,
}: {
  client: XDriveSynologyBackupLocalClient
  sourceID: number
  refreshEpoch: number
}) {
  const [readRevision, setReadRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const [batch, setBatch] = useState<XDriveLocalBackupCommonBatch | null>(null)

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    // Never render an old status as the current response during a new read.
    // Host A -> B -> A and Source changes also remount this component by key.
    setLoading(true)
    setReadFailed(false)
    setBatch(null)
    void client.inspect(sourceID, abort.signal).then((raw) => {
      const verified = xDriveValidateSynologyLocalBatch(sourceID, raw)
      if (active && !abort.signal.aborted) setBatch(verified)
    }).catch(() => {
      if (active && !abort.signal.aborted) {
        setBatch(null)
        setReadFailed(true)
      }
    }).finally(() => {
      if (active && !abort.signal.aborted) setLoading(false)
    })
    return () => { active = false; abort.abort() }
  }, [client, sourceID, refreshEpoch, readRevision])

  // No background Source fan-out. While THIS expanded source is running,
  // re-read only when the browser tab is visible; unmount cancels the timer.
  useEffect(() => {
    if (!batch?.running || typeof window === 'undefined') return
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        setReadRevision(n => n + 1)
      }
    }, 10000)
    return () => window.clearInterval(timer)
  }, [batch?.running, client, sourceID])

  return (
    <Stack data-xdrive-dsm-source-live-progress={sourceID} spacing={0.75}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">当前本机备份进度</Typography>
        <Button size="small" variant="text" disabled={loading}
          onClick={() => setReadRevision(n => n + 1)}>刷新进度</Button>
      </Stack>
      {loading ? (
        <Typography variant="caption" role="status">正在读取所属 Agent 的批次状态…</Typography>
      ) : null}
      {readFailed ? (
        <XDriveStatusAlert tone="neutral">
          当前本机批次状态不可用；不会使用历史记录假定本次备份成功。
        </XDriveStatusAlert>
      ) : null}
      {batch ? (
        <>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <XDriveStatusBadge
              tone={batch.running ? 'busy' : batch.state === 'uncertain' ? 'warning' : 'neutral'}
              label={xDriveDeviceBackupRunLabel(batch.state)} />
            <Typography variant="caption" color="text.secondary">
              已检查 {batch.inspected_files.toLocaleString('zh-CN')} ·
              已确认 {batch.confirmed_files.toLocaleString('zh-CN')} ·
              待核对 {batch.uncertain_files.toLocaleString('zh-CN')} ·
              {formatBytes(batch.confirmed_bytes)}
            </Typography>
          </Stack>
          {batch.stop_requested ? (
            <Typography variant="caption" color="text.secondary">
              已请求{batch.stop_requested === 'pause' ? '暂停' : '取消'}；实际状态以 Agent 下一次核对为准。
            </Typography>
          ) : null}
        </>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        当前数据仅为本机 Agent 批次快照，不代表整份备份完成、CAS 物理校验或可删除源文件。
      </Typography>
    </Stack>
  )
}
