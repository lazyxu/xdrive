import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button,
  Divider, LinearProgress, Stack, Typography,
} from '@mui/material'
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveDeviceBackupLocalCreateDialog } from './DeviceBackupLocalCreateDialog'
import { XDriveDeviceBackupLocalDrafts } from './DeviceBackupLocalDrafts'
import { XDriveDeviceBackupLocalRenameDialog } from './DeviceBackupLocalRenameDialog'
import { XDriveDeviceBackupLocalTargetDialog } from './DeviceBackupLocalTargetDialog'
import { XDriveDeviceBackupLocalModeDialog } from './DeviceBackupLocalModeDialog'
import { XDriveDeviceBackupLocalRulesDialog } from './DeviceBackupLocalRulesDialog'
import { XDriveDeviceBackupLocalScheduleDialog } from './DeviceBackupLocalScheduleDialog'
import { XDriveDeviceBackupLocalPreviewDialog } from './DeviceBackupLocalPreviewDialog'
import { XDriveDeviceBackupLocalSnapshotDialog } from './DeviceBackupLocalSnapshotDialog'
import { XDriveDeviceBackupLocalDeltaDialog } from './DeviceBackupLocalDeltaDialog'
import { XDriveDeviceBackupLocalEvidenceDialog } from './DeviceBackupLocalEvidenceDialog'
import { XDriveDeviceBackupLocalEvidenceSummaryDialog } from './DeviceBackupLocalEvidenceSummaryDialog'
import { XDriveDeviceBackupLocalEvidencePreflightDialog } from './DeviceBackupLocalEvidencePreflightDialog'
import { XDriveDeviceBackupLocalRemoveDialog } from './DeviceBackupLocalRemoveDialog'
import type { XDriveLocalBackupRemoveActions } from './DeviceBackupLocalRemoveDialog'
import type { XDriveLocalBackupTargetActions } from './DeviceBackupLocalTargetDialog'
import type { XDriveLocalBackupModeActions } from './DeviceBackupLocalModeDialog'
import type { XDriveLocalBackupRulesActions } from './DeviceBackupLocalRulesDialog'
import type { XDriveLocalBackupScheduleActions } from './DeviceBackupLocalScheduleDialog'
import type { XDriveLocalBackupPreviewActions } from './DeviceBackupLocalPreviewDialog'
import type { XDriveLocalBackupSnapshotActions } from './DeviceBackupLocalSnapshotDialog'
import type { XDriveLocalBackupDeltaActions } from './DeviceBackupLocalDeltaDialog'
import type { XDriveLocalBackupEvidenceActions } from './DeviceBackupLocalEvidenceDialog'
import type { XDriveLocalBackupEvidenceSummaryActions } from './DeviceBackupLocalEvidenceSummaryDialog'
import type { XDriveLocalBackupEvidencePreflightActions } from './DeviceBackupLocalEvidencePreflightDialog'
import type { XDriveLocalBackupSettingsActions } from './DeviceBackupLocalRenameDialog'
import type { XDriveLocalBackupCreateActions } from './DeviceBackupLocalCreateDialog'
import type { XDriveSourceTargetBrowser } from './SourceManager'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { formatBytes } from '../format'
import { xDriveDeviceBackupVisibleFolders, xDriveDeviceBackupContainsVisibleSource } from '../device-backup-visible-folders'
import { validateXDriveDeviceBackupFolderPage } from '../device-backup-folder-page-validation'
import { validateXDriveDeviceBackupDevicePage } from '../device-backup-device-page-validation'
import type {
  XDriveDeviceBackupDataSource, XDriveDeviceBackupOverview, XDriveDeviceBackupRun,
  XDriveDeviceBackupDevice, XDriveDeviceBackupFolder,
  XDriveLocalSourceDraftPage,
} from '../device-backups'

type HistoryPage = { items: XDriveDeviceBackupRun[]; page: number; hasMore: boolean; loading: boolean; verified: boolean }
type OverviewState = {
  source?: XDriveDeviceBackupDataSource
  overview: XDriveDeviceBackupOverview | null
  loading: boolean
  failed: boolean
  pageLoading?: boolean
  pageFailed?: boolean
}
type HistoryState = {
  source?: XDriveDeviceBackupDataSource
  pages: Record<number, HistoryPage>
}
type DeviceFolderRead = {
  items: XDriveDeviceBackupFolder[]
  nextAfterSourceID: number
  complete: boolean
  loading: boolean
  failed: boolean
  requestID: number
}
type FolderReadState = { scope: number; devices: Record<string, DeviceFolderRead> }
type VerifiedLocalIdentityState = {
  source?: XDriveDeviceBackupDataSource
  deviceID: string | null
}
const emptyHistory: Record<number, HistoryPage> = {}
const emptyFolderPages: Record<string, DeviceFolderRead> = {}
const pageSize = 20
function timeLabel(value?: string) {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')
}
function runLabel(status: string) {
  const labels: Record<string, string> = {
    running: '运行中', completed: '已完成', partial: '部分完成',
    failed: '失败', cancelled: '已取消',
  }
  return labels[status] ?? '未知状态'
}
function platformLabel(platform: string) {
  const names: Record<string, string> = { windows: 'Windows', linux: 'Linux', darwin: 'macOS' }
  return names[platform] ?? platform
}

