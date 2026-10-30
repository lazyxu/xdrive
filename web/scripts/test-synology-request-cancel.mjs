#!/usr/bin/env node
// No external devices/secrets. Real adapter is transpiled for cancellation tests.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(root, 'ui/shared/src/synology-backup-adapter.ts')
const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((js.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const calls = []
let hold = false
function mockFetch(address, options) {
  calls.push({ address, options })
  if (hold) return new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
  const operation = new URL(address).searchParams.get('op')
  const response = operation === 'bootstrap'
    ? { dsm_user: 'owner', csrf_token: 'a'.repeat(64) }
    : operation === 'sources' ? { items: [] }
    : operation === 'cloud-quota'
      ? {
          quota_bytes: 1024, physical_used_bytes: 0, reserved_bytes: 0,
          available_bytes: 1024, logical_file_bytes: 0,
          trash_bytes: 0, history_bytes: 0, over_quota: false,
        }
      : { source_id: 42 }
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => response,
  })
}
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder, fetch: mockFetch,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
})
vm.runInContext(js.outputText, ctx, { filename, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
assert.equal((await client.list()).length, 0)
assert.equal((await client.diagnostics()).summary.pass, 2)
assert.equal((await client.ownerQuota()).available_bytes, 1024)
assert.equal(new URL(calls.at(-1).address).searchParams.get('op'), 'cloud-quota')
assert.equal(calls.at(-1).options.method, 'GET')
assert.ok(calls.every(c => c.options.credentials === 'same-origin' && c.options.redirect === 'error'))
assert.ok(calls.every(c => new URL(c.address).origin === 'https://nas.example'))
assert.ok(calls.every(c => !c.options.headers.Authorization), 'private Agent bearer exposed')
for (const call of [
  signal => client.list(signal),
  signal => client.inspect(42, signal),
  signal => client.history(42, signal),
  signal => client.diagnostics(signal),
  signal => client.ownerQuota(signal),
]) {
  hold = true
  const controller = new AbortController()
  const before = calls.length
  const promise = call(controller.signal)
  assert.equal(calls.length, before + 1, 'unexpected extra CGI requests')
  assert.equal(calls.at(-1).options.signal, controller.signal)
  controller.abort()
  await assert.rejects(promise, e => e.name === 'AbortError')
  hold = false
}
// Browser settings must reuse the already verified Agent Owner quota read,
// never make a browser-origin Server request or grant a generic CGI write.
const settingsSource = fs.readFileSync(path.join(root, 'web/src/synology.tsx'), 'utf8')
assert.match(settingsSource, /window\\.location\\.protocol === 'https:'/)
assert.match(settingsSource, /client\\.ownerQuota\\(controller\\.signal\\)/)
assert.match(settingsSource, /controllerRef\\.current\\?\\.abort\\(\\)/)
assert.match(settingsSource, /<XDriveSettingsDialog/)
assert.doesNotMatch(settingsSource, /fetch\\(|localStorage\\.setItem\\(|Authorization:/)
console.log('DSM Server Owner connection check is scoped, cancellable, and fails closed on HTTP.')
