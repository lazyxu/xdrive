#!/usr/bin/env node
// Test real DSM Owner-B-scope browser adapter without a device or any credentials.
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
assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const calls = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (address, options) => {
    const url = new URL(address)
    calls.push({ url, options })
    const op = url.searchParams.get('op')
    let data
    if (op === 'device-backups') data = { devices: [], has_more: false, has_more_folders: false }
    else if (op === 'device-backup-runs') data = { items: [], has_more: false }
    else if (op === 'device-backup-page') {
      data = { devices: [], has_more: false, has_more_folders: false }
    } else if (op === 'device-backup-folders') {
      data = { folders: [], has_more: false, next_after_source_id: 0 }
    }
    else throw Error('unexpected arbitrary DSM CGI: ' + op)
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => data }
  },
})
vm.runInContext(compiled.outputText, ctx, { filename, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi',
)
const owner = ctx.module.exports.createXDriveSynologyOwnerBackupSource(client)
assert.equal(typeof owner.list, 'function')
assert.equal(typeof owner.runs, 'function')
assert.equal(typeof owner.listPage, 'function')
assert.equal(typeof owner.foldersPage, 'function')
for (const key of ['verifiedLocalDevice', 'createSource', 'deleteSource', 'control', 'run', 'save']) {
  assert.equal(Object.hasOwn(owner, key), false, 'writable or privileged remote key: ' + key)
}
assert.equal((await owner.list()).devices.length, 0)
assert.equal((await owner.runs(42, 20, 0)).items.length, 0)
const firstDevice = 'abcdef01-2345-4abc-8abc-abcdefabcdef'
assert.equal((await owner.listPage(100, firstDevice)).devices.length, 0)
assert.equal((await owner.foldersPage(firstDevice, 100, 0)).folders.length, 0)
assert.equal((await owner.foldersPage(firstDevice, 20, 42)).folders.length, 0)
assert.equal(calls.length, 5)
assert.equal(calls[0].url.search, '?op=device-backups')
assert.equal(calls[1].url.searchParams.get('op'), 'device-backup-runs')
assert.equal(calls[1].url.searchParams.get('source_id'), '42')
assert.equal(calls[1].url.searchParams.get('limit'), '20')
assert.equal(calls[1].url.searchParams.get('offset'), '0')
assert.equal(calls[2].url.searchParams.get('op'), 'device-backup-page')
assert.equal(calls[2].url.searchParams.get('limit'), '100')
assert.equal(calls[2].url.searchParams.get('after_device_id'), firstDevice)
assert.equal(calls[3].url.searchParams.get('op'), 'device-backup-folders')
assert.equal(calls[3].url.searchParams.get('device_id'), firstDevice)
assert.equal(calls[3].url.searchParams.has('after_source_id'), false)
assert.equal(calls[4].url.searchParams.get('after_source_id'), '42')
assert.equal(calls[4].url.searchParams.get('limit'), '20')
assert.ok(calls.every(({ url, options }) =>
  url.origin === 'https://nas.example' && options.method === 'GET' &&
  options.credentials === 'same-origin' && options.redirect === 'error' &&
  !options.headers.Authorization))
for (const inputs of [[0,20,0],[42,0,0],[42,21,0],[42,20,-1],[42,20,100000]]) {
  assert.throws(() => owner.runs(...inputs), /Invalid/)
}
for (const [limit, cursor] of [[0, firstDevice], [101, firstDevice], [100, 'not-uuid'],
  [100, firstDevice.toUpperCase()], [100, firstDevice + '&op=run']]) {
  assert.throws(() => owner.listPage(limit, cursor), /Invalid/)
}
for (const [deviceID, limit, after] of [[firstDevice, 0, 0],
  [firstDevice, 101, 0], ['not-uuid', 100, 0], [firstDevice, 100, -1],
  [firstDevice, 100, Number.MAX_SAFE_INTEGER + 1], [firstDevice + '&op=run', 100, 0]]) {
  assert.throws(() => owner.foldersPage(deviceID, limit, after), /Invalid/)
}
assert.equal(calls.length, 5, 'invalid Source/page cursor contacted Agent')
console.log('DSM remote owner reads are authenticated and read-only via the existing Agent, without private bearer')
