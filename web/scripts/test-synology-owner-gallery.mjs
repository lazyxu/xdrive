#!/usr/bin/env node
// Actual DSM same-origin Owner Gallery adapter; no Agent token or device needed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const filename = root + 'ui/shared/src/synology-backup-adapter.ts'
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.equal((output.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
const stamp = '2026-10-28T00:00:00Z'
const node = { id: 42, parent_id: 17, name: 'Owner.jpg', type: 'file',
  size: 1234, revision: 7, created_at: stamp, updated_at: stamp }
const item = { node, metadata: { media_kind: 'image', index_state: 'ready',
  has_thumbnail: true, mime_type: 'image/jpeg' }, favorite: false }
const goodPage = { items: [item], total_count: 1, offset: 0, limit: 100 }
const goodAlbums = [{ id: 'manual:abc', kind: 'manual', name: 'Album', item_count: 1 }]
let page = goodPage, albums = goodAlbums
const calls = []
const exports = {}
const ctx = vm.createContext({
  exports, module: { exports }, URL, TextEncoder,
  window: { location: {
    href: 'https://nas.example/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example',
  } },
  fetch: async (raw, options) => {
    const url = new URL(raw)
    calls.push({ url, options })
    assert.ok(['cloud-gallery-items', 'cloud-gallery-albums'].includes(url.searchParams.get('op')))
    return { ok: true, headers: { get: () => 'application/json' },
      json: async () => url.searchParams.get('op') === 'cloud-gallery-items' ? page : albums }
  },
})
vm.runInContext(output.outputText, ctx, { filename, timeout: 1000 })
const client = exports.createXDriveSynologyBackupLocalClient(
  'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi')
const abort = new AbortController()
const first = await client.ownerGalleryItemsRange('all', 100, 0, '', abort.signal)
assert.equal(first.items[0].node.id, 42)
assert.equal((await client.ownerGalleryAlbums(abort.signal))[0].id, 'manual:abc')
assert.equal(calls.length, 2)
assert.equal(calls[0].url.search, '?op=cloud-gallery-items&kind=all&limit=100&offset=0')
assert.equal(calls[1].url.search, '?op=cloud-gallery-albums')
assert.ok(calls.every(({ url, options }) =>
  url.origin === 'https://nas.example' &&
  options.method === 'GET' && options.credentials === 'same-origin' &&
  options.redirect === 'error' && options.mode === 'same-origin' &&
  options.signal === abort.signal && !options.body && !options.headers.Authorization))
const firstCallCount = calls.length
for (const input of [
  ['other', 100, 0, ''], ['all', 0, 0, ''], ['all', 101, 0, ''],
  ['all', 100, -1, ''], ['all', 100, Number.MAX_SAFE_INTEGER, ''],
  ['all', 100, 0, '../private'], ['all', 100, 0, 'manual:abc&op=run'],
]) await assert.rejects(client.ownerGalleryItemsRange(...input), /Invalid/)
assert.equal(calls.length, firstCallCount, 'invalid selector contacted Agent')
for (const invalid of [
  { ...goodPage, items: [item, item] },
  { ...goodPage, items: [{ ...item, node: { ...node, private_path: '/volume1' } }] },
  { ...goodPage, items: [{ ...item, node: { ...node, id: 0 } }] },
  { ...goodPage, items: [{ ...item, metadata: { ...item.metadata, exif: { secret: 1 } } }] },
  { ...goodPage, items: [{ ...item, metadata: { ...item.metadata, latitude: 12.3 } }] },
  { ...goodPage, items: [{ ...item, auth_token: 'private' }] },
  { ...goodPage, total_count: -1 }, { ...goodPage, total_count: 0 },
  { ...goodPage, offset: 3 }, { ...goodPage, limit: 101 },
]) {
  page = invalid
  await assert.rejects(client.ownerGalleryItemsRange('all', 100, 0), /Invalid/)
}
page = goodPage
for (const invalid of [
  [goodAlbums[0], goodAlbums[0]],
  [{ ...goodAlbums[0], query: { search: 'secret' } }],
  [{ ...goodAlbums[0], id: 'manual:../../etc' }],
  [{ ...goodAlbums[0], name: '' }],
  [{ ...goodAlbums[0], cover_node_id: Number.MAX_SAFE_INTEGER + 1 }],
]) {
  albums = invalid
  await assert.rejects(client.ownerGalleryAlbums(), /Invalid/)
}
albums = goodAlbums
const other = await client.ownerGalleryItemsRange('image', 100, 0, 'manual:abc')
assert.equal(other.items.length, 1)
assert.equal(calls.at(-1).url.searchParams.get('album_id'), 'manual:abc')
assert.ok(calls.every(({ options }) => !options.headers.Authorization && !options.body))
console.log('DSM Owner Gallery uses only authorized read-only same-origin redacted CGIs')
