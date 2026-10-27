#!/usr/bin/env node
// Owner-only derivatives rendered by the exact shared lazy virtual FileExplorer
// thumbnail port. No arbitrary Server URL, NAS path or Agent bearer leaves DSM.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
function runSource(relative, environment) {
  const filename = path.join(root, relative)
  const source = fs.readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(source, {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.equal((transpiled.diagnostics || []).filter(
    d => d.category === ts.DiagnosticCategory.Error).length, 0)
  const exports = {}
  const module = { exports }
  const context = vm.createContext({ exports, module, Uint8Array, TextEncoder,
    AbortController, Promise, Blob, atob, ...environment })
  vm.runInContext(transpiled.outputText, context, { filename, timeout: 1000 })
  return module.exports
}
const calls = []
// Complete 2x2 RGBA PNG with valid zlib/CRC, not merely a plausible signature.
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mPUibj0n4GBgYGJAQoAIuICWbeSS/QAAAAASUVORK5CYII='
const valid = { content_type: 'image/png', alpha_state: 'opaque', alpha_mask: '', data: pngBase64 }
let response = valid
const adapter = runSource('ui/shared/src/synology-backup-adapter.ts', {
  URL, window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/synology.html',
    origin: 'https://nas.example',
  }},
  fetch: async (address, options) => {
    calls.push({ url: new URL(address), options })
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, undefined)
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => response }
  },
})
const cgi = 'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi'
const client = adapter.createXDriveSynologyBackupLocalClient(cgi)
const signal = new AbortController().signal
const thumb = await client.ownerFileThumbnail(42, 7, signal)
assert.equal(thumb.contentType, 'image/png')
assert.equal(thumb.alphaState, 'opaque')
assert.deepEqual(Array.from(thumb.data.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
assert.equal(calls[0].url.searchParams.get('op'), 'cloud-thumbnail')
assert.equal(calls[0].url.searchParams.get('node_id'), '42')
assert.equal(calls[0].url.searchParams.get('revision'), '7')
assert.equal(calls[0].options.signal, signal)
for (const ids of [[0,7], [42,0], [Number.MAX_SAFE_INTEGER+1,7], [42,1.5]]) {
  await assert.rejects(client.ownerFileThumbnail(...ids), /Invalid/)
}
assert.equal(calls.length, 1, 'invalid selectors hit Agent')
for (const invalid of [
  {...valid, content_type: 'text/html'},
  {...valid, alpha_state: 'unknown'},
  {...valid, alpha_mask: 'SECRET'},
  {...valid, data: Buffer.from('<script>').toString('base64')},
  {...valid, data: ''},
  {...valid, data: '%%%%'},
  {...valid, extra: 'Bearer secret'},
  {...valid, alpha_state: 'masked', alpha_mask: ''},
  {...valid, alpha_state: 'masked', alpha_mask: '%%%'},
]) {
  response = invalid
  await assert.rejects(client.ownerFileThumbnail(42, 7), /Invalid/)
}
response = valid

const objectUrls = []
const revoked = []
const loader = runSource('ui/shared/src/synology-owner-thumbnail.ts', {
  URL: {
    createObjectURL: blob => {
      objectUrls.push(blob)
      return 'blob:https://nas.example/' + objectUrls.length
    },
    revokeObjectURL: url => revoked.push(url),
  },
})
const item = { id: 42, revision: 7, kind: 'file', name: 'photo.png', size: 10 }
const progress = []
const src = await loader.xDriveSynologyLoadOwnerThumbnail(client, item, signal,
  (done, total, mask) => progress.push([done, total, mask]))
assert.equal(src, 'blob:https://nas.example/1')
assert.equal(objectUrls.length, 1)
assert.equal(objectUrls[0].type, 'image/png')
assert.deepEqual(progress, [[0, undefined, null], [thumb.data.length, thumb.data.length, '']])
for (const unsafe of [{...item, kind:'dir'}, {...item, id:0}, {...item, revision:0}]) {
  await assert.rejects(loader.xDriveSynologyLoadOwnerThumbnail(client, unsafe), /Invalid/)
}
const canceled = new AbortController()
canceled.abort()
await assert.rejects(loader.xDriveSynologyLoadOwnerThumbnail(client, item, canceled.signal), /cancelled/)
assert.equal(objectUrls.length, 1)
response = { ...valid, alpha_state: 'masked', alpha_mask: pngBase64 }
const transparent = await loader.xDriveSynologyLoadOwnerThumbnail(client, item, undefined,
  (done, total, mask) => progress.push([done, total, mask]))
assert.equal(transparent, 'blob:https://nas.example/2')
assert.equal(progress.at(-1)[2], 'data:image/png;base64,' + pngBase64)
response = { ...valid, alpha_state: 'unavailable' }
await loader.xDriveSynologyLoadOwnerThumbnail(client, item, undefined,
  (done, total, mask) => progress.push([done, total, mask]))
assert.equal(progress.at(-1)[2], null)
assert.equal(revoked.length, 0, 'shared cache, not adapter, owns object URL lease')

const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/SynologyOwnerFilesPage.tsx'), 'utf8')
assert.match(page, /loadThumbnail=\{loadOwnerThumbnail\}/)
assert.match(page, /thumbnailEligible: xDriveFileSupportsThumbnail\(node.name, node.type\)/)
assert.match(page, /interactionLifecycleKey=\{rootRevision \+ ':' \+ currentScopeKey\}/)
const common = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerThumbnail.tsx'), 'utf8')
for (const contract of ['fileThumbnailConcurrency = 6', 'fileThumbnailCacheLimit = 96',
  'disposeFileThumbnailCache', 'URL.revokeObjectURL', 'IntersectionObserver']) {
  assert.ok(common.includes(contract), 'DSM must reuse common thumbnail ' + contract)
}
console.log('DSM Owner thumbnails: exact Server revision, limited PNG/JPEG, alpha mask, same-origin, lazy shared cache')
