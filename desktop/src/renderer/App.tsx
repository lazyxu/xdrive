import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { formatBinarySize } from '@xdrive/shared'

type View = 'overview' | 'transfers' | 'files' | 'conflicts' | 'diagnostics' | 'settings'

function platformLabel(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  if (platform === 'darwin') return 'macOS'
  return platform || 'Unknown'
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
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0s'
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes < 60) return `${minutes}m ${remain}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function transferKindLabel(kind: string) {
  if (kind === 'upload') return 'Upload'
  if (kind === 'download') return 'Download'
  if (kind === 'hydration') return 'Hydration'
  if (kind === 'dehydration') return 'Free space'
  return kind
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

  const headline = useMemo(() => {
    if (!agent.connected) return 'xdrive-agent is not connected'
    if (!configured) return 'Sign in to xDrive'
    if (status?.must_change_password) return 'Change your password'
    if (status?.has_conflict) return `${status.conflict_count} conflict${status.conflict_count === 1 ? '' : 's'} need attention`
    if (status?.paused) return 'Sync is paused'
    return status?.sync_status || 'xDrive is ready'
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
    const data = await run('restart-agent', () => window.xdriveDesktop.agent.restart(), 'xdrive-agent restarted.')
    if (data) setAgent(data)
  }

  const changeStartAtLogin = async (enabled: boolean) => {
    const result = await window.xdriveDesktop.setStartup(enabled)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setStartAtLogin(result.data.start_at_login)
    setNotice(enabled ? 'xDrive Desktop will start at login.' : 'Start at login disabled.')
  }

  const retry = async () => {
    setBusy('retry')
    setError('')
    const state = await window.xdriveDesktop.agent.retry()
    setAgent(state)
    if (!state.connected) setError(state.error || 'xdrive-agent is not available.')
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
      setError('The new passwords do not match.')
      return
    }
    const result = await run('password', () => window.xdriveDesktop.agent.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }), 'Password updated.')
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
      setError('Cache limit must be between 0 and 16384 GiB.')
      return
    }
    const data = await run('settings', () => window.xdriveDesktop.agent.updateSettings({
      mount_path: mountPath.trim(),
      cache_limit_bytes: Math.round(gib * 1024 ** 3),
    }), 'Settings saved.')
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
      'Folder policy updated.',
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
      setNotice('No reclaimable cache is currently available.')
      return
    }
    const failed = data.failed_files > 0 ? ` · ${data.failed_files} file(s) could not be released` : ''
    setNotice(`Released ${formatBinarySize(data.released_bytes)} from ${data.released_files} file(s)${failed}.`)
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
      ? 'Not synced'
      : node.effective_mode === 'always-local'
        ? 'Always keep'
        : 'Default'
    return (
      <div className="storage-node" key={node.path}>
        <div className="storage-row" style={{ paddingLeft: `${12 + depth * 18}px` }}>
          <button
            className="tree-toggle"
            type="button"
            disabled={children.length === 0}
            aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
            onClick={() => toggleStoragePath(node.path)}
          >
            {children.length === 0 ? '·' : expanded ? '▾' : '▸'}
          </button>
          <div className="storage-folder">
            <strong>{node.name}</strong>
            <span>{node.file_count} file{node.file_count === 1 ? '' : 's'} · {formatBinarySize(node.total_bytes)}</span>
            {inherited && <small>Inherited: {effectiveLabel}</small>}
          </div>
          <div className="storage-modes" role="group" aria-label={`Storage policy for ${node.name}`}>
            <button className={node.mode === 'default' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'default')}>Default</button>
            <button className={node.mode === 'exclude' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'exclude')}>Not synced</button>
            <button className={node.mode === 'always-local' ? 'active' : ''} type="button" disabled={!!busy} onClick={() => void updateStorageMode(node.path, 'always-local')}>Always keep</button>
          </div>
        </div>
        {expanded && children.map((child) => renderStorageNode(child, depth + 1))}
      </div>
    )
  }

  const retryTransfer = async (id: string) => {
    const data = await run(`retry-transfer-${id}`, () => window.xdriveDesktop.agent.retryTransfer(id), 'Transfer retry completed.')
    if (data) setTransfers(data)
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
    if (data.saved) setNotice('Diagnostic report exported.')
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
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>Desktop</span></div></div>
          <p className="eyebrow">AGENT CONNECTION</p>
          <h1>{headline}</h1>
          <p className="subtitle">xDrive Desktop automatically starts and monitors the Go background agent. If recovery fails, verify that the xDrive Core package is installed.</p>
          <div className="offline-box">{agent.error || 'Waiting for desktop IPC discovery…'}</div>
          {error && <div className="alert error">{error}</div>}
          <div className="offline-actions">
            <button className="primary" type="button" disabled={!!busy} onClick={() => void retry()}>
              {busy === 'retry' ? 'Connecting…' : 'Retry connection'}
            </button>
            <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent()}>
              {busy === 'restart-agent' ? 'Restarting…' : 'Start / restart Agent'}
            </button>
          </div>
          <p className="footnote">{info ? `Desktop ${info.version} · ${platformLabel(info.platform)} ${info.arch}` : 'Loading desktop information…'}</p>
        </section>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="center-shell">
        <form className="auth-panel" onSubmit={login}>
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>Desktop</span></div></div>
          <p className="eyebrow">SIGN IN</p>
          <h1>{headline}</h1>
          <p className="subtitle">Credentials are passed to the Go agent. The Electron renderer never receives access or refresh tokens.</p>
          {error && <div className="alert error">{error}</div>}
          <label>Server<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://drive.example.com" required /></label>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <label>
            Sync folder <span className="optional">optional</span>
            <div className="input-action">
              <input value={loginMount} onChange={(e) => setLoginMount(e.target.value)} placeholder="Use default xDrive folder" />
              <button type="button" className="secondary" onClick={() => void chooseDirectory(loginMount, setLoginMount)}>Browse</button>
            </div>
          </label>
          <button className="primary wide" type="submit" disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    )
  }

  if (status?.must_change_password) {
    return (
      <div className="center-shell">
        <form className="auth-panel" onSubmit={changePassword}>
          <div className="brand large"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>{status.username}</span></div></div>
          <p className="eyebrow">PASSWORD CHANGE REQUIRED</p>
          <h1>{headline}</h1>
          <p className="subtitle">Your administrator requires a password change before sync can start.</p>
          {error && <div className="alert error">{error}</div>}
          {notice && <div className="alert success">{notice}</div>}
          <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label>
          <label>New password<input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required /></label>
          <label>Confirm new password<input type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></label>
          <button className="primary wide" type="submit" disabled={busy === 'password'}>{busy === 'password' ? 'Updating…' : 'Change password'}</button>
        </form>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">x</div><div><strong>xDrive</strong><span>Desktop</span></div></div>
        <nav aria-label="Desktop sections">
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} type="button" onClick={() => setView('overview')}>Overview</button>
          <button className={`nav-item ${view === 'transfers' ? 'active' : ''}`} type="button" onClick={() => setView('transfers')}>
            Transfers {activeTransfers.length ? <span className="badge">{activeTransfers.length}</span> : null}
          </button>
          <button className={`nav-item ${view === 'files' ? 'active' : ''}`} type="button" onClick={() => setView('files')}>Storage</button>
          <button className={`nav-item ${view === 'conflicts' ? 'active' : ''}`} type="button" onClick={() => setView('conflicts')}>
            Conflicts {status?.conflict_count ? <span className="badge">{status.conflict_count}</span> : null}
          </button>
          <button className={`nav-item ${view === 'diagnostics' ? 'active' : ''}`} type="button" onClick={() => setView('diagnostics')}>Diagnostics</button>
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} type="button" onClick={() => setView('settings')}>Settings</button>
        </nav>
        <div className="account">
          <strong>{status?.username}</strong>
          <span>{status?.server}</span>
          <span>Agent {status?.version}</span>
          <span>{info ? `Desktop ${info.version}` : ''}</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view.toUpperCase()}</p>
            <h1>{headline}</h1>
            <p className="subtitle">{status?.last_error || `${status?.auth_status} · ${status?.sync_status}`}</p>
          </div>
          <div className="actions">
            <button className="secondary" type="button" disabled={!!busy} onClick={() => void run('folder', () => window.xdriveDesktop.agent.openFolder())}>Open folder</button>
            <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void run('sync', () => window.xdriveDesktop.agent.syncNow(), 'Sync requested.')}>Sync now</button>
            <button className="primary" type="button" disabled={!!busy} onClick={() => void run('pause', () => window.xdriveDesktop.agent.setPaused(!status?.paused))}>{status?.paused ? 'Resume' : 'Pause'}</button>
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        {view === 'overview' && (
          <>
            <section className="status-grid">
              <article className="status-card"><span className={`status-dot ${status?.paused ? 'waiting' : 'ready'}`} /><div><strong>Sync</strong><p>{status?.sync_status}</p></div></article>
              <article className="status-card"><span className={`status-dot ${status?.has_conflict ? 'warning' : 'ready'}`} /><div><strong>Conflicts</strong><p>{status?.conflict_count || 0} unresolved</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>Agent</strong><p>{status?.auth_status} · v{agent.hello?.agent_version || status?.version} · IPC {agent.hello?.protocol_min ?? '?'}-{agent.hello?.protocol_max ?? '?'}</p></div></article>
              <article className="status-card"><span className="status-dot ready" /><div><strong>Desktop bridge</strong><p>Connected through protected local IPC.</p></div></article>
            </section>

            <section className="system-card">
              <div className="section-heading">
                <div><p className="eyebrow">SYNC LOCATION</p><h2>{status?.mount_path || 'Default xDrive folder'}</h2></div>
                <button className="secondary" type="button" onClick={() => void run('folder', () => window.xdriveDesktop.agent.openFolder())}>Open</button>
              </div>
              <dl>
                <div><dt>Server</dt><dd>{status?.server}</dd></div>
                <div><dt>User</dt><dd>{status?.username}</dd></div>
                <div><dt>State</dt><dd>{status?.paused ? 'Paused' : status?.sync_status}</dd></div>
                <div><dt>Revision</dt><dd>{status?.revision}</dd></div>
              </dl>
            </section>
          </>
        )}


        {view === 'transfers' && (
          <section className="panel transfer-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">TRANSFER CENTER</p>
                <h2>Uploads, downloads and local availability</h2>
              </div>
              <div className="transfer-summary">
                <span><strong>{activeTransfers.length}</strong> active</span>
                <span><strong>{completedTransfers.length}</strong> completed</span>
                <span><strong>{failedTransfers.length}</strong> failed</span>
              </div>
            </div>

            {([
              ['In progress', activeTransfers],
              ['Completed', completedTransfers],
              ['Failed', failedTransfers],
            ] as Array<[string, AgentTransfer[]]>).map(([label, items]) => (
              <div className="transfer-section" key={label}>
                <div className="transfer-section-title"><h3>{label}</h3><span>{items.length}</span></div>
                {items.length === 0 ? <div className="transfer-empty">No {label.toLowerCase()} transfers.</div> : (
                  <div className="transfer-list">
                    {items.map((item) => {
                      const percent = Math.max(0, Math.min(100, item.percent || 0))
                      const byteProgress = item.bytes_total > 0
                        ? `${formatBinarySize(item.bytes_done)} / ${formatBinarySize(item.bytes_total)}`
                        : item.bytes_done > 0 ? formatBinarySize(item.bytes_done) : 'No byte stream'
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
                                <span>{item.bytes_total > 0 ? `${percent.toFixed(1)}%` : item.state === 'retrying' ? 'Retrying' : 'Working'}</span>
                              </div>
                            )}
                            {item.error && <div className="transfer-error">{item.error}</div>}
                            <div className="transfer-meta">
                              <span>{item.direction}</span>
                              <span>{byteProgress}</span>
                              <span>Now {formatTransferSpeed(item.instant_bytes_per_second)}</span>
                              <span>Avg {formatTransferSpeed(item.average_bytes_per_second)}</span>
                              <span>{formatElapsed(item.elapsed_ms)}</span>
                              {item.retry_count > 0 && <span>{item.retry_count} retr{item.retry_count === 1 ? 'y' : 'ies'}</span>}
                            </div>
                          </div>
                          {item.state === 'failed' && item.retryable && (
                            <button
                              className="secondary"
                              type="button"
                              disabled={!!busy}
                              onClick={() => void retryTransfer(item.id)}
                            >
                              {busy === `retry-transfer-${item.id}` ? 'Retrying…' : 'Retry'}
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
                <p className="eyebrow">STORAGE POLICIES</p>
                <h2>Choose what this device keeps</h2>
                <p className="storage-note">Policies apply to cloud folders. Default follows the nearest parent policy; “Not synced” removes the folder from this device, while “Always keep” pins its synced content locally.</p>
              </div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void loadStorage()}>
                {busy === 'storage' ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {cacheStats ? (
              <div className="cache-card">
                <div className="cache-metrics">
                  <div><span>Used</span><strong>{formatBinarySize(cacheStats.used_bytes)}</strong><small>{cacheStats.cached_files} cached files</small></div>
                  <div><span>Limit</span><strong>{cacheStats.limit_bytes > 0 ? formatBinarySize(cacheStats.limit_bytes) : 'Unlimited'}</strong><small>Pinned content is protected</small></div>
                  <div><span>Reclaimable</span><strong>{formatBinarySize(cacheStats.reclaimable_bytes)}</strong><small>{cacheStats.reclaimable_files} files</small></div>
                  <div><span>Pinned</span><strong>{formatBinarySize(cacheStats.pinned_bytes)}</strong><small>{cacheStats.pinned_files} files</small></div>
                </div>
                {cacheStats.supported ? (
                  <div className="cache-actions">
                    <p>Only fully synced, unpinned Cloud Files are released. “Always keep” content is never reclaimed.</p>
                    <button className="secondary" type="button" disabled={!!busy || cacheStats.reclaimable_bytes <= 0} onClick={() => void releaseReclaimableCache()}>
                      {busy === 'release-cache' ? 'Releasing…' : 'Release reclaimable cache'}
                    </button>
                  </div>
                ) : (
                  <div className="cache-unavailable">{cacheStats.reason || 'Persistent local cache management is unavailable on this platform.'}</div>
                )}
              </div>
            ) : <div className="empty-state">Loading cache usage…</div>}

            <div className="storage-tree-header">
              <div><strong>Cloud folders</strong><span>Default / Not synced / Always keep</span></div>
              {storageTree && <span>{storageTree.file_count} files · {formatBinarySize(storageTree.total_bytes)}</span>}
            </div>
            {!storageTree ? (
              <div className="empty-state">Loading cloud folder tree…</div>
            ) : (storageTree.children || []).length === 0 ? (
              <div className="empty-state">No cloud folders yet.</div>
            ) : (
              <div className="storage-tree">{(storageTree.children || []).map((node) => renderStorageNode(node))}</div>
            )}
          </section>
        )}

        {view === 'conflicts' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">CONFLICT COPIES</p><h2>Resolve sync conflicts</h2></div>
              <button className="secondary" type="button" onClick={() => void loadConflicts()}>Refresh</button>
            </div>
            {conflicts.length === 0 ? <div className="empty-state">No unresolved conflicts.</div> : (
              <div className="conflict-list">
                {conflicts.map((item) => (
                  <article className="conflict-row" key={item.id}>
                    <div className="conflict-copy">
                      <strong>{item.original_path}</strong>
                      <span>Conflict copy: {item.conflict_path}</span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="row-actions">
                      <button className="secondary" type="button" onClick={() => void run(`open-${item.id}`, () => window.xdriveDesktop.agent.openConflict(item.id, true))}>Open both</button>
                      <button className="secondary" type="button" onClick={() => {
                        if (window.confirm('Keep the server version and remove the local conflict copy?')) {
                          void run(`server-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'server'), 'Conflict resolved.').then(() => loadConflicts())
                        }
                      }}>Keep server</button>
                      <button className="primary" type="button" onClick={() => {
                        if (window.confirm('Use the local conflict copy to replace the server version?')) {
                          void run(`local-${item.id}`, () => window.xdriveDesktop.agent.resolveConflict(item.id, 'local'), 'Conflict resolved.').then(() => loadConflicts())
                        }
                      }}>Keep local</button>
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
                <p className="eyebrow">DOCTOR + SELF REPAIR</p>
                <h2>Client diagnostics</h2>
                <p className="diagnostic-note">The Agent runs the same redacted checks used by <code>xd doctor</code>. Secrets, session IDs and home paths are not exposed to the renderer.</p>
              </div>
              <button className="primary" type="button" disabled={!!busy} onClick={() => void loadDiagnostics()}>
                {busy === 'diagnostics' ? 'Checking…' : 'Run diagnostics'}
              </button>
            </div>

            {diagnostics ? (
              <>
                <div className="diagnostic-summary">
                  <div className="diagnostic-count pass"><strong>{diagnostics.summary.pass}</strong><span>Passed</span></div>
                  <div className="diagnostic-count warn"><strong>{diagnostics.summary.warn}</strong><span>Warnings</span></div>
                  <div className="diagnostic-count fail"><strong>{diagnostics.summary.fail}</strong><span>Failed</span></div>
                  <div className="diagnostic-generated"><span>Last checked</span><strong>{new Date(diagnostics.generated_at).toLocaleString()}</strong></div>
                </div>

                <div className="diagnostic-actions">
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent().then(() => loadDiagnostics())}>
                    {busy === 'restart-agent' ? 'Restarting…' : 'Restart Agent'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void runDiagnosticAction(
                    'reconnect',
                    () => window.xdriveDesktop.agent.reconnect(),
                    'Sync engine reconnected.',
                  )}>
                    {busy === 'reconnect' ? 'Reconnecting…' : 'Reconnect'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy || status?.paused} onClick={() => void runDiagnosticAction(
                    'repair-sync-root',
                    () => window.xdriveDesktop.agent.repairSyncRoot(),
                    'Sync root repaired and reconnected.',
                  )}>
                    {busy === 'repair-sync-root' ? 'Repairing…' : 'Repair Sync Root'}
                  </button>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void run(
                    'open-logs',
                    () => window.xdriveDesktop.agent.openLogs(),
                    'Opened xDrive logs.',
                  )}>Open logs</button>
                  <button className="secondary" type="button" disabled={!!busy} onClick={() => void exportDiagnostics()}>
                    {busy === 'export-diagnostics' ? 'Exporting…' : 'Export report'}
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
              <div className="empty-state">Run diagnostics to check Server/TLS, login and credential storage, Agent/IPC, sync root, CfAPI/FUSE, cache policy, version compatibility and disk space.</div>
            )}
          </section>
        )}

        {view === 'settings' && (
          <section className="panel">
            <div className="section-heading">
              <div><p className="eyebrow">CLIENT SETTINGS</p><h2>Sync, lifecycle and cache</h2></div>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => void restartAgent()}>
                {busy === 'restart-agent' ? 'Restarting Agent…' : 'Restart Agent'}
              </button>
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={startAtLogin} onChange={(e) => void changeStartAtLogin(e.target.checked)} />
              <span><strong>Start xDrive Desktop at login</strong><small>Starts directly in the system tray and keeps the background Agent healthy.</small></span>
            </label>
            {!settings ? <div className="empty-state">Loading settings…</div> : (
              <form className="settings-form" onSubmit={saveSettings}>
                <label>
                  Sync folder
                  <div className="input-action">
                    <input value={mountPath} onChange={(e) => setMountPath(e.target.value)} required />
                    <button type="button" className="secondary" onClick={() => void chooseDirectory(mountPath, setMountPath)}>Browse</button>
                  </div>
                </label>
                <label>
                  Cache limit
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
                      ? `0 means unlimited. Current value: ${formatBinarySize(settings.cache_limit_bytes)}. Pinned / Always keep content is protected from eviction.`
                      : 'Persistent hydration cache limits apply to Windows CfAPI. Linux FUSE uses per-open temporary files.'}
                  </small>
                </label>
                <div className="settings-divider" />
                <div className="setting-link-row">
                  <div>
                    <strong>Folder storage policies</strong>
                    <span>Use the Storage page to choose Default, Not synced, or Always keep from the cloud directory tree.</span>
                  </div>
                  <button className="secondary" type="button" onClick={() => setView('files')}>Manage storage</button>
                </div>
                <div className="settings-divider" />
                <div className="form-actions">
                  <button className="primary" type="submit" disabled={busy === 'settings'}>{busy === 'settings' ? 'Saving…' : 'Save settings'}</button>
                  <button className="danger" type="button" disabled={!!busy} onClick={() => {
                    if (window.confirm('Sign out of xDrive on this device?')) void run('logout', () => window.xdriveDesktop.agent.logout())
                  }}>Sign out</button>
                </div>
              </form>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
