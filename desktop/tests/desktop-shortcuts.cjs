const test = require('node:test')
const assert = require('node:assert/strict')

const {
  desktopShortcutActionFromArgs,
  desktopShortcutShowsWindow,
  windowsUserTasks,
} = require('../dist/main/desktop_shortcuts.cjs')

test('desktop shortcut parser accepts only known actions', () => {
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--desktop-action=open-folder']), 'open-folder')
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--desktop-action=sync-now']), 'sync-now')
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--desktop-action=transfers']), 'transfers')
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--desktop-action=settings']), 'settings')
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--desktop-action=anything-else']), null)
  assert.equal(desktopShortcutActionFromArgs(['xdrive.exe', '--background']), null)
})

test('background shortcuts do not need the main window', () => {
  assert.equal(desktopShortcutShowsWindow('open-folder'), false)
  assert.equal(desktopShortcutShowsWindow('sync-now'), false)
  assert.equal(desktopShortcutShowsWindow('transfers'), true)
  assert.equal(desktopShortcutShowsWindow('settings'), true)
})

test('Windows Jump List exposes four constrained xDrive tasks', () => {
  const program = 'C:\\Program Files\\xDrive\\xdrive-desktop.exe'
  const tasks = windowsUserTasks(program)
  assert.equal(tasks.length, 4)
  assert.deepEqual(tasks.map((task) => task.title), [
    '打开 xDrive 文件夹',
    '立即同步',
    '查看传输',
    '客户端设置',
  ])
  assert.deepEqual(tasks.map((task) => task.arguments), [
    '--desktop-action=open-folder',
    '--desktop-action=sync-now',
    '--desktop-action=transfers',
    '--desktop-action=settings',
  ])
  for (const task of tasks) {
    assert.equal(task.program, program)
    assert.equal(task.iconPath, program)
    assert.equal(task.iconIndex, 0)
  }
})
