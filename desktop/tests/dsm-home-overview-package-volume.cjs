'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/SynologyHomeOverview.tsx')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])

const mui = new Proxy({}, { get: (_, name) => String(name) })
let lastPageActions = null
const dependencies = {
  './ActionButton': { XDriveActionButton: 'ActionButton' },
  './MetricCards': { XDriveMetricCard: 'MetricCard', XDriveMetricGrid: 'MetricGrid' },
  './SectionHeader': { XDriveSectionHeader: 'SectionHeader' },
  './StatePanel': { XDriveStatePanel: 'StatePanel' },
  './SynologyBackupSourceProgress': {
    XDriveSynologyBackupSourceProgress: ({ client, sourceID, refreshEpoch }) =>
      React.createElement('SourceProgress', { client, sourceID, refreshEpoch }),
  },
  './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  './WorkspaceSurface': {
    XDriveWorkspaceSurface: ({ children, pageActions }) => {
      lastPageActions = pageActions
      return React.createElement('WorkspaceSurface', null, children)
    },
  },
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, dependency => {
    if (dependency === 'react') return React
    if (dependency === 'react/jsx-runtime') return require('react/jsx-runtime')
    if (dependency === '@mui/material') return mui
    if (dependency === '@mui/icons-material/RefreshRounded') {
      return { __esModule: true, default: 'RefreshIcon' }
    }
    if (dependency === '../format') return { formatBytes: value => String(value) + ' B' }
    if (Object.hasOwn(dependencies, dependency)) return dependencies[dependency]
    throw Error('Unexpected DSM Home Overview dependency: ' + dependency)
  },
)
const Home = mod.exports.XDriveSynologyHomeOverview
assert.equal(typeof Home, 'function')

function metric(view, title) {
  const matches = view.root.findAll(node =>
    node.type === 'MetricCard' && node.props.title === title)
  assert.equal(matches.length, 1, 'expected one ' + title + ' metric')
  return matches[0].props
}

const flushEffects = () => new Promise(resolve => setImmediate(resolve))

async function mount(client) {
  let view
  await act(async () => {
    view = Renderer.create(React.createElement(Home, { client }))
    await flushEffects()
  })
  return view
}

function clientWith(volumeRead) {
  return {
    list: async signal => {
      assert.ok(signal instanceof AbortSignal)
      return []
    },
    ownerQuota: async signal => {
      assert.ok(signal instanceof AbortSignal)
      return { quota_bytes: 0, physical_used_bytes: 128 }
    },
    nasVolumeSpace: volumeRead,
  }
}

test('DSM Home shows the actual package-data filesystem, not a whole-NAS disk estimate', async () => {
  let reads = 0
  const client = clientWith(async signal => {
    reads += 1
    assert.ok(signal instanceof AbortSignal)
    return { capacity_bytes: 4096, available_bytes: 1024 }
  })
  const view = await mount(client)
  try {
    const card = metric(view, 'DSM 套件数据所在文件系统')
    assert.equal(reads, 1)
    assert.equal(card.value, '3072 B / 4096 B')
    assert.equal(card.suffix,
      '可用 1024 B · 仅表示 xDrive 套件数据所在文件系统')
    assert.doesNotMatch(card.title, /NAS 物理磁盘|全部磁盘/)
  } finally {
    await act(async () => view.unmount())
  }
})

test('DSM Home reports unavailable capacity without substituting zeroes', async () => {
  const view = await mount(clientWith(async () => {
    throw new Error('DSM package filesystem query unavailable')
  }))
  try {
    const card = metric(view, 'DSM 套件数据所在文件系统')
    assert.equal(card.value, '无法确认')
    assert.match(card.suffix, /不推断 NAS 全部磁盘空间/)
    assert.doesNotMatch(card.value, /0 B/)
  } finally {
    await act(async () => view.unmount())
  }
})

