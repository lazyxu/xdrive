'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')

const mui = new Proxy({}, { get: (_target, name) => String(name) })
const components = {
  './ActionButton': { XDriveActionButton: 'ActionButton' },
  './ConfirmDialog': { XDriveConfirmDialog: 'ConfirmDialog' },
  './MetricCards': { XDriveMetricCard: 'MetricCard', XDriveMetricGrid: 'MetricGrid' },
  './SectionHeader': { XDriveSectionHeader: 'SectionHeader' },
  './StatePanel': { XDriveStatePanel: 'StatePanel' },
  './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  './StorageDistributionChart': { XDriveStorageDistributionChart: 'StorageDistributionChart' },
  // A prop containing React elements is not automatically mounted by a host mock:
  // render the actual pageActions slot so refresh behavior is exercised.
  './WorkspaceSurface': {
    XDriveWorkspaceSurface: ({ pageActions, children, ...props }) =>
      React.createElement('WorkspaceSurface', props, pageActions, children),
  },
}
function originalPage(filename, exportName) {
  const file = path.join(root, 'ui/shared/src/mui', filename)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(
    mod, mod.exports, dependency => {
      if (dependency === 'react') return React
      if (dependency === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (dependency === '@mui/material') return mui
      if (dependency.startsWith('@mui/icons-material/')) return { __esModule: true, default: 'Icon' }
      if (dependency === '../format') return { formatBytes: value => String(value) + ' B' }
      if (Object.hasOwn(components, dependency)) return components[dependency]
      throw Error('Unexpected original Storage Page dependency: ' + dependency)
    },
  )
  assert.equal(typeof mod.exports[exportName], 'function')
  return mod.exports[exportName]
}
const cases = [
  {
    name: 'Cloud',
    Component: originalPage('CloudStoragePage.tsx', 'XDriveCloudStoragePage'),
    cold: 'data-xdrive-cloud-storage-loading-slot',
    error: 'data-xdrive-cloud-storage-first-read-error',
    value: {
      quota: { physical_used_bytes: 1, quota_bytes: 0, available_bytes: 100,
        logical_file_bytes: 1, over_quota: false, trash_bytes: 0,
        history_bytes: 0, reserved_bytes: 0 },
    },
  },
  {
    name: 'Local',
    Component: originalPage('LocalStoragePage.tsx', 'XDriveLocalStoragePage'),
    cold: 'data-xdrive-local-storage-loading-slot',
    error: 'data-xdrive-local-storage-first-read-error',
    value: { browserStorage: { supported: false, clear_supported: false, reason: 'fixture unavailable' } },
  },
]
const defer = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const nodes = (view, marker) =>
  view.root.findAll(node => Object.prototype.hasOwnProperty.call(node.props ?? {}, marker))
const badLoading = view => view.root.findAll(node =>
  (node.type === 'StatePanel' && (
    node.props.loading || String(node.props.message || '').includes('正在加载')
  )) || node.type === 'CircularProgress')
const action = view => view.root.findAllByType('ActionButton')[0]
const assertCold = (view, type, label) => {
  const pending = nodes(view, type.cold)
  assert.equal(pending.length, 1, label + ': exactly one cold slot')
  assert.equal(pending[0].props.sx.minHeight, 180, label + ': 180px geometry')
  assert.equal(pending[0].props['aria-busy'], true, label + ': real pending semantic')
  assert.equal(badLoading(view).length, 0, label + ': no decorative loading')
  assert.equal(action(view).props.disabled, true, label + ': duplicate refresh disabled')
  assert.equal(action(view).props.loading, undefined, label + ': stable refresh icon')
}
test('P81 actual Cloud/Local first GET stays silent after 360ms, then keeps accepted data on slow refresh', async () => {
  for (const type of cases) {
    const initial = defer(), refresh = defer()
    let loads = 0, view
    const source = { load: () => (++loads === 1 ? initial.promise : refresh.promise) }
    try {
      await act(async () => { view = Renderer.create(React.createElement(type.Component, { source })) })
      assertCold(view, type, type.name + ' idle/initial')
      await act(async () => { await delay(365) })
      assertCold(view, type, type.name + ' held >300ms')
      await act(async () => { initial.resolve(type.value); await initial.promise })
      assert.equal(nodes(view, type.cold).length, 0, 'authorized snapshot replaces cold slot')
      assert.equal(badLoading(view).length, 0)
      assert.equal(action(view).props.disabled, false)
      await act(async () => { action(view).props.onClick() })
      assert.equal(nodes(view, type.cold).length, 0, 'do not replace verified content with pending')
      assert.equal(action(view).props.disabled, true)
      await act(async () => { await delay(365) })
      assert.equal(nodes(view, type.cold).length, 0, 'held refresh keeps accepted content')
      assert.equal(badLoading(view).length, 0, 'no deferred refresh page spinner')
      assert.equal(action(view).props.loading, undefined, 'stable refresh icon even after 300ms')
      await act(async () => { refresh.resolve(type.value); await refresh.promise })
      assert.equal(action(view).props.disabled, false)
    } finally {
      if (view) await act(async () => { view.unmount() })
    }
  }
})
test('P81 actual Cloud/Local first failure preserves 180px error and can retry to accepted data', async () => {
  for (const type of cases) {
    let calls = 0, view
    const source = { load: () => (++calls === 1
      ? Promise.reject(new Error('fixture read failed')) : Promise.resolve(type.value)) }
    try {
      await act(async () => { view = Renderer.create(React.createElement(type.Component, { source })) })
      assert.equal(nodes(view, type.cold).length, 0, 'terminal failure is not unverified')
      const failure = nodes(view, type.error)
      assert.equal(failure.length, 1, 'failure is visible in a stable slot')
      assert.equal(failure[0].props.sx.minHeight, 180)
      assert.ok(view.root.findAll(node => node.type === 'StatusAlert' &&
        node.props.tone === 'bad').length > 0, 'real network error remains visible')
      assert.equal(badLoading(view).length, 0)
      assert.equal(action(view).props.disabled, false, 'retry available')
      await act(async () => { action(view).props.onClick() })
      assert.equal(nodes(view, type.error).length, 0)
      assert.equal(nodes(view, type.cold).length, 0)
      assert.equal(action(view).props.disabled, false)
    } finally {
      if (view) await act(async () => { view.unmount() })
    }
  }
})
