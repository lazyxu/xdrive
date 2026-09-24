import path = require('node:path')
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  session,
  Tray,
} from 'electron'

const TRAY_ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA20lEQVR42uWX4RGDIAyFNTPYDdrJ2rHsZHYD3UF/9Y6zCbxAQrwrfw35Hgk8ZBj+fYy5j/fnuluBPu/bCAuwBJeEUE84l596wjkORW9C6r36M09dgWWeTGKqWvBNnAMgMWoByzz9JOQAXExJCCTg8dqKpZZA0lx1C0qJaudQa0KpzKjg6/iAZVk17aqqQA6g3StVAhAfcBMQ6oThm1A6btLxNBWg7S06h1oSpStH7LrpLjgDOCAXY3YXpADEB9ys2M0Jpf9279/za/lAryqkHEKfUF4vo/C3Yfg4ANVHcjg82WLtAAAAAElFTkSuQmCC'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
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

  win.on('minimize', () => {
    win.hide()
  })

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
  if (devURL) {
    void win.loadURL(devURL)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())
}

function createTray() {
  const icon = nativeImage
    .createFromBuffer(Buffer.from(TRAY_ICON_BASE64, 'base64'))
    .resize({
      width: process.platform === 'win32' ? 16 : 22,
      height: process.platform === 'win32' ? 16 : 22,
    })

  tray = new Tray(icon)
  tray.setToolTip('xDrive')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open xDrive Desktop',
      click: showMainWindow,
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
  tray.on('click', showMainWindow)
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      showMainWindow()
    } else {
      void app.whenReady().then(showMainWindow)
    }
  })

  app.on('before-quit', () => {
    quitting = true
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('io.github.lazyxu.xdrive.desktop')
    Menu.setApplicationMenu(null)

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    ipcMain.handle('desktop:get-info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }))
    ipcMain.on('desktop:hide', () => mainWindow?.hide())
    ipcMain.on('desktop:quit', () => {
      quitting = true
      app.quit()
    })

    createMainWindow()
    createTray()
  })

  app.on('activate', () => {
    if (mainWindow) showMainWindow()
    else createMainWindow()
  })

  app.on('window-all-closed', () => {
    // The tray owns the desktop-shell lifetime. Explicit Quit exits the app.
  })
}
