'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const repo = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
const web = read('web/src/WebFileExplorer.tsx')
const shared = read('ui/shared/src/mui/FileExplorerOwnerSourceOptions.ts')
const ownerFence = read('ui/shared/src/mui/FileExplorerOwnerFence.ts')

function load(filename, source, deps = {}) {
  const compiled = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const result = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    result, result.exports, name => {
      if (name === 'react') return React
      if (Object.hasOwn(deps, name)) return deps[name]
      throw new Error('Unexpected source-options dependency: ' + name)
    },
  )
  return result.exports
}
const fence = load('FileExplorerOwnerFence.ts', ownerFence)
const { useXDriveFileExplorerOwnerSourceOptions } = load('FileExplorerOwnerSourceOptions.ts', shared, {
  './FileExplorerOwnerFence': fence,
})
function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}
async function flush() { await Promise.resolve(); await Promise.resolve() }

test('Web FileExplorer uses the real common Owner Source lifecycle, not a duplicate page effect', () => {
  assert.match(web, /useXDriveFileExplorerOwnerSourceOptions\(\{/)
  assert.match(web, /host: api,\s*ownerKey: navigationSessionStorageKey \?\? ''/)
  assert.match(web, /read: loadSourceOptions,\s*onError/)
  assert.match(web, /await api\.sources\(\)/)
  assert.doesNotMatch(web, /setSearchSourceOptions\(/)
})

test('Web FileExplorer cannot publish a late prior-account Source read', async () => {
  const pendingA = deferred(), pendingB = deferred(), errors = []
  let exposed, renderer, account = 'A'
  const api = { sources: () => account === 'A' ? pendingA.promise : pendingB.promise }
  const readSources = () => api.sources()
  function Harness({ scope }) {
    exposed = useXDriveFileExplorerOwnerSourceOptions({
      host: api, ownerKey: scope,
      read: readSources,
      onError: error => errors.push(error instanceof Error ? error.message : String(error)),
    })
    return null
  }
  Renderer.act(() => { renderer = Renderer.create(React.createElement(Harness, { scope: 'account-A' })) })
  account = 'B'
  Renderer.act(() => renderer.update(React.createElement(Harness, { scope: 'account-B' })))
  assert.equal(exposed.status, 'unverified')
  assert.deepEqual(exposed.options, [])
  await Renderer.act(async () => {
    pendingB.resolve([{ id: 2, name: 'B source' }])
    await flush()
  })
  assert.deepEqual(exposed.options, [{ id: 2, name: 'B source' }])
  await Renderer.act(async () => {
    pendingA.resolve([{ id: 1, name: 'A source' }])
    await flush()
  })
  assert.deepEqual(exposed.options, [{ id: 2, name: 'B source' }],
    'late A cannot overwrite the authorized B Search Source options')
  assert.deepEqual(errors, [])
  Renderer.act(() => renderer.unmount())
})
