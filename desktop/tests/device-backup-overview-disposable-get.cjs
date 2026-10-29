'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/DeviceBackupPage.tsx'
const source = fs.readFileSync(path.join(root, file), 'utf8')

function actualOverviewEffect(env) {
  // Source-execute the real React effect body, not a rewritten cancellation
  // model. The surrounding React state setter is faithfully represented.
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let arrow = null
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const candidate = node.arguments[0]
      if (candidate && ts.isArrowFunction(candidate) &&
          candidate.getText(ast).includes('source.list(controller.signal)')) {
        assert.equal(arrow, null, 'overview must have a single GET-owned effect')
        arrow = candidate.getText(ast)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.ok(arrow, 'the real shared overview effect must own the optional signal')
  const js = ts.transpileModule('const effect = ' + arrow + ';', {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const names = Object.keys(env)
  return new Function(...names, js + '\nreturn effect')(...names.map(key => env[key]))
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function mount(source, initial = { overview: null, loading: false, failed: false }) {
  let snapshot = initial
  const calls = []
  const effect = actualOverviewEffect({
    source,
    setSnapshot: update => {
      snapshot = typeof update === 'function' ? update(snapshot) : update
      calls.push(snapshot)
    },
    validateXDriveDeviceBackupInitialOverview: overview => {
      if (!Array.isArray(overview.devices)) throw Error('not an authoritative overview')
    },
  })
  return {
    effect,
    get snapshot() { return snapshot },
    get calls() { return calls },
  }
}
test('Device Backup Owner A -> B cancels prior overview GET and blocks late non-cooperative result', async () => {
  const older = deferred(), newer = deferred(), signals = []
  const a = { list: signal => { signals.push(['A', signal]); return older.promise } }
  const b = { list: signal => { signals.push(['B', signal]); return newer.promise } }
  const old = mount(a)
  const disposeOld = old.effect()
  assert.equal(old.snapshot.loading, true)
  assert.equal(signals[0][1].aborted, false)
  disposeOld()
  assert.equal(signals[0][1].aborted, true)
  const current = mount(b)
  const disposeB = current.effect()
  try {
    assert.equal(signals[1][1].aborted, false)
    assert.equal(current.snapshot.overview, null)
    newer.resolve({ devices: [{ id: 'safe-B' }] })
    await tick()
    assert.equal(current.snapshot.overview.devices[0].id, 'safe-B')
    assert.equal(current.snapshot.loading, false)
    older.resolve({ devices: [{ id: 'private-A' }] })
    await tick()
    assert.equal(old.calls.some(call => call.overview?.devices?.[0]?.id === 'private-A'), false)
    assert.equal(current.snapshot.overview.devices[0].id, 'safe-B')
  } finally {
    older.resolve({ devices: [] })
    newer.resolve({ devices: [] })
    disposeB()
  }
})
test('Device Backup same-Owner refresh retains accepted snapshot and prevents stale failure', async () => {
  const stale = deferred(), latest = deferred()
  const signals = []
  let attempt = 0
  const source = { list: signal => {
    signals.push(signal)
    attempt++
    return attempt === 1 ? stale.promise : latest.promise
  } }
  const stable = { devices: [{ id: 'accepted' }] }
  const first = mount(source, { source, overview: stable, loading: false, failed: false })
  const cancelFirst = first.effect()
  assert.equal(first.snapshot.overview, stable, 'accepted same-Owner rows stay visible while refreshing')
  cancelFirst()
  assert.equal(signals[0].aborted, true)
  const successor = mount(source, first.snapshot)
  const cancelSuccessor = successor.effect()
  try {
    assert.equal(successor.snapshot.overview, stable)
    latest.resolve({ devices: [{ id: 'new-valid' }] })
    await tick()
    stale.reject(new Error('expired source connection'))
    await tick()
    assert.equal(first.snapshot.failed, false, 'aborted stale read must not report an active error')
    assert.equal(successor.snapshot.overview.devices[0].id, 'new-valid')
    assert.equal(successor.snapshot.failed, false)
    assert.equal(signals[1].aborted, false)
  } finally {
    stale.resolve(stable)
    latest.resolve(stable)
    cancelSuccessor()
  }
})
test('Device Backup route exit sends only the read AbortSignal, never a backup/Push/Pull Cancel', async () => {
  const pending = deferred(), readSignals = []
  const activeBackup = new AbortController()
  const durableCalls = []
  const source = {
    list: signal => { readSignals.push(signal); return pending.promise },
    startBackup: () => durableCalls.push('started'),
    cancelBackup: () => durableCalls.push('cancelled'),
  }
  const app = mount(source)
  const cleanup = app.effect()
  cleanup()
  assert.equal(readSignals[0].aborted, true)
  assert.equal(activeBackup.signal.aborted, false)
  assert.deepEqual(durableCalls, [])
  pending.resolve({ devices: [{ id: 'unmounted' }] })
  await tick()
  assert.equal(app.snapshot.overview, null)
  assert.equal(app.snapshot.failed, false)
  assert.match(sourceText(), /list\(signal\?: AbortSignal\): Promise<XDriveDeviceBackupOverview>/)
  function sourceText() {
    return fs.readFileSync(path.join(root, 'ui/shared/src/device-backups.ts'), 'utf8')
  }
})
