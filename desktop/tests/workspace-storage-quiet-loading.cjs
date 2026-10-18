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

test('cold Cloud and Local Storage never mount a timed or false-empty page, even after 300ms', () => {
  for (const [file, slot, label] of [
    ['CloudStoragePage.tsx', 'data-xdrive-cloud-storage-loading-slot', '云端'],
    ['LocalStoragePage.tsx', 'data-xdrive-local-storage-loading-slot', '本地'],
  ]) {
    const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui', file), 'utf8')
    assert.ok(page.includes('const [loading, setLoading] = useState(true)'), file + ': first paint is not verified empty')
    assert.equal(page.includes('useXDriveDeferredLoading'), false, file + ': a cold navigation may never schedule an ornamental timer')
    assert.equal(page.includes('showDelayedLoading'), false, file + ': remove the slow GET spinner as well')
    assert.equal(page.includes('正在加载' + label + '存储信息…'), false)
    assert.equal(page.includes('message="暂无' + label + '存储信息"'), false, file + ': null is not an authorized empty read')
    assert.ok(page.includes('disabled={loading}'), file + ': duplicate refresh is still blocked')
    assert.ok(page.includes('startIcon={<RefreshRoundedIcon />}'), file + ': refresh icon remains stable')
    assert.ok(page.includes(slot), file + ': first read reserves fixed geometry')
    assert.ok(page.includes('aria-busy={loading || undefined}'), file + ': real pending state remains accessible')
    const coldStart = page.indexOf(slot)
    const coldEnd = page.indexOf('/>', coldStart)
    assert.ok(coldEnd > coldStart, file + ': the quiet cold slot is self-contained')
    const coldSlot = page.slice(coldStart, coldEnd)
    assert.ok(coldSlot.includes('minHeight: 180'), file + ': reserve the original 180px')
    assert.ok(!coldSlot.includes('XDriveStatePanel'), file + ': no slow-GET status panel')
    const errorMarker = file.startsWith('Cloud')
      ? 'data-xdrive-cloud-storage-first-read-error' : 'data-xdrive-local-storage-first-read-error'
    assert.ok(page.includes(errorMarker), file + ': original true terminal error remains')
    assert.ok(page.includes("minHeight: 180, display: 'grid', placeItems: 'center'"),
      file + ': failure and unverified use the same 180px geometry')
    assert.ok(page.includes('<XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>'),
      file + ': true failure is visible')
  }
  const local = fs.readFileSync(path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx'), 'utf8')
  assert.ok(local.includes('subtitle="管理当前客户端站点缓存'), 'local subtitle must remain unchanged')
  const headerStart = local.indexOf('<XDriveWorkspaceSurface')
  const headerEnd = local.indexOf('pageActions=', headerStart)
  assert.ok(headerStart >= 0 && headerEnd > headerStart)
  assert.ok(!local.slice(headerStart, headerEnd).includes('subtitle={desktop'))
})
