import { useEffect, useMemo, useState } from 'react'
import { formatSize } from '@xdrive/shared'

type DesktopInfo = {
  version: string
  platform: string
  arch: string
}

function platformLabel(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  if (platform === 'darwin') return 'macOS'
  return platform || 'Unknown'
}

export default function App() {
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const sharedUIReady = useMemo(() => formatSize(0) === '0 B', [])

  useEffect(() => {
    let active = true
    void window.xdriveDesktop.getInfo().then((result) => {
      if (active) setInfo(result)
    })
    return () => { active = false }
  }, [])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">x</div>
          <div>
            <strong>xDrive</strong>
            <span>Desktop</span>
          </div>
        </div>
        <nav aria-label="Desktop sections">
          <button className="nav-item active" type="button">Overview</button>
          <button className="nav-item" type="button" disabled>Files</button>
          <button className="nav-item" type="button" disabled>Transfers</button>
          <button className="nav-item" type="button" disabled>Settings</button>
        </nav>
        <div className="sidebar-note">Phase 2 shell</div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">DESKTOP FOUNDATION</p>
            <h1>xDrive Desktop is ready</h1>
            <p className="subtitle">The Electron application shell is running independently from the sync agent.</p>
          </div>
          <div className="actions">
            <button className="secondary" type="button" onClick={() => window.xdriveDesktop.hide()}>
              Hide to tray
            </button>
            <button className="danger" type="button" onClick={() => window.xdriveDesktop.quit()}>
              Quit
            </button>
          </div>
        </header>

        <section className="status-grid" aria-label="Desktop foundation status">
          <article className="status-card">
            <span className="status-dot ready" />
            <div>
              <strong>Main process</strong>
              <p>Single-instance window lifecycle and tray are active.</p>
            </div>
          </article>
          <article className="status-card">
            <span className="status-dot ready" />
            <div>
              <strong>Preload bridge</strong>
              <p>Renderer access is limited to explicit desktop-shell actions.</p>
            </div>
          </article>
          <article className="status-card">
            <span className={`status-dot ${sharedUIReady ? 'ready' : 'waiting'}`} />
            <div>
              <strong>Shared UI</strong>
              <p>{sharedUIReady ? 'ui/shared is available to the renderer.' : 'Shared UI module unavailable.'}</p>
            </div>
          </article>
          <article className="status-card muted">
            <span className="status-dot waiting" />
            <div>
              <strong>Go agent</strong>
              <p>Intentionally not connected in Phase 2.</p>
            </div>
          </article>
        </section>

        <section className="system-card">
          <div>
            <p className="eyebrow">RUNTIME</p>
            <h2>Desktop shell</h2>
          </div>
          <dl>
            <div>
              <dt>Version</dt>
              <dd>{info?.version ?? 'Loading…'}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>{info ? platformLabel(info.platform) : 'Loading…'}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{info?.arch ?? 'Loading…'}</dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd>Not connected</dd>
            </div>
          </dl>
        </section>
      </main>
    </div>
  )
}
