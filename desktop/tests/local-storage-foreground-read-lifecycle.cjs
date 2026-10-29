'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx')
const source = fs.readFileSync(filename, 'utf8')
const js = ts.transpileModule(source, { fileName: filename, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText
const mocks = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/icons-material/DeleteSweepRounded': 'icon',
  '@mui/icons-material/ExpandMoreRounded': 'icon',
  '@mui/icons-material/ChevronRightRounded': 'icon',
  '@mui/icons-material/RefreshRounded': 'icon',
  '@mui/material': Object.fromEntries(
    ['Box','Chip','IconButton','Stack','Typography'].map(name => [name, name.toLowerCase()])),
  '../format': { formatBytes: n => String(n) + ' B' },
  './FolderIcon': { XDriveFolderIcon: 'icon' },
  './ActionButton': { XDriveActionButton: 'action-button' },
  './ConfirmDialog': { XDriveConfirmDialog: 'confirm-dialog' },
  './MetricCards': { XDriveMetricCard: 'metric-card', XDriveMetricGrid: 'metric-grid' },
  './SectionHeader': { XDriveSectionHeader: 'section-header' },
  './StatePanel': { XDriveStatePanel: 'state-panel' },
  './StatusAlert': { XDriveStatusAlert: 'status-alert' },
  './WorkspaceSurface': { XDriveWorkspaceSurface: 'workspace-surface' },
}
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
const originalRequire = mod.require.bind(mod)
mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name)
mod._compile(js, filename)
const Page = mod.exports.XDriveLocalStoragePage
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const snapshot = size => ({ browserStorage: {
  supported: true, clear_supported: false, cache_bytes: size,
  total_used_bytes: size, quota_bytes: 1000, cache_entries: 1,
} })
const metrics = view => view.root.findAll(x => x.type === 'metric-card')
const amount = view => metrics(view).find(x => x.props.title === '站点总占用')?.props.value
const refresh = view => view.root.find(x => x.type === 'workspace-surface').props.pageActions

test('local storage Owner A → B aborts A and never paints its delayed first snapshot', async () => {
  const a = deferred(), b = deferred()
  const readsA = [], readsB = []
  const sourceA = { load: signal => { readsA.push(signal); return a.promise } }
  const sourceB = { load: signal => { readsB.push(signal); return b.promise } }
  let view
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Page, { source: sourceA })) })
    assert.equal(readsA.length, 1)
    assert.equal(readsA[0].aborted, false)
    await act(async () => { view.update(React.createElement(Page, { source: sourceB })) })
    assert.equal(readsA[0].aborted, true, 'old Owner request must receive transport abort')
    assert.equal(readsB.length, 1)
    assert.equal(readsB[0].aborted, false, 'incoming Owner must own an un-aborted read')
    assert.equal(metrics(view).length, 0, 'before B confirms, no A content may be shown')
    await act(async () => { b.resolve(snapshot(220)); await Promise.resolve() })
    assert.equal(amount(view), '220 B')
    await act(async () => { a.resolve(snapshot(110)); await Promise.resolve() })
    assert.equal(amount(view), '220 B', 'uncooperative A cannot replace B')
  } finally {
    a.resolve(snapshot(110)); b.resolve(snapshot(220))
    if (view) await act(async () => { view.unmount() })
  }
})

test('local storage refresh is latest-wins and unmount aborts the current transport', async () => {
  const second = deferred()
  const calls = []
  let view
  const sourcePort = { load: signal => {
    calls.push(signal)
    if (calls.length === 1) return Promise.resolve(snapshot(10))
    if (calls.length === 2) return second.promise
    return Promise.resolve(snapshot(30))
  } }
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Page, { source: sourcePort })) })
    assert.equal(amount(view), '10 B')
    await act(async () => { refresh(view).props.onClick(); await Promise.resolve() })
    assert.equal(calls.length, 2)
    assert.equal(amount(view), '10 B', 'pending refresh preserves the accepted content')
    await act(async () => { refresh(view).props.onClick(); await Promise.resolve() })
    assert.equal(calls.length, 3)
    assert.equal(calls[1].aborted, true, 'intermediate refresh transport is cancelled')
    assert.equal(amount(view), '30 B')
    await act(async () => { second.resolve(snapshot(20)); await Promise.resolve() })
    assert.equal(amount(view), '30 B', 'late intermediate result is never committed')
    await act(async () => { view.unmount() })
    assert.equal(calls[2].aborted, false, 'already-settled response need not be aborted retroactively')
  } finally {
    second.resolve(snapshot(20))
    if (view) await act(async () => { view.unmount() })
  }
})

test('source port and Web adapter separate disposable reads from intentional cache mutations', () => {
  const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
  assert.match(source, /load: \(signal\?: AbortSignal\) => Promise<XDriveLocalStorageSnapshot>/)
  assert.match(source, /activeRead\.current\?\.abort\(\)/)
  assert.match(source, /const next = await source\.load\(controller\.signal\)/)
  assert.match(source, /readGeneration\.current \+= 1/)
  assert.match(source, /if \(!mounted\.current\) return/,
    'late durable completion cannot initiate unmounted page GETs')
  assert.match(source, /setSnapshotReceipt\(\{ owner: source, value: next \}\)/)
  assert.match(web, /load: async \(signal\?: AbortSignal\) => \{/)
  assert.match(web, /const browserStorage = await createWebBrowserStorageSnapshot\(\)/)
  assert.match(web, /signal\?\.throwIfAborted\(\)\s*return \{ browserStorage \}/)
  assert.ok(source.includes('await source.clearBrowserCache()'))
  assert.ok(source.includes('await source.releaseDesktopCache()'))
  assert.ok(source.includes('await source.setFolderMode(path, mode)'))
  assert.doesNotMatch(source, /cancelUpload|cancelDownload|cancelBackup|cancelTransfer|terminateWorker/)
})
