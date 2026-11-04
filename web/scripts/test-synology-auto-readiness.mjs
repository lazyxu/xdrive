#!/usr/bin/env node
// Existing DSM owning-Agent schedule CGI/IPC observation, NOT a clock-driven
// browser scheduler or complete Source/CAS certification.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(root, 'ui/shared/src/device-backup-auto-readiness.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(x =>
  x.category === ts.DiagnosticCategory.Error).length, 0)
const exports = {}
const ctx = vm.createContext({ exports, module: { exports } })
vm.runInContext(compiled.outputText, ctx, { filename, timeout: 1000 })
const view = ctx.module.exports.xDriveLocalBackupAutoReadinessView

const sourcePlan = {
  source_id: 42, revision: 7, schedule_type: 'interval',
  schedule_expression: '6h', schedule_timezone: '',
}
const ready = { ...sourcePlan, auto_readiness: 'checkpoint_ready',
  next_scheduled_at: '2026-11-04T06:00:00Z' }
const observed = view(ready)
assert.equal(observed.needsAttention, false)
assert.equal(observed.nextScheduledAt, '2026-11-04T06:00:00.000Z')
assert.match(observed.title, /检查点已核实/)
assert.match(observed.detail, /不保证 Agent 同时启动/)
assert.equal(view({ ...sourcePlan, auto_readiness: 'checkpoint_unverified' }).needsAttention, true)
assert.match(view({ ...sourcePlan, auto_readiness: 'checkpoint_unverified' }).detail, /不会盲目自动上传/)
assert.match(view({ ...sourcePlan, auto_readiness: 'review_required' }).title, /需核对收据/)
assert.equal(view({ ...sourcePlan, auto_readiness: 'review_required' }).nextScheduledAt, undefined)
assert.match(view({ ...sourcePlan, auto_readiness: 'ineligible_source' }).detail, /Source 非 Backup/)
assert.equal(view({ ...sourcePlan }).needsAttention, true,
  'legacy Agent must not look ready based only on saved Server schedule')
assert.equal(view({ ...sourcePlan, auto_readiness: 'unavailable' }).needsAttention, true)
assert.equal(view({ ...sourcePlan, schedule_type: 'manual',
  schedule_expression: '', auto_readiness: 'manual' }).needsAttention, false)
assert.equal(view({ ...sourcePlan, schedule_type: '',
  schedule_expression: '', auto_readiness: 'not_enabled' }).needsAttention, false)
for (const untrusted of [
  { ...sourcePlan, source_id: 0, auto_readiness: 'checkpoint_ready' },
  { ...sourcePlan, revision: 0, auto_readiness: 'checkpoint_ready' },
  { ...sourcePlan, auto_readiness: 'checkpoint_ready' },
  { ...sourcePlan, auto_readiness: 'checkpoint_ready',
    next_scheduled_at: 'yesterday or never' },
  { ...sourcePlan, auto_readiness: 'checkpoint_ready',
    next_scheduled_at: '2026-11-04T00:00:00Z\nprivate' },
  { ...sourcePlan, auto_readiness: 'review_required',
    next_scheduled_at: ready.next_scheduled_at },
  { ...sourcePlan, auto_readiness: 'COMPLETE', next_scheduled_at: ready.next_scheduled_at },
  { ...sourcePlan, schedule_type: 'manual', auto_readiness: 'checkpoint_ready',
    next_scheduled_at: ready.next_scheduled_at },
]) {
  assert.equal(view(untrusted).needsAttention, true)
  assert.equal(view(untrusted).nextScheduledAt, undefined,
    'untrusted Agent/UI status may never invent an eligible schedule')
}

// Bind the existing shared Desktop/DSM plan dialog, not a second DSM-only
// control panel or browser-origin timer.
const dialog = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/DeviceBackupLocalScheduleDialog.tsx'), 'utf8')
for (const text of [
  "import { xDriveLocalBackupAutoReadinessView }",
  'const readiness = loaded ? xDriveLocalBackupAutoReadinessView(loaded) : null',
  'readiness.nextScheduledAt',
  '此时间不是实际开始上传或整份备份完成的承诺',
  '对应已保存的计划',
]) assert.ok(dialog.includes(text), 'shared backup status wiring missing: ' + text)
assert.ok(!dialog.includes('setInterval('), 'shared schedule editor must not be a second scheduler')
console.log('DSM owning-Agent read-only readiness is bounded, conservative and shared with Desktop.')
