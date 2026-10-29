'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/LocalStoragePage.tsx')
const code = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(code, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
})
assert.deepEqual((compiled.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mocks = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/icons-material/DeleteSweepRounded': 'icon',
  '@mui/icons-material/ExpandMoreRounded': 'icon',
  '@mui/icons-material/ChevronRightRounded': 'icon',
  '@mui/icons-material/RefreshRounded': 'icon',
  '@mui/material': Object.fromEntries(['Box','Chip','IconButton','Stack','Typography']
    .map(x => [x, x.toLowerCase()])),
  '../format': { formatBytes: x => String(x) + ' B' },
  './FolderIcon': { XDriveFolderIcon: 'icon' },
  './ActionButton': { XDriveActionButton: 'action-button' },
  './ConfirmDialog': { XDriveConfirmDialog: 'confirm-dialog' },
  './MetricCards': { XDriveMetricGrid: 'metric-grid', XDriveMetricCard: 'metric-card' },
  './SectionHeader': { XDriveSectionHeader: 'section-header' },
  './StatePanel': { XDriveStatePanel: 'state-panel' },
  './StatusAlert': { XDriveStatusAlert: 'status-alert' },
  './WorkspaceSurface': { XDriveWorkspaceSurface: 'workspace-surface' },
}
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
const fallbackRequire = mod.require.bind(mod)
mod.require = x => Object.hasOwn(mocks, x) ? mocks[x] : fallbackRequire(x)
mod._compile(compiled.outputText, filename)
const Page = mod.exports.XDriveLocalStoragePage

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const browser = value => ({
  supported: true, clear_supported: true, total_used_bytes: value,
  quota_bytes: 4096, cache_bytes: value, cache_entries: 1,
})
const folder = { path: '/local', name: 'local', mode: 'default',
  effective_mode: 'default', file_count: 1, total_bytes: 1, children: [] }
const desktop = {
  supported: true, storagePoliciesSupported: true,
  cacheStats: { supported: true, used_bytes: 32, limit_bytes: 64,
    reclaimable_bytes: 16, reclaimable_files: 1, cached_files: 2,
    pinned_bytes: 2, pinned_files: 1 },
  storageTree: { path:'/', name:'root', mode:'default', effective_mode:'default',
    file_count: 1, total_bytes: 1, children: [folder] },
}
const find = (view, type, condition = () => true) =>
  view.root.findAll(node => node.type === type && condition(node))
const click = (view, title) => {
  const action = find(view, 'action-button', x => x.props.children === title)[0]
  assert.ok(action, 'missing current Host action: ' + title)
  action.props.onClick()
}
const used = view => find(view, 'metric-card',
  x => x.props.title === '站点总占用')[0]?.props.value

for (const operation of ['browser', 'desktop', 'policy']) {
  test('late ' + operation + ' mutation from Host A cannot repaint Host B or trigger an A refresh', async () => {
    const pending = deferred()
    let readsA = 0, readsB = 0, calls = 0
    const sourceA = {
      load: async () => { readsA++; return { browserStorage: browser(100), desktopStorage: desktop } },
      clearBrowserCache: () => { calls++; return pending.promise },
      releaseDesktopCache: () => { calls++; return pending.promise },
      setFolderMode: () => { calls++; return pending.promise },
    }
    const sourceB = {
      load: async () => { readsB++; return { browserStorage: browser(200) } },
      clearBrowserCache: async () => ({ released_bytes: 1 }),
    }
    let view
    try {
      await act(async () => { view = Renderer.create(React.createElement(Page, { source: sourceA })) })
      assert.equal(used(view), '100 B')
      await act(async () => {
        if (operation === 'policy') click(view, '不同步')
        else {
          click(view, operation === 'browser' ? '清理浏览器缓存' : '释放可回收 Desktop 缓存')
          const dialog = find(view, 'confirm-dialog')[0]
          assert.ok(dialog.props.open)
          dialog.props.onConfirm()
        }
      })
      assert.equal(calls, 1)
      await act(async () => { view.update(React.createElement(Page, { source: sourceB })) })
      assert.equal(used(view), '200 B')
      assert.equal(readsB, 1)
      await act(async () => {
        if (operation === 'browser') pending.resolve({released_bytes: 64, cleared_entries: 1})
        else if (operation === 'desktop') pending.resolve({released_files: 1, released_bytes: 16, failed_files: 0})
        else pending.resolve()
        await Promise.resolve()
      })
      assert.equal(readsA, 1, 'old operation must not issue an old-Owner refresh')
      assert.equal(readsB, 1, 'old completion must not invalidate new Host snapshot')
      assert.equal(used(view), '200 B')
      assert.equal(find(view, 'box', x => x.props['data-xdrive-local-storage-operation-notice']).length, 0)
      const clearB = find(view, 'action-button',
        x => x.props.children === '清理浏览器缓存')[0]
      assert.ok(clearB && !clearB.props.disabled, 'old activity must not lock new Host actions')
    } finally {
      pending.resolve()
      if (view) await act(async () => { view.unmount() })
    }
  })
}

test('Host changes retire old pending confirmation and all old action receipts', () => {
  assert.match(code, /activeHostSource\.current = source/)
  assert.match(code, /isCurrentHostAction\(operationSource\)/)
  assert.match(code, /setPendingAction\(null\)\s+setAction\(''\)\s+setError\(''\)\s+setNotice\(''\)/)
  assert.ok((code.match(/if \(!isCurrentHostAction\(operationSource\)\) return/g) ?? []).length === 3)
  assert.doesNotMatch(code, /cancelUpload|cancelBackup|cancelTransfer/)
})
