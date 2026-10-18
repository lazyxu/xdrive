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

function loadOriginal() {
  const filename = path.join(root, 'ui/shared/src/mui/FileExplorerNavigationPane.tsx')
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const components = Object.fromEntries(
    ['Box','Button','Checkbox','Collapse','Divider','IconButton','ListItemButton',
      'Menu','MenuItem','Stack','Tooltip','Typography'].map(name => [name, name.toLowerCase()]))
  components.useMediaQuery = () => false
  const mocks = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': components,
    '../file-explorer-drag': {
      XDRIVE_FILE_EXPLORER_DRAG_MIME: 'application/x-xdrive',
      xDriveFileExplorerDecodeDragIDs: () => [],
    },
    '../file-explorer-controller': { xDriveFileExplorerDragAutoScrollDelta: () => 0 },
    '../file-explorer-organization': { xDriveFileExplorerSavedSearchRuleLabels: () => [] },
    './AutoLoadSentinel': { XDriveAutoLoadSentinel: 'auto-sentinel' },
    './FileExplorerExternalDrop': { xDriveFileExplorerReadExternalDrop: () => null },
    './FileExplorerThumbnail': { XDriveFileExplorerThumbnail: 'thumbnail' },
    './FileExplorer': {
      XDriveFileExplorerAvailabilityBadge: 'availability',
      XDriveFileExplorerItemIcon: 'file-icon',
      xDriveFileSupportsThumbnail: () => false,
    },
    './usePointerDrag': { useXDrivePointerDrag: () => ({
      active: false, begin() {}, cancel() {},
    }) },
  }
  const nativeRequire = mod.require.bind(mod)
  mod.require = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.startsWith('@mui/icons-material/')) return { __esModule: true, default: 'icon' }
    return nativeRequire(id)
  }
  mod._compile(js, filename)
  return mod.exports.XDriveFileExplorerNavigationPane
}
const Pane = loadOriginal()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const one = (view, key, value) => {
  const nodes = view.root.findAll(n => n.props?.[key] === value)
  assert.equal(nodes.length, 1, 'expected exactly one '+key+'='+value)
  return nodes[0]
}
test('P71 original Web/Desktop sidebar first reads stay 360ms quiet, geometry-stable and truthfully busy', async () => {
  let view
  let finishTree, treeReads = 0
  const treeResult = new Promise(resolve => { finishTree = resolve })
  const props = {
    lifecycleKey: 'p71-owner-a',
    sectionPreferencesKey: 'p71-test-navigation',
    currentCrumbs: [{ id: 1, name: '我的文件' }],
    loadDirectoryPage: async () => { treeReads++; return treeResult },
    onNavigate() {},
    quickAccessEnabled: true, quickAccessLoading: true, quickAccessReadState: 'unverified', quickAccessItems: [],
    favoritesEnabled: true, favoritesLoading: true, favoritesReadState: 'unverified', favoriteItems: [],
    recentEnabled: true, recentLoading: true, recentReadState: 'unverified', recentItems: [],
    savedSearchesEnabled: true, organizationLoading: true, savedSearches: [],
    tagsEnabled: true, tags: [],
    onError: error => { throw error },
  }
  const cases = [
    ['quick-access', 112, 112],
    ['favorites', 80, 80],
    ['recent', 32, 32],
  ]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props)) })
    for (const [label, firstHeight] of cases) {
      const slot = one(view, 'data-xdrive-sidebar-'+label+'-first-read', true)
      assert.equal(slot.props.sx.minHeight, firstHeight)
      assert.equal(slot.props['aria-busy'], 'true')
    }
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    assert.equal(treeReads, 0, 'lazy tree must never fetch a folder that is not expanded')
    const rootNode = one(view, 'role', 'treeitem')
    assert.equal(rootNode.props['aria-busy'], undefined)
    const expand = one(view, 'aria-label', '展开 我的文件')
    await act(async () => { expand.props.onClick({ stopPropagation() {} }) })
    assert.equal(treeReads, 1, 'real folder read begins immediately on expand, not after a display timer')
    assert.equal(rootNode.props['aria-busy'], true)
    await act(async () => { await sleep(370) })
    for (const [label, firstHeight] of cases)
      assert.equal(one(view, 'data-xdrive-sidebar-'+label+'-first-read', true).props.sx.minHeight, firstHeight)
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    await act(async () => {
      view.update(React.createElement(Pane, {
        ...props,
        quickAccessLoading: false,
        quickAccessReadState: 'ready',
        favoritesLoading: false,
        favoritesReadState: 'ready',
        recentLoading: false,
        recentReadState: 'ready',
        organizationLoading: false,
      }))
    })
    for (const [label, , emptyHeight] of cases) {
      const verified = one(view, 'data-xdrive-sidebar-'+label+'-empty', true)
      assert.equal(verified.props.sx.minHeight, emptyHeight,
        'verified zero uses same height floor as unverified first read')
    }
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    await act(async () => {
      finishTree({ items: [{ id: 2, name: '已确认文件夹', type: 'dir' }], nextCursor: '', hasMore: false })
      await treeResult
    })
    assert.equal(rootNode.props['aria-busy'], undefined)
    assert.equal(treeReads, 1)
  } finally {
    if (view) await act(async () => { view.unmount() })
    // When an early assertion rejects before the held page has completed,
    // resolve the test-owned Promise so no delayed task remains unobserved.
    if (finishTree) finishTree({ items: [], nextCursor: '', hasMore: false })
  }
})

