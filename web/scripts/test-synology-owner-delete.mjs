#!/usr/bin/env node
// Execute the real DSM Owner move-to-trash adapter. Only one verified node
// is accepted; the browser never receives Server credentials or Agent paths.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fileName = path.join(root, 'ui/shared/src/synology-backup-adapter.ts')
const code = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
  fileName, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((code.diagnostics || []).filter(
  item => item.category === ts.DiagnosticCategory.Error).length, 0)
const calls = []
const scope = 'a'.repeat(64)
let ack = { ok: true }
let statusCode = 200
const exports = {}
const context = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  } },
  fetch: async (raw, options) => {
    const url = new URL(raw)
    calls.push({ url, options })
    assert.equal(url.origin, 'https://nas.example')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    if (url.searchParams.get('op') === 'bootstrap') {
      assert.equal(options.method, 'GET')
      return { ok: true, headers: { get: () => 'application/json' },
        json: async () => ({ csrf_token: 'f'.repeat(64) }) }
    }
    assert.equal(url.searchParams.get('op'), 'cloud-delete-node')
    assert.equal(options.method, 'POST', 'DSM CGI accepts POST, not arbitrary DELETE')
    assert.equal(options.headers['X-CSRF-Token'], 'f'.repeat(64))
    assert.deepEqual(JSON.parse(options.body), {
      id: 42, revision: 7, parent_id: 17,
      type: 'file', name: 'report.txt', owner_scope: scope,
    })
    return { ok: statusCode === 200, status: statusCode,
      headers: { get: () => 'application/json' }, json: async () => ack }
  },
})
vm.runInContext(code.outputText, context, { filename: fileName, timeout: 1000 })
const client = context.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
await client.ownerDeleteNode(42, 7, 17, 'file', 'report.txt', scope)
assert.equal(calls.length, 2, 'one CSRF bootstrap and one authenticated trash operation')
for (const bad of [
  [0, 7, 17, 'file', 'report.txt', scope],
  [42, 0, 17, 'file', 'report.txt', scope],
  [42, 7, 0, 'file', 'report.txt', scope],
  [42, 7, 17, 'symlink', 'report.txt', scope],
  [42, 7, 17, 'file', '../local.txt', scope],
  [42, 7, 17, 'file', 'report.txt', 'foreign'],
]) {
  const count = calls.length
  await assert.rejects(() => client.ownerDeleteNode(...bad))
  assert.equal(calls.length, count, 'forged selector contacted the owning Agent')
}
const controller = new AbortController()
controller.abort()
await assert.rejects(() => client.ownerDeleteNode(
  42, 7, 17, 'file', 'report.txt', scope, controller.signal))
const invalidResponses = [
  { ok: false }, { ok: true, extra: true }, {}, { accepted: true }, null, [],
]
for (const bad of invalidResponses) {
  ack = bad
  await assert.rejects(() => client.ownerDeleteNode(
    42, 7, 17, 'file', 'report.txt', scope),
  /Unverified Server Owner move-to-trash response/)
}
statusCode = 409
await assert.rejects(() => client.ownerDeleteNode(
  42, 7, 17, 'file', 'report.txt', scope), /HTTP 409/)
const ui = fs.readFileSync(path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const host = fs.readFileSync(path.join(root, 'web/src/synologyHost.ts'), 'utf8')
const gateway = fs.readFileSync(path.join(root, 'internal/synologyui/gateway.go'), 'utf8')
const ipc = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/desktop_ipc_runtime_mode.go'), 'utf8')
assert.match(ui, /<XDriveConfirmDialog/)
assert.match(ui, /confirmIntent="danger"/)
assert.match(ui, /onDeleteItems=\{selected => \{/)
assert.match(ui, /xDriveFindVerifiedOwnerSelection\(/)
assert.match(ui, /client\.ownerDeleteNode\(/)
assert.match(ui, /count !== 1 \|\| selected\.length !== 1/)
assert.match(ui, /delete: '退出搜索后进入目标文件夹才能移入回收站。'/)
assert.doesNotMatch(host, /delete: 'DSM Owner 文件目前没有经过授权/)
assert.match(host, /uploadFolder: 'DSM Owner 文件夹上传尚未接通/)
assert.match(gateway, /serveDSMOwnerNodeDelete\(/)
assert.match(ipc, /"DELETE \/v1\/cloud\/nodes"/)
assert.doesNotMatch(ui, /window\.xdriveDesktop|local_path|fetch\s*\(/)
console.log('DSM exact one-node Owner trash: original Server operation, scoped confirmation, no arbitrary local path.')
