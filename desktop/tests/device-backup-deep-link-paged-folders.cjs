const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const helper = fs.readFileSync(path.join(root, 'ui/shared/src/device-backup-visible-folders.ts'), 'utf8')
const output = ts.transpileModule(helper, {
  fileName: 'device-backup-visible-folders.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
const exportsForTest = {}
new Function('exports', 'require', output.outputText)(exportsForTest, () => {
  throw Error('Device Backup redacted keyset lookup must not import network, Root or mutable Source APIs')
})
const { xDriveDeviceBackupVisibleFolders: visible, xDriveDeviceBackupContainsVisibleSource: has } = exportsForTest
const folder = id => ({ source_id: id, name: 'Folder ' + id, status: 'paused', sync_mode: 'backup' })
const device = (id, ids) => ({ id, name: 'Desktop ' + id, platform: 'windows', connection_state: 'unknown', revoked: false, folders: ids.map(folder) })

test('deep link omitted by 1000-binding overview becomes visible after per-device pages', () => {
  const ownerA = device('a', Array.from({ length: 1000 }, (_, i) => i + 1))
  const ownerB = device('b', [2002])
  const list = [ownerA, ownerB]
  assert.equal(has(list, {}, 1003), false)
  const loaded = { a: { items: Array.from({ length: 1003 }, (_, i) => folder(i + 1)), complete: true } }
  assert.equal(has(list, loaded, 1003), true)
  assert.equal(visible(ownerA, loaded.a).length, 1003)
  assert.equal(has(list, loaded, 2002), true)
  assert.equal(has(list, loaded, 2003), false)
})
test('incomplete zero rows keep preview; complete zero rows suppress it', () => {
  const src = device('a', [1, 2])
  assert.deepEqual(visible(src, { items: [], complete: false }).map(x => x.source_id), [1, 2])
  assert.deepEqual(visible(src, { items: [], complete: true }), [])
  assert.equal(has([src], { a: { items: [], complete: true } }, 1), false)
})
test('stale device overlays and invalid source IDs do not resolve', () => {
  const current = device('current', [3])
  const stale = { previous: { items: [folder(9999)], complete: true } }
  assert.equal(has([current], stale, 9999), false)
  assert.equal(has([current], stale, 3), true)
  for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(has([current], {}, value), false)
})
test('shared MUI deep link effect tracks source-scoped folder loading and refresh', () => {
  const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/DeviceBackupPage.tsx'), 'utf8')
  assert.match(page, /xDriveDeviceBackupContainsVisibleSource\(overview\.devices, folderPages, initialSourceID\)/)
  assert.match(page, /\[initialSourceID, overview, folderPages, histories, loadHistory, source\]/)
  assert.match(page, /folderReadState\.scope === folderScopeRef\.current\.epoch/)
  assert.match(page, /const emptyFolderPages:/)
  assert.match(page, /folderScopeRef\.current\.source !== source/)
  assert.match(page, /folderScopeRef\.current\.refreshID !== refreshID/)
  assert.match(page, /verifiedLocalDeviceID && overview\?\.devices\.some/)
  assert.doesNotMatch(helper, /\b(?:fetch|ipcRenderer|RootFingerprint|sourceOverview|createSource|triggerRun)\b/)
})
