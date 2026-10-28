'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.resolve(__dirname, '../../ui/shared/src/mui/FileExplorerHydrationStatus.ts')
const source = fs.readFileSync(file, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const instance = { exports: {} }
new Function('module', 'exports', compiled.outputText)(instance, instance.exports)
const { xDriveFileExplorerDeviceStatusLabel: label,
  xDriveFileExplorerDeviceHydrationPathKey: key,
  xDriveFileExplorerDeviceHydrationProgress: progress } = instance.exports

test('local status is an explicit Host-provided availability projection', () => {
  assert.equal(label({ InSync: true }), '已同步')
  assert.equal(label({ InSync: false }), '待同步')
  assert.equal(label({ InSync: true }, true), '正在同步')
  assert.equal(label({ Mode: 'syncing', InSync: true }), '正在同步')
  assert.equal(label({ Syncing: true }), '正在同步')
})

test('Windows native, extended path and UNC aliases normalize identically', () => {
  assert.equal(key('C:\\Users\\Owner\\album.jpg'), key('\\\\?\\C:\\Users\\Owner\\album.jpg'))
  assert.equal(key('\\\\?\\UNC\\NAS\\Share\\PHOTO.JPG'),
    key('\\\\NAS\\Share\\photo.jpg'))
  assert.equal(key('   C:\\Owner\\Folder\\  '), 'c:/owner/folder')
  assert.equal(key(''), '')
})

test('only the first active hydration progress is projected from actual transfer bytes', () => {
  const values = progress([
    { kind: 'upload', state: 'running', path: 'C:/owner/photo.jpg', bytes_total: 10, bytes_done: 10 },
    { kind: 'hydration', state: 'completed', path: 'C:/owner/photo.jpg', bytes_total: 10, bytes_done: 10 },
    { kind: 'hydration', state: 'running', path: 'C:/owner/photo.jpg', bytes_total: 80, bytes_done: 20 },
    { kind: 'hydration', state: 'running', path: 'c:\\owner\\photo.jpg', bytes_total: 100, bytes_done: 100 },
    { kind: 'hydration', state: 'running', path: 'C:/owner/unknown.jpg', bytes_total: 0, bytes_done: 5 },
    { kind: 'hydration', state: 'running', path: 'C:/owner/over.jpg', bytes_total: 100, bytes_done: 500 },
    { kind: 'hydration', state: 'running', path: 'C:/owner/invalid.jpg', bytes_total: NaN, bytes_done: NaN },
  ])
  assert.equal(values.size, 4)
  assert.equal(values.get('c:/owner/photo.jpg'), 25)
  assert.equal(values.get('c:/owner/unknown.jpg'), null)
  assert.equal(values.get('c:/owner/over.jpg'), 100)
  assert.equal(values.get('c:/owner/invalid.jpg'), null)
})

test('shared module cannot create Agent work or expose user and transport identifiers', () => {
  for (const forbidden of ['window.xdriveDesktop', 'ipcRenderer', 'Authorization',
    'fetch(', 'localStorage', 'getTransfers(', 'cancelTransfer(', 'setInterval(']) {
    assert.equal(source.includes(forbidden), false, forbidden)
  }
  const desktop = fs.readFileSync(path.resolve(__dirname,
    '../src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  assert.match(desktop, /return xDriveFileExplorerDeviceHydrationProgress\(transfers\)/)
  assert.match(desktop, /useMemo\(\s*\(\) => desktopActiveHydrationProgress\(transfers\)/)
})
