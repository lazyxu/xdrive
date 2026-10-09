const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
const keyboard = read('ui', 'shared', 'src', 'file-explorer-keyboard.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

test('shared Copy Path helper emits root-relative xDrive paths and prefers search paths', () => {
  for (const token of [
    'export function xDriveFileExplorerCopyPath',
    'item.secondaryLabel?.trim()',
    "searchPath.replace(/\\\\/g, '/')",
    'currentCrumbs.slice(1).map((crumb) => crumb.name)',
    "return '/' + parts",
  ]) {
    assert.ok(controller.includes(token), 'Copy Path helper missing: ' + token)
  }

  assert.equal(controller.includes("currentCrumbs.map((crumb) => crumb.name)"), false,
    'Copy Path must not include the UI root label such as 我的文件')
})

test('keyboard profiles expose Windows/Web Ctrl+Shift+C and macOS Option+Cmd+C', () => {
  assert.ok(keyboard.includes("| 'copy-path'"), 'copy-path keyboard command is missing')
  for (const token of [
    "profile === 'macos'",
    "key === 'c'",
    'Boolean(event.metaKey)',
    'Boolean(event.altKey)',
    "return 'copy-path'",
    "if (key === 'c' && profile !== 'macos') return 'copy-path'",
  ]) {
    assert.ok(keyboard.includes(token), 'Copy Path keyboard binding missing: ' + token)
  }
})

test('shared FileExplorer owns single and multi-selection Copy Path context-menu behavior', () => {
  for (const token of [
    'onCopyPaths,',
    'onCopyPaths?: (items: XDriveFileExplorerItem[]) => void',
    "id: 'copy-path'",
    "contextSelectionCount > 1 ? '复制所选路径' : '复制路径'",
    'if (selection.length === contextSelectionCount) onCopyPaths(selection)',
    "command === 'copy-path'",
    'selectedItems.length > 0',
    'onCopyPaths(targets)',
  ]) {
    assert.ok(explorer.includes(token), 'shared FileExplorer Copy Path behavior missing: ' + token)
  }

  const editableIndex = explorer.indexOf('if (isEditableTarget(event.target)) return')
  const copyPathIndex = explorer.indexOf("command === 'copy-path'")
  assert.ok(editableIndex >= 0 && copyPathIndex > editableIndex,
    'Copy Path shortcut must not override editable text-field behavior')
})

test('Web and Desktop keep only clipboard adapters and share path semantics', () => {
  for (const token of [
    'xDriveFileExplorerCopyPath',
    '.map((item) => xDriveFileExplorerCopyPath(item, explorerCrumbs))',
    ".join('\\n')",
    'onCopyPaths=',
  ]) {
    assert.ok(web.includes(token), 'Web Copy Path adapter missing: ' + token)
    assert.ok(desktop.includes(token), 'Desktop Copy Path adapter missing: ' + token)
  }

  assert.ok(web.includes('navigator.clipboard?.writeText'), 'Web must use the browser clipboard adapter')
  assert.ok(desktop.includes('window.xdriveDesktop.copyText(text)'), 'Desktop must use the Electron clipboard adapter')
  assert.ok(preload.includes("import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'"),
    'Desktop preload must import Electron clipboard')
  assert.ok(preload.includes('copyText: (text: string) => clipboard.writeText(text)'),
    'Desktop preload clipboard bridge is missing')
  assert.ok(rendererTypes.includes('copyText: (text: string) => void'),
    'Desktop renderer clipboard type is missing')
})
