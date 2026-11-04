#!/usr/bin/env node
// Own-Agent status contract, no device or credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(root, 'ui/shared/src/synology-task-status.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const exports = {}
const ctx = vm.createContext({ exports, module: { exports } })
vm.runInContext(compiled.outputText, ctx, { filename, timeout: 1000 })
const pollDelay = ctx.module.exports.xDriveDSMBackupStatusPollDelay
assert.equal(pollDelay(true, false), 10_000, 'running Source refreshes promptly')
assert.equal(pollDelay(false, false), 30_000, 'idle Source must discover a scheduled start')
assert.equal(pollDelay(true, true), 60_000, 'failed reads need backoff')
assert.equal(pollDelay(false, true), 60_000, 'idle errors must not hammer NAS Agent')
const progress = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/SynologyBackupSourceProgress.tsx'), 'utf8')
for (const required of [
  'xDriveDSMBackupStatusPollDelay(batch?.running === true, readFailed)',
  "if (loading || typeof window === 'undefined' || typeof document === 'undefined') return",
  "document.visibilityState === 'visible'",
  'window.setInterval(refreshIfVisible, pollDelay)',
  "document.addEventListener('visibilitychange', refreshIfVisible)",
  'window.clearInterval(timer)',
  "document.removeEventListener('visibilitychange', refreshIfVisible)",
  'return () => { active = false; abort.abort() }',
]) assert.ok(progress.includes(required), 'DSM scheduled Source status refresh lost: ' + required)
assert.ok(!progress.includes('if (!batch?.running'), 'idle scheduled Source was not observed')
// Unattended scheduled runs also appear in the same Source's history while
// expanded. Never poll every NAS Source or retain timers across Owner switches.
const localPanel = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/SynologyBackupLocalPanel.tsx'), 'utf8')
for (const required of [
  'if (!sameOwningClient || expandedID === null ||',
  "document.visibilityState === 'visible'",
  'window.setInterval(refreshHistoryIfVisible, 60_000)',
  "document.addEventListener('visibilitychange', refreshHistoryIfVisible)",
  'window.clearInterval(timer)',
  "document.removeEventListener('visibilitychange', refreshHistoryIfVisible)",
  '}, [client, expandedID, sameOwningClient])',
  'client.history(id, abort.signal)',
  'return () => { active = false; abort.abort() }',
]) assert.ok(localPanel.includes(required), 'DSM scheduled history refresh lost: ' + required)

// Only one expanded DSM Source may read the *saved* schedule. A configured
// interval/Cron is not proof of an armed private Agent checkpoint or next due.
const viewSchedule = ctx.module.exports.xDriveDSMBackupScheduleView
const saved = {
  source_id: 42, revision: 7, schedule_type: 'interval',
  schedule_expression: '6h', schedule_timezone: '',
}
assert.match(viewSchedule(42, saved).title, /每 6h/)
assert.equal(viewSchedule(42, saved).enabled, true)
assert.equal(viewSchedule(42, { ...saved, schedule_type: 'manual',
  schedule_expression: '' }).enabled, false)
assert.match(viewSchedule(42, { ...saved, schedule_type: '',
  schedule_expression: '' }).title, /未明确开启/)
assert.match(viewSchedule(42, { ...saved, schedule_type: 'cron',
  schedule_expression: '0 3 * * *', schedule_timezone: 'Asia/Shanghai' }).title, /Cron/)
for (const untrusted of [
  { ...saved, source_id: 43 }, { ...saved, revision: 0 },
  { ...saved, schedule_type: 'completed' },
  { ...saved, schedule_expression: '' },
  { ...saved, schedule_timezone: 'UTC' },
  { ...saved, schedule_expression: '6h' + String.fromCharCode(10) + 'Owner token' },
  { ...saved, schedule_type: 'manual' },
  { ...saved, schedule_type: 'cron', schedule_timezone: 'Asia/Shanghai' },
  { ...saved, schedule_type: 'cron', schedule_expression: '0 3 * * *' },
]) assert.throws(() => viewSchedule(42, untrusted), /Untrusted DSM backup schedule/)
assert.throws(() => viewSchedule(0, saved), /Untrusted DSM backup schedule/)
const planSurface = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/SynologyBackupScheduleStatus.tsx'), 'utf8')
for (const required of [
  'client.load(sourceID)',
  'xDriveDSMBackupScheduleView(sourceID, raw)',
  'return () => { active = false }',
  '当前 Agent 尚未提供可核验的调度时间',
]) assert.ok(planSurface.includes(required), 'DSM auto plan summary lost: ' + required)
assert.ok(localPanel.includes('<XDriveSynologyBackupScheduleStatus'),
  'DSM panel must render the schedule only for the expanded local Source')
