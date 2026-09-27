const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')

test('desktop remembers window state and exposes configurable close behavior', () => {
  assert.ok(main.includes('getNormalBounds()'), 'missing normal window-bounds persistence')
  assert.ok(main.includes('window_maximized'), 'missing maximized-state persistence')
  assert.ok(main.includes('screen.getAllDisplays()'), 'missing visible-display restore validation')
  assert.equal(main.includes("win.on('minimize', () => win.hide())"), false, 'minimize should remain a normal taskbar minimize')
  assert.ok(main.includes('关闭窗口后，xDrive 是否继续在后台同步？'), 'missing first-close explanation')
  assert.ok(main.includes("'Icon=xdrive'"), 'Linux autostart entry should use the installed xDrive application icon')
  assert.ok(main.includes("ipcMain.handle('desktop:set-close-to-tray'"), 'missing close-behavior IPC')
  assert.ok(renderer.includes('关闭窗口时最小化到系统托盘'), 'missing close-behavior setting')
})
