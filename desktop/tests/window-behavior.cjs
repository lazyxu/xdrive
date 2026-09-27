const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.cts'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8')

test('desktop window behavior is persistent and user controlled', () => {
  assert.ok(main.includes('getNormalBounds()'), 'window bounds are not persisted')
  assert.ok(main.includes('close_to_tray'), 'close-to-tray preference missing')
  assert.equal(main.includes("win.on('minimize', () => win.hide())"), false, 'minimize should keep native taskbar behavior')
  assert.ok(main.includes('notifyCloseToTrayOnce()'), 'first close-to-tray explanation missing')
  assert.ok(renderer.includes('关闭窗口时最小化到托盘'), 'close-to-tray setting missing')
  assert.ok(renderer.includes('<Switch checked={closeToTray}'), 'close-to-tray setting should use MUI Switch')
})
