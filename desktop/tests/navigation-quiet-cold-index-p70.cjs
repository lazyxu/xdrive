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

function original(relative, overrides) {
  const filename = path.join(root, relative)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const standard = mod.require.bind(mod)
  mod.require = dep => Object.hasOwn(overrides, dep) ? overrides[dep] : standard(dep)
  mod._compile(js, filename)
  return mod.exports
}
const mui = Object.fromEntries(
  ['Box','Button','Chip','CircularProgress','List','ListItemButton','Paper','Stack','Typography']
    .map(key => [key, key.toLowerCase()]))
const icons = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : 'icon' })
const base = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui, '@mui/icons-material': icons,
  './useDeferredLoading': { useXDriveDeferredPendingLoading: pending => Boolean(pending) },
  './MediaGalleryCoverThumbnail': { XDriveMediaGalleryCoverThumbnail: 'thumbnail' },
}
const Memories = original('ui/shared/src/mui/MediaGalleryMemories.tsx', base)
  .XDriveMediaGalleryMemories
const Cleanup = original('ui/shared/src/mui/MediaGalleryCleanup.tsx', {
  ...base, '../format': { formatBytes: () => '0 B' },
  './MediaGalleryCleanupIndexStatus': { XDriveMediaGalleryCleanupIndexStatus: 'index-status' },
}).XDriveMediaGalleryCleanup
const Columns = original('ui/shared/src/mui/FileExplorerColumnView.tsx', {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  '@mui/icons-material/ChevronRightRounded': 'chevron',
  '@mui/icons-material/FolderRounded': 'folder',
  '@mui/icons-material/InsertDriveFileRounded': 'file',
  './AutoLoadSentinel': { XDriveAutoLoadSentinel: 'sentinel' },
}).XDriveFileExplorerColumnView
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const rings = view => view.root.findAllByType('circularprogress')
function textOf(v) {
  if (v == null || typeof v === 'boolean') return ''
  if (Array.isArray(v)) return v.map(textOf).join('')
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  return textOf(v.props?.children)
}
async function withView(Component, props, check) {
  let view
  try {
    await act(async () => { view = Renderer.create(React.createElement(Component, props)) })
    const update = async changed => {
      await act(async () => { view.update(React.createElement(Component, { ...props, ...changed })) })
    }
    await check(view, update)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
}
test('P70 mounted real Memories first read stays quiet even after 360ms', async () => {
  await withView(Memories, { memories: [], loading: true, loadThumbnail: async () => null },
    async (view, update) => {
      const slot = () => view.root.findAll(node =>
        node.props['data-xdrive-gallery-memories-first-read'] !== undefined)[0]
      assert.equal(slot().props['aria-busy'], 'true')
      assert.equal(slot().props.sx.minHeight, 180)
      assert.equal(rings(view).length, 0)
      await act(async () => { await delay(360) })
      assert.equal(slot().props.sx.minHeight, 180)
      assert.equal(rings(view).length, 0)
      assert.equal(view.root.findAll(n => n.type === 'typography' &&
        textOf(n.props.children) === '还没有可生成的回忆').length, 0)
      await update({ loading: false, memories: [] })
      assert.ok(view.root.findAll(n => n.type === 'typography' &&
        textOf(n.props.children) === '还没有可生成的回忆').length > 0)
    })
})
test('P70 mounted real Cleanup remains silent, preserves real failure recovery and verified zero', async () => {
  let retries = 0
  await withView(Cleanup, { bursts: null, loading: true,
    loadThumbnail: async () => null, onRefresh: () => { retries++ },
  }, async (view, update) => {
    const slot = () => view.root.findAll(node =>
      node.props['data-xdrive-gallery-cleanup-first-read'] !== undefined)[0]
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(slot().props['aria-busy'], true)
    await act(async () => { await delay(360) })
    assert.equal(slot().props['aria-busy'], true)
    assert.equal(rings(view).length, 0)
    await update({ loading: false, bursts: null })
    assert.equal(slot().props['aria-busy'], undefined)
    const retry = view.root.findAll(n => n.type === 'button' && n.props.children === '重新检查')[0]
    assert.ok(retry)
    await act(async () => { retry.props.onClick() })
    assert.equal(retries, 1)
    await update({ loading: false, bursts: { groups: [], total_groups: 0 } })
    assert.ok(view.root.findAll(n => n.type === 'typography' &&
      textOf(n.props.children) === '当前已索引素材暂时没有连拍清理建议').length > 0)
  })
})
test('P70 mounted real FileExplorer Column waits for held Range without a loading overlay', async () => {
  let complete, count = 0, view
  const read = new Promise(resolve => { complete = resolve })
  const props = {
    lifecycleKey: 'p70-owner', crumbs: [{ id: 1, name: '我的文件' }],
    selectedIDs: [], onNavigate() {}, onSelect() {}, onOpenFile() {},
    loadPage: (_id, _cursor, signal) => {
      assert.equal(signal.aborted, false)
      count++
      return read
    },
  }
  try {
    await act(async () => { view = Renderer.create(React.createElement(Columns, props)) })
    const col = () => view.root.findAll(n =>
      n.props.role === 'group' && n.props['aria-label'] === '我的文件')[0]
    assert.ok(col())
    assert.equal(col().props['aria-busy'], true)
    assert.equal(col().props['data-xdrive-column-pending'], true)
    assert.equal(rings(view).length, 0)
    await act(async () => { await delay(360) })
    assert.equal(rings(view).length, 0)
    assert.equal(count, 1)
    await act(async () => {
      complete({ items: [{ id: 2, name: '已确认.txt', kind: 'file' }] })
      await read
    })
    assert.equal(col().props['aria-busy'], undefined)
    assert.equal(view.root.findAll(n =>
      n.props['data-xdrive-file-explorer-column-item'] !== undefined).length, 1)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
