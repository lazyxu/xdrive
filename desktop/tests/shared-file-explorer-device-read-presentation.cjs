'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function load(file, deps = {}) {
  const output = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports, mod, name => {
      if (!Object.prototype.hasOwnProperty.call(deps, name)) {
        throw Error('Unexpected dependency: ' + name)
      }
      return deps[name]
    },
  )
  return mod.exports
}
const availability = load('ui/shared/src/file-explorer-availability.ts')
const hydration = load('ui/shared/src/mui/FileExplorerHydrationStatus.ts')
const file = 'ui/shared/src/mui/FileExplorerDeviceReadPresentation.ts'
const ui = load(file, {
  '../file-explorer-availability': availability,
  './FileExplorerHydrationStatus': hydration,
})
const state = {
  Path: 'C:\\Photos\\trip.jpg', Mode: 'local',
  Pinned: false, OnlineOnly: false, AvailableOffline: true,
  Mixed: false, Syncing: false, InSync: true,
}
const label = (value, syncing) => hydration.xDriveFileExplorerDeviceStatusLabel(value, syncing)

test('missing or failed Agent status never means file corruption or successful sync', () => {
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(undefined, new Map(), label), undefined)
  assert.equal(ui.xDriveFileExplorerDeviceReadAvailability(undefined, new Map()), undefined)
  const failed = { error: 'private-path-should-not-display' }
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(failed, new Map(), label), '状态异常')
  const badge = ui.xDriveFileExplorerDeviceReadAvailability(failed, new Map())
  assert.equal(badge.kind, 'error')
  assert.doesNotMatch(JSON.stringify(badge), /private-path-should-not-display/)
})

test('same device path hydration wins over idle status without inventing a durable transfer', () => {
  const snapshot = { state }
  const progress = new Map([['c:/photos/trip.jpg', 37.5]])
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(snapshot, progress, label), '正在同步')
  const badge = ui.xDriveFileExplorerDeviceReadAvailability(snapshot, progress)
  assert.equal(badge.kind, 'syncing')
  assert.equal(badge.progress, 37.5)
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(snapshot, new Map(), label), '已同步')
  assert.equal(ui.xDriveFileExplorerDeviceReadAvailability(snapshot, new Map()).kind, 'local')
})

test('unmeasured hydration and UNC vs local paths cannot invent progress or cross device', () => {
  const entry = { state: { ...state, Path: '\\\\NAS\\share\\file', InSync: false } }
  const local = new Map([['/nas/share/file', 92]])
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(entry, local, label), '待同步')
  const realUNC = new Map([['//nas/share/file', null]])
  assert.equal(ui.xDriveFileExplorerDeviceReadStatus(entry, realUNC, label), '正在同步')
  const badge = ui.xDriveFileExplorerDeviceReadAvailability(entry, realUNC)
  assert.equal(badge.kind, 'syncing')
  assert.equal('progress' in badge, false)
})

test('ordinary verified device flags retain mixed, pinned, cloud and online-only precedence', () => {
  const badge = value => ui.xDriveFileExplorerDeviceReadAvailability({
    state: { ...state, ...value },
  }, new Map()).kind
  assert.equal(badge({ Mixed: true, Pinned: true }), 'mixed')
  assert.equal(badge({ Pinned: true }), 'always-local')
  assert.equal(badge({ OnlineOnly: true }), 'online-only')
  assert.equal(badge({ AvailableOffline: false }), 'cloud')
  assert.equal(badge({ Syncing: true }), 'syncing')
})

test('shared device UI projection is data-only; Desktop still owns every native read', () => {
  const source = read(file)
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  for (const method of [
    'xDriveFileExplorerDeviceReadStatus(', 'xDriveFileExplorerDeviceReadAvailability(',
  ]) assert.match(desktop, new RegExp(method.replace('(', '\\(')))
  assert.match(desktop, /hostPort\.browse\.getFileAvailabilityBatch\(paths\)/)
  assert.match(desktop, /setFileAvailability\(/)
  assert.doesNotMatch(source, /fetch\s*\(|window\.|ipcRenderer|setFileAvailability|cancelTransfer/)
  assert.match(read('ui/shared/src/mui/index.tsx'),
    /export \* from '\.\/FileExplorerDeviceReadPresentation'/)
})