test('DSM Home refresh re-reads the package filesystem through the same cancellable Agent client', async () => {
  let reads = 0
  const client = clientWith(async () => {
    reads += 1
    return { capacity_bytes: 8192, available_bytes: 2048 }
  })
  const view = await mount(client)
  try {
    assert.equal(reads, 1)
    assert.ok(lastPageActions && lastPageActions.type === 'ActionButton')
    assert.equal(lastPageActions.props.children, '刷新')
    assert.equal(typeof lastPageActions.props.onClick, 'function')
    await act(async () => {
      lastPageActions.props.onClick()
      await flushEffects()
    })
    assert.equal(reads, 2)
    assert.equal(metric(view, 'DSM 套件数据所在文件系统').value, '6144 B / 8192 B')
  } finally {
    await act(async () => view.unmount())
  }
})

test('DSM Home aborts an outstanding package filesystem read on unmount', async () => {
  let requestSignal
  const client = clientWith(signal => {
    requestSignal = signal
    return new Promise(() => {})
  })
  const view = await mount(client)
  assert.ok(requestSignal instanceof AbortSignal)
  assert.equal(requestSignal.aborted, false)
  await act(async () => view.unmount())
  assert.equal(requestSignal.aborted, true)
})

test('DSM Home loads Source progress only after expansion and never fans out to all Sources', async () => {
  const client = {
    ...clientWith(async () => ({ capacity_bytes: 4096, available_bytes: 1024 })),
    list: async () => [
      { source_id: 41, name: 'NAS-Photos' },
      { source_id: 42, name: 'NAS-Media' },
    ],
  }
  const view = await mount(client)
  const progress = () => view.root.findAllByType('SourceProgress')
  const action = (label) => view.root.findAll(node =>
    node.type === 'ActionButton' && node.props.children === label)
  try {
    assert.equal(progress().length, 0, 'Home must not issue a Source status fan-out')
    assert.equal(action('查看进度').length, 2)
    await act(async () => { action('查看进度')[0].props.onClick(); await flushEffects() })
    assert.equal(progress().length, 1)
    assert.equal(progress()[0].props.client, client)
    assert.equal(progress()[0].props.sourceID, 41)
    await act(async () => { action('查看进度')[0].props.onClick(); await flushEffects() })
    assert.equal(progress().length, 1)
    assert.equal(progress()[0].props.sourceID, 42,
      'switching the expanded Source cannot leave a second polling reader mounted')
    await act(async () => { action('收起进度')[0].props.onClick(); await flushEffects() })
    assert.equal(progress().length, 0)
  } finally {
    await act(async () => view.unmount())
  }
})

test('DSM Home immediately hides old-Owner Source rows and expanded progress on Host switch', async () => {
  const ownerA = {
    ...clientWith(async () => ({ capacity_bytes: 4096, available_bytes: 1024 })),
    list: async () => [{ source_id: 41, name: 'Owner-A-Photos' }],
  }
  let finishOwnerB
  const ownerB = {
    ...clientWith(async () => ({ capacity_bytes: 4096, available_bytes: 1024 })),
    list: () => new Promise(resolve => { finishOwnerB = resolve }),
  }
  const view = await mount(ownerA)
  const rowNames = () => view.root.findAll(node => node.type === 'Typography' &&
    typeof node.props.children === 'string' && node.props.children.includes('Owner-A-Photos'))
  const progress = () => view.root.findAllByType('SourceProgress')
  try {
    assert.equal(rowNames().length, 1)
    const open = view.root.find(node =>
      node.type === 'ActionButton' && node.props.children === '查看进度')
    await act(async () => { open.props.onClick(); await flushEffects() })
    assert.equal(progress().length, 1)
    await act(async () => {
      view.update(React.createElement(Home, { client: ownerB }))
      await flushEffects()
    })
    // React batches act updates: assert after the new Host props commit,
    // while the replacement Owner list request remains unresolved.
    assert.equal(rowNames().length, 0, 'prior Owner Source leaked into new Host render')
    assert.equal(progress().length, 0, 'prior Owner progress remained mounted')
    assert.equal(rowNames().length, 0)
    assert.equal(progress().length, 0)
    await act(async () => { finishOwnerB([{ source_id: 42, name: 'Owner-B-Photos' }]); await flushEffects() })
    assert.equal(progress().length, 0, 'new Owner must never auto-expand an old Owner Source ID')
    assert.equal(view.root.findAll(node => node.type === 'Typography' &&
      node.props.children === 'Owner-B-Photos').length, 1)
  } finally {
    await act(async () => view.unmount())
  }
})
