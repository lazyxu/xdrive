import { useCallback, useEffect, useState } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import type { XDriveLocalBackupCommonBatchHistoryItem } from '../device-backups'
import type { XDriveSynologyBackupLocalClient, XDriveSynologyLocalSource } from '../synology-backup-adapter'
import { XDriveDeviceBackupFolderAccordion } from './DeviceBackupFolderAccordion'
import { XDriveDeviceBackupLocalPrimaryActions } from './DeviceBackupLocalPrimaryActions'
import { XDriveDeviceBackupDeviceCard } from './DeviceBackupDeviceCard'
import { XDriveDeviceBackupHistoryList } from './DeviceBackupHistoryList'
import { XDriveDeviceBackupLocalCommonBatchDialog } from './DeviceBackupLocalCommonBatchDialog'
import { XDriveDeviceBackupLocalScheduleDialog } from './DeviceBackupLocalScheduleDialog'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatePanel } from './StatePanel'
import { XDriveSynologyBackupSourceSetup } from './SynologyBackupSourceSetup'
import { XDriveStatusAlert } from './StatusAlert'

type LocalHistory = {
  loading: boolean
  failed: boolean
  items: XDriveLocalBackupCommonBatchHistoryItem[]
}

// Reuse the same MUI page shell and folder presentation as Desktop. The DSM
// adapter exposes only owning Source IDs and redacted history; no fake device
// identity, private Root, second Runner, or Electron IPC is sent to a browser.
export function XDriveSynologyBackupLocalPanel({ client }: {
  client: XDriveSynologyBackupLocalClient
}) {
  const [sources, setSources] = useState<XDriveSynologyLocalSource[]>([])
  // Keep the rendered list, history and mutation dialogs tied to the client
  // whose DSM session actually produced them. A new Host client is visible
  // before passive effects can clear the old owner's data.
  const [viewClient, setViewClient] = useState(client)
  const sameOwningClient = viewClient === client
  const visibleSources = sameOwningClient ? sources : []
  const [loading, setLoading] = useState(true)
  const visibleLoading = loading || !sameOwningClient
  const [error, setError] = useState('')
  const [refreshID, setRefreshID] = useState(0)
  const [expandedID, setExpandedID] = useState<number | null>(null)
  const [activeID, setActiveID] = useState<number | null>(null)
  const [scheduleID, setScheduleID] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)
  const [histories, setHistories] = useState<Record<number, LocalHistory>>({})
  const visibleError = sameOwningClient ? error : ''
  const visibleNotice = sameOwningClient ? notice : ''
  const refresh = useCallback(() => { setRefreshID((n) => n + 1) }, [])

  useEffect(() => {
    let active = true
    const abort = new AbortController()
    setLoading(true)
    setError('')
    setNotice('')
    // Mark this Host generation only with the other state invalidations.
    setViewClient(client)
    // DSM session/principal changes must not retain the old Source list.
    setSources([])
    setExpandedID(null)
    setActiveID(null)
    setScheduleID(null)
    setHistories({})
    void client.list(abort.signal).then((items) => {
      if (active) setSources(items)
    }).catch(() => {
      if (active) setError('本机备份暂不可用。请检查 DSM 登录权限和 xdrive-agent。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false; abort.abort() }
  }, [client, refreshID])

  useEffect(() => {
    if (!sameOwningClient || expandedID === null) return
    let active = true
    const abort = new AbortController()
    const id = expandedID
    setHistories((prev) => ({ ...prev, [id]: { loading: true, failed: false, items: [] } }))
    void client.history(id, abort.signal).then((page) => {
      if (!active) return
      if (page.source_id !== id || !Array.isArray(page.items) || page.items.length > 20 ||
        page.items.some((item) => item.source_id !== id || !item.run_id ||
          !Number.isSafeInteger(item.revision) || item.revision <= 0 ||
          !['partial', 'uncertain', 'paused', 'cancelled'].includes(item.state) ||
          ![item.inspected_files, item.confirmed_files, item.skipped_files,
            item.unsupported_files, item.uncertain_files, item.confirmed_bytes].every(
              (value) => Number.isSafeInteger(value) && value >= 0,
            ) || item.confirmed_files + item.skipped_files > item.inspected_files ||
          !Number.isFinite(Date.parse(item.finished_at)))) {
        throw new Error('Untrusted DSM owning Agent backup history')
      }
      setHistories((prev) => ({ ...prev, [id]: { loading: false, failed: false, items: page.items } }))
    }).catch(() => {
      if (active) setHistories((prev) => ({
        ...prev, [id]: { loading: false, failed: true, items: [] },
      }))
    })
    return () => { active = false; abort.abort() }
  }, [client, expandedID, historyRevision, sameOwningClient])

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="设备备份"
      subtitle="查看本机同步文件夹、进度与历史；所有操作只能在所属设备本机进行。"
      pageActions={
        <Button size="small" startIcon={<RefreshRoundedIcon />} disabled={loading}
          onClick={refresh}>刷新</Button>
      }
    >
      {visibleError ? <XDriveStatusAlert tone="neutral">{visibleError}</XDriveStatusAlert> : null}
      {visibleNotice ? <XDriveStatusAlert tone="neutral">{visibleNotice}</XDriveStatusAlert> : null}
      <Box data-xdrive-device-backup-overview sx={{
        position: 'relative', minWidth: 0,
        minHeight: visibleLoading || visibleSources.length === 0 ? 180 : undefined,
      }}>
        {visibleLoading ? (
          <Box data-xdrive-device-backup-first-read aria-busy="true" sx={{
            minHeight: 180, display: 'grid', placeItems: 'center',
          }} />
        ) : visibleError ? null : visibleSources.length === 0 ? (
          <XDriveStatePanel variant="plain"
            message="暂无已授权的本机同步文件夹。可在下方确认创建 NAS 备份来源，或使用本机 xd backup init。" />
        ) : (
          <Stack spacing={2}>
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>本机</Typography>
              <XDriveDeviceBackupDeviceCard
                name="当前 NAS"
                details="Synology DSM · 仅显示本机 Agent 已验证的备份来源"
              >
                {visibleSources.map((item) => {
                  const history = histories[item.source_id]
                  return (
                    <XDriveDeviceBackupFolderAccordion
                      key={item.source_id}
                      folder={{ name: item.name, sync_mode: 'backup' }}
                      targetUnavailableLabel="当前 DSM 页面未提供"
                      historyUnavailableLabel="展开查看本机运行历史"
                      expanded={expandedID === item.source_id}
                      onExpandedChange={(isOpen) => setExpandedID(isOpen ? item.source_id : null)}
                    >
                      <XDriveDeviceBackupLocalPrimaryActions
                        onRun={() => setActiveID(item.source_id)}
                        onSchedule={() => setScheduleID(item.source_id)}
                      />
                          <Typography variant="subtitle2">同步历史（只读）</Typography>
                          <Typography variant="caption" color="text.secondary">
                            历史任务结果不代表当前 CAS 物理完整性证明。
                          </Typography>
                          <XDriveDeviceBackupHistoryList
                            sourceID={item.source_id}
                            entries={history?.items.map((run) => ({ kind: 'local-receipt' as const, run })) ?? []}
                            loading={Boolean(history?.loading)}
                            verified={Boolean(history) && !history?.failed}
                            error={history?.failed ? '本机历史记录读取失败；折叠并重新展开可重试。' : undefined}
                            emptyMessage="暂无本机运行记录"
                          />
                    </XDriveDeviceBackupFolderAccordion>
                  )
                })}
              </XDriveDeviceBackupDeviceCard>
            </Stack>
          </Stack>
        )}
      </Box>
      <XDriveSynologyBackupSourceSetup client={client} onCreated={refresh} />
      {sameOwningClient && scheduleID !== null && (
        <XDriveDeviceBackupLocalScheduleDialog
          sourceID={scheduleID}
          actions={client}
          onClose={() => setScheduleID(null)}
          onFinished={(message) => {
            setScheduleID(null)
            setNotice(message)
            setRefreshID((n) => n + 1)
          }}
        />
      )}
      {sameOwningClient && activeID !== null && (
        <XDriveDeviceBackupLocalCommonBatchDialog
          sourceID={activeID}
          actions={client}
          onClose={() => {
            setActiveID(null)
            setHistoryRevision((n) => n + 1)
          }}
        />
      )}
    </XDriveWorkspaceSurface>
  )
}
