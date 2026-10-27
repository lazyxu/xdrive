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
console.log('DSM batch status rejects wrong Owner, fake completion, CAS proof and counters.')
