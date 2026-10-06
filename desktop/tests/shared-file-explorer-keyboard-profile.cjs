const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const keyboard = read('ui', 'shared', 'src', 'file-explorer-keyboard.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')

test('shared keyboard resolver owns platform profiles and command bindings', () => {
  for (const token of [
    "XDriveFileExplorerKeyboardProfile = 'windows' | 'macos' | 'web'",
    'xDriveFileExplorerKeyboardProfileFromPlatform',
    'xDriveFileExplorerPrimaryModifierActive',
    'xDriveFileExplorerKeyboardCommand',
    "if (profile === 'macos')",
    "if (key === '[') return 'back'",
    "if (key === ']') return 'forward'",
    "if (key === 'arrowup') return 'up'",
    "if (key === 'arrowdown' || key === 'o') return 'open'",
    "if (key === 'i') return 'properties'",
    "if (key === 'backspace') return 'delete'",
    "if (key === 'g') return 'focus-path'",
    "if (key === 'p') return 'toggle-inspector'",
    "if (key === 'enter') return 'rename'",
    "if (key === 'arrowleft') return 'back'",
    "if (key === 'arrowright') return 'forward'",
    "if (key === 'd') return 'focus-path'",
    "if (key === 'f2') return 'rename'",
    "if (key === 'f3') return 'focus-search'",
    "if (key === 'f4') return 'focus-path'",
    "if (key === 'f5') return 'refresh'",
    "return 'context-menu'",
    "if (key === ' ') return 'quick-look'",
  ]) {
    assert.ok(keyboard.includes(token), 'keyboard profile contract missing: ' + token)
  }

  assert.ok(sharedIndex.includes("export * from './file-explorer-keyboard'"), 'keyboard profile resolver must be exported')
})

test('shared FileExplorer dispatches commands instead of embedding OS key bindings', () => {
  for (const token of [
    "keyboardProfile = 'web'",
    'keyboardProfile?: XDriveFileExplorerKeyboardProfile',
    'xDriveFileExplorerKeyboardCommand(event, keyboardProfile)',
    "command === 'new-tab'",
    "command === 'back'",
    "command === 'focus-path'",
    "command === 'focus-search'",
    "command === 'refresh'",
    "command === 'new-folder'",
    "command === 'toggle-inspector'",
    "command === 'undo'",
    "command === 'redo'",
    "command === 'properties'",
    "command === 'open'",
    "command === 'quick-look'",
    "command === 'rename'",
    "command === 'context-menu'",
    "command === 'select-all'",
    "command === 'copy'",
    "command === 'cut'",
    "command === 'paste'",
    "command === 'delete'",
  ]) {
    assert.ok(explorer.includes(token), 'FileExplorer command dispatch missing: ' + token)
  }

  for (const legacy of [
    "event.altKey && event.key === 'ArrowLeft'",
    "event.altKey && event.key === 'ArrowRight'",
    "event.altKey && event.key === 'ArrowUp'",
    "event.key === 'F2' && activeItem",
    "event.shiftKey && event.key === 'F10'",
    "modifier && key === 'c'",
    "modifier && key === 'x'",
    "modifier && key === 'v'",
  ]) {
    assert.equal(explorer.includes(legacy), false, 'OS key binding leaked back into FileExplorer: ' + legacy)
  }
})

test('Web detects browser platform while Desktop uses the authoritative desktop platform', () => {
  for (const token of [
    'xDriveFileExplorerKeyboardProfileFromPlatform',
    'FILE_KEYBOARD_PROFILE',
    'navigator.platform',
    'navigator.userAgent',
    'keyboardProfile={FILE_KEYBOARD_PROFILE}',
  ]) assert.ok(web.includes(token), 'Web keyboard profile adapter missing: ' + token)

  for (const token of [
    'keyboardProfile?: XDriveFileExplorerKeyboardProfile',
    "keyboardProfile = 'web'",
    'keyboardProfile={keyboardProfile}',
  ]) assert.ok(desktop.includes(token), 'Desktop keyboard profile adapter missing: ' + token)

  for (const token of [
    'xDriveFileExplorerKeyboardProfileFromPlatform',
    'fileExplorerKeyboardProfile',
    'info?.platform',
    'keyboardProfile: fileExplorerKeyboardProfile',
  ]) assert.ok(desktopApp.includes(token), 'Desktop App keyboard profile selection missing: ' + token)
})
