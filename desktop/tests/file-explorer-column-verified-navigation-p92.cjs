'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/FileExplorerColumnView.tsx')
const original = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(original, {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const host = (tag) => React.forwardRef(({ children, ...props }, ref) =>
  React.createElement(tag, { ...props, ref }, children))
const mui = {
  Box: host('div'), Button: host('button'), List: host('div'),
  ListItemButton: host('button'), Stack: host('div'), Typography: host('span'),
}
const mod = { exports: {} }
const localRequire = (id) => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (id === '@mui/material') return mui
  if (id.startsWith('@mui/icons-material/')) return { __esModule: true, default: () => null }
  if (id === './AutoLoadSentinel') return { XDriveAutoLoadSentinel: () => null }
  throw Error('Unexpected Column View module: ' + id)
}
new Function('exports', 'module', 'require', compiled)(mod.exports, mod, localRequire)
const Column = mod.exports.XDriveFileExplorerColumnView
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const groups = (view) => view.root.findAll(node =>
  node.type === 'div' && node.props.role === 'group' && node.props['aria-label'])
const rows = (view) => view.root.findAll(node =>
  node.type === 'button' && node.props['data-xdrive-file-explorer-column-item'])
const errors = (view) => view.root.findAll(node =>
  node.type === 'div' && node.props['data-xdrive-column-navigation-error'])
const selected = []
const navigated = []

test('P92 mounts ORIGINAL Column: a held child GET preserves old column/selection; success commits once', async () => {
  selected.length = 0; navigated.length = 0
  const gate = deferred()
  let childRequests = 0, view
  const loadPage = (id, cursor, signal) => {
    assert.equal(cursor, '')
    assert.ok(signal instanceof AbortSignal)
    if (id === 1) return Promise.resolve({ items: [{ id: 10, kind: 'dir', name: '相册文件夹' }], nextCursor: '' })
    if (id === 10) { childRequests++; return gate.promise }
    throw Error('Unexpected id ' + id)
  }
  function Fixture() {
    const [crumbs, setCrumbs] = React.useState([{ id: 1, name: '根目录' }])
    return React.createElement(Column, {
      lifecycleKey: 'owner-a', crumbs, selectedIDs: [], loadPage,
      onNavigate: (next) => { navigated.push(next); setCrumbs(next) },
      onSelect: (item) => selected.push(item.id), onOpenFile: () => {},
    })
  }
  try {
    await act(async () => { view = create(React.createElement(Fixture)); await tick() })
    assert.equal(rows(view).length, 1)
    const oldGroup = groups(view)[0]
    await act(async () => { rows(view)[0].props.onClick(); await tick() })
    assert.equal(childRequests, 1)
    assert.equal(groups(view).length, 1, 'no empty destination column before an accepted page')
    assert.equal(groups(view)[0], oldGroup, 'the original column host stays mounted')
    assert.equal(groups(view)[0].props['aria-busy'], true)
    assert.deepEqual(selected, [])
    assert.deepEqual(navigated, [])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 360)) })
    assert.equal(groups(view).length, 1)
    assert.equal(view.root.findAll(node => node.type === 'circularprogress').length, 0)
    await act(async () => {
      gate.resolve({ items: [{ id: 111, kind: 'file', name: '已确认.jpg' }], nextCursor: '' })
      await tick()
    })
    assert.equal(groups(view).length, 2)
    assert.equal(rows(view).length, 2)
    assert.deepEqual(selected, [10])
    assert.equal(navigated.length, 1)
    assert.equal(navigated[0][1].id, 10)
    assert.equal(errors(view).length, 0)
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P92 preserves old parent on failed child GET, retries, rejects superseded late results', async () => {
  let view, attempts = 0
  const stale = deferred(), latest = deferred()
  let firstSignal
  const commits = []
  const loadPage = (id, cursor, signal) => {
    if (id === 1) return Promise.resolve({ items: [
      { id: 10, kind: 'dir', name: '相册A' },
      { id: 11, kind: 'dir', name: '相册B' },
    ], nextCursor: '' })
    if (id === 10) { firstSignal = signal; return stale.promise }
    if (id === 11) {
      attempts++
      return attempts === 1 ? Promise.reject(new Error('HTTP 503')) : latest.promise
    }
    throw Error('unexpected id')
  }
  function Fixture() {
    const [crumbs, setCrumbs] = React.useState([{ id: 1, name: '根目录' }])
    return React.createElement(Column, {
      lifecycleKey: 'owner-b', crumbs, selectedIDs: [], loadPage,
      onNavigate: (next) => { commits.push(next.map(entry => entry.id)); setCrumbs(next) },
      onSelect: () => {}, onOpenFile: () => {},
    })
  }
  try {
    await act(async () => { view = create(React.createElement(Fixture)); await tick() })
    await act(async () => { rows(view)[0].props.onClick(); await tick() })
    await act(async () => { rows(view)[1].props.onClick(); await tick() })
    assert.equal(firstSignal.aborted, true, 'new intent cancels previous first page')
    assert.equal(groups(view).length, 1)
    assert.equal(errors(view).length, 1, 'terminal failure is a same-parent fixed overlay')
    assert.deepEqual(commits, [])
    await act(async () => { stale.resolve({ items: [{ id: 900, kind: 'file', name: '旧结果.jpg' }] }); await tick() })
    assert.equal(groups(view).length, 1)
    assert.deepEqual(commits, [])
    const retry = errors(view)[0].findAll(node => node.type === 'button')[0]
    assert.ok(retry)
    await act(async () => { retry.props.onClick(); await tick() })
    assert.equal(errors(view).length, 0)
    await act(async () => { latest.resolve({ items: [], nextCursor: '' }); await tick() })
    assert.equal(groups(view).length, 2, 'verified empty page is still an authorized column')
    assert.deepEqual(commits, [[1, 11]])
    assert.equal(errors(view).length, 0)
  } finally {
    if (view) await act(async () => view.unmount())
  }
})

test('P92 opening a file cancels a previously held folder intent without an obsolete navigation', async () => {
  let view
  const held = deferred(), commits = [], selections = []
  let oldSignal
  const loadPage = (id, _cursor, signal) => {
    if (id === 1) return Promise.resolve({ items: [
      { id: 10, kind: 'dir', name: '旧文件夹' },
      { id: 13, kind: 'file', name: '直接查看.jpg' },
    ], nextCursor: '' })
    if (id === 10) { oldSignal = signal; return held.promise }
    throw Error('unexpected id')
  }
  function Fixture() {
    const [crumbs, setCrumbs] = React.useState([{ id: 1, name: '根目录' }])
    return React.createElement(Column, {
      lifecycleKey: 'owner-file', crumbs, selectedIDs: [], loadPage,
      onNavigate: (next) => { commits.push(next); setCrumbs(next) },
      onSelect: (item) => { selections.push(item.id) }, onOpenFile: () => {},
    })
  }
  try {
    await act(async () => { view = create(React.createElement(Fixture)); await tick() })
    await act(async () => { rows(view)[0].props.onClick(); await tick() })
    assert.equal(groups(view).length, 1)
    await act(async () => { rows(view)[1].props.onClick(); await tick() })
    assert.equal(oldSignal.aborted, true)
    assert.deepEqual(selections, [13])
    await act(async () => {
      held.resolve({ items: [{ id: 99, kind: 'file', name: '已取消.jpg' }] })
      await tick()
    })
    assert.equal(groups(view).length, 1)
    assert.deepEqual(commits, [])
  } finally {
    if (view) await act(async () => view.unmount())
  }
})
