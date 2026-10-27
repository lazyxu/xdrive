import { useEffect, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Button, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupCommonBatch } from '../device-backups'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyLocalSource } from '../synology-backup-adapter'
import { formatBytes } from '../format'
import { xDriveValidateSynologyLocalBatch } from '../synology-task-status'
import { XDriveActionButton } from './ActionButton'
import { xDriveDeviceBackupRunLabel } from './DeviceBackupFolderSummary'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveTaskCardSurface, XDriveTaskCenterSection } from './TaskPresentation'

/** Agent-only, on-demand reads: no Server task or transfer assertions. */
export function XDriveSynologyLocalTaskSection({
  client, onOpenBackup,
}: {
  client: XDriveSynologyBackupLocalClient
  onOpenBackup?: () => void
}) {
  const [sources, setSources] = useState<XDriveSynologyLocalSource[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [listRevision, setListRevision] = useState(0)
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [statusRevision, setStatusRevision] = useState(0)
  const [inspecting, setInspecting] = useState(false)
  const [status, setStatus] = useState<XDriveLocalBackupCommonBatch | null>(null)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setLoading(true)
    setSources([])
    setSelectedID(null)
    setStatus(null)
    setStatusError('')
    setListError('')
    void client.list(abort.signal).then((list) => { if (active) setSources(list) }).catch(() => {
      if (active) setListError('无法验证当前 DSM 会话或本机 Agent 的备份来源。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; abort.abort() }
  }, [client, listRevision])

  useEffect(() => {
    if (selectedID === null || !sources.some((s) => s.source_id === selectedID)) {
      setStatus(null)
      setInspecting(false)
      return
    }
    let active = true
    const abort = new AbortController()
    setStatus(null)
    setStatusError('')
    setInspecting(true)
    // A single user-selected Source is inspected; never fan out 512 requests.
    void client.inspect(selectedID, abort.signal).then((snapshot) => {
      const checked = xDriveValidateSynologyLocalBatch(selectedID, snapshot)
      if (active) setStatus(checked)
    }).catch(() => {
      if (active) setStatusError('本机批次状态不可用；无法推断已完成或 CAS 已验证。')
    }).finally(() => { if (active) setInspecting(false) })
    return () => { active = false; abort.abort() }
  }, [client, sources, selectedID, statusRevision])

  // Exactly one running local Source may be polled, only in a visible tab.
  useEffect(() => {
    if (!status?.running || selectedID === null) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setStatusRevision((n) => n + 1)
    }, 10000)
    return () => { window.clearInterval(timer) }
  }, [status?.running, selectedID])

  return (
    <XDriveTaskCenterSection
      title="本机备份批次"
      loadedCount={loading || listError ? undefined : sources.length}
      description="仅限当前 DSM 用户有权访问的本机 Agent；不是 Server 全局任务或完整传输中心。"
      actions={<XDriveActionButton compact startIcon={<RefreshRoundedIcon />}
        disabled={loading} onClick={() => setListRevision((v) => v + 1)}>刷新来源</XDriveActionButton>}
    >
      {listError ? <XDriveStatusAlert tone="bad">{listError}</XDriveStatusAlert> : null}
      {loading ? (
        <Stack data-xdrive-nas-task-first-read aria-busy="true" sx={{ minHeight: 120 }} />
      ) : !listError && sources.length === 0 ? (
        <XDriveStatePanel variant="plain"
          message="没有已授权的本机备份来源；不代表服务器或其他设备没有任务。" />
      ) : (
        <Stack spacing={1}>
          {sources.map((item) => {
            const selected = selectedID === item.source_id
            const current = selected && status?.source_id === item.source_id ? status : null
            return (
              <XDriveTaskCardSurface key={item.source_id} focused={selected}
                data-xdrive-nas-task-source-id={item.source_id} sx={{ p: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
                  alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={650}>{item.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {current ? '当前本机批次快照' : '当前批次状态尚未验证'}
                    </Typography>
                  </Stack>
                  <Button size="small" variant={selected ? 'outlined' : 'text'}
                    disabled={selected && inspecting}
                    onClick={() => {
                      if (selected) setStatusRevision((v) => v + 1)
                      else setSelectedID(item.source_id)
                    }}>
                    {selected ? '刷新状态' : '查看状态'}
                  </Button>
                </Stack>
                {selected ? (
                  <Stack spacing={1} sx={{ mt: 1.25 }}>
                    {inspecting ? (
                      <Typography variant="caption" aria-busy="true">正在读取本机状态…</Typography>
                    ) : null}
                    {statusError ? <XDriveStatusAlert tone="neutral">{statusError}</XDriveStatusAlert> : null}
                    {current ? (
                      <>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <XDriveStatusBadge
                            tone={current.running ? 'busy' : current.state === 'uncertain' ? 'warning' : 'neutral'}
                            label={xDriveDeviceBackupRunLabel(current.state)} />
                          <Typography variant="caption" color="text.secondary">
                            已检查 {current.inspected_files.toLocaleString('zh-CN')} ·
                            已确认 {current.confirmed_files.toLocaleString('zh-CN')} ·
                            待核对 {current.uncertain_files.toLocaleString('zh-CN')} ·
                            {formatBytes(current.confirmed_bytes)}
                          </Typography>
                        </Stack>
                        {current.stop_requested ? (
                          <Typography variant="caption" color="text.secondary">
                            已请求{current.stop_requested === 'pause' ? '暂停' : '取消'}；以本机后续状态为准。
                          </Typography>
                        ) : null}
                        <Typography variant="caption" color="text.secondary">
                          此快照不是完整备份、云端 CAS 验证或可删除本机原件的证明。
                        </Typography>
                      </>
                    ) : null}
                  </Stack>
                ) : null}
              </XDriveTaskCardSurface>
            )
          })}
          {onOpenBackup ? (
            <Stack alignItems="flex-start">
              <XDriveActionButton compact onClick={onOpenBackup}>打开本机备份</XDriveActionButton>
            </Stack>
          ) : null}
        </Stack>
      )}
    </XDriveTaskCenterSection>
  )
}
