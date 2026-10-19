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
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('ui/shared/src/mui/FileExplorerNavigationPane.tsx')
function originalPane() {
  const filename = path.join(root, 'ui/shared/src/mui/FileExplorerNavigationPane.tsx')
  const js = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const mui = Object.fromEntries(
    ['Box','Button','Checkbox','Divider','IconButton','ListItemButton',
      'Menu','MenuItem','Stack','Tooltip','Typography'].map(x => [x, x.toLowerCase()]))
  mui.useMediaQuery = () => false
  const stubs = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': mui,
    '../file-explorer-drag': { XDRIVE_FILE_EXPLORER_DRAG_MIME: 'xdrive-test',
      xDriveFileExplorerDecodeDragIDs: () => [] },
    '../file-explorer-controller': { xDriveFileExplorerDragAutoScrollDelta: () => 0 },
    '../file-explorer-organization': { xDriveFileExplorerSavedSearchRuleLabels: () => [] },
    './AutoLoadSentinel': { XDriveAutoLoadSentinel: 'auto-sentinel' },
    './FileExplorerExternalDrop': { xDriveFileExplorerReadExternalDrop: () => null },
    './FileExplorerThumbnail': { XDriveFileExplorerThumbnail: 'thumbnail' },
    './FileExplorer': {
      XDriveFileExplorerAvailabilityBadge: 'availability',
      XDriveFileExplorerItemIcon: 'file-icon', xDriveFileSupportsThumbnail: () => false,
    },
    './usePointerDrag': { useXDrivePointerDrag: () => ({
      active: false, begin() {}, cancel() {},
    }) },
  }
  const native = mod.require.bind(mod)
  mod.require = key => {
    if (Object.hasOwn(stubs, key)) return stubs[key]
    if (key.startsWith('@mui/icons-material/')) return { __esModule: true, default: 'icon' }
    return native(key)
  }
  mod._compile(js, filename)
  return mod.exports.XDriveFileExplorerNavigationPane
}
const Pane = originalPane()
const wait = ms => new Promise(done => setTimeout(done, ms))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const one = (v, prop, value) => {
  const found = v.root.findAll(node => node.props?.[prop] === value)
  assert.equal(found.length, 1, 'expected one ' + prop + '=' + value + ', got ' + found.length)
  return found[0]
}
const count = (v, prop, value) => v.root.findAll(node => node.props?.[prop] === value).length
const page = (items, more = false) => ({
  items: items.map(([id, name]) => ({ id, name, type: 'dir' })),
  nextCursor: more ? 'next-page' : '', hasMore: more,
})
const props = (loadDirectoryPage, rest = {}) => ({
  lifecycleKey: 'p101-owner-A', sectionPreferencesKey: 'p101-nav',
  currentCrumbs: [{ id: 1, name: '我的文件' }],
  loadDirectoryPage, onNavigate() {}, onError: e => { throw e }, ...rest,
})

test('P101 ORIGINAL mounted Web/Desktop tree is silent for held first page, then expands exactly once', async () => {
  const first = deferred()
  const calls = []
  const load = async (id, cursor) => {
    calls.push([id, cursor])
    return cursor ? page([[3, '下一页目录']]) : first.promise
  }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props(load))) })
    assert.equal(count(view, 'role', 'treeitem'), 1)
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.deepEqual(calls, [[1, undefined]], 'real bounded network read starts immediately')
    assert.equal(one(view, 'role', 'treeitem').props['aria-expanded'], false)
    assert.equal(one(view, 'role', 'treeitem').props['aria-busy'], true)
    one(view, 'aria-label', '取消展开 我的文件')
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { await wait(370) })
    assert.equal(count(view, 'role', 'group'), 0, 'held >350ms has no temporary height/Loading')
    assert.equal(view.root.findAll(x => x.type === 'collapse').length, 0)
    await act(async () => { first.resolve(page([[2, '子目录']], true)); await first.promise })
    assert.equal(count(view, 'role', 'group'), 1)
    assert.equal(count(view, 'role', 'treeitem'), 2)
    one(view, 'data-xdrive-file-explorer-tree-verified-group', 1)
    const more = one(view, 'data-xdrive-file-explorer-tree-auto-load', true)
    await act(async () => { more.findAll(x => x.type === 'auto-sentinel')[0].props.onLoad() })
    assert.equal(count(view, 'role', 'treeitem'), 3, 'the real page-2 cursor still appends nodes')
    assert.equal(calls.length, 2)
    await act(async () => { one(view, 'aria-label', '折叠 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'treeitem'), 3)
    assert.equal(calls.length, 2, 'accepted cached page reveals without another GET')
  } finally {
    if (view) await act(async () => { view.unmount() })
    first.resolve(page([]))
  }
})

test('P101 second activation cancels only unverified visual reveal; late first page may be reused without re-fetch', async () => {
  const first = deferred()
  const calls = []
  const load = async id => { calls.push(id); return first.promise }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props(load))) })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    await act(async () => { one(view, 'aria-label', '取消展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 0)
    one(view, 'aria-label', '展开 我的文件')
    await act(async () => { first.resolve(page([[2, '后台完成的目录']])); await first.promise })
    assert.equal(count(view, 'role', 'group'), 0, 'late response cannot reopen cancelled group')
    assert.equal(calls.length, 1)
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 1)
    assert.equal(calls.length, 1, 'verified cached children need no second read')
  } finally {
    if (view) await act(async () => { view.unmount() })
    first.resolve(page([]))
  }
})