// All devices share the strictly redacted read model. The optional local
// creator exists only in the owning Desktop and is separately Agent-gated;
// Web/Mobile Web never receive it and cannot mutate or obtain a local Root.
export function XDriveDeviceBackupPage({
  source,
  initialSourceID,
  localCreate,
  targetBrowser,
  localDrafts,
  localSettings,
  localTarget,
  localMode,
  localRules,
  localSchedule,
  localPreview,
  localSnapshot,
  localDelta,
  localEvidence,
  localEvidenceSummary,
  localEvidencePreflight,
  localRemove,
}: {
  source?: XDriveDeviceBackupDataSource
  initialSourceID?: number
  localCreate?: XDriveLocalBackupCreateActions
  targetBrowser?: XDriveSourceTargetBrowser
  localDrafts?: (limit: number, afterID: number) => Promise<XDriveLocalSourceDraftPage>
  localSettings?: XDriveLocalBackupSettingsActions
  localTarget?: XDriveLocalBackupTargetActions
  localMode?: XDriveLocalBackupModeActions
  localRules?: XDriveLocalBackupRulesActions
  localSchedule?: XDriveLocalBackupScheduleActions
  localPreview?: XDriveLocalBackupPreviewActions
  localSnapshot?: XDriveLocalBackupSnapshotActions
  localDelta?: XDriveLocalBackupDeltaActions
  localEvidence?: XDriveLocalBackupEvidenceActions
  localEvidenceSummary?: XDriveLocalBackupEvidenceSummaryActions
  localEvidencePreflight?: XDriveLocalBackupEvidencePreflightActions
  localRemove?: XDriveLocalBackupRemoveActions
}) {
  const [refreshID, refresh] = useState(0)
  // The render-scoped epoch invalidates requests on A→B→A account,
  // Server/Agent changes and refreshes, even when the viewer is not unmounted.
  const folderScopeRef = useRef({ source, refreshID, epoch: 0 })
  if (folderScopeRef.current.source !== source || folderScopeRef.current.refreshID !== refreshID) {
    folderScopeRef.current = { source, refreshID, epoch: folderScopeRef.current.epoch + 1 }
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [targetChange, setTargetChange] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [modeChange, setModeChange] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [rulesTarget, setRulesTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [snapshotTarget, setSnapshotTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [deltaTarget, setDeltaTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [evidenceTarget, setEvidenceTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [evidenceSummaryTarget, setEvidenceSummaryTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [evidencePreflightTarget, setEvidencePreflightTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const [localMessage, setLocalMessage] = useState('')
  // Late wizard completions must never publish messages into a different
  // account/server's Device Backup page.
  const activeSourceRef = useRef(source)
  activeSourceRef.current = source
  useEffect(() => {
    setCreateOpen(false)
    setRenameTarget(null)
    setTargetChange(null)
    setModeChange(null)
    setRulesTarget(null)
    setScheduleTarget(null)
    setPreviewTarget(null)
    setSnapshotTarget(null)
    setDeltaTarget(null)
    setEvidenceTarget(null)
    setEvidenceSummaryTarget(null)
    setEvidencePreflightTarget(null)
    setRemoveTarget(null)
    setLocalMessage('')
  }, [source])
  // The data source identity is the account/server boundary. Never display
  // another session's cached overview while its replacement request starts.
  const [snapshot, setSnapshot] = useState<OverviewState>({
    overview: null, loading: false, failed: false,
  })
  const current = snapshot.source === source
  const overview = current ? snapshot.overview : null
  const loading = current ? snapshot.loading : Boolean(source)
  const failed = current && snapshot.failed
  const [delayedRead, setDelayedRead] = useState<{
    source: XDriveDeviceBackupDataSource; revision: number
  } | null>(null)
  const showReadProgress = Boolean(source && overview && loading && delayedRead?.source === source &&
    delayedRead.revision === refreshID)
  // Only an accepted overview refresh gets delayed in-place feedback.
  // An unverified first Owner/Agent read must stay silent, even after 300ms.
  useEffect(() => {
    if (!source || !loading || !overview) return
    const timer = window.setTimeout(() => setDelayedRead({ source, revision: refreshID }), 300)
    return () => window.clearTimeout(timer)
  }, [source, refreshID, loading, overview])
  const pageLoading = current && Boolean(snapshot.pageLoading)
  const pageFailed = current && Boolean(snapshot.pageFailed)
  const [expanded, setExpanded] = useState<{ source?: XDriveDeviceBackupDataSource; id: number | null }>({
    id: initialSourceID ?? null,
  })
  const expandedID = expanded.source === source ? expanded.id : initialSourceID ?? null
  const [historyState, setHistoryState] = useState<HistoryState>({ pages: {} })
  const histories = historyState.source === source ? historyState.pages : emptyHistory
  const [folderReadState, setFolderReadState] = useState<FolderReadState>({ scope: -1, devices: {} })
  const folderPages = folderReadState.scope === folderScopeRef.current.epoch ? folderReadState.devices : emptyFolderPages
  const folderRequestIDs = useRef<Record<string, number>>({})
  const visibleFolders = (device: XDriveDeviceBackupDevice): XDriveDeviceBackupFolder[] =>
    xDriveDeviceBackupVisibleFolders(device, folderPages[device.id])
  const [historyError, setHistoryError] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const requests = useRef<Record<number, number>>({})
  const [localIdentity, setLocalIdentity] = useState<VerifiedLocalIdentityState>({ deviceID: null })
  const verifiedLocalDeviceID = localIdentity.source === source ? localIdentity.deviceID : null
  // Read-only folder paging may surface local Source IDs beyond the first
  // overview 1000 bindings. Native actions remain gated by verified Agent
  // device identity plus Server-side Root/Source revision permissions.
  const localOwnsFolder = (sourceID: number): boolean => Boolean(
    verifiedLocalDeviceID && overview?.devices.some((device) =>
      device.id === verifiedLocalDeviceID && !device.revoked &&
      visibleFolders(device).some((folder) => folder.source_id === sourceID)),
  )
  const groupedDevices = overview && verifiedLocalDeviceID &&
    overview.devices.some((device) => device.id === verifiedLocalDeviceID)
    ? [
      { label: '本机', devices: overview.devices.filter((device) => device.id === verifiedLocalDeviceID) },
      { label: '其他设备', devices: overview.devices.filter((device) => device.id !== verifiedLocalDeviceID) },
    ].filter((group) => group.devices.length > 0)
    : [{ label: '', devices: overview?.devices ?? [] }]

  // Account/Server and Agent capability changes replace the datasource.
  // Never label another account's device as local while verification is pending.
  useEffect(() => {
    if (!source?.verifiedLocalDevice) return
    let active = true
    setLocalIdentity({ source, deviceID: null })
    void source.verifiedLocalDevice().then((deviceID) => {
      if (active) setLocalIdentity({ source, deviceID: deviceID || null })
    }).catch(() => {
      if (active) setLocalIdentity({ source, deviceID: null })
    })
    return () => { active = false }
  }, [source, refreshID])

  useEffect(() => {
    if (!source) return
    let active = true
    // Retain a same-account authoritative snapshot until the next owner
    // response. A changed Server/account source must never show prior devices.
    setSnapshot((prev) => ({
      source,
      overview: prev.source === source ? prev.overview : null,
      loading: true, failed: false,
    }))
    void source.list().then((result) => {
      if (active) setSnapshot({ source, overview: result, loading: false, failed: false })
    }).catch(() => {
      if (active) setSnapshot((prev) => prev.source === source
        ? { ...prev, loading: false, failed: true }
        : prev)
    })
    return () => { active = false }
  }, [source, refreshID])

  // Device list pages are owner-redacted and optional for older Agents.
  // Requiring the exact captured overview identity fences stale results after
  // account/Server switch, refresh and concurrently superseding page loads.
  const loadMoreDevices = useCallback(async () => {
    if (!source?.listPage || !overview?.has_more || !overview.next_after_device_id ||
      loading || pageLoading) return
    const requestedOverview = overview
    const cursor = requestedOverview.next_after_device_id
    // Narrow the optional cursor as a local immutable value for the async call.
    if (!cursor) return
    setSnapshot((prev) => prev.source === source && prev.overview === requestedOverview
      ? { ...prev, pageLoading: true, pageFailed: false } : prev)
    try {
      const page = await source.listPage(100, cursor)
      validateXDriveDeviceBackupDevicePage(page, cursor, new Set(requestedOverview.devices.map((device) => device.id)))
      setSnapshot((prev) => {
        if (prev.source !== source || prev.overview !== requestedOverview) return prev
        const devices = [...requestedOverview.devices]
        const seen = new Set(devices.map((device) => device.id))
        for (const device of page.devices) {
          if (seen.has(device.id)) continue
          seen.add(device.id)
          devices.push(device)
        }
        if (page.has_more && (!page.next_after_device_id ||
          page.next_after_device_id === cursor || devices.length === requestedOverview.devices.length)) {
          return { ...prev, pageLoading: false, pageFailed: true }
        }
        return {
          ...prev, pageLoading: false, pageFailed: false,
          overview: {
            ...requestedOverview, devices,
            has_more: page.has_more,
            has_more_folders: requestedOverview.has_more_folders || page.has_more_folders,
            next_after_device_id: page.has_more ? page.next_after_device_id : undefined,
          },
        }
      })
    } catch {
      setSnapshot((prev) => prev.source === source && prev.overview === requestedOverview
        ? { ...prev, pageLoading: false, pageFailed: true } : prev)
    }
  }, [source, overview, loading, pageLoading])

  // 1000 bindings is a global overview limit, not a per-device count. A
  // deliberate, per-device keyset read is required to verify completeness.
  const loadDeviceFolders = useCallback(async (deviceID: string) => {
    if (!source?.foldersPage || !overview?.devices.some((device) => device.id === deviceID) || loading) return
    const scope = folderScopeRef.current.epoch
    const currentPage = folderPages[deviceID]
    if (currentPage?.loading || currentPage?.complete) return
    const cursor = currentPage?.nextAfterSourceID ?? 0
    const requestID = (folderRequestIDs.current[deviceID] ?? 0) + 1
    folderRequestIDs.current[deviceID] = requestID
    setFolderReadState((prev) => {
      const devices = prev.scope === scope ? prev.devices : {}
      const old = devices[deviceID]
      return { scope, devices: { ...devices, [deviceID]: {
        items: old?.items ?? [], nextAfterSourceID: cursor, complete: false,
        loading: true, failed: false, requestID,
      } } }
    })
    try {
      const page = await source.foldersPage(deviceID, 100, cursor)
      if (folderScopeRef.current.epoch !== scope || folderRequestIDs.current[deviceID] !== requestID) return
      validateXDriveDeviceBackupFolderPage(page, cursor)
      if (!Array.isArray(page.folders) || typeof page.has_more !== 'boolean' ||
        !Number.isSafeInteger(page.next_after_source_id) || page.next_after_source_id < 0 ||
        page.folders.some((folder) => !Number.isSafeInteger(folder.source_id) || folder.source_id <= 0)) {
        throw new Error('Invalid redacted backup folder page')
      }
      setFolderReadState((prev) => {
        if (prev.scope !== scope) return prev
        const old = prev.devices[deviceID]
        if (!old || old.requestID !== requestID) return prev
        const items = cursor === 0 ? [] : [...old.items]
        const ids = new Set(items.map((item) => item.source_id))
        for (const folder of page.folders) {
          if (!ids.has(folder.source_id)) {
            ids.add(folder.source_id)
            items.push(folder)
          }
        }
        const lastID = page.folders.length ? page.folders[page.folders.length - 1].source_id : 0
        const invalidCursor = page.has_more
          ? lastID <= cursor || page.next_after_source_id !== lastID || items.length === (cursor === 0 ? 0 : old.items.length)
          : page.next_after_source_id !== 0
        if (invalidCursor) {
          return { ...prev, devices: { ...prev.devices, [deviceID]: { ...old, loading: false, failed: true } } }
        }
        return { ...prev, devices: { ...prev.devices, [deviceID]: {
          items, nextAfterSourceID: page.has_more ? page.next_after_source_id : 0,
          complete: !page.has_more, loading: false, failed: false, requestID,
        } } }
      })
    } catch {
      if (folderScopeRef.current.epoch !== scope || folderRequestIDs.current[deviceID] !== requestID) return
      setFolderReadState((prev) => {
        if (prev.scope !== scope) return prev
        const old = prev.devices[deviceID]
        if (!old || old.requestID !== requestID) return prev
        return { ...prev, devices: { ...prev.devices, [deviceID]: { ...old, loading: false, failed: true } } }
      })
    }
  }, [source, overview, folderPages, loading])

  const loadHistory = useCallback(async (id: number, page: number) => {
    if (!source) return
    const request = (requests.current[id] ?? 0) + 1
    requests.current[id] = request
    setHistoryError(null)
    setHistoryState((prev) => {
      const pages = prev.source === source ? prev.pages : emptyHistory
      return {
        source, pages: {
          ...pages, [id]: {
            items: pages[id]?.items ?? [],
            // Keep the last committed page number while the next Server
            // page is in flight; stage navigation until the winning receipt.
            page: pages[id]?.page ?? page,
            hasMore: pages[id]?.hasMore ?? false,
            loading: true,
            verified: pages[id]?.verified ?? false,
          },
        },
      }
    })
    try {
      const data = await source.runs(id, pageSize, (page - 1) * pageSize)
      if (requests.current[id] !== request) return
      setHistoryState((prev) => {
        if (prev.source !== source) return prev
        return {
          source, pages: {
            ...prev.pages,
            [id]: { items: data.items, page, hasMore: data.has_more, loading: false, verified: true },
          },
        }
      })
    } catch {
      if (requests.current[id] !== request) return
      setHistoryState((prev) => {
        if (prev.source !== source) return prev
        return {
          source, pages: {
            ...prev.pages,
            [id]: {
              items: prev.pages[id]?.items ?? [],
              page: prev.pages[id]?.page ?? page,
              hasMore: prev.pages[id]?.hasMore ?? false, loading: false,
              verified: prev.pages[id]?.verified ?? false,
            },
          },
        }
      })
      setHistoryError({ source, id })
    }
  }, [source])

  useEffect(() => {
    if (!initialSourceID || !overview) return
    // A bookmarked Source may be omitted by the capped overview, but become
    // visible once its owner-redacted per-device keyset page is fetched.
    if (!xDriveDeviceBackupContainsVisibleSource(overview.devices, folderPages, initialSourceID)) return
    setExpanded({ source, id: initialSourceID })
    if (!histories[initialSourceID]) void loadHistory(initialSourceID, 1)
  }, [initialSourceID, overview, folderPages, histories, loadHistory, source])

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="设备备份"
      subtitle="查看各设备的同步文件夹、进度与历史；所有操作只能在所属设备本机进行。"
      pageActions={source ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" startIcon={<RefreshRoundedIcon />} disabled={loading}
            onClick={() => refresh((n) => n + 1)}>
            刷新
          </Button>
          {localCreate && targetBrowser ? (
            <Button size="small" variant="contained" startIcon={<AddRoundedIcon />}
              onClick={() => setCreateOpen(true)}>
              新增本机备份
            </Button>
          ) : null}
        </Stack>
      ) : undefined}
    >
      {localMessage ? <XDriveStatusAlert tone="neutral">{localMessage}</XDriveStatusAlert> : null}
      {source && verifiedLocalDeviceID && localCreate && localDrafts ? (
        <XDriveDeviceBackupLocalDrafts
          key={verifiedLocalDeviceID}
          reader={localDrafts}
          actions={localCreate}
          refreshID={refreshID}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      <Box data-xdrive-device-backup-overview sx={{
        position: 'relative', minWidth: 0,
        minHeight: source && (!overview || overview.devices.length === 0) ? 180 : undefined,
      }}>
      {failed && overview ? (
        <XDriveStatusAlert tone="neutral">
          设备备份刷新失败；已保留上次成功读取的设备信息，请重试。
        </XDriveStatusAlert>
      ) : null}
      {!source ? (
        <XDriveStatusAlert tone="neutral">
          当前 Desktop Agent 暂不支持读取脱敏设备备份数据。请更新 Agent；不能从普通 Source 接口读取异机私有路径。
        </XDriveStatusAlert>
      ) : loading && !overview ? (
        <Box data-xdrive-device-backup-first-read aria-busy="true" sx={{
          minHeight: 180, display: 'grid', placeItems: 'center',
        }} />
      ) : failed && !overview ? (
        <XDriveStatePanel variant="plain" message="设备备份信息读取失败，请刷新重试。" />
      ) : !overview || overview.devices.length === 0 ? (
        <XDriveStatePanel variant="plain" message="当前账号尚未登记电脑备份设备。" />
      ) : (
        <Stack spacing={2}>
          {groupedDevices.map((group) => (
            <Stack key={group.label || 'all'} spacing={1}>
              {group.label ? <Typography variant="subtitle2" fontWeight={700}>{group.label}</Typography> : null}
              {group.devices.map((device) => (
            <Box key={device.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <DevicesRoundedIcon color="action" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={700}>{device.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {platformLabel(device.platform)} · {device.client_version || 'Agent 版本未知'} ·
                    {device.revoked ? ' 授权已撤销' : device.connection_state === 'online' ? ' 在线' : device.connection_state === 'offline' ? ' 离线' : ' 连接状态未知'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    最近登记或活动记录：{timeLabel(device.last_seen_at)}
                  </Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              {overview.has_more_folders ? (
                <Stack spacing={1} sx={{ mb: 1.5 }} alignItems="flex-start">
                  <Typography variant="caption" color="text.secondary">
                    {folderPages[device.id]?.complete
                      ? `本轮已逐页读取此设备的 ${folderPages[device.id].items.length.toLocaleString('zh-CN')} 个同步文件夹`
                      : '概览可能受到 1000 条绑定上限影响，此设备的列表仍待核对。'}
                  </Typography>
                  {source?.foldersPage ? (
                    !folderPages[device.id]?.complete ? (
                      <Button size="small" variant="outlined"
                        disabled={Boolean(folderPages[device.id]?.loading)}
                        aria-busy={Boolean(folderPages[device.id]?.loading) || undefined}
                        data-xdrive-device-backup-folder-page-action={device.id}
                        onClick={() => void loadDeviceFolders(device.id)}>
                        {folderPages[device.id]?.items.length
                          ? '加载更多此设备文件夹' : '核对并加载此设备文件夹'}
                      </Button>
                    ) : null
                  ) : <Typography variant="caption" color="text.secondary">
                    当前 Server 或 Agent 不支持文件夹连续分页，请升级后重试。
                  </Typography>}
                  {folderPages[device.id]?.failed ? (
                    <Typography variant="caption" color="error">文件夹读取失败，已保留当前内容；可重试。</Typography>
                  ) : null}
                </Stack>
              ) : null}
              {visibleFolders(device).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {overview.has_more_folders && !folderPages[device.id]?.complete
                    ? '本次概览尚未返回此设备的文件夹，请核对完整列表。'
                    : '此设备没有已绑定的同步文件夹。'}
                </Typography>
              ) : visibleFolders(device).map((folder) => {
                const history = histories[folder.source_id]
                return (
                  <Accordion key={folder.source_id} disableGutters elevation={0}
                    expanded={expandedID === folder.source_id}
                    onChange={(_event, isOpen) => {
                      setExpanded({ source, id: isOpen ? folder.source_id : null })
                      if (isOpen && !history) void loadHistory(folder.source_id, 1)
                    }}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1, '&:before': { display: 'none' } }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" fontWeight={700}>{folder.name}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          云端目标：{folder.target_path || '尚未配置'} · {folder.sync_mode === 'mirror' ? '镜像' : '备份'}
                        </Typography>
                        {folder.latest_run ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {runLabel(folder.latest_run.status)}
                            {' · '}扫描 {folder.latest_run.scanned_items.toLocaleString('zh-CN')} 项
                            {' · '}传输 {formatBytes(folder.latest_run.transferred_bytes)}
                            {' · '}失败 {folder.latest_run.failed_items} 项
                          </Typography>
                        ) : <Typography variant="caption" color="text.secondary">尚无运行记录</Typography>}
                        {folder.latest_run?.status === 'running' && folder.latest_run.active_transfer_total_bytes > 0 ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            当前传输 {formatBytes(folder.latest_run.active_transfer_bytes)}
                            {' / '}{formatBytes(folder.latest_run.active_transfer_total_bytes)}
                          </Typography>
                        ) : null}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={1}>
                        {localSettings && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setRenameTarget({ source, id: folder.source_id })}>
                            重命名本机同步文件夹
                          </Button>
                        ) : null}
                        {localTarget && targetBrowser && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setTargetChange({ source, id: folder.source_id })}>
                            修改本机云端目标
                          </Button>
                        ) : null}
                        {localMode && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setModeChange({ source, id: folder.source_id })}>
                            修改备份策略
                          </Button>
                        ) : null}
                        {localRules && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setRulesTarget({ source, id: folder.source_id })}>
                            编辑本机忽略规则
                          </Button>
                        ) : null}
                        {localSchedule && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setScheduleTarget({ source, id: folder.source_id })}>
                            配置本机同步计划
                          </Button>
                        ) : null}
                        {localPreview && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setPreviewTarget({ source, id: folder.source_id })}>
                            预览本机文件扫描（不上传）
                          </Button>
                        ) : null}
                        {localSnapshot && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setSnapshotTarget({ source, id: folder.source_id })}>
                            保存本机扫描清单（不上传）
                          </Button>
                        ) : null}
                        {localDelta && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setDeltaTarget({ source, id: folder.source_id })}>
                            比较两代本机清单（只读）
                          </Button>
                        ) : null}
                        {localEvidence && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setEvidenceTarget({ source, id: folder.source_id })}>
                            暂存本机重命名候选（不上传）
                          </Button>
                        ) : null}
                        {localEvidenceSummary && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setEvidenceSummaryTarget({ source, id: folder.source_id })}>
                            查看本机已暂存候选（只读）
                          </Button>
                        ) : null}
                        {localEvidencePreflight && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined"
                            onClick={() => setEvidencePreflightTarget({ source, id: folder.source_id })}>
                            本机内容一致性预检（不上传）
                          </Button>
                        ) : null}
                        {localRemove && verifiedLocalDeviceID === device.id && !device.revoked ? (
                          <Button size="small" variant="outlined" color="error"
                            onClick={() => setRemoveTarget({ source, id: folder.source_id })}>
                            移除本机备份配置
                          </Button>
                        ) : null}
                        <Typography variant="subtitle2">同步历史（只读）</Typography>
                        <Box data-xdrive-device-backup-history-list={folder.source_id}
                          aria-busy={Boolean(history?.loading) || undefined}
                          sx={{ minHeight: 72 }}>
                          {history && history.items.length > 0 ? history.items.map((run) => (
                            <Box key={run.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                              <Typography variant="body2">{runLabel(run.status)} · {timeLabel(run.started_at)}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                扫描 {run.scanned_items} 项
                                {' · '}传输 {run.transferred_items} 项 / {formatBytes(run.transferred_bytes)}
                                {' · '}失败 {run.failed_items} 项
                              </Typography>
                            </Box>
                          )) : history?.verified
                            ? <Typography variant="body2" color="text.secondary">暂无历史记录。</Typography>
                            : null}
                        </Box>
                        {historyError?.source === source && historyError.id === folder.source_id ? (
                          <Typography variant="caption" color="error">无法加载历史，请重试。</Typography>
                        ) : null}
                        {history && (history.page > 1 || history.hasMore) ? (
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Button size="small" disabled={history.loading || history.page <= 1}
                              onClick={() => void loadHistory(folder.source_id, history.page - 1)}>上一页</Button>
                            <Typography variant="caption">第 {history.page} 页</Typography>
                            <Button size="small" disabled={history.loading || !history.hasMore}
                              onClick={() => void loadHistory(folder.source_id, history.page + 1)}>下一页</Button>
                          </Stack>
                        ) : null}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Box>
              ))}
            </Stack>
          ))}
          {overview.has_more ? (
            <Stack spacing={1} alignItems="flex-start">
              <Typography variant="caption" color="text.secondary">
                当前显示 {overview.devices.length.toLocaleString('zh-CN')} 台设备，另有未加载设备。
              </Typography>
              {source?.listPage && overview.next_after_device_id ? (
                <Button size="small" variant="outlined" disabled={pageLoading}
                  aria-busy={pageLoading || undefined}
                  data-xdrive-device-backup-more-devices
                  onClick={() => void loadMoreDevices()}>
                  加载更多设备
                </Button>
              ) : (
                <XDriveStatusAlert tone="neutral">当前 Server 或 Agent 不支持后续设备分页，请升级后查看完整设备列表。</XDriveStatusAlert>
              )}
              {pageFailed ? (
                <XDriveStatusAlert tone="neutral">后续设备读取失败；已加载设备保持不变，可重试。</XDriveStatusAlert>
              ) : null}
            </Stack>
          ) : null}
          {overview.has_more_folders ? (
            <XDriveStatusAlert tone="neutral">
              {!overview.has_more && overview.devices.every((device) => folderPages[device.id]?.complete)
                ? '本次已逐设备读取文件夹；新增或修改的绑定请刷新后查看。'
                : '设备概览中的文件夹存在截断。请逐台分页核对；未读完前不能将当前列表视作完整。'}
            </XDriveStatusAlert>
          ) : null}
        </Stack>
      )}
      {overview && showReadProgress ? (
        <LinearProgress aria-label="正在刷新设备备份" sx={{
          position: 'absolute', top: 0, left: 0, right: 0,
          pointerEvents: 'none',
        }} />
      ) : null}
      </Box>
      <Box sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <DnsRoundedIcon color="disabled" />
          <Box>
            <Typography variant="subtitle2" fontWeight={700}>NAS 备份 · 待支持</Typography>
            <Typography variant="caption" color="text.secondary">
              本轮不开发 NAS Push 新管理 UI。NAS 仍在 NAS 本地配置执行，原有来源、文件及运行历史保留。
            </Typography>
          </Box>
        </Stack>
      </Box>
      {localCreate && targetBrowser && source ? (
        <XDriveDeviceBackupLocalCreateDialog
          open={createOpen}
          targetBrowser={targetBrowser}
          actions={localCreate}
          onClose={() => setCreateOpen(false)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {renameTarget && renameTarget.source === source && source && localSettings && verifiedLocalDeviceID &&
        localOwnsFolder(renameTarget.id) ? (
        <XDriveDeviceBackupLocalRenameDialog
          key={renameTarget.id}
          sourceID={renameTarget.id}
          actions={localSettings}
          onClose={() => setRenameTarget(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setRenameTarget(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {targetChange && targetChange.source === source && source && localTarget && targetBrowser &&
        verifiedLocalDeviceID && localOwnsFolder(targetChange.id) ? (
        <XDriveDeviceBackupLocalTargetDialog
          key={targetChange.id}
          sourceID={targetChange.id}
          actions={localTarget}
          targetBrowser={targetBrowser}
          onClose={() => setTargetChange(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setTargetChange(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {modeChange && modeChange.source === source && source && localMode &&
        verifiedLocalDeviceID && localOwnsFolder(modeChange.id) ? (
        <XDriveDeviceBackupLocalModeDialog
          key={modeChange.id}
          sourceID={modeChange.id}
          actions={localMode}
          onClose={() => setModeChange(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setModeChange(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {rulesTarget && rulesTarget.source === source && source && localRules &&
        verifiedLocalDeviceID && localOwnsFolder(rulesTarget.id) ? (
        <XDriveDeviceBackupLocalRulesDialog
          key={rulesTarget.id}
          sourceID={rulesTarget.id}
          actions={localRules}
          onClose={() => setRulesTarget(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setRulesTarget(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {scheduleTarget && scheduleTarget.source === source && source && localSchedule &&
        verifiedLocalDeviceID && localOwnsFolder(scheduleTarget.id) ? (
        <XDriveDeviceBackupLocalScheduleDialog
          key={scheduleTarget.id}
          sourceID={scheduleTarget.id}
          actions={localSchedule}
          onClose={() => setScheduleTarget(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setScheduleTarget(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
      {previewTarget && previewTarget.source === source && source && localPreview &&
        verifiedLocalDeviceID && localOwnsFolder(previewTarget.id) ? (
        <XDriveDeviceBackupLocalPreviewDialog
          key={previewTarget.id}
          sourceID={previewTarget.id}
          actions={localPreview}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}
      {snapshotTarget && snapshotTarget.source === source && source && localSnapshot &&
        verifiedLocalDeviceID && localOwnsFolder(snapshotTarget.id) ? (
        <XDriveDeviceBackupLocalSnapshotDialog
          key={snapshotTarget.id}
          sourceID={snapshotTarget.id}
          actions={localSnapshot}
          onClose={() => setSnapshotTarget(null)}
        />
      ) : null}
      {deltaTarget && deltaTarget.source === source && source && localDelta &&
        verifiedLocalDeviceID && localOwnsFolder(deltaTarget.id) ? (
        <XDriveDeviceBackupLocalDeltaDialog
          key={deltaTarget.id}
          sourceID={deltaTarget.id}
          actions={localDelta}
          onClose={() => setDeltaTarget(null)}
        />
      ) : null}
      {evidenceTarget && evidenceTarget.source === source && source && localEvidence &&
        verifiedLocalDeviceID && localOwnsFolder(evidenceTarget.id) ? (
        <XDriveDeviceBackupLocalEvidenceDialog
          key={evidenceTarget.id}
          sourceID={evidenceTarget.id}
          actions={localEvidence}
          onClose={() => setEvidenceTarget(null)}
        />
      ) : null}
      {evidenceSummaryTarget && evidenceSummaryTarget.source === source && source && localEvidenceSummary &&
        verifiedLocalDeviceID && localOwnsFolder(evidenceSummaryTarget.id) ? (
        <XDriveDeviceBackupLocalEvidenceSummaryDialog
          key={evidenceSummaryTarget.id}
          sourceID={evidenceSummaryTarget.id}
          actions={localEvidenceSummary}
          onClose={() => setEvidenceSummaryTarget(null)}
        />
      ) : null}
      {evidencePreflightTarget && evidencePreflightTarget.source === source && source && localEvidencePreflight &&
        verifiedLocalDeviceID && localOwnsFolder(evidencePreflightTarget.id) ? (
        <XDriveDeviceBackupLocalEvidencePreflightDialog
          key={evidencePreflightTarget.id}
          sourceID={evidencePreflightTarget.id}
          actions={localEvidencePreflight}
          onClose={() => setEvidencePreflightTarget(null)}
        />
      ) : null}
      {removeTarget && removeTarget.source === source && source && localRemove &&
        verifiedLocalDeviceID && localOwnsFolder(removeTarget.id) ? (
        <XDriveDeviceBackupLocalRemoveDialog
          key={removeTarget.id}
          sourceID={removeTarget.id}
          actions={localRemove}
          onClose={() => setRemoveTarget(null)}
          onFinished={(message) => {
            if (activeSourceRef.current !== source) return
            setRemoveTarget(null)
            setLocalMessage(message)
            refresh((n) => n + 1)
          }}
        />
      ) : null}
    </XDriveWorkspaceSurface>
  )
}
