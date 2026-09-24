import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { formatBinarySize } from '@xdrive/shared'

type View = 'overview' | 'conflicts' | 'settings'

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

export default function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [agent, setAgent] = useState<AgentConnectionState>({ connected: false })
  const [view, setView] = useState<View>('overview')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [conflicts, setConflicts] = useState<AgentConflict[]>([])

  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMount, setLoginMount] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mountPath, setMountPath] = useState('')
  const [cacheLimit, setCacheLimit] = useState('0')

  const status = agent.status
  const configured = !!status?.configured

  useEffect(() => {
    let active = true
    void window.xdriveDesktop.getInfo().then((value) => {
      if (active) setInfo(value)
    })
    void window.xdriveDesktop.agent.getState().then((value) => {
      if (active) setAgent(value)
    })
    const unsubscribe = window.xdriveDesktop.agent.onState((value) => {
      if (active) setAgent(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!agent.connected || !configured) {
      setSettings(null)
      setConflicts([])
      return
    }
    if (view === 'settings') void loadSettings()
    if (view === 'conflicts') void loadConflicts()
    // Refresh when the agent revision changes so settings/conflicts stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, agent.connected, configured, status?.revision])

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
          <p className="subtitle">xDrive Desktop needs the Go background agent. Install or start the xDrive client agent, then retry.</p>
          <div className="offline-box">{agent.error || 'Waiting for desktop IPC discovery…'}</div>
          {error && <div className="alert error">{error}</div>}
          <button className="primary wide" type="button" disabled={busy === 'retry'} onClick={() => void retry()}>
            {busy === 'retry' ? 'Connecting…' : 'Retry connection'}
          </button>
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
          <button className={`nav-item ${view === 'conflicts' ? 'active' : ''}`} type="button" onClick={() => setView('conflicts')}>
            Conflicts {status?.conflict_count ? <span className="badge">{status.conflict_count}</span> : null}
          </button>
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
              <article className="status-card"><span className="status-dot ready" /><div><strong>Agent</strong><p>{status?.auth_status} · v{status?.version}</p></div></article>
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

        {view === 'settings' && (
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">CLIENT SETTINGS</p><h2>Sync and cache</h2></div></div>
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
                    <input type="number" min="0" max="16384" step="0.25" value={cacheLimit} onChange={(e) => setCacheLimit(e.target.value)} required />
                    <span>GiB</span>
                  </div>
                  <small>0 means unlimited. Current value: {formatBinarySize(settings.cache_limit_bytes)}.</small>
                </label>
                <div className="setting-meta">Selective sync rules configured: {settings.sync_rules.length}</div>
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
