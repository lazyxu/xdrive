'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const shared = read('ui/shared/src/mui/FileExplorerOwnerSourceOptions.ts')
const ownerFence = read('ui/shared/src/mui/FileExplorerOwnerFence.ts')

function load(filename, content, dependencies = {}) {
  const result = ts.transpileModule(content, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputText)(
    mod, mod.exports, request => {
      if (request === 'react') return React
      if (Object.hasOwn(dependencies, request)) return dependencies[request]
      throw Error('unexpected shared Files dependency ' + request)
    },
  )
  return mod.exports
}
const fence = load('FileExplorerOwnerFence.ts', ownerFence)
const { useXDriveFileExplorerOwnerSourceOptions } = load('FileExplorerOwnerSourceOptions.ts', shared, {
  './FileExplorerOwnerFence': fence,
})
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function tick() { await Promise.resolve(); await Promise.resolve() }

test('Desktop and Web consume one Owner-scoped Source filter controller', () => {
  for (const [name, source] of [['Desktop', desktop], ['Web', web]]) {
    assert.match(source, /useXDriveFileExplorerOwnerSourceOptions\(\{/)
    assert.match(source, /ownerKey: navigationSessionStorageKey \?\? ''/)
    assert.match(source, /options: searchSourceOptions/)
    assert.doesNotMatch(source, /setSearchSourceOptions\(/)
  }
  assert.match(desktop, /host: hostPort/)
  assert.match(desktop, /hostPort\.browse\.getSources\(\)/)
  assert.match(web, /host: api/)
  assert.match(web, /await api\.sources\(\)/)
  assert.match(web, /onError,\s*\}\)/)
  assert.doesNotMatch(shared, /window\.xdriveDesktop|ipcRenderer|fetch\s*\(|backup\.cgi/)
})

test('same-ID Owner switch rejects old Source rows before effect cleanup or late resolution', async () => {
  const host = {}, a = deferred(), b = deferred()
  let exposed, renderer
  function Harness({ scope, read }) {
    exposed = useXDriveFileExplorerOwnerSourceOptions({ host, ownerKey: scope, read })
    return null
  }
  const readA = () => a.promise, readB = () => b.promise
  Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness, { scope: 'ownerA', read: readA })) })
  assert.deepEqual(exposed.options, [])
  assert.equal(exposed.status, 'unverified')
  Renderer.act(() => renderer.update(React.createElement(Harness, { scope: 'ownerB', read: readB })))
  assert.deepEqual(exposed.options, [], 'account B cannot receive cached account A filters')
  await Renderer.act(async () => { b.resolve([{ id: 1, name: 'B source' }]); await tick() })
  assert.deepEqual(exposed.options, [{ id: 1, name: 'B source' }])
  assert.equal(exposed.status, 'ready')
  await Renderer.act(async () => { a.resolve([{ id: 1, name: 'A source' }]); await tick() })
  assert.deepEqual(exposed.options, [{ id: 1, name: 'B source' }], 'late A must not replace B')
  Renderer.act(() => renderer.unmount())
})

test('ready old Owner Source options are hidden immediately on same-node account switch', async () => {
  const host = {}, first = deferred(), next = deferred()
  let exposed, renderer
  function Harness({ ownerKey, read }) {
    exposed = useXDriveFileExplorerOwnerSourceOptions({ host, ownerKey, read })
    return null
  }
  Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness, { ownerKey: 'A', read: () => first.promise })) })
  await Renderer.act(async () => { first.resolve([{ id: 42, name: 'private A Source' }]); await tick() })
  assert.deepEqual(exposed.options, [{ id: 42, name: 'private A Source' }])
  Renderer.act(() => renderer.update(React.createElement(Harness, { ownerKey: 'B', read: () => next.promise })))
  assert.deepEqual(exposed.options, [], 'old verified Source must disappear synchronously for B')
  assert.equal(exposed.status, 'unverified')
  await Renderer.act(async () => { next.resolve([{ id: 42, name: 'B Source' }]); await tick() })
  assert.deepEqual(exposed.options, [{ id: 42, name: 'B Source' }])
  Renderer.act(() => renderer.unmount())
})

test('a disposed Source read never publishes an error or calls an unmounted owner', async () => {
  const host = {}, pending = deferred(), errors = []
  let exposed, renderer
  function Harness() {
    exposed = useXDriveFileExplorerOwnerSourceOptions({
      host, ownerKey: 'A', read: () => pending.promise,
      onError: error => errors.push(error.message),
    })
    return null
  }
  Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness)) })
  assert.equal(exposed.status, 'unverified')
  Renderer.act(() => renderer.unmount())
  pending.reject(new Error('late disposed Source failure'))
  await tick()
  assert.deepEqual(errors, [])
})

test('replaced Host and unmounted caller ignore stale errors and preserve truthful read state', async () => {
  const aHost = {}, bHost = {}, a = deferred(), b = deferred(), errors = []
  let exposed, renderer
  function Harness({ host, read }) {
    exposed = useXDriveFileExplorerOwnerSourceOptions({
      host, ownerKey: 'same-account-name', read,
      onError: error => errors.push(error.message),
    })
    return null
  }
  Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness, { host: aHost, read: () => a.promise })) })
  Renderer.act(() => renderer.update(React.createElement(Harness, { host: bHost, read: () => b.promise })))
  await Renderer.act(async () => { a.reject(new Error('old Host failure')); await tick() })
  assert.deepEqual(errors, [], 'replaced Host cannot publish an old failure')
  assert.deepEqual(exposed.options, [])
  assert.equal(exposed.status, 'unverified')
  await Renderer.act(async () => { b.reject(new Error('real current read failure')); await tick() })
  assert.deepEqual(errors, ['real current read failure'])
  assert.equal(exposed.status, 'error', 'read failure is not marked verified empty')
  Renderer.act(() => renderer.unmount())
})
