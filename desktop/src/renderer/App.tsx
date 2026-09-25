import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { formatBinarySize } from '@xdrive/shared'

type View = 'overview' | 'cloud' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings'

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
    transfers: '传输',
    files: '存储',
    conflicts: '冲突',
    diagnostics: '诊断',
    settings: '设置',
  }
  return labels[view]
}

function shareStatusLabel(status: string) {
  if (status === 'active') return '有效'
  if (status === 'expired') return '已过期'
  if (status === 'exhausted') return '已达下载上限'
  if (status === 'revoked') return '已撤销'
  return status
}

export default function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [startAtLogin, setStartAtLogin] = useState(true)
  const [agent, setAgent] = useState<AgentConnectionState>({ connected: false })
  const [view, setView] = useState<View>('overview')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])
  const [transfers, setTransfers] = useState<AgentTransfers>({ revision: 0, transfers: [] })
  const [diagnostics, setDiagnostics] = useState<AgentDiagnosticReport | null>(null)
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

  useEffect(() => {
    let active = true
    void window.xdriveDesktop.getInfo().then((value) => {
      if (active) setInfo(value)
    })
    void window.xdriveDesktop.getStartup().then((value) => {
      if (active) setStartAtLogin(value.start_at_login)
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
    return () => {
      active = false
      unsubscribe()
      unsubscribeTransfers()
    }
  }, [])

  useEffect(() => {
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      setDiagnostics(null)
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
    setStartAtLogin(result.data.start_at_login)
    setNotice(enabled ? 'xDrive 桌面版将在登录系统后自动启动。' : '已关闭开机启动。')
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
            <span>{node.file_count} file{node.file_count === 1 ? '' : 's'} · {formatBinarySize(node.total_bytes)}</span>
            {inherited && <small>继承策略：{effectiveLabel}</small>}
          </div>
          <div className="storage-modes" role="group" aria-label={`${node.name} 的存储策略`}>
            <button className={node.mode === 'default' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'default')}>默认</button>
            <button className={node.mode === 'exclude' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'exclude')}>不同步</button>
            <button className={node.mode === 'always-local' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'always-local')}>始终保留</button>
          </div>
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
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>桌面版</span></div></div>
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
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>桌面版</span></div></div>
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
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>{status.username}</span></div></div>
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
        <div className="brand"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>桌面版</span></div></div>
        <nav aria-label="桌面版功能区">
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} type="button" onClick={() => setView('overview')}>概览</button>
          <button className={`nav-item ${view === 'cloud' ? 'active' : ''}`} type="button" onClick={() => setView('cloud')}>云端文件</button>
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
            <p className="eyebrow">{viewLabel(view)}</p>
            <h1>{headline}</h1>
            <p className="subtitle">{status?.last_error || `${status?.auth_status} · ${status?.sync_status}`}</p>
          </div>
          <div className="actions">
            <button className="secondary" type="button" disabled={!!busy} onClick={() => void run('folder', () => window.xdriveDesktop.agent.openFolder())}>打开文件夹</button>
            <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void run('sync', () => window.xdriveDesktop.agent.syncNow(), '已请求立即同步。')}>立即同步</button>
            <button className="primary" type="button" disabled={!!busy} onClick={() => void run('pause', () => window.xdriveDesktop.agent.setPaused(!status?.paused))}>{status?.paused ? '继续同步' : '暂停同步'}</button>
          </div>
        </header>

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
                <h2>选择此设备保留的内容</h2>
                <p className="storage-note">策略应用于云端文件夹。“默认”继承最近的父级策略；“不同步”会从此设备移除该文件夹；“始终保留”会将已同步内容固定保存在本地。</p>
              </div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadStorage()}>
                {busy === 'storage' ? '正在刷新…' : '刷新'}
              </button>
            </div>

            {cacheStats ? (
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
            ) : <div className="empty-state">正在加载缓存用量…</div>}

            <div className="storage-tree-header">
              <div><strong>云端文件夹</strong><span>默认 / 不同步 / 始终保留</span></div>
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
              <div><p className="eyebrow">客户端设置</p><h2>同步、生命周期与缓存</h2></div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent()}>
                {busy === 'restart-agent' ? '正在重启 Agent…' : '重启 Agent'}
              </button>
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={startAtLogin} onChange={(e) => void changeStartAtLogin(e.target.checked)} />
              <span><strong>登录系统后启动 xDrive 桌面版</strong><small>启动后直接驻留系统托盘，并保持后台 Agent 正常运行。</small></span>
            </label>
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
                    <strong>文件夹存储策略</strong>
                    <span>可在“存储”页面的云端目录树中选择“默认”“不同步”或“始终保留”。</span>
                  </div>
                  <button className="secondary" type="button" onClick={() => setView('files')}>管理存储</button>
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
    </div>
  )
}
