const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const hookPath = path.join(root, 'ui/shared/src/mui/useDeferredLoading.ts')
const source = fs.readFileSync(hookPath, 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
}}).outputText
const loaded = new Module(hookPath, module)
loaded.filename = hookPath
loaded.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
loaded._compile(js, hookPath)
const { useXDriveDeferredPendingLoading, XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS } = loaded.exports
const memories = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryMemories.tsx'), 'utf8')
const cleanup = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryCleanup.tsx'), 'utf8')
const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('Gallery quick pending first read is silent, true 300ms wait shows feedback, and later quick reads never inherit old ring', async () => {
  assert.equal(XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS, 300)
  function View({ pending }) {
    const visible = useXDriveDeferredPendingLoading(pending, 75)
    return React.createElement('output', { 'data-visible': visible })
  }
  let view
  const shown = () => view.root.findByType('output').props['data-visible']
  await act(async () => { view = TestRenderer.create(React.createElement(View, { pending: true })) })
  assert.equal(shown(), false, 'cold first frame remains quiet')
  await act(async () => { await sleep(20) })
  assert.equal(shown(), false)
  await act(async () => { view.update(React.createElement(View, { pending: false })) })
  await act(async () => { await sleep(100) })
  assert.equal(shown(), false, 'a completed read cannot show a late spinner')
  await act(async () => { view.update(React.createElement(View, { pending: true })) })
  assert.equal(shown(), false, 'fresh pending cycle must never inherit the prior state')
  await act(async () => { await sleep(110) })
  assert.equal(shown(), true, 'sustained real wait does show progress')
  await act(async () => { view.update(React.createElement(View, { pending: false })) })
  assert.equal(shown(), false)
  await act(async () => { view.update(React.createElement(View, { pending: true })) })
  assert.equal(shown(), false, 'the next pending cycle must be quiet again')
  await act(async () => { view.unmount() })
})

test('Memories and Cleanup first read preserve fixed slots without instant Circle progress', () => {
  assert.ok(memories.includes('data-xdrive-gallery-memories-first-read'))
  assert.ok(memories.includes('useXDriveDeferredPendingLoading('))
  assert.ok(memories.includes('Boolean(loading) && memories.length === 0'))
  assert.ok(memories.includes('showFirstReadLoading ? <CircularProgress size={28} /> : null'))
  assert.ok(cleanup.includes('data-xdrive-gallery-cleanup-first-read'))
  assert.ok(cleanup.includes('useXDriveDeferredPendingLoading(firstReadPending)'))
  assert.ok(cleanup.includes('showFirstReadLoading ? <CircularProgress size={28} /> : null'))
  assert.ok(memories.includes('minHeight: 180'))
  assert.ok(cleanup.includes('minHeight: 180'))
  assert.ok(gallery.includes('<XDriveMediaGalleryMemories'))
  assert.ok(gallery.includes('<XDriveMediaGalleryCleanup'))
})

test('Cleanup never advertises absence of advice before a real accepted canonical burst list', () => {
  assert.ok(cleanup.includes('if (bursts === null)'))
  assert.ok(cleanup.includes('连拍清理结果尚未确认，请重新检查。'))
  const confirmedZero = cleanup.indexOf('if (burstGroups.length === 0)')
  const priorNoData = cleanup.indexOf('if (bursts === null)')
  assert.ok(confirmedZero > priorNoData, 'zero claims require confirmed canonical response')
  assert.ok(cleanup.includes('当前已索引素材暂时没有连拍清理建议'))
  assert.ok(cleanup.includes('<XDriveMediaGalleryCleanupIndexStatus'))
  assert.ok(cleanup.includes('{indexCoverage}'))
  assert.ok(cleanup.includes('onRefresh ? <Button onClick={onRefresh}'))
})

test('Cleanup pagination progress preserves control text and button dimensions without delaying real requests', () => {
  assert.ok(cleanup.includes("useXDriveDeferredPendingLoading(loadingMore === 'burst')"))
  assert.ok(cleanup.includes("disabled={Boolean(loadingMore)}"))
  assert.ok(cleanup.includes("onClick={onLoadMoreBurst}"))
  assert.ok(cleanup.includes('width: 16, height: 16'))
  assert.ok(cleanup.includes('showMoreLoading ? <CircularProgress size={16} /> : null'))
  assert.ok(cleanup.includes('加载更多连拍组'))
  assert.equal(cleanup.includes("{loadingMore === 'burst' ? '正在加载' : '加载更多连拍组'}"), false)
  assert.ok(cleanup.includes('<XDriveMediaGalleryCoverThumbnail'))
  assert.ok(memories.includes('<XDriveMediaGalleryCoverThumbnail'))
})
