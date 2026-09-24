import path = require('node:path')
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  Tray,
  type OpenDialogOptions,
} from 'electron'
import {
  AgentIPCClient,
  AgentIPCError,
  type AgentConflict,
  type AgentSettings,
  type AgentStatus,
} from './agent_client.cjs'

const TRAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA20lEQVR42uWX4RGDIAyFNTPYDdrJ2rHsZHYD3UF/9Y6zCbxAQrwrfw35Hgk8ZBj+fYy5j/fnuluBPu/bCAuwBJeEUE84l596wjkORW9C6r36M09dgWWeTGKqWvBNnAMgMWoByzz9JOQAXExJCCTg8dqKpZZA0lx1C0qJaudQa0KpzKjg6/iAZVk17aqqQA6g3StVAhAfcBMQ6oThm1A6btLxNBWg7S06h1oSpStH7LrpLjgDOCAXY3YXpADEB9ys2M0Jpf9279/za/lAryqkHEKfUF4vo/C3Yfg4ANVHcjg82WLtAAAAAElFTkSuQmCC'

type AgentConnectionState = {
  connected: boolean
  status?: AgentStatus
  error?: string
}

type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status?: number } }

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let agentClient: AgentIPCClient | null = null
let agentState: AgentConnectionState = { connected: false, error: 'Connecting to xdrive-agent…' }
let agentMonitor: AbortController | null = null

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'xDrive Desktop',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  win.on('minimize', () => win.hide())
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devURL = process.env.XD_DESKTOP_DEV_URL
    if (devURL) {
      if (!url.startsWith(devURL)) event.preventDefault()
      return
    }
    if (!url.startsWith('file://')) event.preventDefault()
  })
  const devURL = process.env.XD_DESKTOP_DEV_URL
  if (devURL) void win.loadURL(devURL)
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.webContents.once('did-finish-load', () => win.webContents.send('agent:state', agentState))
}

function statusLabel() {
  if (!agentState.connected) return 'Agent not connected'
  const status = agentState.status
  if (!status) return 'Connecting'
  if (status.has_conflict) return `Conflicts (${status.conflict_count})`
  if (status.paused) return 'Paused'
  return status.sync_status || status.auth_status
}

