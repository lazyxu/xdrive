#!/usr/bin/env node
// DSM single-node Move To must use only the current authenticated Owner,
// the original Agent's revision-checking Server operation, and shared picker.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const filename = path.join(root, 'ui/shared/src/synology-backup-adapter.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((compiled.diagnostics || []).filter(
  item => item.category === ts.DiagnosticCategory.Error).length, 0)
const scope = 'a'.repeat(64)
let receipt = {
  id: 42, revision: 8, parent_id: 29, type: 'file', name: 'a.txt',
  size: 8, created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:01Z',
}
let status = 200
const calls = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (href, options) => {
    const url = new URL(href)
    calls.push({ url, options })
    assert.equal(url.origin, 'https://nas.example')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    const op = url.searchParams.get('op')
    if (op === 'bootstrap') {
      return { ok: true, headers: { get: () => 'application/json' },
        json: async () => ({ csrf_token: 'f'.repeat(64) }) }
    }
    assert.equal(op, 'cloud-move-node')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['X-CSRF-Token'], 'f'.repeat(64))
    assert.deepEqual(JSON.parse(options.body), {
      id: 42, revision: 7, parent_id: 17, target_parent_id: 29,
      type: 'file', name: 'a.txt', owner_scope: scope,
    })
    return { ok: status === 200, status,
      headers: { get: () => 'application/json' }, json: async () => receipt }
  },
})
vm.runInContext(compiled.outputText, ctx, { filename, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const move = (signal) => client.ownerMoveNode(42, 7, 17, 29, 'file', 'a.txt', scope, signal)
assert.equal((await move()).revision, 8)
assert.equal(calls.length, 2, 'one bootstrap and one authenticated single-node move')
for (const args of [
  [0, 7, 17, 29, 'file', 'a.txt', scope],
  [42, 0, 17, 29, 'file', 'a.txt', scope],
  [42, 7, 29, 29, 'file', 'a.txt', scope],
  [42, 7, 17, 42, 'dir', 'a.txt', scope],
  [42, 7, 17, 29, 'symlink', 'a.txt', scope],
  [42, 7, 17, 29, 'file', '../a.txt', scope],
  [42, 7, 17, 29, 'file', 'a.txt', 'foreign'],
]) {
  const before = calls.length
  await assert.rejects(() => client.ownerMoveNode(...args))
  assert.equal(calls.length, before, 'invalid selector reached Agent')
}
const aborted = new AbortController()
aborted.abort()
const beforeAbort = calls.length
await assert.rejects(() => move(aborted.signal), /cancelled/)
assert.equal(calls.length, beforeAbort, 'cancelled move reached Agent')
for (const bad of [
  { ...receipt, id: 43 },
  { ...receipt, revision: 7 },
  { ...receipt, parent_id: 17 },
  { ...receipt, type: 'dir' },
  { ...receipt, name: 'foreign.txt' },
  { ...receipt, local_path: '/volume1' },
]) {
  receipt = bad
  await assert.rejects(() => move(), /Invalid current Server Owner move acknowledgement/)
}
status = 409
await assert.rejects(() => move(), /HTTP 409/)

const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const host = fs.readFileSync(path.join(root, 'web/src/synologyHost.ts'), 'utf8')
const gateway = fs.readFileSync(path.join(root, 'internal/synologyui/gateway.go'), 'utf8')
const mode = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/desktop_ipc_runtime_mode.go'), 'utf8')
assert.match(page, /<XDriveFileExplorerDestinationDialog/)
assert.match(page, /operation="move"/)
assert.match(page, /onMoveItemsTo=\{selected => \{/)
assert.match(page, /client\.ownerMoveNode\(/)
assert.match(page, /count !== 1 \|\| selected\.length !== 1/)
assert.match(page, /xDriveFileExplorerDestinationTargetDisabledReason/)
assert.match(page, /moveTo: '退出搜索后进入目标文件夹才能移动。'/)
assert.doesNotMatch(host, /moveTo: 'DSM Owner 文件目前没有经过授权/)
assert.match(host, /copyTo: 'DSM Owner 文件目前没有经过授权/)
assert.match(gateway, /serveDSMOwnerNodeMove\(/)
assert.match(mode, /"PATCH \/v1\/cloud\/move"/)
assert.doesNotMatch(page, /window\.xdriveDesktop|local_path|fetch\s*\(/)
console.log('DSM Owner move: one verified node + target, original revision-checked Agent move, shared picker')