assert.ok(localPanel.includes("key={'schedule:' + renderedHostEpoch + ':' + item.source_id}"),
  'DSM plan view must be remounted on owning Host/Source generation')
assert.ok(!planSurface.includes('client.list('), 'Do not fan out schedule reads to all Sources')
const localActions = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/DeviceBackupLocalPrimaryActions.tsx'), 'utf8')
assert.ok(localActions.includes('手动增量备份'), 'shared Desktop/DSM manual action missing')
assert.ok(!localActions.includes('手动增量备份（试用）'), 'obsolete trial label remains')

const validate = ctx.module.exports.xDriveValidateSynologyLocalBatch
const valid = {
  source_id: 42, revision: 1, state: 'partial', running: false,
  inspected_files: 10, confirmed_files: 4, skipped_files: 2,
  unsupported_files: 1, uncertain_files: 2, confirmed_bytes: 1024,
  backup_complete: false, retirement_safe: false, current_cas_verified: false,
}
assert.equal(validate(42, valid).confirmed_bytes, 1024)
assert.equal(validate(42, { ...valid, revision: 0, running: true, state: 'running' }).state, 'running')
for (const bad of [
  { ...valid, source_id: 99 }, { ...valid, backup_complete: true },
  { ...valid, current_cas_verified: true }, { ...valid, retirement_safe: true },
  { ...valid, inspected_files: -1 }, { ...valid, confirmed_files: 9 },
  { ...valid, skipped_files: 8 }, { ...valid, unsupported_files: 5 },
  { ...valid, confirmed_bytes: Infinity }, { ...valid, revision: 0 },
  { ...valid, state: 'completed' }, { ...valid, state: 'running', running: false },
  { ...valid, stop_requested: 'cancel' },
  { ...valid, stop_requested: 'delete', state: 'running', running: true },
]) assert.throws(() => validate(42, bad), /Untrusted DSM/)
assert.throws(() => validate(0, valid), /Invalid owner/)

// The same owning-Agent history used in Device Backup is now available from
// Task Center on an explicit user selection, never from an eager Source fan-out.
const validateHistory = ctx.module.exports.xDriveValidateSynologyLocalHistoryPage
const receipt = {
  source_id: 42, run_id: 'local-run-1', revision: 2, state: 'partial',
  inspected_files: 12, confirmed_files: 5, skipped_files: 2,
  unsupported_files: 1, uncertain_files: 3, confirmed_bytes: 4096,
  started_at: '2026-11-01T00:00:00Z', finished_at: '2026-11-01T00:02:00Z',
}
const goodHistory = { source_id: 42, items: [receipt] }
assert.equal(validateHistory(42, goodHistory).items[0].run_id, 'local-run-1')
assert.equal(validateHistory(42, { source_id: 42, items: [] }).items.length, 0)
for (const broken of [
  { ...goodHistory, source_id: 43 },
  { ...goodHistory, items: [null] },
  { ...goodHistory, items: [{ ...receipt, source_id: 43 }] },
  { ...goodHistory, items: [{ ...receipt, state: 'completed' }] },
  { ...goodHistory, items: [{ ...receipt, run_id: '' }] },
  { ...goodHistory, items: [{ ...receipt, revision: 0 }] },
  { ...goodHistory, items: [{ ...receipt, confirmed_files: 12 }] },
  { ...goodHistory, items: [{ ...receipt, finished_at: 'not-a-date' }] },
  { ...goodHistory, items: [receipt, receipt] },
  { ...goodHistory, items: Array.from({ length: 21 }, (_, i) => ({
    ...receipt, run_id: 'run-' + i,
  })) },
]) assert.throws(() => validateHistory(42, broken), /Untrusted DSM local history/)
assert.throws(() => validateHistory(0, goodHistory), /Invalid owner/)
const tasks = fs.readFileSync(path.join(root,
  'ui/shared/src/mui/SynologyLocalTaskSection.tsx'), 'utf8')
for (const contract of [
  'client.history(id, abort.signal)',
  'xDriveValidateSynologyLocalHistoryPage(id, page)',
  '<XDriveDeviceBackupHistoryList',
  'historyView.hostEpoch === hostEpoch',
  'hostEpochRef.current.client === client',
  'visibleSources.some((item) => item.source_id === selectedID)',
  'return () => { active = false; abort.abort() }',
  "setHistoryExpanded(value => !value)",
  "kind: 'local-receipt' as const",
]) assert.ok(tasks.includes(contract), 'DSM Task Center lost bounded Owner history: ' + contract)
console.log('DSM batch status and on-demand Source history retain current Owner and non-authoritative receipt boundaries.')
