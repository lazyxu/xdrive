const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const home = read('ui', 'shared', 'src', 'mui', 'HomePage.tsx')
const muiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const desktopHome = read('desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
const webHome = read('web', 'src', 'WebOverviewPage.tsx')
const webApp = read('web', 'src', 'App.tsx')

test('Web and Desktop share one Home presentation surface', () => {
  assert.ok(home.includes('export function XDriveHomePage'))
  assert.ok(muiIndex.includes("export * from './HomePage'"))
  assert.ok(desktopHome.includes('<XDriveHomePage'))
  assert.ok(webHome.includes('<XDriveHomePage'))
  assert.equal(desktopHome.includes('<XDriveMetricGrid'), false, 'Desktop must not keep a second Home presentation')
  assert.equal(webHome.includes('<XDriveMetricGrid'), false, 'Web must not fork the shared Home presentation')
})

test('shared Home owns content-first sections and shared thumbnails', () => {
  for (const token of [
    'title="主页"',
    '需要处理',
    '云端存储',
    '活动任务',
    '快捷操作',
    '最近活动',
    '最近使用',
    '收藏',
    'XDriveFileExplorerThumbnailProvider',
    'XDriveFileExplorerThumbnail',
    'XDriveFileExplorerAvailabilityBadge',
  ]) {
    if (token === '需要处理') {
      assert.ok(home.includes('alerts.length > 0'), 'Home must surface actionable alerts')
      continue
    }
    assert.ok(home.includes(token), 'shared Home missing: ' + token)
  }
})

test('Web exposes Home as a first-class workspace and keeps platform adapters local', () => {
  assert.ok(webApp.includes('useXDriveWebAppRuntime()'))
  assert.ok(webApp.includes("?? 'overview'"))
  assert.ok(webApp.includes("key: 'overview'"))
  assert.ok(webApp.includes("label: '主页'"))
  assert.ok(webApp.includes("appView === 'overview'"))
  assert.ok(webApp.includes('<WebOverviewPage'))
  assert.ok(webHome.includes('api.fileRecent(6)'))
  assert.ok(webHome.includes('api.fileFavorites()'))
  assert.ok(webHome.includes('api.mediaThumbnail(id, requestSignal)'))
  assert.ok(webHome.includes('onOpenDirectory(entry.node.id, entry.crumbs)'))
  assert.ok(webHome.includes('entry.crumbs.slice(0, -1)'))
  assert.ok(webApp.includes('loadDirectory(id, nextCrumbs)'))
  assert.ok(webHome.includes("setAttribute('webkitdirectory', '')"))
  assert.equal(home.includes('window.xdriveDesktop'), false, 'shared Home must not own Desktop IPC')
  assert.equal(home.includes('XDriveApi'), false, 'shared Home must not own Web REST adapters')
})

test('Desktop-only local disk and availability remain outside the shared Home contract', () => {
  assert.ok(desktopHome.includes('getLocalDiskSpace()'))
  assert.ok(desktopHome.includes('getFileAvailabilityBatch(paths)'))
  assert.ok(desktopHome.includes('xDriveFileExplorerAvailabilityFromSnapshot'))
  assert.equal(webHome.includes('getLocalDiskSpace'), false)
  assert.equal(webHome.includes('getFileAvailabilityBatch'), false)
})


test('Home video cards use the same persisted-first poster resolver on Web and Desktop', () => {
  const sharedPoster = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVideoPoster.ts')
  const provider = read('ui', 'shared', 'src', 'mui', 'FileExplorerThumbnail.tsx')
  assert.ok(sharedPoster.includes('export async function xDriveResolveMediaVideoPoster'))
  assert.ok(home.includes('signal?: AbortSignal'), 'shared Home must forward the provider cancellation signal')
  assert.ok(provider.includes('scheduleFileThumbnail((signal) => loadThumbnail(requestedItem, signal))'))
  for (const adapter of [webHome, desktopHome]) {
    assert.ok(adapter.includes("xDriveFileKind(item.name, item.kind) !== 'video'"), 'non-video thumbnails must not open media previews')
    assert.ok(adapter.includes('xDriveResolveMediaVideoPoster({'), 'video Home cards must try persisted poster first')
    assert.ok(adapter.includes('revision: Number(item.revision)'), 'poster backfill must use the current node revision')
    assert.ok(adapter.includes('signal,'), 'Home video work must support cancelling a recycled viewport')
    assert.ok(adapter.includes('loadCached,'), 'warm Home video card must avoid original-video decode')
    assert.ok(adapter.includes('capture: async (requestSignal)'), 'cold Home video card must try bounded frame capture')
    assert.ok(adapter.includes('xDriveCaptureVideoPosterBlob('), 'cold Home capture must use shared bounded helper')
  }
  assert.ok(webHome.includes('api.filePreviewURL(nodeID, requestSignal)'))
  assert.ok(webHome.includes('api.mediaVideoPoster(id, revision, poster, requestSignal)'))
  assert.ok(desktopHome.includes('xDriveDesktopViewportRequest('))
  assert.ok(desktopHome.includes('agent.cloudFilePreviewURL(nodeID)'))
  assert.ok(desktopHome.includes('agent.putMediaVideoPoster(id, revision, bytes)'))
})
