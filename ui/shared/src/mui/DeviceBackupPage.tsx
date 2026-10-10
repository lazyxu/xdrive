import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button,
  Divider, Stack, Typography,
} from '@mui/material'
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded'
import DnsRoundedIcon from '@mui/icons-material/DnsRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveDeviceBackupLocalCreateDialog } from './DeviceBackupLocalCreateDialog'
import { XDriveDeviceBackupLocalDrafts } from './DeviceBackupLocalDrafts'
import type { XDriveLocalBackupCreateActions } from './DeviceBackupLocalCreateDialog'
import type { XDriveSourceTargetBrowser } from './SourceManager'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { formatBytes } from '../format'
import type {
  XDriveDeviceBackupDataSource, XDriveDeviceBackupOverview, XDriveDeviceBackupRun,
  XDriveLocalSourceDraftPage,
} from '../device-backups'

type HistoryPage = { items: XDriveDeviceBackupRun[]; page: number; hasMore: boolean; loading: boolean }
type OverviewState = {
  source?: XDriveDeviceBackupDataSource
  overview: XDriveDeviceBackupOverview | null
  loading: boolean
  failed: boolean
}
type HistoryState = {
  source?: XDriveDeviceBackupDataSource
  pages: Record<number, HistoryPage>
}
type VerifiedLocalIdentityState = {
  source?: XDriveDeviceBackupDataSource
  deviceID: string | null
}
const emptyHistory: Record<number, HistoryPage> = {}
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
}: {
  source?: XDriveDeviceBackupDataSource
  initialSourceID?: number
  localCreate?: XDriveLocalBackupCreateActions
  targetBrowser?: XDriveSourceTargetBrowser
  localDrafts?: (limit: number, afterID: number) => Promise<XDriveLocalSourceDraftPage>
}) {
  const [refreshID, refresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [localMessage, setLocalMessage] = useState('')
  // Late wizard completions must never publish messages into a different
  // account/server's Device Backup page.
  const activeSourceRef = useRef(source)
  activeSourceRef.current = source
  useEffect(() => {
    setCreateOpen(false)
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
  const [expanded, setExpanded] = useState<{ source?: XDriveDeviceBackupDataSource; id: number | null }>({
    id: initialSourceID ?? null,
  })
  const expandedID = expanded.source === source ? expanded.id : initialSourceID ?? null
  const [historyState, setHistoryState] = useState<HistoryState>({ pages: {} })
  const histories = historyState.source === source ? historyState.pages : emptyHistory
  const [historyError, setHistoryError] = useState<{ source?: XDriveDeviceBackupDataSource; id: number } | null>(null)
  const requests = useRef<Record<number, number>>({})
  const [localIdentity, setLocalIdentity] = useState<VerifiedLocalIdentityState>({ deviceID: null })
  const verifiedLocalDeviceID = localIdentity.source === source ? localIdentity.deviceID : null
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
    setSnapshot({ source, overview: null, loading: true, failed: false })
    void source.list().then((result) => {
      if (active) setSnapshot({ source, overview: result, loading: false, failed: false })
    }).catch(() => {
      if (active) setSnapshot({ source, overview: null, loading: false, failed: true })
    })
    return () => { active = false }
  }, [source, refreshID])

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
            page,
            hasMore: pages[id]?.hasMore ?? false,
            loading: true,
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
            [id]: { items: data.items, page, hasMore: data.has_more, loading: false },
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
              items: prev.pages[id]?.items ?? [], page,
              hasMore: prev.pages[id]?.hasMore ?? false, loading: false,
            },
          },
        }
      })
      setHistoryError({ source, id })
    }
  }, [source])

  useEffect(() => {
    if (!initialSourceID || !overview) return
    if (!overview.devices.some((device) => device.folders.some((folder) => folder.source_id === initialSourceID))) return
    setExpanded({ source, id: initialSourceID })
    if (!histories[initialSourceID]) void loadHistory(initialSourceID, 1)
  }, [initialSourceID, overview, histories, loadHistory])

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="设备备份"
      subtitle="查看各设备的同步文件夹、进度与历史；所有操作只能在所属设备本机进行。"
      pageActions={source ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => refresh((n) => n + 1)}>
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
      {!source ? (
        <XDriveStatusAlert tone="neutral">
          当前 Desktop Agent 暂不支持读取脱敏设备备份数据。请更新 Agent；不能从普通 Source 接口读取异机私有路径。
        </XDriveStatusAlert>
      ) : loading && !overview ? (
        <XDriveStatePanel loading variant="plain" message="正在读取设备备份…" />
      ) : failed ? (
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
                    {device.revoked ? ' 授权已撤销' : ' 连接状态未知'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    最近登记或活动记录：{timeLabel(device.last_seen_at)}
                  </Typography>
                </Box>
              </Stack>
              <Divider sx={{ my: 1.5 }} />
              {device.folders.length === 0 ? (
                <Typography variant="body2" color="text.secondary">此设备没有已绑定的同步文件夹。</Typography>
              ) : device.folders.map((folder) => {
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
                        <Typography variant="subtitle2">同步历史（只读）</Typography>
                        {history?.loading ? (
                          <Typography variant="body2">读取历史中…</Typography>
                        ) : history && history.items.length > 0 ? history.items.map((run) => (
                          <Box key={run.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                            <Typography variant="body2">{runLabel(run.status)} · {timeLabel(run.started_at)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              扫描 {run.scanned_items} 项
                              {' · '}传输 {run.transferred_items} 项 / {formatBytes(run.transferred_bytes)}
                              {' · '}失败 {run.failed_items} 项
                            </Typography>
                          </Box>
                        )) : <Typography variant="body2" color="text.secondary">暂无历史记录。</Typography>}
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
          {overview.has_more || overview.has_more_folders ? (
            <XDriveStatusAlert tone="neutral">设备或文件夹超过当前返回范围，后续将提供连续分页。</XDriveStatusAlert>
          ) : null}
        </Stack>
      )}
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
    </XDriveWorkspaceSurface>
  )
}