test('P72 sidebar never equates loading=false with accepted empty; current errors have fixed recovery', async () => {
  let view
  const retried = { quick: 0, favorite: 0, recent: 0 }
  const base = {
    lifecycleKey: 'p72-owner-a',
    sectionPreferencesKey: 'p72-read-state',
    currentCrumbs: [],
    loadDirectoryPage: async () => ({ items: [], nextCursor: '', hasMore: false }),
    onNavigate() {},
    quickAccessEnabled: true, quickAccessItems: [],
    quickAccessLoading: false, quickAccessReadState: 'unverified',
    favoritesEnabled: true, favoriteItems: [],
    favoritesLoading: false, favoritesReadState: 'unverified',
    recentEnabled: true, recentItems: [],
    recentLoading: false, recentReadState: 'unverified',
    onRetryQuickAccess: () => { retried.quick++ },
    onRetryFavorites: () => { retried.favorite++ },
    onRetryRecent: () => { retried.recent++ },
  }
  const groups = [
    ['quick-access', 'quick', 112],
    ['favorites', 'favorite', 80],
    ['recent', 'recent', 32],
  ]
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, base)) })
    for (const [id, , floor] of groups) {
      assert.equal(one(view, 'data-xdrive-sidebar-'+id+'-first-read', true).props.sx.minHeight, floor)
      assert.equal(view.root.findAll(n => n.props['data-xdrive-sidebar-'+id+'-empty'] === true).length, 0,
        'a current unanswered Owner list is not confirmed zero: '+id)
    }
    await act(async () => { await sleep(370) })
    for (const [id] of groups) one(view, 'data-xdrive-sidebar-'+id+'-first-read', true)
    assert.equal(view.root.findAll(n => n.type === 'circularprogress').length, 0)
    await act(async () => { view.update(React.createElement(Pane, {
      ...base,
      quickAccessReadState: 'error',
      favoritesReadState: 'error',
      recentReadState: 'error',
    })) })
    for (const [id, action, floor] of groups) {
      const error = one(view, 'data-xdrive-sidebar-'+id+'-error', true)
      assert.equal(error.props.sx.minHeight, floor)
      assert.equal(error.props.role, 'alert')
      const retry = error.findAll(n => n.type === 'button' && n.props.children === '重试')[0]
      assert.ok(retry, 'real current error has a retry: '+id)
      await act(async () => { retry.props.onClick() })
      assert.equal(retried[action], 1)
    }
    await act(async () => { view.update(React.createElement(Pane, {
      ...base,
      quickAccessReadState: 'ready',
      favoritesReadState: 'ready',
      recentReadState: 'ready',
    })) })
    for (const [id, , floor] of groups)
      assert.equal(one(view, 'data-xdrive-sidebar-'+id+'-empty', true).props.sx.minHeight, floor)
    await act(async () => { view.update(React.createElement(Pane, {
      ...base,
      quickAccessLoading: true, quickAccessReadState: 'ready',
      favoritesLoading: true, favoritesReadState: 'ready',
      recentLoading: true, recentReadState: 'ready',
    })) })
    for (const [id] of groups) {
      assert.ok(one(view, 'data-xdrive-sidebar-'+id+'-empty', true),
        'refresh of a previously verified empty list does not insert another blank intermediary')
    }
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
