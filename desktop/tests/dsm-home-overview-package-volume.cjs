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
const dependencies = {
  './ActionButton': { XDriveActionButton: 'ActionButton' },
  './MetricCards': { XDriveMetricCard: 'MetricCard', XDriveMetricGrid: 'MetricGrid' },
  './SectionHeader': { XDriveSectionHeader: 'SectionHeader' },
  './StatePanel': { XDriveStatePanel: 'StatePanel' },
  './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  './WorkspaceSurface': { XDriveWorkspaceSurface: 'WorkspaceSurface' },
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
    const refresh = view.root.findAll(node =>
      node.type === 'ActionButton' && node.props.children === '刷新')[0]
    assert.ok(refresh && typeof refresh.props.onClick === 'function')
    await act(async () => {
      refresh.props.onClick()
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
