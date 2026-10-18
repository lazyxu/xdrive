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
const { useXDriveDeferredLoading, XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS } = loaded.exports
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('storage navigation keeps a 300ms quiet window and discards superseded progress', async () => {
  assert.equal(XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS, 300)
  function View({ pending, generation }) {
    const visible = useXDriveDeferredLoading(pending, generation, 100)
    return React.createElement('output', { 'data-visible': visible })
  }
  let view
  const shown = () => view.root.findByType('output').props['data-visible']
  await act(async () => { view = TestRenderer.create(React.createElement(View, { pending: true, generation: 1 })) })
  assert.equal(shown(), false, 'first paint is quiet')
  await act(async () => { await sleep(35) })
  assert.equal(shown(), false, 'a fast request does not render a spinner')
  await act(async () => { view.update(React.createElement(View, { pending: false, generation: 1 })) })
  await act(async () => { await sleep(115) })
  assert.equal(shown(), false, 'a completed request cannot flash a late status')
  await act(async () => { view.update(React.createElement(View, { pending: true, generation: 2 })) })
  await act(async () => { await sleep(130) })
  assert.equal(shown(), true, 'a genuinely slow request shows feedback')
  await act(async () => { view.update(React.createElement(View, { pending: true, generation: 3 })) })
  assert.equal(shown(), false, 'new request cannot inherit previous spinner')
  await act(async () => { view.update(React.createElement(View, { pending: false, generation: 3 })) })
  assert.equal(shown(), false, 'real error/success clears progress immediately')
  await act(async () => { view.unmount() })
})

test('cloud and local workspace have one quiet initial loading state, stable chrome and immediate errors', () => {
  for (const [file, slot] of [
    ['CloudStoragePage.tsx', 'data-xdrive-cloud-storage-loading-slot'],
    ['LocalStoragePage.tsx', 'data-xdrive-local-storage-loading-slot'],
  ]) {
    const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui', file), 'utf8')
    assert.ok(page.includes('const [loading, setLoading] = useState(true)'), file + ': initial first paint must not claim empty')
    assert.ok(page.includes('useXDriveDeferredLoading(loading, requestGeneration)'), file + ': use generation-scoped timer')
    assert.ok(page.includes('setRequestGeneration(value => value + 1)'), file + ': refresh must disarm old timer')
    assert.ok(page.includes('disabled={loading}'), file + ': pending refresh stays disabled even before spinner')
    assert.ok(page.includes('loading={showDelayedLoading}'), file + ': only delayed progress may alter button')
    assert.ok(page.includes('loadingLabel="刷新"'), file + ': refresh text width stays fixed')
    assert.ok(page.includes(slot), file + ': reserve bounded content height before first range')
    assert.ok(page.includes('showDelayedLoading\n              ? <XDriveStatePanel'), file + ': no short-lived spinner')
    assert.ok(page.includes('aria-busy={loading || undefined}'),file + ': first real pending is accessible')
    const errorMarker=file.startsWith('Cloud')
      ? 'data-xdrive-cloud-storage-first-read-error' : 'data-xdrive-local-storage-first-read-error'
    assert.ok(page.includes(errorMarker),file + ': first-read failure keeps the waiting geometry')
    assert.ok(page.includes("minHeight: 180, display: 'grid', placeItems: 'center'"),
      file + ': first error and pending layout must use same minimum height')
    assert.ok(page.includes('<XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>'),
      file + ': true first-read failure must be visible')
    assert.ok(!page.includes("message={loading ? '正在加载"), file + ': no false empty→spinner jump')
  }
  const local = fs.readFileSync(path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx'), 'utf8')
  assert.ok(local.includes('subtitle="管理当前客户端站点缓存'), 'local subtitle must not change after data arrives')
  const headerStart = local.indexOf('<XDriveWorkspaceSurface')
  const headerEnd = local.indexOf('pageActions=', headerStart)
  assert.ok(headerStart >= 0 && headerEnd > headerStart, 'local page header must exist')
  const pageHeader = local.slice(headerStart, headerEnd)
  assert.ok(!pageHeader.includes('subtitle={desktop'),
    'the page header must not switch between Browser and Desktop descriptions after first load')
})