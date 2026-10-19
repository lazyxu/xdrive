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
const mui = new Proxy({}, { get(_target, name) {
  if (name === 'useMediaQuery') return () => false
  return String(name)
} })
const localMocks = {
  './ActionButton': { XDriveActionButton: 'ActionButton' },
  './StatePanel': { XDriveStatePanel: 'StatePanel' },
  './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  './StatusBadge': { XDriveStatusBadge: 'StatusBadge' },
  './TaskPresentation': { XDriveTaskCardSurface: 'TaskCard' },
  './TableSurface': { XDriveTableSurface: 'TableSurface' },
  './TransferSpeedDisplay': {
    useXDriveTransferDisplayedRates: tasks => ({ tasks }),
  },
  './DescriptionGrid': {
    XDriveDescriptionGrid: 'DescriptionGrid',
    XDriveDescriptionItem: 'DescriptionItem',
  },
}
function mountOriginalFile(file) {
  const filename = path.join(root, 'ui/shared/src/mui', file)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(
    mod, mod.exports, spec => {
      if (spec === 'react') return React
      if (spec === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (spec === '@mui/material') return mui
      if (spec.startsWith('@mui/icons-material/'))
        return { __esModule: true, default: 'Icon' }
      if (spec === '..') return { xDriveTransferTree: () => [] }
      if (Object.hasOwn(localMocks, spec)) return localMocks[spec]
      throw Error('Unrecognized actual shared Task/Transfer import: ' + spec)
    },
  )
  return mod.exports
}
const {
  XDriveBackgroundTaskList: Personal,
  XDriveBackgroundTaskTable: Global,
} = mountOriginalFile('BackgroundTaskCenter.tsx')
const { XDriveTransferCenter: Transfers } = mountOriginalFile('TransferCenter.tsx')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const mark = (view, name) => view.root.findAll(node =>
  Object.prototype.hasOwnProperty.call(node.props ?? {}, name))
const loader = view => view.root.findAll(node => node.type === 'StatePanel' &&
  node.props.loading)
async function withComponent(Component, initial, run) {
  let v
  try {
    await act(async () => { v = Renderer.create(React.createElement(Component, initial)) })
    const update = async props => act(async () => v.update(React.createElement(Component, props)))
    await run(v, update)
  } finally {
    if (v) await act(async () => { v.unmount() })
  }
}
test('P83 actual personal/global task list has no idle, >350ms or refresh transient spinner', async () => {
  for (const [Component, cold, ready] of [
    [Personal, 'data-xdrive-background-tasks-first-read', 'data-xdrive-background-tasks-verified-empty'],
    [Global, 'data-xdrive-global-background-tasks-first-read', 'data-xdrive-global-background-tasks-verified-empty'],
  ]) {
    const props = { tasks: [], loaded: false, loading: false, failed: false, loadEpoch: 0 }
    await withComponent(Component, props, async (v, update) => {
      const verifyCold = () => {
        const slot = mark(v, cold)
        assert.equal(slot.length, 1, 'one quiet task slot')
        assert.equal(slot[0].props.sx.minHeight, 120)
        assert.equal(slot[0].props['aria-busy'], true)
        assert.equal(loader(v).length, 0)
      }
      verifyCold()
      await update({ ...props, loading: true, loadEpoch: 1 })
      await act(async () => { await sleep(365) })
      verifyCold()
      await update({ ...props, failed: true })
      const failed = mark(v, cold)
      assert.equal(failed.length, 1)
      assert.equal(failed[0].props['aria-busy'], undefined)
      assert.equal(failed[0].props.sx.minHeight, 120)
      assert.ok(v.root.findAll(el => el.type === 'StatePanel' &&
        String(el.props.message).includes('读取失败')).length > 0)
      await update({ ...props, loaded: true })
      assert.equal(mark(v, cold).length, 0)
      assert.equal(mark(v, ready).length, 1)
      assert.equal(mark(v, ready)[0].props.sx.minHeight, 120,
        'accepted empty may not shrink the first-read region')
      await update({ ...props, loaded: true, loading: true, loadEpoch: 2 })
      await act(async () => { await sleep(365) })
      assert.equal(mark(v, ready).length, 1, 'verified zero persists on refresh')
      assert.equal(loader(v).length, 0)
    })
  }
})
test('P83 actual Transfer Center cold optional loading path is silent even on slow GET', async () => {
  await withComponent(Transfers, { transfers: [], loading: true }, async (v, update) => {
    const check = () => {
      const slot = mark(v, 'data-xdrive-transfer-first-read')
      assert.equal(slot.length, 1)
      assert.equal(slot[0].props['aria-busy'], 'true')
      assert.equal(slot[0].props.sx.minHeight, 120)
      assert.equal(loader(v).length, 0)
    }
    check()
    await act(async () => { await sleep(365) })
    check()
    await update({ transfers: [], loading: false })
    assert.equal(mark(v, 'data-xdrive-transfer-first-read').length, 0)
    assert.equal(loader(v).length, 0)
  })
})