test('P101 failed original tree GET stays closed, and retry reveals only verified new children', async () => {
  const first = deferred()
  const errors = []
  let reads = 0
  const load = async () => (++reads === 1 ? first.promise : page([[2, '正确重试结果']]))
  let view
  try {
    await act(async () => {
      view = Renderer.create(React.createElement(Pane,
        props(load, { onError: e => errors.push(e.message) })))
    })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    await act(async () => { first.reject(new Error('真实网络失败')); await first.promise.catch(() => {}) })
    assert.deepEqual(errors, ['真实网络失败'])
    assert.equal(count(view, 'role', 'group'), 0)
    one(view, 'aria-label', '展开 我的文件')
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 1)
    assert.equal(reads, 2)
  } finally {
    if (view) await act(async () => { view.unmount() })
    first.resolve(page([]))
  }
})

test('P101 a new authenticated account cannot reveal a stale held tree disclosure', async () => {
  const first = deferred()
  let view
  const originalLoad = async () => first.promise
  const nextLoad = async () => page([[72, '当前账户目录']])
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props(originalLoad))) })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => {
      view.update(React.createElement(Pane, props(nextLoad, {
        lifecycleKey: 'p101-owner-B',
        sectionPreferencesKey: 'p101-nav-B',
        currentCrumbs: [{ id: 71, name: '新账户' }],
      })))
    })
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { first.resolve(page([[2, '旧账户目录']])); await first.promise })
    assert.equal(count(view, 'role', 'group'), 0)
    assert.equal(view.root.findAll(node => node.props?.['aria-label'] === '旧账户目录').length, 0)
    await act(async () => { one(view, 'aria-label', '展开 新账户').props.onClick({ stopPropagation() {} }) })
    assert.equal(count(view, 'role', 'group'), 1)
    one(view, 'data-xdrive-file-explorer-tree-verified-group', 71)
  } finally {
    if (view) await act(async () => { view.unmount() })
    first.resolve(page([]))
  }
})

test('P101 verified zero-child directory stays a leaf without empty group or fake loading', async () => {
  let reads = 0
  const load = async () => { reads += 1; return page([]) }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props(load))) })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(reads, 1)
    assert.equal(count(view, 'role', 'group'), 0)
    assert.equal(count(view, 'role', 'treeitem'), 1)
    assert.equal(one(view, 'role', 'treeitem').props['aria-expanded'], undefined)
    assert.equal(one(view, 'role', 'treeitem').props['aria-busy'], undefined)
    assert.equal(view.root.findAll(n => n.props?.['aria-label'] === '展开 我的文件').length, 0)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})

test('P101 rapid expand/cancel/re-expand coalesces original pending GET but still reveals verified children', async () => {
  const held = deferred()
  let reads = 0
  const load = async () => { reads += 1; return held.promise }
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Pane, props(load))) })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    await act(async () => { one(view, 'aria-label', '取消展开 我的文件').props.onClick({ stopPropagation() {} }) })
    await act(async () => { one(view, 'aria-label', '展开 我的文件').props.onClick({ stopPropagation() {} }) })
    assert.equal(reads, 1, 'one real request must be coalesced, never duplicated')
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { await wait(370) })
    assert.equal(count(view, 'role', 'group'), 0)
    await act(async () => { held.resolve(page([[2, '当前有效目录']])); await held.promise })
    assert.equal(count(view, 'role', 'group'), 1,
      'newest current intent must commit after shared existing request completes')
    assert.equal(count(view, 'role', 'treeitem'), 2)
  } finally {
    if (view) await act(async () => { view.unmount() })
    held.resolve(page([]))
  }
})

test('P101 source-exact owner fences / no height animation / shared transport / AGENTS contract', () => {
  // Comments may describe the OLD Collapse; prohibit actual animated JSX/imports.
  assert.doesNotMatch(source, /<Collapse\b|^\s*Collapse,|timeout="auto"/m)
  for (const marker of [
    'pendingExpandRef.current.set(node.id, { token, generation, lifecycleKey: owner })',
    'ticket.generation !== loadDirectoryPageGenerationRef.current',
    'ticket.lifecycleKey !== lifecycleKeyRef.current',
    'accepted.generation === ticket.generation',
    'if (accepted.children.length === 0 && !accepted.hasMore) continue',
    'useLayoutEffect(() => {',
    'if (accepted?.loaded && accepted.generation === ticket.generation &&',
    'data-xdrive-file-explorer-tree-verified-group={node.id}',
    'aria-busy={loading || pendingExpand || undefined}',
    'onLoad={() => loadChildren(node, true)}',
    'setExpandedIDs(new Set())',
  ]) assert.ok(source.includes(marker), marker)
  for (const client of ['web/src/WebFileExplorer.tsx',
    'desktop/src/renderer/DesktopFileExplorer.tsx']) {
    const src = read(client)
    assert.ok(src.includes('<XDriveFileExplorerNavigationPane'), client)
    assert.ok(src.includes('loadDirectoryPage={loadTreeDirectoryPage}'), client)
  }
  const agents = read('AGENTS.md')
  assert.equal(agents.split('P101 verified tree disclosure without height animation (mandatory)').length, 2)
})
