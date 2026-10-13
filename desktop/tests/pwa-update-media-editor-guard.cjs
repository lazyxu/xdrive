const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('web/src/pwaWorkloadSafety.ts')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const moduleObject = { exports: {} }
new Function('exports', 'module', js)(moduleObject.exports, moduleObject)
const guard = moduleObject.exports
const emptyActivity = () => ({
  browserUpload: false, browserDownload: false,
  viewerOpen: false, mediaEditorOpen: false,
  unsavedSystemDependencies: false,
})

test('S3D2C: real in-memory activity store reports open media editors as blockers', () => {
  const owner = {}, events = []
  const unsubscribe = guard.subscribeXDrivePwaWindowActivity(
    () => events.push(guard.xDrivePwaWindowActivitySnapshot()),
  )
  guard.xDriveReportPwaWindowActivity(owner, { ...emptyActivity(), mediaEditorOpen: true })
  const current = guard.xDrivePwaWindowActivitySnapshot()
  assert.equal(current.observed, true)
  assert.equal(current.mediaEditorOpen, true)
  assert.deepEqual(guard.xDrivePwaKnownWindowBlockers(current), [
    '正在打开的媒体编辑或创意对话框',
  ])
  assert.equal(events.length, 1)
  guard.xDriveReportPwaWindowActivity(owner, { ...emptyActivity(), mediaEditorOpen: true })
  assert.equal(events.length, 1)
  guard.xDriveClearPwaWindowActivity(owner)
  assert.equal(guard.xDrivePwaWindowActivitySnapshot().observed, false)
  unsubscribe()
})

test('S3D2C: clearing editor dialog does not cancel upload, Viewer, or unsaved config blockers', () => {
  const owner = {}
  const activity = {
    ...emptyActivity(), mediaEditorOpen: true, browserUpload: true,
    viewerOpen: true, unsavedSystemDependencies: true,
  }
  guard.xDriveReportPwaWindowActivity(owner, activity)
  let blockers = guard.xDrivePwaKnownWindowBlockers(guard.xDrivePwaWindowActivitySnapshot())
  assert.equal(blockers.length, 4)
  guard.xDriveReportPwaWindowActivity(owner, { ...activity, mediaEditorOpen: false })
  blockers = guard.xDrivePwaKnownWindowBlockers(guard.xDrivePwaWindowActivitySnapshot())
  assert.equal(blockers.includes('正在打开的媒体编辑或创意对话框'), false)
  assert.equal(blockers.includes('浏览器前台上传'), true)
  assert.equal(blockers.includes('正在打开的 Viewer'), true)
  assert.equal(blockers.includes('未保存的系统依赖配置'), true)
  guard.xDriveClearPwaWindowActivity(owner)
})

test('S3D2C: shared routed media editor sessions explicitly report and clear activity', () => {
  const viewer = read('web/src/WebFileViewerApps.tsx')
  const app = read('web/src/App.tsx')
  for (const token of [
    'const editOpen = Boolean(editingItem)',
    'const creativeOpen = Boolean(creativeItem)',
    'onMediaEditorActivityChange?.(editOpen || creativeOpen)',
    'onMediaEditorActivityChange?.(false)',
    'onMediaEditorActivityChange={onMediaEditorActivityChange}',
    'onMediaEditorActivityChange?: (active: boolean) => void',
  ]) assert.ok(viewer.includes(token), token)
  assert.ok(app.includes('onMediaEditorActivityChange={setMediaEditorActive}'))
  assert.ok(app.includes('const hasBlockingMediaEditor = viewerActive && mediaEditorActive'))
  assert.ok(app.includes('mediaEditorOpen: hasBlockingMediaEditor'))
  assert.ok(app.includes('xDriveReportPwaWindowActivity(pwaActivityOwner.current, {'))
  assert.doesNotMatch(viewer, /skipWaiting\s*\(|location\.reload\s*\(/)
})

test('S3D2C: browser exit warning now covers unsaved settings and editor dialog, without auto-cancel', () => {
  const app = read('web/src/App.tsx')
  const transferSafety = read('web/src/pwaTransferSafety.ts')
  assert.ok(app.includes(
    'const hasBlockingUnloadWork = hasPendingUpload || systemDependenciesDraftDirty || hasBlockingMediaEditor',
  ))
  assert.ok(app.includes('if (!hasBlockingUnloadWork) return'))
  assert.ok(app.includes("window.addEventListener('beforeunload', xDriveWarnBeforeLeavingUpload)"))
  assert.ok(app.includes("window.removeEventListener('beforeunload', xDriveWarnBeforeLeavingUpload)"))
  assert.ok(transferSafety.includes('event.preventDefault()'))
  assert.ok(transferSafety.includes("event.returnValue = ''"))
  assert.doesNotMatch(transferSafety, /cancelTransfer|fetch\s*\(|skipWaiting|api\/v1/)
})

test('S3D2C: Web and Mobile share update safety UX; no forced worker activation', () => {
  const ui = read('web/src/PwaUpdateSection.tsx')
  const docs = read('docs/pwa-delivery.md')
  const peer = read('web/src/pwaPeerActivity.ts')
  assert.ok(ui.includes('媒体编辑/创意对话框与系统依赖草稿'))
  assert.ok(docs.includes('PWA-S3D2C'))
  assert.ok(peer.includes('xDrivePwaKnownWindowBlockers(local).length > 0'))
  assert.doesNotMatch(ui, /skipWaiting|location\.reload|api\/v1/)
  assert.doesNotMatch(peer, /skipWaiting\s*\(|location\.reload\s*\(|api\/v1/)
})
