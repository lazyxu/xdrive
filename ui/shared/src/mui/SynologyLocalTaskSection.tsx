import { useEffect, useRef, useState } from 'react'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Button, Stack, Typography } from '@mui/material'
import type { XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryItem } from '../device-backups'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyLocalSource } from '../synology-backup-adapter'
import { formatBytes } from '../format'
import { xDriveValidateSynologyLocalBatch, xDriveValidateSynologyLocalHistoryPage } from '../synology-task-status'
import { XDriveActionButton } from './ActionButton'
import { xDriveDeviceBackupRunLabel } from './DeviceBackupFolderSummary'
import { XDriveDeviceBackupHistoryList } from './DeviceBackupHistoryList'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveTaskCardSurface, XDriveTaskCenterSection } from './TaskPresentation'

const EMPTY_SOURCES: XDriveSynologyLocalSource[] = []
type HistoryView = {
  client: XDriveSynologyBackupLocalClient
  hostEpoch: number
  sourceID: number
  loading: boolean
  failed: boolean
  items: XDriveLocalBackupCommonBatchHistoryItem[]
}

/** Agent-only, on-demand reads: no Server task or transfer assertions. */
export function XDriveSynologyLocalTaskSection({
  client, onOpenBackup,
}: {
  client: XDriveSynologyBackupLocalClient
  onOpenBackup?: () => void
}) {
  const [sources, setSources] = useState<XDriveSynologyLocalSource[]>([])
  // A→B→A Host replacement must not revive old Source or receipt state.
  const hostEpochRef = useRef({ client, epoch: 0 })
  if (hostEpochRef.current.client !== client) {
    hostEpochRef.current = { client, epoch: hostEpochRef.current.epoch + 1 }
  }
  const hostEpoch = hostEpochRef.current.epoch
  const [loadedEpoch, setLoadedEpoch] = useState(hostEpoch)
  const sameHost = loadedEpoch === hostEpoch
  const visibleSources = sameHost ? sources : EMPTY_SOURCES
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [listRevision, setListRevision] = useState(0)
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [statusRevision, setStatusRevision] = useState(0)
  const [inspecting, setInspecting] = useState(false)
  const [status, setStatus] = useState<XDriveLocalBackupCommonBatch | null>(null)
  const [statusError, setStatusError] = useState('')
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [historyView, setHistoryView] = useState<HistoryView | null>(null)

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setLoadedEpoch(hostEpoch)
    setLoading(true)
    setSources([])
    setHistoryExpanded(false)
    setHistoryView(null)
    setSelectedID(null)
    setStatus(null)
    setStatusError('')
    setListError('')
    void client.list(abort.signal).then((list) => { if (active) setSources(list) }).catch(() => {
      if (active) setListError('无法验证当前 DSM 会话或本机 Agent 的备份来源。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; abort.abort() }
  }, [client, hostEpoch, listRevision])

  useEffect(() => {
    if (selectedID === null || !visibleSources.some((s) => s.source_id === selectedID)) {
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
  }, [client, visibleSources, selectedID, statusRevision])

  // Historical receipts are loaded only for the explicitly expanded current Source.
  // Closing/switching aborts the read; it never cancels or restarts a backup.
  useEffect(() => {
    if (!historyExpanded || selectedID === null ||
        !visibleSources.some((item) => item.source_id === selectedID)) {
      setHistoryView(null)
      return
    }
    const id = selectedID
    const epoch = hostEpoch
    let active = true
    const abort = new AbortController()
    setHistoryView({ client, hostEpoch: epoch, sourceID: id,
      loading: true, failed: false, items: [] })
    void client.history(id, abort.signal).then((page) => {
      const checked = xDriveValidateSynologyLocalHistoryPage(id, page)
      if (active && !abort.signal.aborted && hostEpochRef.current.epoch === epoch &&
          hostEpochRef.current.client === client) {
        setHistoryView({ client, hostEpoch: epoch, sourceID: id,
          loading: false, failed: false, items: checked.items })
      }
    }).catch(() => {
      if (active && !abort.signal.aborted && hostEpochRef.current.epoch === epoch &&
          hostEpochRef.current.client === client) {
        setHistoryView({ client, hostEpoch: epoch, sourceID: id,
          loading: false, failed: true, items: [] })
      }
    })
    return () => { active = false; abort.abort() }
  }, [client, historyExpanded, historyRevision, hostEpoch, selectedID, visibleSources])

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
      loadedCount={loading || !sameHost || listError ? undefined : visibleSources.length}
      description="仅限当前 DSM 用户有权访问的本机 Agent；不是 Server 全局任务或完整传输中心。"
      actions={<XDriveActionButton compact startIcon={<RefreshRoundedIcon />}
        disabled={loading} onClick={() => setListRevision((v) => v + 1)}>刷新来源</XDriveActionButton>}
    >
      {sameHost && listError ? <XDriveStatusAlert tone="bad">{listError}</XDriveStatusAlert> : null}
      {loading || !sameHost ? (
        <Stack data-xdrive-nas-task-first-read aria-busy="true" sx={{ minHeight: 120 }} />
      ) : !listError && visibleSources.length === 0 ? (
        <XDriveStatePanel variant="plain"
          message="没有已授权的本机备份来源；不代表服务器或其他设备没有任务。" />
      ) : (
        <Stack spacing={1}>
          {visibleSources.map((item) => {
            const selected = selectedID === item.source_id
            const current = selected && status?.source_id === item.source_id ? status : null
            const currentHistory = selected && historyView?.client === client &&
              historyView.hostEpoch === hostEpoch && historyView.sourceID === item.source_id
              ? historyView : null
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
                      else { setSelectedID(item.source_id); setHistoryExpanded(false); setHistoryView(null) }
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
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Button size="small" onClick={() => {
                        setHistoryExpanded(value => !value)
                        setHistoryView(null)
                      }}>
                        {historyExpanded ? '收起最近历史' : '查看最近历史'}
                      </Button>
                      {historyExpanded ? (
                        <Button size="small" disabled={Boolean(currentHistory?.loading)}
                          onClick={() => setHistoryRevision(value => value + 1)}>
                          刷新历史
                        </Button>
                      ) : null}
                    </Stack>
                    {historyExpanded ? (
                      <>
                        {!currentHistory || currentHistory.loading ? (
                          <Typography variant="caption" role="status">
                            正在读取当前 Source 的最近备份记录…
                          </Typography>
                        ) : null}
                        <XDriveDeviceBackupHistoryList
                          sourceID={item.source_id}
                          entries={currentHistory?.items.map(run => ({
                            kind: 'local-receipt' as const, run,
                          })) ?? []}
                          loading={!currentHistory || currentHistory.loading}
                          verified={Boolean(currentHistory) && !currentHistory?.loading && !currentHistory?.failed}
                          error={currentHistory?.failed
                            ? '本机历史读取失败；可点击刷新历史重试。' : undefined}
                          emptyMessage="当前 Source 暂无已记录的备份批次"
                        />
                        <Typography variant="caption" color="text.secondary">
                          历史仅是所属 Agent 的运行收据，不表示当前 CAS 已完整验证。
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
