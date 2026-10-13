const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
function load(src) {
  const js = ts.transpileModule(src, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', js)(module.exports, module)
  return module.exports
}
const source = read('web/src/pwaWorkloadSafety.ts')
const guard = load(source)
const transfers = load(read('web/src/pwaTransferSafety.ts'))

test('S3D2A: unobserved and no known blockers never authorize activation', () => {
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().observed, false)
  assert.deepEqual(guard.xDrivePwaKnownWindowBlockers(guard.xDrivePwaWindowActivitySnapshot()),
    ['当前窗口活动尚不可确认'])
  const owner = {}
  guard.xDriveReportPwaWindowActivity(owner, {
    browserUpload: false, browserDownload: false, viewerOpen: false,
    unsavedSystemDependencies: false,
  })
  assert.deepEqual(guard.xDrivePwaKnownWindowBlockers(guard.xDrivePwaWindowActivitySnapshot()), [])
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().observed, true)
  guard.xDriveClearPwaWindowActivity(owner)
})

test('S3D2A: changes only notify once and cover uploads, downloads, Viewer and dirty settings', () => {
  const owner = {}, observed = []
  const unsubscribe = guard.subscribeXDrivePwaWindowActivity(() => {
    observed.push(guard.xDrivePwaWindowActivitySnapshot())
  })
  const active = { browserUpload: true, browserDownload: true,
    viewerOpen: true, unsavedSystemDependencies: true }
  guard.xDriveReportPwaWindowActivity(owner, active)
  guard.xDriveReportPwaWindowActivity(owner, { ...active })
  assert.equal(observed.length, 1)
  assert.deepEqual(guard.xDrivePwaKnownWindowBlockers(observed[0]), [
    '浏览器前台上传', '浏览器前台下载', '正在打开的 Viewer', '未保存的系统依赖配置',
  ])
  guard.xDriveClearPwaWindowActivity(owner)
  assert.equal(observed.length, 2)
  assert.equal(observed[1].observed, false)
  unsubscribe()
})

test('S3D2A: logout/fast-switch stale cleanup cannot clear a new FileManager', () => {
  const oldOwner = {}, newOwner = {}
  const idle = { browserUpload: false, browserDownload: false, viewerOpen: false,
    unsavedSystemDependencies: false }
  guard.xDriveReportPwaWindowActivity(oldOwner, idle)
  guard.xDriveReportPwaWindowActivity(newOwner, { ...idle, viewerOpen: true })
  guard.xDriveClearPwaWindowActivity(oldOwner)
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().viewerOpen, true)
  // Identical snapshot must STILL transfer the cleanup lease.
  guard.xDriveReportPwaWindowActivity(oldOwner, { ...idle, viewerOpen: true })
  guard.xDriveClearPwaWindowActivity(newOwner)
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().viewerOpen, true)
  guard.xDriveClearPwaWindowActivity(oldOwner)
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().observed, false)
})

test('S3D2A: browser-owned downloads are separate from uploads/Server durable jobs', () => {
  const alive = ['queued', 'running', 'retrying', 'cancelling']
  for (const state of alive) {
    assert.equal(transfers.xDriveHasPendingBrowserDownload([{ direction: 'download', state }]), true)
    assert.equal(transfers.xDriveHasPendingBrowserUpload([{ direction: 'download', state }]), false)
  }
  for (const state of ['failed', 'cancelled', 'completed']) {
    assert.equal(transfers.xDriveHasPendingBrowserDownload([{ direction: 'download', state }]), false)
  }
  assert.equal(transfers.xDriveHasPendingBrowserDownload([{ direction: 'server', state: 'running' }]), false)
  assert.equal(transfers.xDriveHasPendingBrowserDownload([]), false)
})

test('S3D2A: shared Web/Mobile wiring is observer only, no activation or private persistence', () => {
  const app = read('web/src/App.tsx')
  const section = read('web/src/PwaUpdateSection.tsx')
  const docs = read('docs/pwa-delivery.md')
  for (const snippet of [
    'xDriveHasPendingBrowserUpload(transfers)', 'xDriveHasPendingBrowserDownload(transfers)',
    'xDriveReportPwaWindowActivity(pwaActivityOwner.current, {',
    'browserUpload: hasPendingUpload', 'browserDownload: hasPendingDownload',
    'viewerOpen: viewerActive', 'unsavedSystemDependencies: systemDependenciesDraftDirty',
    'xDriveClearPwaWindowActivity(pwaActivityOwner.current)',
  ]) assert.ok(app.includes(snippet), snippet)
  for (const snippet of [
    'subscribeXDrivePwaWindowActivity', 'xDrivePwaWindowActivitySnapshot',
    'xDrivePwaKnownWindowBlockers', 'data-xdrive-pwa-activity-guard',
    "state.phase === 'waiting'", '无法证明其他窗口',
  ]) assert.ok(section.includes(snippet), snippet)
  assert.match(docs, /PWA-S3D2A/)
  assert.doesNotMatch(source, /BroadcastChannel|localStorage|sessionStorage|api\/v1|postMessage|skipWaiting|location\.reload/)
  assert.doesNotMatch(section, /skipWaiting|location\.reload|api\/v1/)
})
