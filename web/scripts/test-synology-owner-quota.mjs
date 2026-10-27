#!/usr/bin/env node
// Runs the actual DSM Owner quota source through the real same-origin
// transport. No Server, NAS account or credential required.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(repo, 'ui/shared/src/synology-backup-adapter.ts')
const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((js.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const calls = []
const data = {
  quota_bytes: 8000, physical_used_bytes: 1200, reserved_bytes: 300,
  available_bytes: 6500, logical_file_bytes: 5000, trash_bytes: 200,
  history_bytes: 100, over_quota: false, disk_total_bytes: 10000,
  disk_available_bytes: 8500,
}
let nextData = data
let nextStatus = 200
const exports = {}
const ctx = vm.createContext({
  exports, module: { exports }, URL, TextEncoder,
  window: { location: { href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example' } },
  fetch: async (raw, options) => {
    const url = new URL(raw)
    calls.push({url,options})
    if (url.search !== '?op=cloud-quota') throw Error('unexpected Agent operation')
    return {
      ok: nextStatus === 200, status: nextStatus,
      headers: { get: () => 'application/json' },
      json: async () => nextData,
    }
  },
})
vm.runInContext(js.outputText, ctx, { filename, timeout: 1000 })
const local = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
const source = ctx.module.exports.createXDriveSynologyCloudStorageDataSource(local)
const controller = new AbortController()
const snapshot = await source.load(controller.signal)
assert.equal(snapshot.quota.quota_bytes, 8000)
assert.equal(snapshot.quota.reserved_bytes, 300)
assert.equal(snapshot.quota.disk_total_bytes, 10000)
assert.equal(snapshot.stats, undefined)
assert.match(snapshot.statsUnavailableMessage, /CAS 统计尚未接通/)
assert.equal(calls.length, 1)
assert.equal(calls[0].options.signal, controller.signal)
assert.equal(calls[0].options.method, 'GET')
assert.equal(calls[0].options.credentials, 'same-origin')
assert.equal(calls[0].options.redirect, 'error')
assert.equal(calls[0].url.origin, 'https://nas.example')
assert.equal(calls[0].options.headers.Authorization, undefined)

for (const bad of [
  { ...data, reserved_bytes: -1 },
  { ...data, reserved_bytes: undefined },
  { ...data, logical_file_bytes: Number.MAX_SAFE_INTEGER + 1 },
  { ...data, over_quota: 'false' },
  { ...data, root_path: '/private/system' },
]) {
  nextData = bad
  await assert.rejects(source.load(), /Invalid authenticated/)
}
nextData = data
nextStatus = 403
await assert.rejects(source.load(), /HTTP 403/)
assert.equal(calls.every(c => c.url.search === '?op=cloud-quota'), true)
console.log('DSM Owner quota stays Server-authorized, source-bounded, read-only and has no bearer')
