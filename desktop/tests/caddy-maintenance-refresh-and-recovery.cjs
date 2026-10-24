'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function loadReconciler() {
  const js = ts.transpileModule(read('ui/shared/src/caddy-operation-recovery.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  assert.equal((js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const mod = { exports: {} }
  new Function('module', 'exports', js.outputText)(mod, mod.exports)
  return mod.exports.xDriveReconcileCaddyDeployReceipt
}
const now = Date.parse('2026-10-24T12:00:00Z')
const mk = (id, state, recorded_at) => ({
  protocol: 'xdrive.caddy.host-env.v1', request_id: id.repeat(24),
  sha256: 'f'.repeat(64), state, ...(recorded_at ? { recorded_at } : {}),
})

test('Caddy Host recovery cannot overlay a new in-flight task with an old failure', () => {
  const choose = loadReconciler()
  const active = mk('1', 'deploying')
  const oldFailed = mk('2', 'failed', new Date(now - 60_000).toISOString())
  assert.equal(choose(active, null, oldFailed, now), active)
  assert.equal(choose(active, null, mk('2', 'deployed', oldFailed.recorded_at), now), active)
  assert.equal(choose(null, active, oldFailed, now), active)
})

test('same original Request ID upgrades from deploying to terminal, never downgrades', () => {
  const choose = loadReconciler()
  const pending = mk('1', 'deploying')
  const completed = mk('1', 'deployed', new Date(now - 1000).toISOString())
  const failed = mk('1', 'failed', new Date(now - 1000).toISOString())
  assert.equal(choose(pending, completed, null, now), completed)
  assert.equal(choose(pending, null, failed, now), failed)
  assert.equal(choose(completed, pending, null, now), completed)
  assert.equal(choose(failed, pending, null, now), failed)
})

test('fresh Host active supersedes stale browser record; old/malformed archives do not', () => {
  const choose = loadReconciler()
  const recentFailed = mk('2', 'failed', new Date(now - 1000).toISOString())
  const current = mk('3', 'deploying')
  const old = mk('2', 'failed', new Date(now - 24 * 3600 * 1000).toISOString())
  assert.equal(choose(recentFailed, current, null, now), current)
  assert.equal(choose(null, null, recentFailed, now), recentFailed)
  assert.equal(choose(null, null, old, now), null)
  assert.equal(choose(null, { ...current, request_id: '../' }, null, now), null)
  assert.equal(choose(null, { ...current, state: 'applied' }, null, now), null)
})

test('Caddy refresh and terminal transitions update all expanded panels without resetting drafts', () => {
  const ui = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const start = ui.indexOf('const refreshAllCaddy =')
  const stop = ui.indexOf('const startDeploy =', start)
  assert.ok(start > 0 && stop > start)
  const refresh = ui.slice(start, stop)
  assert.match(refresh, /hasUnsavedEdits \|\| dirtyAtomic/)
  assert.match(refresh, /savePendingRef.current \|\| deployPendingRef.current/)
  for (const setter of ['setConfigRevision', 'setAtomicRefreshID', 'setHistoryRefreshID']) {
    assert.match(refresh, new RegExp(setter + '\\('))
  }
  assert.match(ui, /onClick=\{refreshAllCaddy\}/)
  assert.match(ui, /inlineEdit atomicMode atomicSaving=\{editorsLocked\}/)
  assert.match(ui, /atomicMode atomicSaving=\{editorsLocked\}/)
  assert.match(ui, /const canSaveAtomic = [^\n]+!editorsLocked/)
  assert.match(ui, /xDriveReconcileCaddyDeployReceipt\(prior, page.current, clean\[0\], Date.now\(\)\)/)
  assert.ok((ui.match(/setAtomicRefreshID\(\(value\) => value \+ 1\)/g) || []).length >= 4)
  assert.match(ui, /data-xdrive-caddy-host-terminal-history/)
  assert.match(ui, /data-xdrive-caddy-single-page="true"/)
  assert.doesNotMatch(ui, /Accordion|collapse|showHistory|setHistoryOpen/)
})
