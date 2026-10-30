'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const file = path.resolve(__dirname, '../../ui/shared/src/mui/FileExplorerOwnerQuota.ts')
const src = fs.readFileSync(file, 'utf8')
const compiled = ts.transpileModule(src, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => {
    assert.equal(name, 'react')
    return React
  },
)
const hook = mod.exports.useXDriveFileExplorerOwnerQuota
function deferred() {
  let resolve, reject
  const promise = new Promise((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}
async function mount(port, revision = 0, authenticatedRootCurrent = true) {
  const history = []
  function Panel(props) {
    const overQuota = hook(props.port, props.revision, props.authenticatedRootCurrent)
    history.push(overQuota)
    return React.createElement('quota', { overQuota })
  }
  let tree
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Panel, {
      port, revision, authenticatedRootCurrent,
    }))
  })
  return {
    history,
    get value() { return tree.root.findByType('quota').props.overQuota },
    async update(port2, revision2 = 0, rootVerified = true) {
      await Renderer.act(async () => {
        tree.update(React.createElement(Panel, {
          port: port2, revision: revision2, authenticatedRootCurrent: rootVerified,
        }))
      })
    },
    async flush(fn) {
      await Renderer.act(async () => { fn(); await Promise.resolve(); await Promise.resolve() })
    },
    async unmount() { await Renderer.act(async () => tree.unmount()) },
  }
}

test('verified true enables the existing shared Files over-quota alert; false is genuine', async () => {
  const d = deferred(), signals = []
  const port = { ownerQuota(signal) { signals.push(signal); return d.promise } }
  const app = await mount(port)
  assert.equal(app.value, null, 'pending Owner quota is unknown, not false')
  assert.equal(signals.length, 1)
  await app.flush(() => d.resolve({ over_quota: true }))
  assert.equal(app.value, true)
  await app.update(port)
  assert.equal(signals.length, 1, 'unrelated repaint must not refetch Owner quota')
  await app.unmount()
  assert.equal(signals[0].aborted, true)
})

test('Owner switch invalidates stale results during render and aborts the prior request', async () => {
  const first = deferred(), second = deferred(), firstSignals = [], secondSignals = []
  const a = { ownerQuota(signal) { firstSignals.push(signal); return first.promise } }
  const b = { ownerQuota(signal) { secondSignals.push(signal); return second.promise } }
  const app = await mount(a)
  await app.update(b)
  assert.equal(firstSignals[0].aborted, true)
  assert.equal(app.value, null)
  await app.flush(() => first.resolve({ over_quota: true }))
  assert.equal(app.value, null, 'old Owner cannot publish after the new Host mounts')
  await app.flush(() => second.resolve({ over_quota: false }))
  assert.equal(app.value, false, 'real new Owner quota may be within quota')
  await app.unmount()
})

test('same Owner root revalidation clears quota immediately and rejects late old revision', async () => {
  const old = deferred(), latest = deferred(), signals = []
  const port = { ownerQuota(signal) {
    signals.push(signal)
    return signals.length === 1 ? old.promise : latest.promise
  } }
  const app = await mount(port)
  await app.update(port, 1)
  assert.equal(signals[0].aborted, true)
  await app.flush(() => old.resolve({ over_quota: true }))
  assert.equal(app.value, null)
  await app.flush(() => latest.resolve({ over_quota: true }))
  assert.equal(app.value, true)
  await app.unmount()
})

test('rejected or malformed authorized reads remain unknown, never a fabricated quota value', async () => {
  const failed = deferred(), bad = deferred()
  const portA = { ownerQuota() { return failed.promise } }
  const portB = { ownerQuota() { return bad.promise } }
  const app = await mount(portA)
  await app.flush(() => failed.reject(new Error('owner session expired')))
  assert.equal(app.value, null)
  await app.update(portB)
  await app.flush(() => bad.resolve({ over_quota: 'true' }))
  assert.equal(app.value, null)
  await app.unmount()
})

test('the shared quota boundary never stores tokens, writes files or invents an Owner role', () => {
  for (const forbidden of ['window.xdriveDesktop', 'localStorage', 'sessionStorage',
    'fetch(', 'Authorization', 'setPaused(', 'backup.cgi']) {
    assert.equal(src.includes(forbidden), false, forbidden)
  }
  const files = fs.readFileSync(path.resolve(__dirname, '../../ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
  assert.match(files, /<XDriveFilesWorkspacePage overQuota=\{verifiedOverQuota === true\}>/)
  assert.match(files, /useXDriveFileExplorerOwnerQuota\(\s*client, rootRevision, authenticatedRootCurrent/)
})


test('unauthenticated root cannot start a quota read; late values cannot cross root admission', async () => {
  const first = deferred(), second = deferred(), signals = []
  const port = { ownerQuota(signal) {
    signals.push(signal)
    return signals.length === 1 ? first.promise : second.promise
  } }
  const app = await mount(port, 0, false)
  assert.equal(signals.length, 0, 'before real Owner root no quota RPC is allowed')
  assert.equal(app.value, null)
  await app.update(port, 0, true)
  assert.equal(signals.length, 1)
  await app.update(port, 0, false)
  assert.equal(signals[0].aborted, true)
  assert.equal(app.value, null, 'Owner root revocation hides a prior positive badge immediately')
  await app.flush(() => first.resolve({ over_quota: true }))
  assert.equal(app.value, null, 'late prior Owner result cannot reappear')
  await app.update(port, 1, true)
  assert.equal(signals.length, 2)
  await app.flush(() => second.resolve({ over_quota: false }))
  assert.equal(app.value, false)
  await app.unmount()
})

test('quota readiness is tied to verified root, not per-folder sort or page repaint', async () => {
  const signalList = []
  const port = { ownerQuota(signal) {
    signalList.push(signal)
    return Promise.resolve({ over_quota: true })
  } }
  const app = await mount(port, 3, true)
  assert.equal(app.value, true)
  await app.update(port, 3, true)
  await app.update(port, 3, true)
  assert.equal(signalList.length, 1, 'no extra quota read for same verified root')
  await app.unmount()
})
