import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert as MuiAlert,
  Box as MuiBox,
  Button as MuiButton,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider as MuiDivider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'
import SynologyDsmGuideDialog from './SynologyDsmGuideDialog'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceCredentialTestErrorLabel,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  externalSourceTriggerActionLabel,
  formatBinarySize,
  formatExternalSourceTime,
  yikeConnectorNotice,
  yikeCookieHelp,
  yikeManagedTargetLabel,
} from '@xdrive/shared'
import type {
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceRow,
  ExternalSourceStateTone,
  SupportedExternalSourceKind,
} from '@xdrive/shared'

type View = 'overview' | 'cloud' | 'sources' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings'

function platformLabel(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  if (platform === 'darwin') return 'macOS'
  return platform || '未知'
}

function cacheGiB(bytes: number) {
  if (!bytes) return '0'
  return String(Number((bytes / 1024 ** 3).toFixed(3)))
}

function formatTransferSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBinarySize(Math.round(bytesPerSecond))}/s`
}

function formatElapsed(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0 秒'
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${remain} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function transferKindLabel(kind: string) {
  if (kind === 'upload') return '上传'
  if (kind === 'download') return '下载'
  if (kind === 'hydration') return '下载到本地'
  if (kind === 'dehydration') return '释放空间'
  return kind
}

function viewLabel(view: View) {
  const labels: Record<View, string> = {
    overview: '概览',
    cloud: '云端文件',
    sources: '外部来源',
    transfers: '传输',
    files: '存储',
    conflicts: '冲突',
    diagnostics: '诊断',
    settings: '设置',
  }
  return labels[view]
}

function desktopSourceTone(tone: ExternalSourceStateTone) {
  if (tone === 'good' || tone === 'busy') return 'ready'
  if (tone === 'neutral') return 'waiting'
  return 'warning'
}

function shareStatusLabel(status: string) {
  if (status === 'active') return '有效'
  if (status === 'expired') return '已过期'
  if (status === 'exhausted') return '已达下载上限'
  if (status === 'revoked') return '已撤销'
  return status
}
function updateStatusLabel(state: AgentUpdateState | null) {
  if (!state) return '不可用'
  if (state.status === 'idle') return '等待检查'
  if (state.status === 'checking') return '正在检查'
  if (state.status === 'available') return '发现新版本'
  if (state.status === 'up_to_date') return '已是最新'
  if (state.status === 'downloading') return '正在下载'
  if (state.status === 'downloaded') return '已下载，等待安装'
  if (state.status === 'installing') return '正在安装'
  if (state.status === 'error') return '更新错误'
  return state.status
}

function updateModeDescription(mode: AgentUpdateMode) {
  if (mode === 'check') return '后台定期检查；发现新版本后只提示，不会自动下载。'
  if (mode === 'download') return '后台定期检查并自动下载、校验；安装前仍由你确认。'
  if (mode === 'install') return '后台定期检查，有新版本时自动下载并安装。'
  return '不在后台检查更新；只有点击“检查更新”时才访问更新服务。'
}

export default function YikeCookieHelpGuide() {
  return (
    <Accordion disableGutters elevation={0} sx={{ mt: 0.5, border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
      <AccordionSummary>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{yikeCookieHelp.title}</Typography>
          <Typography variant="caption" color="text.secondary">点击展开</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2">{yikeCookieHelp.summary}</Typography>
        <ol style={{ margin: '10px 0', paddingLeft: 24 }}>
          {yikeCookieHelp.steps.map((step) => (
            <li key={step}><Typography variant="body2">{step}</Typography></li>
          ))}
        </ol>
        <MuiAlert severity="warning">{yikeCookieHelp.security}</MuiAlert>
      </AccordionDetails>
    </Accordion>
  )
}

function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>({
    start_at_login: true,
    close_to_tray: true,
  })
  const [agent, setAgent] = useState<AgentConnectionState>({ connected: false })
  const [view, setView] = useState<View>('overview')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [syncMenuAnchor, setSyncMenuAnchor] = useState<HTMLElement | null>(null)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [clientUpdate, setClientUpdate] = useState<AgentUpdateState | null>(null)
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const [diagnostics, setDiagnostics] = useState<AgentDiagnosticReport | null>(null)
  const [sources, setSources] = useState<ExternalSourceRow[]>([])
  const [selectedSourceID, setSelectedSourceID] = useState<number | null>(null)
  const [editingSourceID, setEditingSourceID] = useState<number | null>(null)
  const [sourceEditName, setSourceEditName] = useState('')
  const [sourceEditRunMode, setSourceEditRunMode] = useState<'scan' | 'sync'>('scan')
  const [sourceEditStatus, setSourceEditStatus] = useState<'active' | 'paused'>('active')
  const [sourceEditIgnoreRules, setSourceEditIgnoreRules] = useState('')
  const [sourceEditCookie, setSourceEditCookie] = useState('')
  const [sourceCreateOpen, setSourceCreateOpen] = useState(false)
  const initialSourceDefaults = externalSourceDefaults('synology_photos')
  const [sourceCreateKind, setSourceCreateKind] = useState<SupportedExternalSourceKind>(initialSourceDefaults.kind)
  const [sourceCreateName, setSourceCreateName] = useState(initialSourceDefaults.name)
  const [sourceCreateRunMode, setSourceCreateRunMode] = useState<'scan' | 'sync'>('scan')
  const [sourceCreateIgnoreRules, setSourceCreateIgnoreRules] = useState(initialSourceDefaults.ignoreRules)
  const [sourceCreateCookie, setSourceCreateCookie] = useState('')
  const [sourceCreateCredentialTest, setSourceCreateCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [sourceEditCredentialTest, setSourceEditCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [sourceFailedItems, setSourceFailedItems] = useState<ExternalSourceItem[]>([])
  const [sourceFailedItemsSourceID, setSourceFailedItemsSourceID] = useState<number | null>(null)
  const [sourceFailedItemsLoadingID, setSourceFailedItemsLoadingID] = useState<number | null>(null)
  const [sourceFailedItemsOpen, setSourceFailedItemsOpen] = useState(false)
  const [sourceFailedItemsLimitReached, setSourceFailedItemsLimitReached] = useState(false)
  const [sourceDeleteTarget, setSourceDeleteTarget] = useState<ExternalSourceRow | null>(null)
  const [synologyGuideSource, setSynologyGuideSource] = useState<AgentSource | null>(null)
  const [sourceTargetCrumbs, setSourceTargetCrumbs] = useState<AgentCloudCrumb[]>([])
  const [sourceTargetDirectories, setSourceTargetDirectories] = useState<AgentCloudNode[]>([])
  const [sourceTargetLoading, setSourceTargetLoading] = useState(false)
  const [cloudRoot, setCloudRoot] = useState<AgentCloudNode | null>(null)
  const [cloudItems, setCloudItems] = useState<AgentCloudNode[]>([])
  const [cloudCrumbs, setCloudCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudQuota, setCloudQuota] = useState<AgentCloudQuota | null>(null)
  const [cloudStorageStats, setCloudStorageStats] = useState<AgentCloudStorageStats | null>(null)
  const [cloudQuery, setCloudQuery] = useState('')
  const [cloudSearchActive, setCloudSearchActive] = useState(false)
  const [cloudResults, setCloudResults] = useState<AgentCloudSearchResult[]>([])
  const [cloudTrashOpen, setCloudTrashOpen] = useState(false)
  const [cloudTrash, setCloudTrash] = useState<AgentCloudNode[]>([])
  const [cloudHistoryNode, setCloudHistoryNode] = useState<AgentCloudNode | null>(null)
  const [cloudHistoryCrumbs, setCloudHistoryCrumbs] = useState<AgentCloudCrumb[]>([])
  const [cloudVersions, setCloudVersions] = useState<AgentCloudVersion[]>([])
  const [cloudShareNode, setCloudShareNode] = useState<AgentCloudNode | null>(null)
  const [cloudShares, setCloudShares] = useState<AgentCloudShare[]>([])
  const [shareExpiresDays, setShareExpiresDays] = useState('7')
  const [sharePassword, setSharePassword] = useState('')
  const [shareMaxDownloads, setShareMaxDownloads] = useState('0')
  const [createdShareURL, setCreatedShareURL] = useState('')

  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMount, setLoginMount] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mountPath, setMountPath] = useState('')
  const [cacheLimit, setCacheLimit] = useState('0')
  const [storageTree, setStorageTree] = useState<AgentStorageTreeNode | null>(null)
  const [cacheStats, setCacheStats] = useState<AgentCacheStats | null>(null)
  const [expandedStorage, setExpandedStorage] = useState<Set<string>>(new Set())

  const status = agent.status
  const configured = !!status?.configured
  const activeTransfers = transfers.transfers.filter((item) => item.state === 'running' || item.state === 'retrying')
  const completedTransfers = transfers.transfers.filter((item) => item.state === 'completed')
  const failedTransfers = transfers.transfers.filter((item) => item.state === 'failed')
  const updateSupported = agent.hello?.capabilities.includes('client-update') ?? false
  const storagePoliciesSupported = info?.platform === 'win32'
  const updateOperationBusy = clientUpdate?.status === 'checking' || clientUpdate?.status === 'downloading' || clientUpdate?.status === 'installing'
  const updateProgress = clientUpdate?.bytes_total
    ? Math.max(0, Math.min(100, ((clientUpdate.bytes_done || 0) * 100) / clientUpdate.bytes_total))
    : 0
  const globalSyncState = useMemo<{
    label: string
    color: 'success' | 'warning' | 'error' | 'info'
  }>(() => {
    if (status?.last_error) return { label: '同步异常', color: 'error' }
    if (status?.has_conflict) return { label: `${status.conflict_count || 0} 个冲突`, color: 'warning' }
    if (status?.paused) return { label: '同步已暂停', color: 'warning' }
    if (activeTransfers.length > 0) return { label: `正在同步 · ${activeTransfers.length}`, color: 'info' }
    return { label: status?.sync_status || '同步正常', color: 'success' }
  }, [
    activeTransfers.length,
    status?.conflict_count,
    status?.has_conflict,
    status?.last_error,
    status?.paused,
    status?.sync_status,
  ])

  useEffect(() => {
    let active = true
    void window.xdriveDesktop.getInfo().then((value) => {
      if (active) setInfo(value)
    })
    void window.xdriveDesktop.getPreferences().then((value) => {
      if (active) setDesktopPreferences(value)
    })
    void window.xdriveDesktop.agent.getState().then((value) => {
      if (active) setAgent(value)
    })
    void window.xdriveDesktop.agent.getTransfers().then((value) => {
      if (active) setTransfers(value)
    })
    const unsubscribe = window.xdriveDesktop.agent.onState((value) => {
      if (active) setAgent(value)
    })
    const unsubscribeTransfers = window.xdriveDesktop.agent.onTransfers((value) => {
      if (active) setTransfers(value)
    })
    const unsubscribeNavigate = window.xdriveDesktop.onNavigate((target) => {
      if (active) setView(target)
    })
    return () => {
      active = false
      unsubscribe()
      unsubscribeTransfers()
      unsubscribeNavigate()
    }
  }, [])

  useEffect(() => {
    if (!agent.connected || !(agent.hello?.capabilities.includes('client-update') ?? false)) {
      setClientUpdate(null)
      return
    }
    let active = true
    const refresh = async () => {
      const result = await window.xdriveDesktop.agent.getUpdate()
      if (active && result.ok) setClientUpdate(result.data)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 4_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agent.connected, agent.hello?.agent_version])

  useEffect(() => {
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      setDiagnostics(null)
      setSources([])
      setSelectedSourceID(null)
      setEditingSourceID(null)
      setSourceEditCookie('')
      setSourceCreateOpen(false)
      setSourceCreateCookie('')
      setSourceDeleteTarget(null)
      setSynologyGuideSource(null)
      setSourceTargetCrumbs([])
      setSourceTargetDirectories([])
      setStorageTree(null)
      setCacheStats(null)
      setCloudRoot(null)
      setCloudItems([])
      setCloudCrumbs([])
      setCloudQuota(null)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudTrash([])
      setCloudHistoryNode(null)
      setCloudHistoryCrumbs([])
      setCloudVersions([])
      setCloudShareNode(null)
      setCloudShares([])
      setCreatedShareURL('')
      return
    }
    if (view === 'settings') void loadSettings()
    if (view === 'conflicts') void loadConflicts()
    // Refresh lightweight settings/conflict state when the Agent revision changes.
    // Diagnostics are intentionally excluded because they perform network/system checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured, status?.revision])

  useEffect(() => {
    if (view !== 'sources' || !agent.connected || !configured) return
    void loadSources()
    // External Sources load when entering the page or reconnecting. Refresh is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (view !== 'diagnostics' || !agent.connected || !configured) return
    void loadDiagnostics()
    // Diagnostics run once when entering the page or reconnecting, not on every status revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (view !== 'files' || !agent.connected || !configured) return
    void loadStorage()
    // Storage tree and cache telemetry load once when entering the page or reconnecting.
    // Policy changes and the Refresh button perform explicit reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  useEffect(() => {
    if (view !== 'cloud' || !agent.connected || !configured) return
    void loadCloudHome()
    // Cloud browser loads once when entering the page or reconnecting.
    // Navigation, search, mutations and Refresh perform explicit reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured])

  const headline = useMemo(() => {
    if (!agent.connected) return 'xdrive-agent 未连接'
    if (!configured) return '登录 xDrive'
    if (status?.must_change_password) return '修改密码'
    if (status?.has_conflict) return `${status.conflict_count} 个冲突需要处理`
    if (status?.paused) return '同步已暂停'
    return status?.sync_status || 'xDrive 已就绪'
  }, [agent.connected, configured, status])

  const run = async <T,>(name: string, action: () => Promise<DesktopResult<T>>, success?: string) => {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error.message)
        return null
      }
      if (success) setNotice(success)
      return result.data
    } finally {
      setBusy('')
    }
  }

  const restartAgent = async () => {
    const data = await run('restart-agent', () => window.xdriveDesktop.agent.restart(), 'xdrive-agent 已重启。')
    if (data) setAgent(data)
  }

  const changeStartAtLogin = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setStartup(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDesktopPreferences((current) => ({ ...current, start_at_login: result.data.start_at_login }))
    setNotice(enabled ? 'xDrive 桌面版将在登录系统后自动启动。' : '已关闭开机启动。')
  }

  const changeCloseToTray = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setCloseToTray(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDesktopPreferences(result.data)
    setNotice(enabled ? '关闭窗口时将继续在系统托盘后台运行。' : '关闭窗口时将退出 xDrive 桌面版。')
  }

  const retry = async () => {
    setBusy('retry')
    setError('')
    const state = await window.xdriveDesktop.agent.retry()
    setAgent(state)
    if (!state.connected) setError(state.error || 'xdrive-agent 当前不可用。')
    setBusy('')
  }

  const chooseDirectory = async (current: string, apply: (value: string) => void) => {
    const selected = await window.xdriveDesktop.selectDirectory(current || undefined)
    if (selected) apply(selected)
  }

  const login = async (event: FormEvent) => {
    event.preventDefault()
    const result = await run('login', () => window.xdriveDesktop.agent.login({
      server: server.trim(),
      username: username.trim(),
      password,
      ...(loginMount.trim() ? { mount_path: loginMount.trim() } : {}),
    }))
    if (result) setPassword('')
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }
    const result = await run('password', () => window.xdriveDesktop.agent.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }), '密码已更新。')
    if (result) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const loadSources = async () => {
    setBusy('sources')
    setError('')
    try {
      if (!(agent.hello?.capabilities.includes('external-sources') ?? false)) {
        setSources([])
        setError('当前 xdrive-agent 不支持外部来源，请更新客户端核心组件。')
        return
      }
      const sourceResult = await window.xdriveDesktop.agent.getSources()
      if (!sourceResult.ok) {
        setError(sourceResult.error.message)
        return
      }
      const rows = await Promise.all(sourceResult.data.map(async (source) => {
        const [runsResult, credentialResult] = await Promise.all([
          window.xdriveDesktop.agent.getSourceRuns(source.id, 1),
          externalSourceConnectorProfile(source.kind).credential === 'cookie'
            ? window.xdriveDesktop.agent.getSourceCredential(source.id)
            : Promise.resolve(null),
        ])
        if (!runsResult.ok) setError(runsResult.error.message)
        if (credentialResult && !credentialResult.ok) setError(credentialResult.error.message)
        return {
          source,
          latestRun: runsResult.ok ? runsResult.data[0] : undefined,
          credential: credentialResult && credentialResult.ok ? credentialResult.data : undefined,
        }
      }))
      setSources(rows)
    } finally {
      setBusy('')
    }
  }

  const toggleSourceDetails = async (row: ExternalSourceRow) => {
    const sourceID = row.source.id
    if (selectedSourceID === sourceID) {
      setSelectedSourceID(null)
      setSourceFailedItems([])
      setSourceFailedItemsSourceID(null)
      setSourceFailedItemsOpen(false)
      setSourceFailedItemsLimitReached(false)
      return
    }

    setSelectedSourceID(sourceID)
    setSourceFailedItems([])
    setSourceFailedItemsSourceID(null)
    setSourceFailedItemsOpen(false)
    setSourceFailedItemsLimitReached(false)
    setSourceFailedItemsLoadingID(sourceID)
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.getSourceItems(sourceID, 'error', 1000, 0)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setSourceFailedItems(result.data)
      setSourceFailedItemsSourceID(sourceID)
      setSourceFailedItemsLimitReached(result.data.length >= 1000)
    } finally {
      setSourceFailedItemsLoadingID(null)
    }
  }

  const triggerSourceNow = async (row: ExternalSourceRow) => {
    const sourceID = row.source.id
    const success = row.source.kind === 'synology_photos'
      ? '已请求立即扫描，等待群晖 source-agent 下一次任务检查。'
      : '已请求立即扫描，Pull worker 将在下一次轮询时开始。'
    const data = await run(
      `source-trigger-${sourceID}`,
      () => window.xdriveDesktop.agent.triggerSource(sourceID),
      success,
    )
    if (data) await loadSources()
  }

  const loadSourceTargetDirectory = async (nodeID: number, crumbs: AgentCloudCrumb[]) => {
    setSourceTargetLoading(true)
    setError('')
    try {
      const children = await window.xdriveDesktop.agent.cloudChildren(nodeID)
      if (!children.ok) {
        setError(children.error.message)
        return false
      }
      setSourceTargetCrumbs(crumbs)
      setSourceTargetDirectories(children.data.filter((item) => item.type === 'dir'))
      return true
    } finally {
      setSourceTargetLoading(false)
    }
  }

  const openSourceCreate = async () => {
    const defaults = externalSourceDefaults('synology_photos')
    setSourceCreateKind(defaults.kind)
    setSourceCreateName(defaults.name)
    setSourceCreateRunMode('scan')
    setSourceCreateIgnoreRules(defaults.ignoreRules)
    setSourceCreateCookie('')
    setSourceCreateCredentialTest(null)
    setSourceCreateOpen(true)
    setSourceTargetLoading(true)
    setError('')
    try {
      const root = await window.xdriveDesktop.agent.cloudRoot()
      if (!root.ok) {
        setError(root.error.message)
        return
      }
      await loadSourceTargetDirectory(root.data.id, [{ id: root.data.id, name: '我的文件' }])
    } finally {
      setSourceTargetLoading(false)
    }
  }

  const changeSourceCreateKind = (kind: SupportedExternalSourceKind) => {
    const defaults = externalSourceDefaults(kind)
    setSourceCreateKind(defaults.kind)
    setSourceCreateName(defaults.name)
    setSourceCreateIgnoreRules(defaults.ignoreRules)
    if (kind === 'synology_photos') setSourceCreateCookie('')
    setSourceCreateCredentialTest(null)
  }

  const testCreateYikeCredential = async () => {
    const cookie = sourceCreateCookie.trim()
    if (!cookie) {
      setError('请先填写一刻相册 Cookie。')
      return null
    }
    setBusy('source-create-test')
    setError('')
    setNotice('')
    try {
      const result = await window.xdriveDesktop.agent.testSourceCredential('yike_photos', cookie)
      if (!result.ok) {
        setSourceCreateCredentialTest(null)
        setError(externalSourceCredentialTestErrorLabel(result.error.code || result.error.message))
        return null
      }
      setSourceCreateCredentialTest(result.data)
      setNotice(externalSourceCredentialTestSuccessLabel(result.data))
      return result.data
    } finally {
      setBusy('')
    }
  }

  const createExternalSource = async (event: FormEvent) => {
    event.preventDefault()
    const name = sourceCreateName.trim()
    const target = sourceTargetCrumbs.at(-1)
    if (!name) {
      setError('来源名称不能为空。')
      return
    }
    if (sourceCreateKind !== 'yike_photos' && !target) {
      setError('请选择目标文件夹。')
      return
    }
    const cookie = sourceCreateCookie.trim()
    if (sourceCreateKind === 'yike_photos' && !cookie) {
      setError('请填写一刻相册 Cookie。')
      return
    }

    setBusy('source-create')
    setError('')
    setNotice('')
    try {
      if (sourceCreateKind === 'yike_photos') {
        const tested = await window.xdriveDesktop.agent.testSourceCredential('yike_photos', cookie)
        if (!tested.ok) {
          setSourceCreateCredentialTest(null)
          setError(externalSourceCredentialTestErrorLabel(tested.error.code || tested.error.message))
          return
        }
        setSourceCreateCredentialTest(tested.data)
      }
      const created = await window.xdriveDesktop.agent.createSource({
        name,
        kind: sourceCreateKind,
        direction: externalSourceDefaults(sourceCreateKind).direction,
        sync_mode: 'backup',
        run_mode: sourceCreateRunMode,
        target_node_id: sourceCreateKind === 'yike_photos' ? 0 : (target?.id ?? 0),
        ignore_rules: sourceCreateIgnoreRules,
      })
      if (!created.ok) {
        setError(created.error.message)
        return
      }

      if (sourceCreateKind === 'yike_photos') {
        const credential = await window.xdriveDesktop.agent.setSourceCredential(created.data.id, cookie)
        if (!credential.ok) {
          const rollback = await window.xdriveDesktop.agent.deleteSource(created.data.id, created.data.revision)
          if (rollback.ok) {
            setError(`Cookie 保存失败：${credential.error.message}。刚创建的一刻相册来源已自动撤销，请检查后重试。`)
            await loadSources()
            return
          }
          setSourceCreateOpen(false)
          setSourceCreateCookie('')
          setError(`来源已创建，但 Cookie 保存失败且自动回滚失败：${credential.error.message}；回滚错误：${rollback.error.message}。请在该来源的“设置”中重新配置 Cookie。`)
          await loadSources()
          return
        }
      }

      setSourceCreateOpen(false)
      setSourceCreateCookie('')
      if (sourceCreateKind === 'synology_photos') {
        setSynologyGuideSource(created.data)
        setNotice('群晖来源已添加。请按 DSM 配置向导绑定 xdrive-source-agent。')
      } else {
        setNotice(`一刻相册来源已添加，目标目录固定为 ${yikeManagedTargetLabel}。`)
      }
      await loadSources()
    } finally {
      setBusy('')
    }
  }

  const openSourceSettings = (row: ExternalSourceRow) => {
    setEditingSourceID(row.source.id)
    setSourceEditName(row.source.name)
    setSourceEditRunMode(row.source.run_mode)
    setSourceEditStatus(row.source.status)
    setSourceEditIgnoreRules(row.source.ignore_rules || '')
    setSourceEditCookie('')
    setSourceEditCredentialTest(null)
  }

  const testSettingsYikeCredential = async (row: ExternalSourceRow) => {
    setBusy(`source-credential-test-${row.source.id}`)
    setError('')
    setNotice('')
    try {
      const cookie = sourceEditCookie.trim()
      const result = cookie
        ? await window.xdriveDesktop.agent.testSourceCredential('yike_photos', cookie)
        : await window.xdriveDesktop.agent.testStoredSourceCredential(row.source.id)
      if (!result.ok) {
        setSourceEditCredentialTest(null)
        setError(externalSourceCredentialTestErrorLabel(result.error.code || result.error.message))
        return null
      }
      setSourceEditCredentialTest(result.data)
      setNotice(externalSourceCredentialTestSuccessLabel(result.data))
      return result.data
    } finally {
      setBusy('')
    }
  }

  const saveSourceSettings = async (event: FormEvent, row: ExternalSourceRow) => {
    event.preventDefault()
    const name = sourceEditName.trim()
    if (!name) {
      setError('来源名称不能为空。')
      return
    }
    const busyKey = `source-settings-${row.source.id}`
    setBusy(busyKey)
    setError('')
    setNotice('')
    try {
      const pendingCookie = sourceEditCookie.trim()
      if (externalSourceConnectorProfile(row.source.kind).credential === 'cookie' && pendingCookie) {
        const tested = await window.xdriveDesktop.agent.testSourceCredential('yike_photos', pendingCookie)
        if (!tested.ok) {
          setSourceEditCredentialTest(null)
          setError(externalSourceCredentialTestErrorLabel(tested.error.code || tested.error.message))
          return
        }
        setSourceEditCredentialTest(tested.data)
      }
      const updated = await window.xdriveDesktop.agent.updateSource(row.source.id, row.source.revision, {
        name,
        run_mode: sourceEditRunMode,
        status: sourceEditStatus,
        ignore_rules: sourceEditIgnoreRules,
      })
      if (!updated.ok) {
        setError(updated.error.message)
        return
      }

      const cookie = sourceEditCookie.trim()
      if (externalSourceConnectorProfile(row.source.kind).credential === 'cookie' && cookie) {
        const credential = await window.xdriveDesktop.agent.setSourceCredential(row.source.id, cookie)
        if (!credential.ok) {
          setError(`来源设置已保存，但 Cookie 更新失败：${credential.error.message}`)
          await loadSources()
          return
        }
      }

      setEditingSourceID(null)
      setSourceEditCookie('')
      setNotice('来源设置已保存。')
      await loadSources()
    } finally {
      setBusy('')
    }
  }

  const clearSourceCookie = async (row: ExternalSourceRow) => {
    if (!window.confirm(`确定清除“${row.source.name}”保存的 Cookie？清除后 Pull 扫描将暂停，直到重新配置 Cookie。`)) return
    const data = await run(
      `source-cookie-delete-${row.source.id}`,
      () => window.xdriveDesktop.agent.deleteSourceCredential(row.source.id),
      'Cookie 已清除。',
    )
    if (data) {
      setSourceEditCookie('')
      setSourceEditStatus('paused')
      await loadSources()
    }
  }

  const deleteExternalSource = async () => {
    if (!sourceDeleteTarget) return
    const row = sourceDeleteTarget
    const data = await run(
      `source-delete-${row.source.id}`,
      () => window.xdriveDesktop.agent.deleteSource(row.source.id, row.source.revision),
      '来源已删除；已同步到 xDrive 的文件已保留。',
    )
    if (data) {
      if (selectedSourceID === row.source.id) setSelectedSourceID(null)
      if (editingSourceID === row.source.id) setEditingSourceID(null)
      setSourceDeleteTarget(null)
      await loadSources()
    }
  }

  const loadSettings = async () => {
    const result = await window.xdriveDesktop.agent.getSettings()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSettings(result.data)
    setMountPath(result.data.mount_path)
    setCacheLimit(cacheGiB(result.data.cache_limit_bytes))
  }

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    const gib = Number(cacheLimit)
    if (!Number.isFinite(gib) || gib < 0 || gib > 16384) {
      setError('缓存上限必须在 0 到 16384 GiB 之间。')
      return
    }
    const data = await run('settings', () => window.xdriveDesktop.agent.updateSettings({
      mount_path: mountPath.trim(),
      cache_limit_bytes: Math.round(gib * 1024 ** 3),
    }), '设置已保存。')
    if (data) setSettings(data)
  }

  const changeUpdateMode = async (mode: AgentUpdateMode) => {
    const data = await run(
      'update-mode',
      () => window.xdriveDesktop.agent.setUpdateMode(mode),
      mode === 'manual' ? '已关闭后台更新检查。' : '更新策略已保存，并将按新策略检查更新。',
    )
    if (data) setClientUpdate(data)
  }

  const changeUpdateSource = async (source: AgentUpdateSource) => {
    const data = await run(
      'update-source',
      () => window.xdriveDesktop.agent.setUpdateSource(source),
      `更新来源已切换为 ${source === 'gitlab' ? 'GitLab' : 'GitHub'}；下一次检查更新时生效。`,
    )
    if (data) setClientUpdate(data)
  }

  const checkClientUpdate = async () => {
    const data = await run('update-check', () => window.xdriveDesktop.agent.checkUpdate())
    if (!data) return
    setClientUpdate(data)
    setNotice(data.update_available ? `发现新版本 ${data.latest_version || ''}。` : '当前已是最新版本。')
  }

  const downloadClientUpdate = async () => {
    const data = await run('update-download', () => window.xdriveDesktop.agent.downloadUpdate())
    if (!data) return
    setClientUpdate(data)
    setNotice(data.downloaded ? '更新已下载并通过校验，等待安装。' : '当前已是最新版本。')
  }

  const installClientUpdate = async () => {
    if (!window.confirm('安装更新将关闭当前 xDrive 客户端，完成校验后自动重启。确定现在安装？')) return
    const data = await run('update-install', () => window.xdriveDesktop.agent.installUpdate())
    if (!data) return
    setClientUpdate(data)
    setNotice(data.status === 'installing' ? '更新安装已启动，xDrive 将完成验证并重启。' : '当前已是最新版本。')
  }

  const loadStorage = async () => {
    setBusy('storage')
    setError('')
    try {
      const [treeResult, cacheResult] = await Promise.all([
        window.xdriveDesktop.agent.getStorageTree(),
        window.xdriveDesktop.agent.getCache(),
      ])
      if (!treeResult.ok) {
        setError(treeResult.error.message)
        return
      }
      if (!cacheResult.ok) {
        setError(cacheResult.error.message)
        return
      }
      setStorageTree(treeResult.data)
      setCacheStats(cacheResult.data)
      setExpandedStorage((current) => {
        if (current.size > 0) return current
        return new Set((treeResult.data.children || []).map((child) => child.path))
      })
    } finally {
      setBusy('')
    }
  }

  const updateStorageMode = async (path: string, mode: 'exclude' | 'always-local' | 'default') => {
    const data = await run(
      `storage-rule-${path}-${mode}`,
      () => window.xdriveDesktop.agent.setSyncRule(path, mode),
      '文件夹策略已更新。',
    )
    if (!data) return
    setSettings(data)
    await loadStorage()
  }

  const releaseReclaimableCache = async () => {
    const data = await run('release-cache', () => window.xdriveDesktop.agent.releaseCache())
    if (!data) return
    setCacheStats(data.stats)
    if (data.released_files === 0 && data.failed_files === 0) {
      setNotice('当前没有可释放的缓存。')
      return
    }
    const failed = data.failed_files > 0 ? ` · ${data.failed_files} 个文件无法释放` : ''
    setNotice(`已从 ${data.released_files} 个文件释放 ${formatBinarySize(data.released_bytes)}${failed}。`)
  }

  const toggleStoragePath = (path: string) => {
    setExpandedStorage((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderStorageNode = (node: AgentStorageTreeNode, depth = 0) => {
    const children = node.children || []
    const expanded = expandedStorage.has(node.path)
    const inherited = node.mode === 'default' && node.effective_mode !== 'default'
    const effectiveLabel = node.effective_mode === 'exclude'
      ? '不同步'
      : node.effective_mode === 'always-local'
        ? '始终保留'
        : '默认'
    return (
      <div className="storage-node" key={node.path}>
        <div className="storage-row" style={{ paddingLeft: `${12 + depth * 18}px` }}>
          <button
            className="tree-toggle"
            type="button"
            disabled={children.length === 0}
            aria-label={expanded ? '折叠文件夹' : '展开文件夹'}
            onClick={() => toggleStoragePath(node.path)}
          >
            {children.length === 0 ? '·' : expanded ? '▾' : '▸'}
          </button>
          <div className="storage-folder">
            <strong>{node.name}</strong>
            <span>{node.file_count} 个文件 · {formatBinarySize(node.total_bytes)}</span>
            {storagePoliciesSupported && inherited && <small>继承策略：{effectiveLabel}</small>}
          </div>
          {storagePoliciesSupported ? (
            <div className="storage-modes" role="group" aria-label={`${node.name} 的存储策略`}>
              <button className={node.mode === 'default' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'default')}>默认</button>
              <button className={node.mode === 'exclude' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'exclude')}>不同步</button>
              <button className={node.mode === 'always-local' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'always-local')}>始终保留</button>
            </div>
          ) : (
            <Chip size="small" variant="outlined" label="FUSE 按需访问" />
          )}
        </div>
        {expanded && children.map((child) => renderStorageNode(child, depth + 1))}
      </div>
    )
  }

  const retryTransfer = async (id: string) => {
    const data = await run(`retry-transfer-${id}`, () => window.xdriveDesktop.agent.retryTransfer(id), '传输重试已完成。')
    if (data) setTransfers(data)
  }

  const refreshCloudQuota = async () => {
    const result = await window.xdriveDesktop.agent.cloudQuota()
    if (!result.ok) {
      setError(result.error.message)
      return null
    }
    setCloudQuota(result.data)
    return result.data
  }

  const loadCloudDirectory = async (id: number, crumbs: AgentCloudCrumb[]) => {
    setBusy('cloud-directory')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudChildren(id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudItems(result.data)
      setCloudCrumbs(crumbs)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudQuery('')
    } finally {
      setBusy('')
    }
  }

  const loadCloudHome = async () => {
    setBusy('cloud-load')
    setError('')
    try {
      const storageStatsSupported = agent.hello?.capabilities.includes('storage-intelligence') ?? false
      const [rootResult, quotaResult, storageStatsResult] = await Promise.all([
        window.xdriveDesktop.agent.cloudRoot(),
        window.xdriveDesktop.agent.cloudQuota(),
        storageStatsSupported ? window.xdriveDesktop.agent.cloudStorageStats() : Promise.resolve(null),
      ])
      if (!rootResult.ok) {
        setError(rootResult.error.message)
        return
      }
      if (!quotaResult.ok) {
        setError(quotaResult.error.message)
        return
      }
      if (storageStatsResult && !storageStatsResult.ok) {
        setCloudStorageStats(null)
      }
      const childrenResult = await window.xdriveDesktop.agent.cloudChildren(rootResult.data.id)
      if (!childrenResult.ok) {
        setError(childrenResult.error.message)
        return
      }
      setCloudRoot(rootResult.data)
      setCloudItems(childrenResult.data)
      setCloudCrumbs([{ id: rootResult.data.id, name: '我的文件' }])
      setCloudQuota(quotaResult.data)
      setCloudStorageStats(storageStatsResult?.ok ? storageStatsResult.data : null)
      setCloudSearchActive(false)
      setCloudResults([])
      setCloudQuery('')
    } finally {
      setBusy('')
    }
  }

  const searchCloud = async () => {
    const query = cloudQuery.trim()
    if (query.length < 2) {
      setError('搜索关键字至少需要 2 个字符。')
      return
    }
    setBusy('cloud-search')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudSearch(query)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudSearchActive(true)
      setCloudResults(result.data)
    } finally {
      setBusy('')
    }
  }

  const loadCloudTrash = async () => {
    setBusy('cloud-trash')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudTrash()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudTrash(result.data)
      setCloudTrashOpen(true)
    } finally {
      setBusy('')
    }
  }

  const restoreCloudTrash = async (node: AgentCloudNode) => {
    const data = await run('cloud-trash-restore', () => window.xdriveDesktop.agent.cloudRestoreTrash(node.id, node.revision), '项目已恢复。')
    if (!data) return
    await loadCloudTrash()
    await refreshCloudQuota()
    if (cloudCrumbs.length > 0) await loadCloudDirectory(cloudCrumbs.at(-1)!.id, cloudCrumbs)
  }

  const deleteCloudTrash = async (node: AgentCloudNode) => {
    if (!window.confirm(`永久删除 ${node.name}？这也会删除已保存的历史版本，且无法撤销。`)) return
    const data = await run('cloud-trash-delete', () => window.xdriveDesktop.agent.cloudDeleteTrash(node.id, node.revision), '已永久删除。')
    if (!data) return
    await loadCloudTrash()
    await refreshCloudQuota()
  }

  const openCloud历史版本 = async (node: AgentCloudNode, crumbs = cloudCrumbs) => {
    setBusy('cloud-history')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudVersions(node.id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudHistoryNode(node)
      setCloudHistoryCrumbs(crumbs)
      setCloudVersions(result.data)
    } finally {
      setBusy('')
    }
  }

  const restoreCloudVersion = async (version: AgentCloudVersion) => {
    if (!cloudHistoryNode) return
    if (!window.confirm(`恢复到版本 r${version.revision}？当前内容会先保留到历史版本中。`)) return
    const restored = await run(
      'cloud-version-restore',
      () => window.xdriveDesktop.agent.cloudRestoreVersion(cloudHistoryNode.id, cloudHistoryNode.revision, version.id),
      '版本已恢复。',
    )
    if (!restored) return
    setCloudHistoryNode(restored)
    const versions = await window.xdriveDesktop.agent.cloudVersions(restored.id)
    if (versions.ok) setCloudVersions(versions.data)
    await refreshCloudQuota()
    if (cloudHistoryCrumbs.length > 0) {
      await loadCloudDirectory(cloudHistoryCrumbs.at(-1)!.id, cloudHistoryCrumbs)
    }
  }

  const openCloudShares = async (node: AgentCloudNode) => {
    setBusy('cloud-shares')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.cloudShares(node.id)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCloudShareNode(node)
      setCloudShares(result.data)
      setCreatedShareURL('')
      setShareExpiresDays('7')
      setSharePassword('')
      setShareMaxDownloads('0')
    } finally {
      setBusy('')
    }
  }

  const createCloudShare = async () => {
    if (!cloudShareNode) return
    const days = Number(shareExpiresDays)
    const maxDownloads = Number(shareMaxDownloads)
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      setError('分享有效期必须在 0 到 3650 天之间。')
      return
    }
    if (!Number.isSafeInteger(maxDownloads) || maxDownloads < 0) {
      setError('最大下载次数必须是非负整数。')
      return
    }
    if (sharePassword && sharePassword.length < 8) {
      setError('分享密码至少需要 8 个字符。')
      return
    }
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : undefined
    const created = await run(
      'cloud-share-create',
      () => window.xdriveDesktop.agent.cloudCreateShare(cloudShareNode.id, {
        expires_at: expiresAt,
        password: sharePassword,
        max_downloads: maxDownloads,
      }),
      '分享链接已创建。请立即复制，令牌只会显示一次。',
    )
    if (!created) return
    setCreatedShareURL(created.url)
    const shares = await window.xdriveDesktop.agent.cloudShares(cloudShareNode.id)
    if (shares.ok) setCloudShares(shares.data)
  }

  const revokeCloudShare = async (share: AgentCloudShare) => {
    const data = await run('cloud-share-revoke', () => window.xdriveDesktop.agent.cloudRevokeShare(share.id), '分享已撤销。')
    if (!data || !cloudShareNode) return
    const shares = await window.xdriveDesktop.agent.cloudShares(cloudShareNode.id)
    if (shares.ok) setCloudShares(shares.data)
  }

  const copyShareURL = async () => {
    if (!createdShareURL) return
    try {
      await navigator.clipboard.writeText(createdShareURL)
      setNotice('分享链接已复制。')
    } catch {
      setError('无法自动复制，请手动选择并复制链接。')
    }
  }

  const loadDiagnostics = async () => {
    setBusy('diagnostics')
    setError('')
    try {
      const result = await window.xdriveDesktop.agent.getDiagnostics()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setDiagnostics(result.data)
    } finally {
      setBusy('')
    }
  }

  const runDiagnosticAction = async (
    name: string,
    action: () => Promise<DesktopResult<unknown>>,
    success: string,
  ) => {
    const data = await run(name, action, success)
    if (data) await loadDiagnostics()
  }

  const exportDiagnostics = async () => {
    const data = await run('export-diagnostics', () => window.xdriveDesktop.agent.exportDiagnostics())
    if (!data) return
    if (data.saved) setNotice('诊断报告已导出。')
  }

  const loadConflicts = async () => {
    const result = await window.xdriveDesktop.agent.getConflicts()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setConflicts(result.data)
  }

  if (!agent.connected) {
    return (
      <div className="center-shell">
        <section className="auth-panel">
          <div className="brand large"><img className="brand-mark" src={xDriveBrandIcon} alt="" aria-hidden="true" /><div><strong>xDrive</strong><span>桌面版</span></div></div>
          <p className="eyebrow">AGENT 连接</p>
          <h1>{headline}</h1>
          <p className="subtitle">xDrive 桌面版会自动启动并监控 Go 后台 Agent。如果自动恢复失败，请确认已安装完整的 xDrive 客户端。</p>
          <div className="offline-box">{agent.error || '正在等待桌面 IPC 连接…'}</div>
          {error && <div className="alert error">{error}</div>}
          <div className="offline-actions">
            <button className="primary" type="button" disabled={!!busy} onClick={() => void retry()}>
              {busy === 'retry' ? '正在连接…' : '重试连接'}
            </button>
            <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent()}>
              {busy === 'restart-agent' ? '正在重启…' : '启动 / 重启 Agent'}
            </button>
          </div>
          <p className="footnote">{info ? `桌面版 ${info.version} · ${platformLabel(info.platform)} ${info.arch}` : '正在加载桌面信息…'}</p>
        </section>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="center-shell">
        <form className="auth-panel" onSubmit={login}>
          <div className="brand large"><img className="brand-mark" src={xDriveBrandIcon} alt="" aria-hidden="true" /><div><strong>xDrive</strong><span>桌面版</span></div></div>
          <p className="eyebrow">登录</p>
          <h1>{headline}</h1>
          <p className="subtitle">凭据会直接传递给 Go Agent，Electron 渲染进程不会接触 access token 或 refresh token。</p>
          {error && <div className="alert error">{error}</div>}
          <label>服务器<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://drive.example.com" required /></label>
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <label>
            同步文件夹 <span className="optional">可选</span>
            <div className="input-action">
              <input value={loginMount} onChange={(e) => setLoginMount(e.target.value)} placeholder="使用默认 xDrive 文件夹" />
              <button type="button" className="secondary" onClick={() => void chooseDirectory(loginMount, setLoginMount)}>浏览</button>
            </div>
          </label>
          <button className="primary wide" type="submit" disabled={busy === 'login'}>{busy === 'login' ? '正在登录…' : '登录'}</button>
        </form>
      </div>
    )
  }

  if (status?.must_change_password) {
    return (
      <div className="center-shell">
        <form className="auth-panel" onSubmit={changePassword}>
          <div className="brand large"><img className="brand-mark" src={xDriveBrandIcon} alt="" aria-hidden="true" /><div><strong>xDrive</strong><span>{status.username}</span></div></div>
          <p className="eyebrow">需要修改密码</p>
          <h1>{headline}</h1>
          <p className="subtitle">管理员要求先修改密码，之后才能开始同步。</p>
          {error && <div className="alert error">{error}</div>}
          {notice && <div className="alert success">{notice}</div>}
          <label>当前密码<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label>
          <label>新密码<input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required /></label>
          <label>确认新密码<input type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></label>
          <button className="primary wide" type="submit" disabled={busy === 'password'}>{busy === 'password' ? '正在更新…' : '修改密码'}</button>
        </form>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img className="brand-mark" src={xDriveBrandIcon} alt="" aria-hidden="true" /><div><strong>xDrive</strong><span>桌面版</span></div></div>
        <nav aria-label="桌面版功能区">
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} type="button" onClick={() => setView('overview')}>概览</button>
          <button className={`nav-item ${view === 'cloud' ? 'active' : ''}`} type="button" onClick={() => setView('cloud')}>云端文件</button>
          <button className={`nav-item ${view === 'sources' ? 'active' : ''}`} type="button" onClick={() => setView('sources')}>外部来源</button>
          <button className={`nav-item ${view === 'transfers' ? 'active' : ''}`} type="button" onClick={() => setView('transfers')}>
            传输 {activeTransfers.length ? <span className="badge">{activeTransfers.length}</span> : null}
          </button>
          <button className={`nav-item ${view === 'files' ? 'active' : ''}`} type="button" onClick={() => setView('files')}>存储</button>
          <button className={`nav-item ${view === 'conflicts' ? 'active' : ''}`} type="button" onClick={() => setView('conflicts')}>
            冲突 {status?.conflict_count ? <span className="badge">{status.conflict_count}</span> : null}
          </button>
          <button className={`nav-item ${view === 'diagnostics' ? 'active' : ''}`} type="button" onClick={() => setView('diagnostics')}>诊断</button>
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} type="button" onClick={() => setView('settings')}>设置</button>
        </nav>
        <div className="account">
          <strong>{status?.username}</strong>
          <span>{status?.server}</span>
          <span>Agent {status?.version}</span>
          <span>{info ? `桌面版 ${info.version}` : ''}</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">xDrive</p>
            <h1>{viewLabel(view)}</h1>
          </div>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            sx={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}
          >
            <Chip
              aria-label="同步状态"
              clickable
              size="small"
              variant="outlined"
              color={globalSyncState.color}
              label={globalSyncState.label}
              icon={<MuiBox component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'currentColor' }} />}
              onClick={(event) => setSyncMenuAnchor(event.currentTarget)}
              sx={{ fontWeight: 700 }}
            />
            <Tooltip title={status?.paused ? '同步已暂停' : '立即同步'}>
              <span>
                <IconButton
                  aria-label="立即同步"
                  size="small"
                  color="primary"
                  disabled={!!busy || status?.paused}
                  onClick={() => void run('sync', () => window.xdriveDesktop.agent.syncNow(), '已请求立即同步。')}
                >
                  <SyncRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="更多同步操作">
              <IconButton
                aria-label="更多同步操作"
                size="small"
                onClick={(event) => setSyncMenuAnchor(event.currentTarget)}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              id="global-sync-menu"
              anchorEl={syncMenuAnchor}
              open={Boolean(syncMenuAnchor)}
              onClose={() => setSyncMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MuiBox sx={{ minWidth: 260, px: 2, py: 1.25 }}>
                <Typography variant="body2" fontWeight={700}>{globalSyncState.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {status?.auth_status || '已登录'}{status?.server ? ` · ${status.server}` : ''}
                </Typography>
              </MuiBox>
              <MuiDivider />
              <MenuItem onClick={() => {
                setSyncMenuAnchor(null)
                void run('folder', () => window.xdriveDesktop.agent.openFolder())
              }}>
                <ListItemIcon><FolderOpenRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>打开同步文件夹</ListItemText>
              </MenuItem>
              <MenuItem disabled={!!busy} onClick={() => {
                setSyncMenuAnchor(null)
                const nextPaused = !status?.paused
                void run(
                  'pause',
                  () => window.xdriveDesktop.agent.setPaused(nextPaused),
                  nextPaused ? '同步已暂停。' : '同步已恢复。',
                )
              }}>
                <ListItemIcon>
                  {status?.paused ? <PlayArrowRoundedIcon fontSize="small" /> : <PauseRoundedIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText>{status?.paused ? '恢复同步' : '暂停同步'}</ListItemText>
              </MenuItem>
              {status?.has_conflict ? (
                <MenuItem onClick={() => {
                  setSyncMenuAnchor(null)
                  setView('conflicts')
                }}>
                  <ListItemIcon><WarningAmberRoundedIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{`查看冲突（${status.conflict_count || 0}）`}</ListItemText>
                </MenuItem>
              ) : null}
              <MuiDivider />
              <MenuItem onClick={() => {
                setSyncMenuAnchor(null)
                setView('diagnostics')
              }}>
                <ListItemIcon><BuildRoundedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>客户端诊断</ListItemText>
              </MenuItem>
            </Menu>
          </Stack>
        </header>

        {(status?.last_error || status?.paused || status?.has_conflict) ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {status?.last_error ? (
              <MuiAlert
                severity="error"
                action={<MuiButton color="inherit" size="small" onClick={() => setView('diagnostics')}>运行诊断</MuiButton>}
              >
                同步异常：{status.last_error}
              </MuiAlert>
            ) : null}
            {status?.paused ? (
              <MuiAlert
                severity="warning"
                action={(
                  <MuiButton
                    color="inherit"
                    size="small"
                    disabled={!!busy}
                    onClick={() => void run('pause', () => window.xdriveDesktop.agent.setPaused(false), '同步已恢复。')}
                  >
                    恢复同步
                  </MuiButton>
                )}
              >
                同步已暂停；此设备不会继续后台同步。
              </MuiAlert>
            ) : null}
            {status?.has_conflict ? (
              <MuiAlert
                severity="warning"
                action={<MuiButton color="inherit" size="small" onClick={() => setView('conflicts')}>处理冲突</MuiButton>}
              >
                发现 {status.conflict_count || 0} 个同步冲突，请进入“冲突”页面处理。
              </MuiAlert>
            ) : null}
          </Stack>
        ) : null}

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {view === 'overview' && (
          <>
            <section className="status-grid">
              <article className="status-card"><span className={`status-dot ${status?.paused ? 'waiting' : 'ready'}`} /><div><strong>同步</strong><p>{status?.sync_status}</p></div></article>
              <article className="status-card"><span className={`status-dot ${status?.has_conflict ? 'warning' : 'ready'}`} /><div><strong>冲突</strong><p>{status?.conflict_count || 0} 个未解决</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>Agent</strong><p>{status?.auth_status} · v{agent.hello?.agent_version || status?.version} · IPC {agent.hello?.protocol_min ?? '?'}-{agent.hello?.protocol_max ?? '?'}</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>桌面桥接</strong><p>已通过受保护的本地 IPC 连接。</p></div></article>
            </section>

            <section className="system-card">
              <div className="section-heading">
                <div><p className="eyebrow">同步位置</p><h2>{status?.mount_path || '默认 xDrive 文件夹'}</h2></div>
                <button className="secondary" type="button" onClick={() => void run('folder', () => window.xdriveDesktop.agent.openFolder())}>打开</button>
              </div>
              <dl>
                <div><dt>服务器</dt><dd>{status?.server}</dd></div>
                <div><dt>用户</dt><dd>{status?.username}</dd></div>
                <div><dt>状态</dt><dd>{status?.paused ? '已暂停' : status?.sync_status}</dd></div>
                <div><dt>修订号</dt><dd>{status?.revision}</dd></div>
              </dl>
            </section>
          </>
        )}



        {view === 'sources' && (
          <section className="panel source-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">外部来源</p>
                <h2>管理照片与媒体来源</h2>
                <p className="source-note">来源状态通过 xdrive-agent 的受保护本地 IPC 读取，渲染进程不会接触服务器令牌或已保存的 Cookie 明文。</p>
              </div>
              <div className="source-heading-actions">
                <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadSources()}>
                  {busy === 'sources' ? '正在刷新…' : '刷新'}
                </button>
                <button className="primary" type="button" disabled={!!busy} onClick={() => void openSourceCreate()}>
                  + 添加来源
                </button>
              </div>
            </div>

            {sourceCreateOpen && (
              <form className="source-create" onSubmit={(event) => void createExternalSource(event)}>
                <div className="source-create-heading">
                  <div>
                    <strong>添加外部来源</strong>
                    <span>{sourceCreateKind === 'yike_photos' ? '一刻相册目标目录由服务器自动管理。' : '选择来源类型、运行方式与 xDrive 目标文件夹。'}</span>
                  </div>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => setSourceCreateOpen(false)}>关闭</button>
                </div>
                <div className="source-create-grid">
                  <label>
                    <span>来源类型</span>
                    <select value={sourceCreateKind} onChange={(event) => changeSourceCreateKind(event.target.value as SupportedExternalSourceKind)}>
                      <option value="synology_photos">群晖 Photos · Push</option>
                      <option value="yike_photos">一刻相册 · Pull</option>
                    </select>
                  </label>
                  <label>
                    <span>名称</span>
                    <input value={sourceCreateName} onChange={(event) => setSourceCreateName(event.target.value)} maxLength={128} required />
                  </label>
                  <label>
                    <span>运行模式</span>
                    <select value={sourceCreateRunMode} onChange={(event) => setSourceCreateRunMode(event.target.value as 'scan' | 'sync')}>
                      <option value="scan">仅扫描</option>
                      <option value="sync">同步</option>
                    </select>
                  </label>
                </div>

                {sourceCreateKind === 'yike_photos' ? (
                  <MuiAlert severity="info" sx={{ mb: 1.5 }}>
                    固定逻辑目录：{yikeManagedTargetLabel}。连接成功后自动创建；底层文件仍使用 xDrive CAS 存储。
                  </MuiAlert>
                ) : (
                <div className="source-target">
                  <div className="source-target-heading">
                    <div>
                      <strong>目标文件夹</strong>
                      <span>当前选择：{sourceTargetCrumbs.map((crumb) => crumb.name).join(' / ') || '正在加载…'}</span>
                    </div>
                    {sourceTargetLoading && <span>正在加载…</span>}
                  </div>
                  <div className="source-target-crumbs">
                    {sourceTargetCrumbs.map((crumb, index) => (
                      <button
                        key={crumb.id}
                        type="button"
                        disabled={sourceTargetLoading || index === sourceTargetCrumbs.length - 1}
                        onClick={() => void loadSourceTargetDirectory(crumb.id, sourceTargetCrumbs.slice(0, index + 1))}
                      >
                        {crumb.name}
                      </button>
                    ))}
                  </div>
                  <div className="source-target-list">
                    {sourceTargetDirectories.length === 0 ? (
                      <span className="source-target-empty">当前目录下没有子文件夹，可直接使用当前目录。</span>
                    ) : sourceTargetDirectories.map((directory) => (
                      <button
                        className="source-target-folder"
                        key={directory.id}
                        type="button"
                        disabled={sourceTargetLoading}
                        onClick={() => void loadSourceTargetDirectory(directory.id, [...sourceTargetCrumbs, { id: directory.id, name: directory.name }])}
                      >
                        <strong>{directory.name}</strong>
                        <span>进入文件夹 ›</span>
                      </button>
                    ))}
                  </div>
                </div>
                )}

                <label className="source-create-wide">
                  <span>忽略规则</span>
                  <textarea
                    value={sourceCreateIgnoreRules}
                    onChange={(event) => setSourceCreateIgnoreRules(event.target.value)}
                    rows={5}
                    spellCheck={false}
                    placeholder="每行一条 gitignore 风格规则"
                  />
                </label>
                {sourceCreateKind === 'yike_photos' && (
                  <label className="source-create-wide">
                    <span>一刻相册 Cookie</span>
                    <input
                      type="password"
                      value={sourceCreateCookie}
                      onChange={(event) => {
                        setSourceCreateCookie(event.target.value)
                        setSourceCreateCredentialTest(null)
                      }}
                      autoComplete="off"
                      placeholder="粘贴已登录的一刻相册 Web Cookie"
                      required
                    />
                    <small>Cookie 仅通过受保护 IPC 发送到服务器并加密保存，不会回读明文。</small>
                    <MuiAlert severity="warning" sx={{ mt: 0.5 }}>{yikeConnectorNotice}</MuiAlert>
                    <YikeCookieHelpGuide />
                    <MuiButton
                      type="button"
                      size="small"
                      variant="outlined"
                      disabled={!!busy}
                      onClick={() => void testCreateYikeCredential()}
                      sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                    >
                      {busy === 'source-create-test' ? '正在测试…' : '测试连接'}
                    </MuiButton>
                    {sourceCreateCredentialTest && (
                      <MuiAlert severity="success" sx={{ mt: 0.5 }}>
                        {externalSourceCredentialTestSuccessLabel(sourceCreateCredentialTest)}
                      </MuiAlert>
                    )}
                  </label>
                )}
                {sourceCreateKind === 'synology_photos' && (
                  <div className="alert warning source-create-note">
                    创建 Source 后，还需要在群晖 DSM 上配置 xdrive-source-agent；NAS 始终主动发起 Push 连接。
                  </div>
                )}
                <div className="source-create-actions">
                  <button className="primary" type="submit" disabled={!!busy || (sourceCreateKind !== 'yike_photos' && sourceTargetLoading)}>
                    {busy === 'source-create' ? '正在添加…' : '添加来源'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => setSourceCreateOpen(false)}>取消</button>
                </div>
              </form>
            )}

            {sources.length === 0 && busy !== 'sources' ? (
              <div className="empty-state">尚未添加外部来源。</div>
            ) : (
              <div className="source-list">
                {sources.map((row) => {
                  const card = externalSourceCardView(row)
                  const detail = externalSourceDetailView(row)
                  const runDetail = row.latestRun ? externalSourceRunDetailView(row.latestRun) : null
                  const failedItems = sourceFailedItemsSourceID === row.source.id ? sourceFailedItems : []
                  return (
                    <article className="source-card" key={row.source.id}>
                      <div className="source-card-header">
                        <div className="source-title">
                          <strong>{row.source.name}</strong>
                          <span>{card.modeLabel}</span>
                        </div>
                        <div className="source-state">
                          <span className={`status-dot ${desktopSourceTone(card.state.tone)}`} />
                          <strong>{card.state.label}</strong>
                        </div>
                      </div>
                      <div className="source-card-meta">
                        <span>{card.lastActivityLabel}：{formatExternalSourceTime(card.lastActivityAt)}</span>
                        <span>
                          {card.scannedItems === undefined || card.scannedBytes === undefined
                            ? '尚无扫描统计'
                            : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatBinarySize(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`}
                        </span>
                      </div>
                      {row.source.last_error && <div className="source-error">{row.source.last_error}</div>}
                      <div className="source-card-actions">
                        <button
                          className="secondary"
                          type="button"
                          disabled={sourceFailedItemsLoadingID !== null}
                          onClick={() => void toggleSourceDetails(row)}
                        >
                          {sourceFailedItemsLoadingID === row.source.id
                            ? '正在检查…'
                            : selectedSourceID === row.source.id ? '收起' : '查看'}
                        </button>
                        {row.source.kind === 'synology_photos' && (
                          <MuiButton
                            size="small"
                            variant="outlined"
                            disabled={!!busy}
                            onClick={() => setSynologyGuideSource(row.source)}
                            sx={{ minWidth: 'auto', px: 1.1, py: 0.2, fontSize: 11 }}
                          >
                            DSM 配置
                          </MuiButton>
                        )}
                        <button
                          className="secondary"
                          type="button"
                          title={card.trigger.label}
                          disabled={!!busy || !card.trigger.ready}
                          onClick={() => void triggerSourceNow(row)}
                        >
                          {busy === `source-trigger-${row.source.id}`
                            ? '正在请求…'
                            : externalSourceTriggerActionLabel(row)}
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          disabled={!!busy}
                          onClick={() => editingSourceID === row.source.id
                            ? setEditingSourceID(null)
                            : openSourceSettings(row)}
                        >
                          {editingSourceID === row.source.id ? '取消设置' : '设置'}
                        </button>
                      </div>
                      {editingSourceID === row.source.id && (
                        <form className="source-settings" onSubmit={(event) => void saveSourceSettings(event, row)}>
                          <div className="source-settings-heading">
                            <div>
                              <strong>来源设置</strong>
                              <span>目标节点保持不变：{row.source.target_node_id ? `#${row.source.target_node_id}` : '未配置'}</span>
                            </div>
                          </div>
                          <div className="source-settings-grid">
                            <label>
                              <span>名称</span>
                              <input value={sourceEditName} onChange={(event) => setSourceEditName(event.target.value)} maxLength={128} required />
                            </label>
                            <label>
                              <span>运行模式</span>
                              <select value={sourceEditRunMode} onChange={(event) => setSourceEditRunMode(event.target.value as 'scan' | 'sync')}>
                                <option value="scan">仅扫描</option>
                                <option value="sync">同步</option>
                              </select>
                            </label>
                            <label>
                              <span>状态</span>
                              <select value={sourceEditStatus} onChange={(event) => setSourceEditStatus(event.target.value as 'active' | 'paused')}>
                                <option value="active">启用</option>
                                <option value="paused">暂停</option>
                              </select>
                            </label>
                          </div>
                          <label className="source-settings-wide">
                            <span>忽略规则</span>
                            <textarea
                              value={sourceEditIgnoreRules}
                              onChange={(event) => setSourceEditIgnoreRules(event.target.value)}
                              rows={5}
                              spellCheck={false}
                              placeholder="每行一条 gitignore 风格规则"
                            />
                          </label>
                          {externalSourceConnectorProfile(row.source.kind).credential === 'cookie' && (
                            <label className="source-settings-wide">
                              <span>一刻相册 Cookie</span>
                              <input
                                type="password"
                                value={sourceEditCookie}
                                onChange={(event) => {
                                  setSourceEditCookie(event.target.value)
                                  setSourceEditCredentialTest(null)
                                }}
                                autoComplete="off"
                                placeholder={row.credential?.configured ? '留空则保持当前 Cookie' : '当前未配置，请粘贴 Cookie'}
                              />
                              <small>已保存的 Cookie 不会回读到桌面渲染进程。</small>
                              <YikeCookieHelpGuide />
                              <MuiButton
                                type="button"
                                size="small"
                                variant="outlined"
                                disabled={!!busy}
                                onClick={() => void testSettingsYikeCredential(row)}
                                sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                              >
                                {busy === `source-credential-test-${row.source.id}` ? '正在测试…' : '测试连接'}
                              </MuiButton>
                              {sourceEditCredentialTest && (
                                <MuiAlert severity="success" sx={{ mt: 0.5 }}>
                                  {externalSourceCredentialTestSuccessLabel(sourceEditCredentialTest)}
                                </MuiAlert>
                              )}
                            </label>
                          )}
                          <div className="source-settings-actions">
                            <button className="primary" type="submit" disabled={!!busy}>
                              {busy === `source-settings-${row.source.id}` ? '正在保存…' : '保存设置'}
                            </button>
                            <button className="secondary" type="button" disabled={!!busy} onClick={() => setEditingSourceID(null)}>取消</button>
                            {externalSourceConnectorProfile(row.source.kind).credential === 'cookie' && row.credential?.configured && (
                              <button className="danger" type="button" disabled={!!busy} onClick={() => void clearSourceCookie(row)}>清除 Cookie</button>
                            )}
                            <MuiButton
                              type="button"
                              color="error"
                              variant="outlined"
                              size="small"
                              disabled={!!busy || row.latestRun?.status === 'running'}
                              onClick={() => setSourceDeleteTarget(row)}
                              sx={{ minWidth: 'auto', px: 1.2, py: 0.35, fontSize: 12 }}
                            >
                              删除来源
                            </MuiButton>
                          </div>
                        </form>
                      )}
                      {selectedSourceID === row.source.id && (
                        <div className="source-detail">
                          <div className="source-detail-grid">
                            <div><span>来源类型</span><strong>{detail.kindLabel}</strong></div>
                            <div><span>工作方式</span><strong>{detail.modeLabel}</strong></div>
                            <div><span>状态</span><strong>{detail.state.label}</strong></div>
                            <div>
                              <span>目标目录</span>
                              <strong>{row.source.kind === 'yike_photos' ? yikeManagedTargetLabel : (detail.targetNodeID ? `#${detail.targetNodeID}` : '未配置')}</strong>
                            </div>
                            <div><span>上次运行</span><strong>{formatExternalSourceTime(detail.lastRunAt)}</strong></div>
                            <div><span>上次成功</span><strong>{formatExternalSourceTime(detail.lastSuccessAt)}</strong></div>
                            {detail.credential && (
                              <div><span>{detail.credential.label}</span><strong>{detail.credential.configured ? '已配置' : '未配置'}</strong></div>
                            )}
                            <div><span>配置修订号</span><strong>{detail.revision}</strong></div>
                          </div>
                          {detail.ignoreRules && (
                            <div className="source-ignore">
                              <span>忽略规则</span>
                              <pre>{detail.ignoreRules}</pre>
                            </div>
                          )}
                          <div className="source-run-detail">
                            <div className="source-run-heading">
                              <strong>最近一次运行</strong>
                              <span>{runDetail ? runDetail.statusLabel : '尚无运行记录'}</span>
                            </div>
                            {runDetail && (
                              <div className="source-run-grid">
                                <div><span>开始时间</span><strong>{formatExternalSourceTime(runDetail.startedAt)}</strong></div>
                                {runDetail.metrics.map((metric) => (
                                  <div key={metric.key}>
                                    <span>{metric.label}</span>
                                    <strong>
                                      {metric.items.toLocaleString('zh-CN')} 项
                                      {metric.bytes === undefined ? '' : ` · ${formatBinarySize(metric.bytes)}`}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {sourceFailedItemsLoadingID === row.source.id && (
                            <Typography variant="caption" color="text.secondary">正在检查逐文件失败记录…</Typography>
                          )}
                          {failedItems.length > 0 && (
                            <MuiAlert
                              severity="error"
                              sx={{ mt: 1.5 }}
                              action={(
                                <Stack direction="row" spacing={0.5}>
                                  <MuiButton color="inherit" size="small" onClick={() => setSourceFailedItemsOpen(true)}>
                                    查看失败项（{failedItems.length}）
                                  </MuiButton>
                                  <MuiButton
                                    color="inherit"
                                    size="small"
                                    disabled={!!busy || !card.trigger.ready}
                                    onClick={() => void triggerSourceNow(row)}
                                  >
                                    {busy === `source-trigger-${row.source.id}` ? '正在请求…' : '立即重试'}
                                  </MuiButton>
                                </Stack>
                              )}
                            >
                              当前仍有 {failedItems.length} 个文件处于失败状态；下一次扫描会自动重试。
                            </MuiAlert>
                          )}
                        </div>
                      )}

                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}


        {view === 'cloud' && (
          <section className="panel cloud-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">云端文件</p>
                <h2>浏览和管理云端内容</h2>
                <p className="cloud-note">云端操作通过 xdrive-agent 执行，渲染进程不会接触服务器 access token 或 refresh token。</p>
              </div>
              <div className="cloud-heading-actions">
                <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadCloudTrash()}>
                  回收站
                </button>
                <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadCloudHome()}>
                  {busy === 'cloud-load' ? '正在刷新…' : '刷新'}
                </button>
              </div>
            </div>

            {cloudQuota?.over_quota && (
              <div className="alert error">存储空间已超出配额。请永久删除回收站内容，或联系管理员提高配额。</div>
            )}
            {cloudQuota && (
              <div className="cloud-quota-grid">
                <div><span>物理占用</span><strong>{formatBinarySize(cloudQuota.physical_used_bytes)}</strong><small>{cloudQuota.quota_bytes > 0 ? `of ${formatBinarySize(cloudQuota.quota_bytes)}` : '不限配额'}</small></div>
                <div><span>当前文件</span><strong>{formatBinarySize(cloudQuota.logical_file_bytes)}</strong><small>有效逻辑内容</small></div>
                <div><span>回收站</span><strong>{formatBinarySize(cloudQuota.trash_bytes)}</strong><small>计入物理配额</small></div>
                <div><span>历史版本</span><strong>{formatBinarySize(cloudQuota.history_bytes)}</strong><small>已保存的历史内容</small></div>
              </div>
            )}

            {cloudStorageStats && (
              <div className="cloud-subpanel storage-intelligence">
                <div className="cloud-subpanel-heading">
                  <div>
                    <strong>CAS 存储情报</strong>
                    <span>用于评估 CDC 与 small-file packing 的真实收益</span>
                  </div>
                </div>
                <div className="cloud-quota-grid">
                  <div><span>CAS Blob</span><strong>{cloudStorageStats.cas_blob_count.toLocaleString()}</strong><small>唯一物理对象</small></div>
                  <div><span>CAS 物理容量</span><strong>{formatBinarySize(cloudStorageStats.cas_physical_bytes)}</strong><small>实际占用</small></div>
                  <div><span>逻辑引用容量</span><strong>{formatBinarySize(cloudStorageStats.cas_logical_referenced_bytes)}</strong><small>含重复引用</small></div>
                  <div><span>去重节省</span><strong>{formatBinarySize(cloudStorageStats.cas_dedup_saved_bytes)}</strong><small>{cloudStorageStats.cas_dedup_ratio.toFixed(2)}× · {(cloudStorageStats.cas_savings_ratio * 100).toFixed(1)}%</small></div>
                  <div><span>平均 Blob</span><strong>{formatBinarySize(cloudStorageStats.average_blob_size_bytes)}</strong><small>算术平均</small></div>
                  <div><span>P50</span><strong>{formatBinarySize(cloudStorageStats.p50_blob_size_bytes)}</strong><small>中位尺寸</small></div>
                  <div><span>P90</span><strong>{formatBinarySize(cloudStorageStats.p90_blob_size_bytes)}</strong><small>90% Blob 不超过</small></div>
                  <div><span>P99</span><strong>{formatBinarySize(cloudStorageStats.p99_blob_size_bytes)}</strong><small>99% Blob 不超过</small></div>
                </div>
                <div className="cloud-compact-list">
                  {cloudStorageStats.buckets.map((bucket) => (
                    <div className="cloud-compact-row" key={bucket.key}>
                      <div><strong>{bucket.label}</strong><span>{bucket.count.toLocaleString()} 个 Blob</span></div>
                      <strong>{formatBinarySize(bucket.bytes)}</strong>
                    </div>
                  ))}
                </div>
                {cloudStorageStats.legacy_blob_count > 0 && (
                  <div className="alert warning">
                    仍有 {cloudStorageStats.legacy_blob_count.toLocaleString()} 个 legacy 对象（{formatBinarySize(cloudStorageStats.legacy_physical_bytes)}），未计入 CAS 分布。
                  </div>
                )}
              </div>
            )}

            <div className="cloud-search-row">
              <div className="cloud-search-input">
                <input
                  value={cloudQuery}
                  onChange={(event) => setCloudQuery(event.target.value)}
                  placeholder="搜索全部云端文件和文件夹"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void searchCloud()
                    }
                  }}
                />
                <button className="primary" type="button" disabled={!!busy || cloudQuery.trim().length < 2} onClick={() => void searchCloud()}>
                  {busy === 'cloud-search' ? '正在搜索…' : '搜索'}
                </button>
              </div>
              {cloudSearchActive && (
                <button className="secondary" type="button" onClick={() => {
                  setCloudSearchActive(false)
                  setCloudResults([])
                  setCloudQuery('')
                }}>清除结果</button>
              )}
            </div>

            {!cloudSearchActive && (
              <div className="cloud-breadcrumbs">
                {cloudCrumbs.map((crumb, index) => (
                  <button
                    type="button"
                    key={crumb.id}
                    disabled={index === cloudCrumbs.length - 1 || !!busy}
                    onClick={() => void loadCloudDirectory(crumb.id, cloudCrumbs.slice(0, index + 1))}
                  >
                    {crumb.name}
                  </button>
                ))}
              </div>
            )}

            <div className="cloud-list">
              <div className="cloud-list-header">
                <span>名称</span><span>大小</span><span>修改时间</span><span />
              </div>
              {cloudSearchActive ? (
                cloudResults.length === 0 ? (
                  <div className="cloud-empty">No cloud files or folders matched “{cloudQuery.trim()}”.</div>
                ) : cloudResults.map((result) => (
                  <div className="cloud-row" key={`search:${result.node.id}:${result.path}`}>
                    <div className="cloud-name">
                      <strong>{result.node.name}</strong>
                      <span>{result.path}</span>
                    </div>
                    <span>{result.node.type === 'dir' ? '—' : formatBinarySize(result.node.size)}</span>
                    <span>{new Date(result.node.updated_at).toLocaleString()}</span>
                    <div className="cloud-row-actions">
                      {result.node.type === 'dir' ? (
                        <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadCloudDirectory(result.node.id, result.crumbs)}>打开</button>
                      ) : (
                        <>
                          <button className="secondary" type="button" disabled={!!busy} onClick={() => void openCloud历史版本(result.node, result.crumbs)}>历史版本</button>
                          <button className="secondary" type="button" disabled={!!busy} onClick={() => void openCloudShares(result.node)}>分享</button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              ) : cloudItems.length === 0 ? (
                <div className="cloud-empty">此云端文件夹为空。</div>
              ) : (
                cloudItems.map((node) => (
                  <div className="cloud-row" key={node.id}>
                    <div className="cloud-name">
                      <strong>{node.name}</strong>
                      <span>{node.type === 'dir' ? 'Folder' : 'File'}</span>
                    </div>
                    <span>{node.type === 'dir' ? '—' : formatBinarySize(node.size)}</span>
                    <span>{new Date(node.updated_at).toLocaleString()}</span>
                    <div className="cloud-row-actions">
                      {node.type === 'dir' ? (
                        <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadCloudDirectory(
                          node.id,
                          [...cloudCrumbs, { id: node.id, name: node.name }],
                        )}>打开</button>
                      ) : (
                        <>
                          <button className="secondary" type="button" disabled={!!busy} onClick={() => void openCloud历史版本(node, cloudCrumbs)}>历史版本</button>
                          <button className="secondary" type="button" disabled={!!busy} onClick={() => void openCloudShares(node)}>分享</button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {cloudTrashOpen && (
              <div className="cloud-subpanel">
                <div className="cloud-subpanel-heading">
                  <div><strong>回收站</strong><span>{cloudTrash.length} item{cloudTrash.length === 1 ? '' : 's'}</span></div>
                  <button className="secondary" type="button" onClick={() => setCloudTrashOpen(false)}>关闭</button>
                </div>
                {cloudTrash.length === 0 ? <div className="cloud-empty">回收站为空。</div> : (
                  <div className="cloud-compact-list">
                    {cloudTrash.map((node) => (
                      <div className="cloud-compact-row" key={node.id}>
                        <div><strong>{node.name}</strong><span>{node.type === 'dir' ? 'Folder' : formatBinarySize(node.size)} · deleted {node.deleted_at ? new Date(node.deleted_at).toLocaleString() : '—'}</span></div>
                        <div className="cloud-row-actions">
                          <button className="secondary" type="button" disabled={!!busy} onClick={() => void restoreCloudTrash(node)}>恢复</button>
                          <button className="danger" type="button" disabled={!!busy} onClick={() => void deleteCloudTrash(node)}>永久删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {cloudHistoryNode && (
              <div className="cloud-subpanel">
                <div className="cloud-subpanel-heading">
                  <div><strong>版本历史 — {cloudHistoryNode.name}</strong><span>当前版本 r{cloudHistoryNode.revision}</span></div>
                  <button className="secondary" type="button" onClick={() => {
                    setCloudHistoryNode(null)
                    setCloudHistoryCrumbs([])
                    setCloudVersions([])
                  }}>关闭</button>
                </div>
                {cloudVersions.length === 0 ? <div className="cloud-empty">暂无历史版本。</div> : (
                  <div className="cloud-compact-list">
                    {cloudVersions.map((version) => (
                      <div className="cloud-compact-row" key={version.id}>
                        <div><strong>Revision r{version.revision}</strong><span>{formatBinarySize(version.size)} · {new Date(version.created_at).toLocaleString()}</span></div>
                        <button className="primary" type="button" disabled={!!busy} onClick={() => void restoreCloudVersion(version)}>恢复</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {cloudShareNode && (
              <div className="cloud-subpanel">
                <div className="cloud-subpanel-heading">
                  <div><strong>分享 — {cloudShareNode.name}</strong><span>分享令牌只会在创建时显示一次。</span></div>
                  <button className="secondary" type="button" onClick={() => {
                    setCloudShareNode(null)
                    setCloudShares([])
                    setCreatedShareURL('')
                  }}>关闭</button>
                </div>

                {createdShareURL && (
                  <div className="share-created-row">
                    <input value={createdShareURL} readOnly />
                    <button className="primary" type="button" onClick={() => void copyShareURL()}>复制链接</button>
                  </div>
                )}

                <div className="share-form">
                  <label>
                    有效期
                    <div className="input-with-unit">
                      <input type="number" min="0" max="3650" step="1" value={shareExpiresDays} onChange={(event) => setShareExpiresDays(event.target.value)} />
                      <span>天</span>
                    </div>
                    <small>0 表示永不过期。</small>
                  </label>
                  <label>
                    最大下载次数
                    <input type="number" min="0" step="1" value={shareMaxDownloads} onChange={(event) => setShareMaxDownloads(event.target.value)} />
                    <small>0 表示不限次数。</small>
                  </label>
                  <label>
                    密码（可选）
                    <input type="password" autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} placeholder="至少 8 个字符" />
                  </label>
                  <button className="primary" type="button" disabled={!!busy} onClick={() => void createCloudShare()}>
                    {busy === 'cloud-share-create' ? '正在创建…' : '创建分享链接'}
                  </button>
                </div>

                <div className="cloud-compact-list">
                  {cloudShares.length === 0 ? <div className="cloud-empty">此文件暂无分享链接。</div> : cloudShares.map((share) => (
                    <div className="cloud-compact-row" key={share.id}>
                      <div>
                        <strong>{shareStatusLabel(share.status)}</strong>
                        <span>
                          {share.has_password ? '密码保护' : '仅链接'} ·
                          {' '}{share.expires_at ? `到期时间 ${new Date(share.expires_at).toLocaleString()}` : '永不过期'} ·
                          {' '}{share.download_count}{share.max_downloads > 0 ? ` / ${share.max_downloads}` : ' / 不限'} 次下载
                        </span>
                      </div>
                      <button className="danger" type="button" disabled={!!busy || share.status === 'revoked'} onClick={() => void revokeCloudShare(share)}>撤销</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'transfers' && (
          <section className="panel transfer-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">传输中心</p>
                <h2>上传、下载与本地可用性</h2>
              </div>
              <div className="transfer-summary">
                <span><strong>{activeTransfers.length}</strong> 进行中</span>
                <span><strong>{completedTransfers.length}</strong> 已完成</span>
                <span><strong>{failedTransfers.length}</strong> 失败</span>
              </div>
            </div>

            {([
              ['进行中', activeTransfers],
              ['已完成', completedTransfers],
              ['失败', failedTransfers],
            ] as Array<[string, AgentTransfer[]]>).map(([label, items]) => (
              <div className="transfer-section" key={label}>
                <div className="transfer-section-title"><h3>{label}</h3><span>{items.length}</span></div>
                {items.length === 0 ? <div className="transfer-empty">暂无{label}任务。</div> : (
                  <div className="transfer-list">
                    {items.map((item) => {
                      const percent = Math.max(0, Math.min(100, item.percent || 0))
                      const byteProgress = item.bytes_total > 0
                        ? `${formatBinarySize(item.bytes_done)} / ${formatBinarySize(item.bytes_total)}`
                        : item.bytes_done > 0 ? formatBinarySize(item.bytes_done) : '暂无字节流'
                      return (
                        <article className="transfer-row" key={item.id}>
                          <div className="transfer-main">
                            <div className="transfer-title">
                              <strong title={item.path || item.file_name}>{item.file_name || item.path || item.id}</strong>
                              <span className={`transfer-kind ${item.kind}`}>{transferKindLabel(item.kind)}</span>
                            </div>
                            {(item.state === 'running' || item.state === 'retrying') && (
                              <div className="transfer-progress">
                                <div className="transfer-progress-track"><span style={{ width: `${percent}%` }} /></div>
                                <span>{item.bytes_total > 0 ? `${percent.toFixed(1)}%` : item.state === 'retrying' ? '正在重试' : '处理中'}</span>
                              </div>
                            )}
                            {item.error && <div className="transfer-error">{item.error}</div>}
                            <div className="transfer-meta">
                              <span>{transferKindLabel(item.direction)}</span>
                              <span>{byteProgress}</span>
                              <span>当前 {formatTransferSpeed(item.instant_bytes_per_second)}</span>
                              <span>平均 {formatTransferSpeed(item.average_bytes_per_second)}</span>
                              <span>{formatElapsed(item.elapsed_ms)}</span>
                              {item.retry_count > 0 && <span>重试 {item.retry_count} 次</span>}
                            </div>
                          </div>
                          {item.state === 'failed' && item.retryable && (
                            <button
                              className="secondary"
                              type="button"
                              disabled={!!busy}
                              onClick={() => void retryTransfer(item.id)}
                            >
                              {busy === `retry-transfer-${item.id}` ? '正在重试…' : '重试'}
                            </button>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {view === 'files' && (
          <section className="panel storage-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">存储策略</p>
                <h2>{storagePoliciesSupported ? '选择此设备保留的内容' : 'Linux FUSE 挂载'}</h2>
                <p className="storage-note">
                  {storagePoliciesSupported
                    ? '策略应用于云端文件夹。“默认”继承最近的父级策略；“不同步”会从此设备移除该文件夹；“始终保留”会将已同步内容固定保存在本地。'
                    : 'Linux 当前使用 FUSE 远程挂载；目录在此处只读展示，文件内容在打开时按需获取。'}
                </p>
              </div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadStorage()}>
                {busy === 'storage' ? '正在刷新…' : '刷新'}
              </button>
            </div>

            {!storagePoliciesSupported ? (
              <MuiAlert severity="info" sx={{ mb: 2 }}>
                Linux FUSE 模式不提供 Windows CfAPI 的“不同步”“始终保留”或持久化本地缓存语义；这些策略只在 Windows 客户端可配置。
              </MuiAlert>
            ) : null}

            {storagePoliciesSupported ? (cacheStats ? (
              <div className="cache-card">
                <div className="cache-metrics">
                  <div><span>已使用</span><strong>{formatBinarySize(cacheStats.used_bytes)}</strong><small>{cacheStats.cached_files} 个缓存文件</small></div>
                  <div><span>上限</span><strong>{cacheStats.limit_bytes > 0 ? formatBinarySize(cacheStats.limit_bytes) : '不限'}</strong><small>固定内容受保护</small></div>
                  <div><span>可释放</span><strong>{formatBinarySize(cacheStats.reclaimable_bytes)}</strong><small>{cacheStats.reclaimable_files} 个文件</small></div>
                  <div><span>已固定</span><strong>{formatBinarySize(cacheStats.pinned_bytes)}</strong><small>{cacheStats.pinned_files} 个文件</small></div>
                </div>
                {cacheStats.supported ? (
                  <div className="cache-actions">
                    <p>只会释放已完整同步且未固定的云端文件。“始终保留”的内容永远不会被回收。</p>
                    <button className="secondary" type="button" disabled={!!busy || cacheStats.reclaimable_bytes <= 0} onClick={() => void releaseReclaimableCache()}>
                      {busy === 'release-cache' ? '正在释放…' : '释放可回收缓存'}
                    </button>
                  </div>
                ) : (
                  <div className="cache-unavailable">{cacheStats.reason || '当前平台不支持持久化本地缓存管理。'}</div>
                )}
              </div>
            ) : <div className="empty-state">正在加载缓存用量…</div>) : null}

            <div className="storage-tree-header">
              <div>
                <strong>云端文件夹</strong>
                <span>{storagePoliciesSupported ? '默认 / 不同步 / 始终保留' : '只读目录视图 · FUSE 按需访问'}</span>
              </div>
              {storageTree && <span>{storageTree.file_count} 个文件 · {formatBinarySize(storageTree.total_bytes)}</span>}
            </div>
            {!storageTree ? (
              <div className="empty-state">正在加载云端文件夹树…</div>
            ) : (storageTree.children || []).length === 0 ? (
              <div className="empty-state">暂无云端文件夹。</div>
            ) : (
              <div className="storage-tree">{(storageTree.children || []).map((node) => renderStorageNode(node))}</div>
            )}
          </section>
        )}

        {view === 'conflicts' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">冲突副本</p><h2>解决同步冲突</h2></div>
              <button className="secondary" type="button" onClick={() => void loadConflicts()}>刷新</button>
            </div>
            {conflicts.length === 0 ? <div className="empty-state">没有未解决的冲突。</div> : (
              <div className="conflict-list">
                {conflicts.map((item) => (
                  <article className="conflict-row" key={item.id}>
                    <div className="conflict-copy">
                      <strong>{item.original_path}</strong>
                      <span>冲突副本：{item.conflict_path}</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="row-actions">
                      <button className="secondary" type="button" onClick={() => void run(`open-${item.id}`, () => window.xdriveDesktop.agent.openConflict(item.id, true))}>同时打开</button>
                      <button className="secondary" type="button" onClick={() => {
                        if (window.confirm('保留服务器版本并删除本地冲突副本？')) {
                          void run(`server-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'server'), '冲突已解决。').then(() => loadConflicts())
                        }
                      }}>保留服务器版本</button>
                      <button className="primary" type="button" onClick={() => {
                        if (window.confirm('使用本地冲突副本替换服务器版本？')) {
                          void run(`local-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'local'), '冲突已解决。').then(() => loadConflicts())
                        }
                      }}>保留本地版本</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}


        {view === 'diagnostics' && (
          <section className="panel diagnostics-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">诊断与自修复</p>
                <h2>客户端诊断</h2>
                <p className="diagnostic-note">Agent 会运行与 <code>xd doctor</code> 相同的脱敏检查。密钥、会话 ID 和用户目录路径不会暴露给渲染进程。</p>
              </div>
              <button className="primary" type="button" disabled={!!busy} onClick={() => void loadDiagnostics()}>
                {busy === 'diagnostics' ? '正在检查…' : '运行诊断'}
              </button>
            </div>

            {diagnostics ? (
              <>
                <div className="diagnostic-summary">
                  <div className="diagnostic-count pass"><strong>{diagnostics.summary.pass}</strong><span>通过</span></div>
                  <div className="diagnostic-count warn"><strong>{diagnostics.summary.warn}</strong><span>警告</span></div>
                  <div className="diagnostic-count fail"><strong>{diagnostics.summary.fail}</strong><span>失败</span></div>
                  <div className="diagnostic-generated"><span>上次检查</span><strong>{new Date(diagnostics.generated_at).toLocaleString()}</strong></div>
                </div>

                <div className="diagnostic-actions">
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent().then(() => loadDiagnostics())}>
                    {busy === 'restart-agent' ? '正在重启 Agent…' : '重启 Agent'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void runDiagnosticAction(
                    'reconnect',
                    () => window.xdriveDesktop.agent.reconnect(),
                    '同步引擎已重新连接。',
                  )}>
                    {busy === 'reconnect' ? '正在重新连接…' : '重新连接'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void runDiagnosticAction(
                    'repair-sync-root',
                    () => window.xdriveDesktop.agent.repairSyncRoot(),
                    '同步根目录已修复并重新连接。',
                  )}>
                    {busy === 'repair-sync-root' ? '正在修复…' : '修复同步根目录'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void run(
                    'open-logs',
                    () => window.xdriveDesktop.agent.openLogs(),
                    '已打开 xDrive 日志。',
                  )}>打开日志</button>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void exportDiagnostics()}>
                    {busy === 'export-diagnostics' ? '正在导出…' : '导出报告'}
                  </button>
                </div>

                <div className="diagnostic-list">
                  {diagnostics.checks.map((check, index) => (
                    <article className="diagnostic-row" key={`${check.name}:${index}`}>
                      <span className={`diagnostic-badge ${check.status.toLowerCase()}`}>{check.status}</span>
                      <div>
                        <strong>{check.name}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">运行诊断可检查服务器/TLS、登录与凭据存储、Agent/IPC、同步根目录、CfAPI/FUSE、缓存策略、版本兼容性和磁盘空间。</div>
            )}
          </section>
        )}

        {view === 'settings' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">客户端设置</p><h2>同步、更新、生命周期与缓存</h2></div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent()}>
                {busy === 'restart-agent' ? '正在重启 Agent…' : '重启 Agent'}
              </button>
            </div>
            <Stack spacing={0.5} sx={{ mb: 2 }}>
              <FormControlLabel
                control={(
                  <Switch
                    checked={desktopPreferences.start_at_login}
                    onChange={(event) => void changeStartAtLogin(event.target.checked)}
                  />
                )}
                label="登录系统后启动 xDrive 桌面版"
              />
              <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
                启动后保持后台 Agent 正常运行；主窗口可按你的关闭偏好处理。
              </Typography>
              <FormControlLabel
                control={(
                  <Switch
                    checked={desktopPreferences.close_to_tray}
                    onChange={(event) => void changeCloseToTray(event.target.checked)}
                  />
                )}
                label="关闭窗口时最小化到系统托盘"
              />
              <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
                开启后，点击关闭按钮只隐藏主窗口并继续同步；关闭后将直接退出 xDrive 桌面版。
              </Typography>
            </Stack>
            <div className="update-card">
              <div className="update-card-header">
                <div>
                  <strong>客户端更新</strong>
                  <span>默认不自动更新。你可以选择只检查、自动下载，或自动下载安装。</span>
                </div>
                {updateSupported && clientUpdate ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ minWidth: { sm: 360 } }}>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel id="client-update-source-label">更新来源</InputLabel>
                      <Select
                        labelId="client-update-source-label"
                        value={clientUpdate.source}
                        label="更新来源"
                        disabled={!!busy || updateOperationBusy}
                        onChange={(event) => void changeUpdateSource(event.target.value as AgentUpdateSource)}
                      >
                        <MenuItem value="github">GitHub</MenuItem>
                        <MenuItem value="gitlab">GitLab</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 190 }}>
                      <InputLabel id="client-update-mode-label">更新策略</InputLabel>
                      <Select
                        labelId="client-update-mode-label"
                        value={clientUpdate.mode}
                        label="更新策略"
                        disabled={!!busy || updateOperationBusy}
                        onChange={(event) => void changeUpdateMode(event.target.value as AgentUpdateMode)}
                      >
                        <MenuItem value="manual">手动检查</MenuItem>
                        <MenuItem value="check">自动检查</MenuItem>
                        <MenuItem value="download">有更新自动下载</MenuItem>
                        <MenuItem value="install" disabled={!clientUpdate.install_supported}>自动更新</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                ) : null}
              </div>

              {!updateSupported ? (
                <div className="update-unavailable">当前 xdrive-agent 不支持更新设置，请先安装包含新 Agent 的统一客户端版本。</div>
              ) : !clientUpdate ? (
                <div className="update-unavailable">正在读取客户端更新状态…</div>
              ) : (
                <>
                  <p className="update-mode-note">
                    当前来源：{clientUpdate.source === 'gitlab' ? 'GitLab · http://gitlab.t-fluid.com:1080' : 'GitHub'}。
                    {' '}{updateModeDescription(clientUpdate.mode)}
                    {!clientUpdate.install_supported ? ' 当前平台不会后台安装更新；下载后请使用系统包管理器完成安装。' : ''}
                  </p>
                  <div className="update-metrics">
                    <div><span>当前版本</span><strong>{clientUpdate.current_version || status?.version || '未知'}</strong></div>
                    <div><span>最新版本</span><strong>{clientUpdate.latest_version || '尚未检查'}</strong></div>
                    <div><span>状态</span><strong>{updateStatusLabel(clientUpdate)}</strong></div>
                    <div><span>上次检查</span><strong>{clientUpdate.last_checked_at ? new Date(clientUpdate.last_checked_at).toLocaleString() : '尚未检查'}</strong></div>
                  </div>

                  {(clientUpdate.status === 'downloading' || clientUpdate.bytes_done || clientUpdate.bytes_total) ? (
                    <div className="update-progress">
                      <div className="update-progress-copy">
                        <span>{clientUpdate.message || '正在处理更新…'}</span>
                        <strong>
                          {clientUpdate.bytes_total
                            ? `${formatBinarySize(clientUpdate.bytes_done || 0)} / ${formatBinarySize(clientUpdate.bytes_total)} · ${updateProgress.toFixed(1)}%`
                            : clientUpdate.bytes_done
                              ? formatBinarySize(clientUpdate.bytes_done)
                              : ''}
                        </strong>
                      </div>
                      {clientUpdate.bytes_total ? (
                        <div className="update-progress-track"><span style={{ width: `${updateProgress}%` }} /></div>
                      ) : null}
                      {clientUpdate.bytes_per_second ? <small>{formatTransferSpeed(clientUpdate.bytes_per_second)}</small> : null}
                    </div>
                  ) : null}

                  {clientUpdate.last_error ? <div className="update-error">{clientUpdate.last_error}</div> : null}
                  {!clientUpdate.last_error && clientUpdate.message ? <div className="update-message">{clientUpdate.message}</div> : null}

                  <div className="update-actions">
                    <button
                      className="secondary"
                      type="button"
                      disabled={!!busy || updateOperationBusy}
                      onClick={() => void checkClientUpdate()}
                    >
                      {busy === 'update-check' || clientUpdate.status === 'checking' ? '正在检查…' : '检查更新'}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={!!busy || updateOperationBusy || !clientUpdate.update_available || clientUpdate.downloaded}
                      onClick={() => void downloadClientUpdate()}
                    >
                      {busy === 'update-download' || clientUpdate.status === 'downloading' ? '正在下载…' : clientUpdate.downloaded ? '已下载' : '下载更新'}
                    </button>
                    <button
                      className="primary"
                      type="button"
                      disabled={!!busy || updateOperationBusy || !clientUpdate.update_available || !clientUpdate.install_supported}
                      onClick={() => void installClientUpdate()}
                    >
                      {busy === 'update-install' || clientUpdate.status === 'installing'
                        ? '正在安装…'
                        : clientUpdate.downloaded ? '安装更新' : '下载并安装'}
                    </button>
                  </div>
                  <small className="update-footnote">自动策略在 Agent 启动后约 90 秒首次运行，之后约每 6 小时检查一次；切换到自动策略时会立即检查一次。</small>
                </>
              )}
            </div>
            {!settings ? <div className="empty-state">正在加载设置…</div> : (
              <form className="settings-form" onSubmit={saveSettings}>
                <label>
                  同步文件夹
                  <div className="input-action">
                    <input value={mountPath} onChange={(e) => setMountPath(e.target.value)} required />
                    <button type="button" className="secondary" onClick={() => void chooseDirectory(mountPath, setMountPath)}>浏览</button>
                  </div>
                </label>
                <label>
                  缓存上限
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      max="16384"
                      step="0.25"
                      value={cacheLimit}
                      onChange={(e) => setCacheLimit(e.target.value)}
                      disabled={info?.platform !== 'win32'}
                      required
                    />
                    <span>GiB</span>
                  </div>
                  <small>
                    {info?.platform === 'win32'
                      ? `0 表示不限。当前值：${formatBinarySize(settings.cache_limit_bytes)}。已固定 / 始终保留的内容不会被清理。`
                      : '持久化下载缓存上限适用于 Windows CfAPI；Linux FUSE 对每次打开使用临时文件。'}
                  </small>
                </label>
                <div className="settings-divider" />
                <div className="setting-link-row">
                  <div>
                    <strong>{storagePoliciesSupported ? '文件夹存储策略' : 'Linux FUSE 存储模式'}</strong>
                    <span>
                      {storagePoliciesSupported
                        ? '可在“存储”页面的云端目录树中选择“默认”“不同步”或“始终保留”。'
                        : 'Linux 使用 FUSE 远程挂载；“存储”页面提供只读目录视图，不提供 Windows CfAPI 的选择性同步和固定保留。'}
                    </span>
                  </div>
                  <button className="secondary" type="button" onClick={() => setView('files')}>
                    {storagePoliciesSupported ? '管理存储' : '查看存储'}
                  </button>
                </div>
                <div className="settings-divider" />
                <div className="form-actions">
                  <button className="primary" type="submit" disabled={busy === 'settings'}>{busy === 'settings' ? '正在保存…' : '保存设置'}</button>
                  <button className="danger" type="button" disabled={!!busy} onClick={() => {
                    if (window.confirm('确定要在此设备上退出 xDrive 吗？')) void run('logout', () => window.xdriveDesktop.agent.logout())
                  }}>退出登录</button>
                </div>
              </form>
            )}
          </section>
        )}
      </main>

      <Dialog open={sourceFailedItemsOpen && sourceFailedItems.length > 0} onClose={() => setSourceFailedItemsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>失败文件</DialogTitle>
        <DialogContent dividers>
          {sourceFailedItemsLimitReached && (
            <MuiAlert severity="info" sx={{ mb: 2 }}>当前最多显示前 1000 个失败项。</MuiAlert>
          )}
          <Stack spacing={1.5}>
            {sourceFailedItems.map((item) => (
              <MuiBox key={item.source_item_id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {item.path || item.external_id}
                  </Typography>
                  <Chip size="small" label={formatBinarySize(item.size)} />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
                  外部 ID：{item.external_id}
                </Typography>
                <MuiAlert severity="error" sx={{ mt: 1 }}>{item.last_error || '未提供具体错误原因'}</MuiAlert>
              </MuiBox>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setSourceFailedItemsOpen(false)}>关闭</MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog open={!!sourceDeleteTarget} onClose={() => busy.startsWith('source-delete-') ? undefined : setSourceDeleteTarget(null)}>
        <DialogTitle>删除外部来源？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            删除“{sourceDeleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、来源映射和已保存凭据。
            已经同步到 xDrive 的文件会保留，不会删除。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton disabled={busy.startsWith('source-delete-')} onClick={() => setSourceDeleteTarget(null)}>取消</MuiButton>
          <MuiButton color="error" variant="contained" disabled={busy.startsWith('source-delete-')} onClick={() => void deleteExternalSource()}>
            {busy.startsWith('source-delete-') ? '正在删除…' : '删除来源'}
          </MuiButton>
        </DialogActions>
      </Dialog>

      <SynologyDsmGuideDialog
        open={!!synologyGuideSource}
        source={synologyGuideSource}
        serverURL={status?.server}
        username={status?.username}
        onClose={() => setSynologyGuideSource(null)}
      />
    </div>
  )
}
