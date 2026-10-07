const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

function loadNativeDragOut() {
  const filename = path.join(repo, 'desktop', 'src', 'main', 'native_drag_out.cts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}

test('native drag-out path resolver stays inside the configured xDrive mount', () => {
  const { resolveDesktopNativeDragOutPath } = loadNativeDragOut()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-native-drag-'))
  try {
    const root = path.join(temp, 'mount')
    const folder = path.join(root, 'Projects')
    const file = path.join(folder, 'report.pdf')
    const outside = path.join(temp, 'outside.txt')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(file, 'x')
    fs.writeFileSync(outside, 'outside')

    assert.equal(
      resolveDesktopNativeDragOutPath(root, path.join('Projects', 'report.pdf')),
      fs.realpathSync(file),
    )
    assert.equal(
      resolveDesktopNativeDragOutPath(root, 'Projects'),
      fs.realpathSync(folder),
      'folders are valid native drag sources too',
    )
    assert.throws(
      () => resolveDesktopNativeDragOutPath(root, '../outside.txt'),
      /outside the xDrive mount root/,
    )
    assert.throws(
      () => resolveDesktopNativeDragOutPath(root, outside),
      /safe relative xDrive path/,
    )
    assert.throws(
      () => resolveDesktopNativeDragOutPath(root, ''),
      /safe relative xDrive path/,
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

test('native drag-out is advertised only for Windows and macOS desktop profiles', () => {
  const { desktopNativeDragOutSupported } = loadNativeDragOut()
  assert.equal(desktopNativeDragOutSupported('win32'), true)
  assert.equal(desktopNativeDragOutSupported('darwin'), true)
  assert.equal(desktopNativeDragOutSupported('linux'), false)
})

test('Electron main owns the absolute path and starts the OS drag', () => {
  const main = read('desktop', 'src', 'main', 'index.cts')
  const preload = read('desktop', 'src', 'preload', 'index.cts')
  const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

  for (const token of [
    "ipcMain.on('desktop:start-native-drag-out'",
    'agentState.status?.mount_path',
    'resolveDesktopNativeDragOutPath(',
    'event.sender.startDrag({',
    'desktopWindowIcon ?? nativeImage.createEmpty()',
  ]) {
    assert.ok(main.includes(token), 'Electron native drag bridge missing: ' + token)
  }
  assert.ok(
    preload.includes("ipcRenderer.send('desktop:start-native-drag-out', relativePath)"),
    'preload must send only the relative xDrive path',
  )
  assert.ok(
    rendererTypes.includes('startNativeDragOut: (relativePath: string) => void'),
    'renderer native drag API type is missing',
  )
  assert.equal(
    preload.includes('realpath'),
    false,
    'renderer/preload must never resolve or receive the absolute local path',
  )
})

test('shared FileExplorer keeps internal drag/drop and exposes a separate native drag handle', () => {
  const shared = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
  const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

  for (const token of [
    'onNativeDragOutItem?: (item: XDriveFileExplorerItem) => void',
    'data-xdrive-native-drag-out',
    'title="拖到系统文件管理器"',
    'event.preventDefault()',
    'event.stopPropagation()',
    'onNativeDragOutItem(item)',
  ]) {
    assert.ok(shared.includes(token), 'shared native drag handle missing: ' + token)
  }
  assert.ok(
    shared.includes('onDragStart={(event) => startItemDrag(event, item)}'),
    'ordinary row/card drag must remain the internal xDrive drag source',
  )
  for (const token of [
    "keyboardProfile === 'windows' || keyboardProfile === 'macos'",
    'window.xdriveDesktop.startNativeDragOut(relativePath)',
    'onNativeDragOutItem={!trashActive && nativeDragOutSupported',
  ]) {
    assert.ok(desktop.includes(token), 'Desktop native drag adapter missing: ' + token)
  }
})
