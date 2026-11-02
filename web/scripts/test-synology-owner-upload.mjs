#!/usr/bin/env node
// Execute the real DSM Host upload adapter: no Agent token, NAS path, or
// synthetic succeeded upload. A real Server file receipt is required.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, webcrypto } from 'node:crypto'
import ts from 'typescript'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const fileName = path.join(repo, 'ui/shared/src/synology-backup-adapter.ts')
const code = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
  fileName, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
const content = Buffer.from([0, 255, 1, 128, 50, 60, 0])
const sha = createHash('sha256').update(content).digest('hex')
const ownerScope = 'a'.repeat(64)
const iso = '2026-11-03T00:00:00Z'
const node = {
  id: 42, parent_id: 17, revision: 2, type: 'file', name: '测试.bin',
  size: content.length, created_at: iso, updated_at: iso,
}
let receipt = node
let responseStatus = 200
const sent = []
const exports = {}
const ctx = vm.createContext({
  module: { exports }, exports, URL, Uint8Array, TextEncoder,
  crypto: webcrypto, btoa: string => Buffer.from(string, 'binary').toString('base64'),
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  } },
  fetch: async (href, options) => {
    const url = new URL(href)
    sent.push({ url, options })
    assert.equal(url.origin, 'https://nas.example')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    const op = url.searchParams.get('op')
    if (op === 'bootstrap') {
      assert.equal(options.method, 'GET')
      return { ok: true, headers: { get: () => 'application/json' },
        json: async () => ({ csrf_token: 'f'.repeat(64) }) }
    }
    assert.equal(op, 'cloud-upload-file')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['X-CSRF-Token'], 'f'.repeat(64))
    const body = JSON.parse(options.body)
    assert.deepEqual(Object.keys(body).sort(), ['data','name','owner_scope','parent_id','sha256'])
    assert.equal(body.name, node.name)
    assert.equal(body.parent_id, 17)
    assert.equal(body.owner_scope, ownerScope)
    assert.equal(body.sha256, sha)
    assert.deepEqual(Buffer.from(body.data, 'base64'), content)
    return { ok: responseStatus === 200, status: responseStatus,
      headers: { get: () => 'application/json' }, json: async () => receipt }
  },
})
vm.runInContext(code.outputText, ctx, { filename: fileName, timeout: 1000 })
const client = ctx.module.exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const picked = {
  name: node.name, size: content.length,
  arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
}
const good = await client.ownerUploadSmallFile(17, picked, ownerScope)
assert.equal(good.id, 42)
assert.equal(sent.length, 2)
const calls = () => sent.length
for (const invalid of [
  { ...picked, name: '../escape' },
  { ...picked, name: '  white-space.txt' },
  { ...picked, size: 0 },
  { ...picked, size: (4 << 20) + 1 },
  { ...picked, size: content.length + 1 },
  { ...picked, arrayBuffer: null },
]) {
  const before = calls()
  await assert.rejects(() => client.ownerUploadSmallFile(17, invalid, ownerScope))
  assert.equal(calls(), before, 'invalid file reached upload transport')
}
const countBefore = calls()
await assert.rejects(() => client.ownerUploadSmallFile(17, picked, 'bad-owner-scope'))
assert.equal(calls(), countBefore)
const aborted = new AbortController()
aborted.abort()
await assert.rejects(() => client.ownerUploadSmallFile(17, picked, ownerScope, aborted.signal))
assert.equal(calls(), countBefore)
for (const changed of [
  { ...node, id: 0 }, { ...node, type: 'dir' },
  { ...node, parent_id: 18 }, { ...node, size: 4 },
  { ...node, name: 'wrong.bin' }, { ...node, revision: 0 },
  { ...node, arbitrary_path: '/volume1/photo' },
]) {
  receipt = changed
  await assert.rejects(() => client.ownerUploadSmallFile(17, picked, ownerScope),
    /Invalid verified DSM Owner upload acknowledgement/)
}
responseStatus = 409
await assert.rejects(() => client.ownerUploadSmallFile(17, picked, ownerScope), /HTTP 409/)
const page = fs.readFileSync(path.join(repo, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
const host = fs.readFileSync(path.join(repo, 'web/src/synologyHost.ts'), 'utf8')
assert.match(page, /onUpload=\{\(\) => \{/)
assert.match(page, /uploadInputRef\.current\?\.click\(\)/)
assert.match(page, /onChange=\{event => \{/)
assert.match(page, /client\.ownerUploadSmallFile\(/)
assert.match(page, /uploadFiles: '退出搜索后可上传文件。'/)
assert.match(page, /uploadAbort\.current\?\.abort\(\)/)
assert.doesNotMatch(host, /uploadFiles: 'DSM Owner 文件上传尚未接通/)
assert.match(host, /uploadFolder: 'DSM Owner 文件夹上传尚未接通/)
assert.doesNotMatch(page, /window\.xdriveDesktop|local_path|Client\.CloudUpload\(/)
console.log('DSM bounded Owner upload: real bytes + digest, fail-on-conflict, no native path, exact Server receipt.')
