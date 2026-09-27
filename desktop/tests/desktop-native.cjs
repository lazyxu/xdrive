const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src', 'preload', 'index.cts'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')

test('desktop native feedback wires taskbar progress and clickable navigation', () => {
  assert.ok(main.includes('setProgressBar'), 'missing Windows taskbar progress')
  assert.ok(main.includes('tray.setImage(trayStatusImage())'), 'missing dynamic tray status icon updates')
  assert.ok(main.includes("showDesktopNotification('xDrive 冲突'"), 'missing clickable conflict notification')
  assert.ok(main.includes("'settings'"), 'missing update notification target')
  assert.ok(main.includes("'desktop:navigate'"), 'missing main-process navigation event')
  assert.ok(preload.includes("'desktop:navigate'"), 'missing preload navigation bridge')
  assert.ok(renderer.includes('window.xdriveDesktop.onNavigate'), 'missing renderer navigation subscription')
})
