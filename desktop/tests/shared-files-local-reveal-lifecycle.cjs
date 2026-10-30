'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/FileExplorerLocalRevealIntent.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module','exports','require',compiled.outputText)(
  mod,mod.exports, name => {
    assert.equal(name, 'react')
    return React
  })
const hook = mod.exports.useXDriveFileExplorerLocalReveal

async function mount(options = {}) {
  let rendered, tree
  const initial = {
    lifecycleKey: 'server-a:owner-a',
    requestPrefix: 'local',
    externalKey: '',
    ...options,
  }
  function Harness(props) {
    rendered = hook(props)
    return null
  }
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Harness, initial))
  })
  return {
    get value() { return rendered },
    async update(next) {
      await Renderer.act(async () => {
        tree.update(React.createElement(Harness, { ...initial, ...next }))
      })
    },
    async call(action) {
      let result
      await Renderer.act(async () => { result = action(rendered) })
      return result
    },
    async unmount() { await Renderer.act(async () => tree.unmount()) },
  }
}

test('Web/PWA and Desktop emit one bounded local reveal ticket per accepted read intent', async () => {
  for (const requestPrefix of ['local','desktop-local']) {
    const app = await mount({ requestPrefix })
    assert.equal(app.value.localRevealTarget, null)
    for (const pair of [[0,9],[9,-1],[1.5,2],[2,NaN],[2,Number.MAX_SAFE_INTEGER+1]]) {
      assert.equal(await app.call(s => s.requestReveal(...pair)), false)
      assert.equal(app.value.localRevealTarget, null)
    }
    assert.equal(await app.call(s => s.requestReveal(10,20)), true)
    const first = app.value.localRevealTarget
    assert.deepEqual(first, {
      parentID:10,nodeID:20,requestID:requestPrefix+':server-a:owner-a:1',
    })
    await app.call(s => s.requestReveal(10,21))
    assert.equal(app.value.localRevealTarget.requestID,
      requestPrefix+':server-a:owner-a:2',
      'a second lookup must supersede a previous same-file ticket')
    await app.unmount()
  }
})

test('a prior account callback cannot publish after A -> B -> A, even with repeated node IDs', async () => {
  const app = await mount()
  const oldA = app.value.requestReveal
  await app.call(s => s.requestReveal(12,42))
  await app.update({ lifecycleKey:'server-b:owner-b' })
  assert.equal(app.value.localRevealTarget,null,
    'new account must hide former Owner reveal synchronously')
  const oldB = app.value.requestReveal
  assert.equal(await app.call(() => oldA(12,42)),false)
  assert.equal(app.value.localRevealTarget,null)
  await app.call(s => s.requestReveal(12,42))
  assert.match(app.value.localRevealTarget.requestID,/server-b:owner-b/)
  await app.update({ lifecycleKey:'server-a:owner-a' })
  assert.equal(app.value.localRevealTarget,null)
  assert.equal(await app.call(() => oldA(12,42)),false)
  assert.equal(await app.call(() => oldB(12,42)),false)
  assert.equal(app.value.localRevealTarget,null)
  await app.call(s => s.requestReveal(12,42))
  assert.match(app.value.localRevealTarget.requestID,/server-a:owner-a:3$/)
  await app.unmount()
})

test('a new Web route deep link supersedes an in-app lookup immediately', async () => {
  const app = await mount({ externalKey:'route:owner-a:1:2' })
  await app.call(s => s.requestReveal(3,4))
  assert.ok(app.value.localRevealTarget)
  const prior = app.value.requestReveal
  await app.update({ externalKey:'route:owner-a:9:10' })
  assert.equal(app.value.localRevealTarget,null)
  assert.equal(await app.call(() => prior(3,4)),false)
  assert.equal(app.value.localRevealTarget,null)
  await app.call(s => s.requestReveal(9,10))
  assert.ok(app.value.localRevealTarget)
  await app.unmount()
})

test('real Web and Desktop use one shared controller, no render-phase state update', () => {
  const web = fs.readFileSync(path.join(root,'web/src/WebFileExplorer.tsx'),'utf8')
  const desktop = fs.readFileSync(path.join(root,'desktop/src/renderer/DesktopFileExplorer.tsx'),'utf8')
  for (const code of [web,desktop]) {
    assert.match(code,/useXDriveFileExplorerLocalReveal\(\{/)
    assert.match(code,/localRevealTarget, requestReveal/)
    assert.match(code,/requestReveal\(location\.parent_id, location\.node_id\)|requestReveal\(target\.parentID, target\.nodeID\)/)
    assert.doesNotMatch(code,/revealSequenceRef/)
  }
  assert.match(web,/externalKey: routeRevealKey/)
  assert.doesNotMatch(web,/setLocalRevealTarget/)
  assert.match(desktop,/requestPrefix: 'desktop-local'/)
  assert.doesNotMatch(source,/fetch\s*\(|ipcRenderer|window\.|localStorage|upload|delete/)
})
