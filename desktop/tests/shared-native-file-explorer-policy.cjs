'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const filename = 'ui/shared/src/file-explorer-native-policy.ts'
const source = read(filename)
const compiled = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', compiled)(mod, mod.exports)
const { XDRIVE_NATIVE_FILE_AVAILABILITY_OPTIONS: options,
  xDriveFileExplorerThrowUploadFailure: throwFailure } = mod.exports

test('same native Files status filter values survive the controller migration', () => {
  assert.deepEqual(options, [
    { value: 'local', label: '本地可用' },
    { value: 'always-local', label: '始终保留在此设备上' },
    { value: 'online-only', label: '仅联机' },
    { value: 'cloud', label: '云端' },
    { value: 'mixed', label: '混合' },
    { value: 'syncing', label: '正在同步' },
  ])
  assert.equal(new Set(options.map(option => option.value)).size, options.length)
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  assert.match(desktop, /XDRIVE_NATIVE_FILE_AVAILABILITY_OPTIONS/)
  assert.doesNotMatch(desktop, /const desktopSearchAvailabilityOptions/)
  assert.match(read('ui/shared/src/index.ts'), /export \* from '\.\/file-explorer-native-policy'/)
})

test('only explicitly cancelled native uploads are classified as AbortError', () => {
  assert.throws(() => throwFailure({
    code: 'transfer_cancelled', message: 'operation cancelled',
  }), error => error.name === 'AbortError' && error.message === 'operation cancelled')
  assert.throws(() => throwFailure({
    code: 'agent_unavailable', message: 'agent disconnected',
  }), error => error.name === 'Error' && error.message === 'agent disconnected')
  assert.throws(() => throwFailure({ message: 'unknown rejected transfer' }),
    error => error.name === 'Error' && error.message === 'unknown rejected transfer')
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  assert.equal((desktop.match(/xDriveFileExplorerThrowUploadFailure\(/g) || []).length, 3)
  assert.doesNotMatch(desktop, /function throwDesktopUploadError/)
})

test('native UI policy has no implicit Electron IPC, Owner rights or generic proxy', () => {
  assert.doesNotMatch(source, /window\.|fetch\s*\(|ipcRenderer|\bProxy\b|localStorage/)
  const app = read('web/src/synologyHost.ts')
  assert.doesNotMatch(app, /XDRIVE_NATIVE_FILE_AVAILABILITY_OPTIONS|xDriveFileExplorerThrowUploadFailure/)
  assert.match(app, /unavailableActions: \{/)
})