function rebuildTrayMenu() {
  if (!tray) return
  const status = agentState.status
  const configured = !!status?.configured
  tray.setToolTip(`xDrive — ${statusLabel()}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Open xDrive Desktop', click: showMainWindow },
    {
      label: 'Open xDrive Folder',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().openFolder(), false) },
    },
    {
      label: 'Sync Now',
      enabled: agentState.connected && configured && !status?.paused,
      click: () => { void runAgentAction(() => requireAgentClient().syncNow()) },
    },
    {
      label: status?.paused ? 'Resume Sync' : 'Pause Sync',
      enabled: agentState.connected && configured,
      click: () => { void runAgentAction(() => requireAgentClient().setPaused(!status?.paused)) },
    },
    { type: 'separator' },
    {
      label: 'Quit xDrive Desktop',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
}

function createTray() {
  const trayIcon = nativeImage
    .createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'))
    .resize({ width: process.platform === 'win32' ? 16 : 22, height: process.platform === 'win32' ? 16 : 22 })
  tray = new Tray(trayIcon)
  tray.on('click', showMainWindow)
  rebuildTrayMenu()
}

function publishAgentState(next: AgentConnectionState) {
  const changed = JSON.stringify(agentState) !== JSON.stringify(next)
  agentState = next
  rebuildTrayMenu()
  if (changed && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:state', next)
}

function agentError(error: unknown) {
  if (error instanceof AgentIPCError) {
    return { code: error.code, message: error.message, ...(error.status ? { status: error.status } : {}) }
  }
  return { code: 'desktop_error', message: error instanceof Error ? error.message : 'Desktop operation failed.' }
}

function isUnavailable(error: unknown) {
  return error instanceof AgentIPCError &&
    (error.code === 'agent_unavailable' || error.code === 'invalid_discovery' || error.code === 'unsupported_ipc_version')
}

function requireAgentClient() {
  if (!agentClient) throw new AgentIPCError('agent_unavailable', 0, 'xdrive-agent Desktop IPC is not initialized.')
  return agentClient
}

async function refreshAgentState() {
  try {
    const status = await requireAgentClient().status()
    const next: AgentConnectionState = { connected: true, status }
    publishAgentState(next)
    return next
  } catch (error) {
    const next: AgentConnectionState = { connected: false, error: agentError(error).message }
    publishAgentState(next)
    return next
  }
}

async function runAgentAction<T>(operation: () => Promise<T>, refresh = true): Promise<DesktopResult<T>> {
  try {
    const data = await operation()
    if (refresh) await refreshAgentState()
    return { ok: true, data }
  } catch (error) {
    if (isUnavailable(error)) publishAgentState({ connected: false, error: agentError(error).message })
    return { ok: false, error: agentError(error) }
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function startAgentMonitor() {
  agentMonitor?.abort()
  const monitor = new AbortController()
  agentMonitor = monitor
  void (async () => {
    while (!monitor.signal.aborted) {
      try {
        const status = await requireAgentClient().status(monitor.signal)
        publishAgentState({ connected: true, status })
        let revision = status.revision
        while (!monitor.signal.aborted) {
          const event = await requireAgentClient().events(revision, 25_000, monitor.signal)
          if (!event) continue
          revision = event.revision
          publishAgentState({ connected: true, status: event.status })
        }
      } catch (error) {
        if (monitor.signal.aborted) return
        publishAgentState({ connected: false, error: agentError(error).message })
        requireAgentClient().invalidate()
        await wait(2_000, monitor.signal)
      }
    }
  })()
}

function registerIPCHandlers() {
  ipcMain.handle('desktop:get-info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch }))
  ipcMain.handle('desktop:select-directory', async (_event, defaultPath?: unknown) => {
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: 'Choose xDrive sync folder' }
    if (typeof defaultPath === 'string' && defaultPath.trim()) options.defaultPath = defaultPath
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('agent:get-state', () => agentState)
  ipcMain.handle('agent:retry', () => refreshAgentState())
  ipcMain.handle('agent:login', (_event, input: unknown) => {
    const value = input as Partial<{ server: string; username: string; password: string; mount_path: string }>
    if (!value || typeof value.server !== 'string' || typeof value.username !== 'string' || typeof value.password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Server, username and password are required.' } }
    }
    const { server, username, password } = value
    const mountPath = typeof value.mount_path === 'string' ? value.mount_path.trim() : ''
    return runAgentAction(() => requireAgentClient().login({
      server,
      username,
      password,
      ...(mountPath ? { mount_path: mountPath } : {}),
    }))
  })
  ipcMain.handle('agent:logout', () => runAgentAction(() => requireAgentClient().logout()))
  ipcMain.handle('agent:change-password', (_event, input: unknown) => {
    const value = input as Partial<{ current_password: string; new_password: string }>
    if (!value || typeof value.current_password !== 'string' || typeof value.new_password !== 'string') {
      return { ok: false, error: { code: 'invalid_input', message: 'Current and new password are required.' } }
    }
    const { current_password: currentPassword, new_password: newPassword } = value
    return runAgentAction(() => requireAgentClient().changePassword({
      current_password: currentPassword,
      new_password: newPassword,
    }))
  })
  ipcMain.handle('agent:set-paused', (_event, paused: unknown) => {
    if (typeof paused !== 'boolean') return { ok: false, error: { code: 'invalid_input', message: 'Paused must be a boolean.' } }
    return runAgentAction(() => requireAgentClient().setPaused(paused))
  })
  ipcMain.handle('agent:sync-now', () => runAgentAction(() => requireAgentClient().syncNow()))
  ipcMain.handle('agent:get-settings', () => runAgentAction<AgentSettings>(() => requireAgentClient().settings(), false))
  ipcMain.handle('agent:update-settings', (_event, input: unknown) => {
    const value = input as Partial<{ mount_path: string; cache_limit_bytes: number }>
    const update: { mount_path?: string; cache_limit_bytes?: number } = {}
    if (typeof value?.mount_path === 'string') update.mount_path = value.mount_path
    if (typeof value?.cache_limit_bytes === 'number' && Number.isFinite(value.cache_limit_bytes)) {
      update.cache_limit_bytes = Math.round(value.cache_limit_bytes)
    }
    if (Object.keys(update).length === 0) {
      return { ok: false, error: { code: 'invalid_input', message: 'At least one valid setting is required.' } }
    }
    return runAgentAction<AgentSettings>(() => requireAgentClient().updateSettings(update))
  })
  ipcMain.handle('agent:get-conflicts', () => runAgentAction<AgentConflict[]>(() => requireAgentClient().conflicts(), false))
  ipcMain.handle('agent:open-conflict', (_event, id: unknown, both: unknown) => {
    if (typeof id !== 'string' || !id.trim() || typeof both !== 'boolean') {
      return { ok: false, error: { code: 'invalid_input', message: 'Conflict id and open mode are required.' } }
    }
    return runAgentAction(() => requireAgentClient().openConflict(id, both), false)
  })
  ipcMain.handle('agent:resolve-conflict', (_event, id: unknown, choice: unknown) => {
    if (typeof id !== 'string' || !id.trim() || (choice !== 'server' && choice !== 'local')) {
      return { ok: false, error: { code: 'invalid_input', message: 'Conflict id and resolution choice are required.' } }
    }
    return runAgentAction(() => requireAgentClient().resolveConflict(id, choice))
  })
  ipcMain.handle('agent:open-folder', () => runAgentAction(() => requireAgentClient().openFolder(), false))
  ipcMain.on('desktop:hide', () => mainWindow?.hide())
  ipcMain.on('desktop:quit', () => {
    quitting = true
    app.quit()
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) showMainWindow()
    else void app.whenReady().then(showMainWindow)
  })
  app.on('before-quit', () => {
    quitting = true
    agentMonitor?.abort()
  })
  void app.whenReady().then(() => {
    app.setAppUserModelId('io.github.lazyxu.xdrive.desktop')
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    agentClient = new AgentIPCClient(path.join(app.getPath('appData'), 'xdrive', 'desktop-ipc.json'))
    registerIPCHandlers()
    createMainWindow()
    createTray()
    startAgentMonitor()
  })
  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else createMainWindow()
  })
  app.on('window-all-closed', () => {
    // The tray owns the desktop lifetime. Explicit Quit exits the app.
  })
}
