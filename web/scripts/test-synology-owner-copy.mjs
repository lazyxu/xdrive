#!/usr/bin/env node
// DSM Owner copy is one authenticated Server copy through the original Agent.
// Copy's Server route has NO source revision CAS; tests don't imply otherwise.
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
  x => x.category === ts.DiagnosticCategory.Error).length, 0)
const scope = 'a'.repeat(64)
let node = { id: 77, parent_id: 29, type: 'file', name: 'a (1).txt',
  revision: 1, size: 8, created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:01Z' }
let status = 200
const calls = []
const exports = {}
const sandbox = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (urlText, options) => {
    const url = new URL(urlText)
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
    assert.equal(url.searchParams.get('op'), 'cloud-copy-node')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['X-CSRF-Token'], 'f'.repeat(64))
    assert.deepEqual(JSON.parse(options.body), {
      id: 42, revision: 7, parent_id: 17, target_parent_id: 29,
      type: 'file', name: 'a.txt', owner_scope: scope,
    })
    return { ok: status === 200, status,
      headers: { get: () => 'application/json' }, json: async () => node }
  },
})
vm.runInContext(compiled.outputText, sandbox, { filename, timeout: 1000 })
const client = sandbox.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const copy = signal => client.ownerCopyNode(42, 7, 17, 29, 'file', 'a.txt', scope, signal)
const result = await copy()
assert.equal(result.id, 77)
assert.equal(result.parent_id, 29)
assert.equal(result.name, 'a (1).txt', 'original Server may rename a copy')
assert.equal(calls.length, 2)
for (const bad of [
  [0, 7, 17, 29, 'file', 'a.txt', scope],
  [42, 0, 17, 29, 'file', 'a.txt', scope],
  [42, 7, 29, 29, 'file', 'a.txt', scope],
  [42, 7, 17, 42, 'file', 'a.txt', scope],
  [42, 7, 17, 29, 'symlink', 'a.txt', scope],
  [42, 7, 17, 29, 'file', '../a.txt', scope],
  [42, 7, 17, 29, 'file', 'a.txt', 'foreign'],
]) {
  const before = calls.length
  await assert.rejects(() => client.ownerCopyNode(...bad))
  assert.equal(calls.length, before, 'invalid copy selector contacted Server')
}
const cancelled = new AbortController()
cancelled.abort()
const before = calls.length
await assert.rejects(() => copy(cancelled.signal), /cancelled/)
assert.equal(calls.length, before, 'cancelled copy contacted Server')
for (const invalid of [
  { ...node, id: 42 },
  { ...node, parent_id: 17 },
  { ...node, revision: 0 },
  { ...node, type: 'dir' },
  { ...node, local_path: '/volume1/photo' },
]) {
  node = invalid
  await assert.rejects(() => copy(), /Invalid current Server Owner copy acknowledgement/)
}
status = 409
await assert.rejects(() => copy(), /HTTP 409/)

const ui = fs.readFileSync(path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const host = fs.readFileSync(path.join(root, 'web/src/synologyHost.ts'), 'utf8')
const gateway = fs.readFileSync(path.join(root, 'internal/synologyui/gateway.go'), 'utf8')
const mode = fs.readFileSync(path.join(root, 'cmd/xdrive-agent/desktop_ipc_runtime_mode.go'), 'utf8')
assert.match(ui, /<XDriveFileExplorerDestinationDialog/)
assert.match(ui, /onCopyItemsTo=\{selected => \{/)
assert.match(ui, /onMoveItemsTo=\{selected => \{/)
assert.match(ui, /operation=\{moveTarget\?\.operation \?\? 'move'\}/)
assert.match(ui, /client\.ownerCopyNode\(/)
assert.match(ui, /selected\.length !== 1/)
assert.match(ui, /action === 'copy-to'/)
assert.match(ui, /target\.operation === 'copy'/)
assert.match(ui, /copyTo: '退出搜索后进入目标文件夹才能复制。'/)
assert.doesNotMatch(host, /copyTo: 'DSM Owner 文件目前没有经过授权/)
assert.match(host, /copy: 'DSM Owner 文件目前没有经过授权/)
assert.match(host, /paste: 'DSM Owner 文件目前没有经过授权/)
assert.match(gateway, /serveDSMOwnerNodeCopy\(/)
assert.match(mode, /"POST \/v1\/cloud\/copy"/)
assert.doesNotMatch(ui, /window\.xdriveDesktop|local_path|fetch\s*\(/)
console.log('DSM Owner copy: one scoped item, shared picker, existing Agent Server copy, strict receipt')
