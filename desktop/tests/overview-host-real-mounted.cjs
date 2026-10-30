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
const filename = path.join(root, 'ui/shared/src/mui/OverviewPage.tsx')
const source = fs.readFileSync(filename, 'utf8')
const desktopPort = fs.readFileSync(
  path.join(root, 'desktop/src/renderer/desktopOverviewAdapter.ts'), 'utf8')
const outlet = fs.readFileSync(
  path.join(root, 'ui/shared/src/mui/XDriveAppPageOutlet.tsx'), 'utf8')
const desktop = fs.readFileSync(
  path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')

const result = ts.transpileModule(source, {
  fileName: filename,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
})
const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')), [],
  'shared Overview TSX must have valid syntax')
const dependencies = {
  '../format': { formatBytes: n => String(n) },
  '../background-tasks': {
    xDriveBackgroundTaskKindLabel: x => x,
    xDriveBackgroundTaskStateLabel: x => x,
  },
  '../file-explorer-availability': {
    xDriveFileExplorerAvailabilityError: () => ({ mode: 'error' }),
    xDriveFileExplorerAvailabilityFromSnapshot: x => x,
  },
  '../file-operations': { xDriveFileOperationTypeLabel: x => x },
  '../transfers': {
    xDriveTransferKindLabel: x => x,
    xDriveTransferRootTasks: x => x,
  },
  './HomePage': {
    XDriveHomePage: props => React.createElement('canonical-home', props),
  },
}
// Load the newly extracted, real shared projection modules rather than
// creating duplicate Overview behavior in this mounted test harness.
for (const [specifier, filename] of [
  ['./OverviewSharedModels', 'ui/shared/src/mui/OverviewSharedModels.ts'],
  ['./OverviewFileProjection', 'ui/shared/src/mui/OverviewFileProjection.ts'],
]) {
  const sourceFile = path.join(root, filename)
  const compiled = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
    fileName: sourceFile,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\\n')), [])
  const actual = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    actual, actual.exports, name => {
      assert.ok(Object.hasOwn(dependencies, name),
        'unexpected extracted Overview dependency: ' + name)
      return dependencies[name]
    },
  )
  dependencies[specifier] = actual.exports
}
const loaded = { exports: {} }
new Function('module', 'exports', 'require', result.outputText)(
  loaded, loaded.exports, name => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw Error('Unexpected common Overview dependency: ' + name)
  },
)
const Overview = loaded.exports.XDriveOverviewPage
assert.equal(typeof Overview, 'function')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function item(name) {
  return { path: name, crumbs: [], node: {
    id: 11, name, type: 'file', size: 8, revision: 1,
    created_at: '2026-10-27', updated_at: '2026-10-27',
  }, accessed_at: '2026-10-27', favorited_at: '2026-10-27' }
}
function props(port, server = 'a', username = 'alice') {
  return {
    port, status: { server, username, sync_status: 'idle' }, quota: null,
    activeTaskCount: 0, transfers: [], fileOperations: [], backgroundTasks: [],
    activityRevision: 'unchanged', recentSupported: true,
    favoritesSupported: true, fileAvailabilitySupported: false,
    localDiskSpaceSupported: false, folderUploadSupported: false,
    openFolderLoading: false, onOpenFolder() {}, onOpenFiles() {},
    onRequestFileAction() {}, onOpenGallery() {}, onOpenTransfers() {},
    onOpenConflicts() {}, onError() {},
  }
}
function home(view) { return view.root.findByType('canonical-home').props }

test('Overview shares a real Home without Electron IPC or a second route renderer', () => {
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer/)
  assert.match(desktopPort, /xDriveDesktopViewportRequest\(signal,/)
  assert.match(desktopPort, /window\.xdriveDesktop\.agent\.cloudFileRecent\(limit, requestID\)/,
    'Desktop shared Home must use request-owned cancellable Recent GET')
  assert.match(desktopPort, /xDriveResolveMediaVideoPoster\(/)
  assert.match(source, /recentSnapshot\?\.scope === overviewLifecycleKey/)
  assert.match(source, /favoriteSnapshot\?\.scope === overviewLifecycleKey/)
  assert.match(source, /const EMPTY_RECENT:/)
  assert.match(source, /const EMPTY_FAVORITES:/)
  assert.match(outlet, /<XDriveOverviewPage key=\{revision\}/)
  assert.match(desktop, /overviewPage: \{/)
  assert.doesNotMatch(desktop, /<DesktopOverviewPage/)
})

test('Overview never exposes stale A Owner rows on account switch or late promise completion', async () => {
  const aRecent = deferred(), aFavorites = deferred()
  const bRecent = deferred(), bFavorites = deferred()
  let owner = 'A', recentCalls = 0, favoriteCalls = 0
  const port = {
    cloudFileRecent() { recentCalls++; return owner === 'A' ? aRecent.promise : bRecent.promise },
    cloudFileFavorites() { favoriteCalls++; return owner === 'A' ? aFavorites.promise : bFavorites.promise },
    getFileAvailabilityBatch() { throw Error('unsupported') },
    getLocalDiskSpace() { throw Error('unsupported') },
    openPath() { throw Error('not requested') },
    loadThumbnail: async () => null,
  }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Overview, props(port, 'A'))) })
    assert.equal(home(view).recentVerified, false)
    assert.equal(home(view).favoritesVerified, false)
    assert.deepEqual(home(view).recentItems, [])
    owner = 'B'
    await act(async () => { view.update(React.createElement(Overview, props(port, 'B'))) })
    assert.deepEqual(home(view).recentItems, [], 'Owner A list may not leak into B')
    await act(async () => {
      bRecent.resolve([item('B.jpg')])
      bFavorites.resolve([item('B-favorite.jpg')])
      await Promise.resolve()
    })
    assert.deepEqual(home(view).recentItems.map(row => row.item.name), ['B.jpg'])
    assert.deepEqual(home(view).favoriteItems.map(row => row.item.name), ['B-favorite.jpg'])
    await act(async () => {
      aRecent.resolve([item('A.jpg')])
      aFavorites.resolve([item('A-favorite.jpg')])
      await Promise.resolve()
    })
    assert.deepEqual(home(view).recentItems.map(row => row.item.name), ['B.jpg'])
    assert.deepEqual(home(view).favoriteItems.map(row => row.item.name), ['B-favorite.jpg'])
    assert.equal(recentCalls, 2, 'no render-induced repeated Recent GET')
    assert.equal(favoriteCalls, 2, 'no render-induced repeated Favorites GET')
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})

test('failed initial Home read remains unverified rather than falsely empty', async () => {
  const port = {
    cloudFileRecent: async () => { throw Error('read unavailable') },
    cloudFileFavorites: async () => { throw Error('read unavailable') },
    getFileAvailabilityBatch: async () => [],
    getLocalDiskSpace: async () => { throw Error('unsupported') },
    openPath: async () => {},
    loadThumbnail: async () => null,
  }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Overview, props(port))) })
    assert.equal(home(view).recentVerified, false)
    assert.equal(home(view).favoritesVerified, false)
    assert.match(home(view).recentError, /读取失败/)
    assert.match(home(view).favoritesError, /读取失败/)
    assert.deepEqual(home(view).recentItems, [])
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
