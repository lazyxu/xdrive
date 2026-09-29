const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src', 'preload', 'index.cts'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')
const setVersion = fs.readFileSync(path.join(root, 'scripts', 'set-version.mjs'), 'utf8')

test('desktop native feedback wires taskbar progress and clickable navigation', () => {
  assert.ok(main.includes('setProgressBar'), 'missing Windows taskbar progress')
  assert.ok(main.includes('setOverlayIcon'), 'missing Windows taskbar status overlay')
  assert.ok(main.includes('flashFrame(true)'), 'missing Windows taskbar attention flash')
  assert.ok(main.includes("win.on('focus', () => win.flashFrame(false))"), 'missing taskbar flash reset on focus')
  assert.ok(main.includes("powerMonitor.on('resume'"), 'missing system-resume monitor recovery')
  assert.ok(main.includes('restartDesktopMonitors()'), 'missing monitor restart helper')
  assert.ok(main.includes('app.setUserTasks(windowsUserTasks(process.execPath))'), 'missing Windows Jump List tasks')
  assert.ok(main.includes("win.webContents.on('before-input-event'"), 'missing window-local keyboard shortcuts')
  assert.ok(main.includes("win.webContents.on('context-menu'"), 'missing native editable context menu')
  assert.ok(main.includes('editContextMenuTemplate(params.editFlags)'), 'missing edit-flag driven menu state')
  assert.ok(main.includes("app.on('second-instance', (_event, commandLine)"), 'missing second-instance shortcut routing')
  assert.ok(main.includes('tray.setImage(trayStatusImage())'), 'missing dynamic tray status icon updates')
  assert.ok(main.includes("path.join(process.resourcesPath, 'tray-icons')"), 'missing packaged tray icon resource path')
  assert.ok(main.includes("path.resolve(app.getAppPath(), '..', 'assets', 'icon', 'tray')"), 'missing development tray icon resource path')
  assert.ok(main.includes('nativeImage.createFromBuffer(taskbarOverlayPNG(kind))'), 'taskbar overlay must decode a PNG buffer')
  assert.ok(main.includes("lifecycleLog?.record('taskbar_overlay_invalid'"), 'invalid taskbar overlays must be logged without aborting startup')
  assert.ok(main.includes("lifecycleLog?.record('taskbar_overlay_failed'"), 'taskbar overlay failures must be non-fatal')
  assert.equal(main.includes('taskbar overlay badge is invalid'), false, 'taskbar badge decode failures must not throw during startup')
  assert.ok(main.includes("{ label: '设置', click: () => showDesktopView('settings') }"), 'missing tray settings shortcut')
  assert.ok(main.includes("label: '打开传输中心'"), 'missing tray transfer center shortcut')
  assert.ok(main.includes("showDesktopNotification('xDrive 冲突'"), 'missing clickable conflict notification')
  assert.ok(main.includes("'settings-update'"), 'update notification must navigate to the client update section')
  assert.ok(main.includes("'desktop:navigate'"), 'missing main-process navigation event')
  assert.ok(preload.includes("'desktop:navigate'"), 'missing preload navigation bridge')
  assert.ok(renderer.includes('window.xdriveDesktop.onNavigate'), 'missing renderer navigation subscription')
  assert.ok(main.includes("desktopBuildInfo"), 'desktop info must expose packaged build metadata')
  assert.ok(renderer.includes('Desktop 构建信息'), 'settings must show Desktop build metadata')
  assert.ok(renderer.includes('Server 构建信息'), 'settings must show Server build metadata')
  assert.ok(renderer.includes("status?.server_build?.version"), 'top bar must show Server version')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT'), 'desktop packaging must embed commit metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT_MESSAGE_B64'), 'desktop packaging must embed commit message metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_COMMIT_TIME'), 'desktop packaging must embed commit time metadata')
  assert.ok(setVersion.includes('XDRIVE_BUILD_TIME'), 'desktop packaging must embed build time metadata')
})


test('desktop startup failures are visible and renderer loading is guarded', () => {
  assert.ok(main.includes("title: 'xDrive Desktop 启动失败'"), 'foreground startup failures need a native error dialog')
  assert.ok(main.includes("buttons: ['打开日志目录', '退出']"), 'startup error dialog must offer the lifecycle log directory')
  assert.ok(main.includes("win.webContents.on('did-fail-load'"), 'missing main-frame load failure handling')
  assert.ok(main.includes("win.webContents.on('preload-error'"), 'missing preload failure handling')
  assert.ok(main.includes("'renderer_load_timeout'"), 'missing renderer startup timeout')
  assert.ok(main.includes('15_000'), 'renderer startup timeout should be bounded')
})

test('desktop startup lifecycle records checkpoints and non-fatal Windows task registration', () => {
  for (const stage of [
    'electron_ready',
    'preferences_loaded',
    'ipc_ready',
    'window_created',
    'tray_created',
    'agent_checked',
    'monitors_started',
    'renderer_loaded',
    'startup_complete',
  ]) {
    assert.ok(main.includes(`startupCheckpoint('${stage}'`), `missing startup checkpoint: ${stage}`)
  }
  assert.ok(main.includes("'windows_user_tasks_failed'"), 'Windows user-task failures must reach the lifecycle log')
  assert.ok(main.includes("'Windows 任务栏快捷操作'"), 'Windows user-task status must appear in diagnostics')
  assert.equal(main.includes("console.error('failed to register Windows taskbar user tasks')"), false, 'user-task registration should not be console-only')
})
