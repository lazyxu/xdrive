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
const name = 'ui/shared/src/mui/FileExplorerOwnerActionLifecycle.ts'
const source = read(name)
const originalFence = read('ui/shared/src/mui/FileExplorerOwnerFence.ts')

function transpile(filename, content, local = {}) {
  const compiled = ts.transpileModule(content, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const m = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    m, m.exports, request => request === 'react' ? React :
      (Object.hasOwn(local, request) ? local[request] : (() => { throw Error(request) })()),
  )
  return m.exports
}
const fence = transpile('FileExplorerOwnerFence.ts', originalFence)
const { useXDriveFileExplorerOwnerActionLifecycle } = transpile(name, source, {
  './FileExplorerOwnerFence': fence,
})

test('shared Files Owner action lease is exclusive and rejects late account and Host completions', () => {
  const desktopHost = {}, dsmHost = {}
  let current
  function Harness({ host, scope }) {
    current = useXDriveFileExplorerOwnerActionLifecycle(host, scope)
    return null
  }
  let renderer
  const render = (host, scope) => {
    Renderer.act(() => {
      const element = React.createElement(Harness, { host, scope })
      if (renderer) renderer.update(element)
      else renderer = Renderer.create(element)
    })
    return current
  }
  const a = render(desktopHost, 'serverA/ownerA/files')
  let tokenA
  Renderer.act(() => { tokenA = a.beginActionBusy('download') })
  assert.ok(tokenA)
  assert.equal(a.isActionBusyCurrent(tokenA), true)
  assert.equal(a.beginActionBusy('upload'), null, 'second action may not overlap')
  const aGeneration = a.actionGenerationRef.current
  const b = render(desktopHost, 'serverA/ownerB/files')
  assert.equal(a.isActionBusyCurrent(tokenA), false, 'Owner A completion must be stale')
  assert.notEqual(b.actionGenerationRef.current, aGeneration, 'same-ID new Owner retires old media tickets')
  let tokenB
  Renderer.act(() => { tokenB = b.beginActionBusy('upload') })
  assert.ok(tokenB)
  a.finishActionBusy(tokenA)
  assert.equal(b.isActionBusyCurrent(tokenB), true, 'stale completion cannot clear B')
  const c = render(dsmHost, 'serverA/ownerB/files')
  assert.equal(b.isActionBusyCurrent(tokenB), false, 'same scope but replacement Host invalidates token')
  let tokenC
  Renderer.act(() => { tokenC = c.beginActionBusy('rename') })
  assert.ok(tokenC)
  Renderer.act(() => c.finishActionBusy(tokenC))
  assert.equal(c.isActionBusyCurrent(tokenC), false)
  Renderer.act(() => renderer.unmount())
  assert.equal(c.beginActionBusy('late'), null, 'unmounted owner must not start new work')
})

test('Desktop delegates owning action lifecycle without exposing privileged API to shared code', () => {
  const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
  const index = read('ui/shared/src/mui/index.tsx')
  assert.match(desktop, /useXDriveFileExplorerOwnerActionLifecycle\(/)
  assert.ok(desktop.includes('actionGenerationRef.current'), 'media ticket generation remains bounded')
  assert.ok(desktop.includes('actionBusyRef.current'), 'persistent write conflict guard remains')
  assert.ok(index.includes("export * from './FileExplorerOwnerActionLifecycle'"))
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|backup\.cgi|fetch\s*\(/)
})
