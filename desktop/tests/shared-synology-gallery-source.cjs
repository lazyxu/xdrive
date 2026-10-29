'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/SynologyOwnerGallerySource.ts')
const src = fs.readFileSync(filename, 'utf8')
const transpiled = ts.transpileModule(src, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
const errors = (transpiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const calls = []
let deferredPreview = null
let deferredNative = null
const previews = []
const fakeURL = {
  createObjectURL: blob => { previews.push(blob); return 'blob:owner:' + previews.length },
  revokeObjectURL: url => { calls.push(['revoke', url]) },
}
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require', 'URL', 'Blob', transpiled.outputText)(
  moduleRef, moduleRef.exports,
  name => {
    if (name === '../synology-media-preview') return {
      xDriveSynologyLoadBoundedMediaPreview: async (_client, item) => {
        assert.equal(item.size, 120)
        return deferredPreview ?? 'blob:verified-original'
      },
    }
    if (name === '../synology-media-stream') return {
      xDriveSynologyPlaybackMIME: filename =>
        /\\.(mp4|m4v)$/i.test(filename) ? 'video/mp4'
          : /\\.webm$/i.test(filename) ? 'video/webm' : null,
      xDriveSynologyLoadNativeMediaStream: async (client, item, signal) => {
        calls.push(['stream', item.id, item.revision, item.size, item.name, signal])
        assert.equal(typeof client.ownerFileMediaStreamURL, 'function')
        return deferredNative ?? 'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi?op=cloud-media-stream'
      },
    }
    if (name === '../synology-owner-thumbnail') return {
      xDriveSynologyLoadOwnerThumbnail: async (client, item, signal, onProgress) => {
        assert.equal(item.kind, 'file')
        if (signal?.aborted) throw Error('thumbnail aborted')
        onProgress?.(0, undefined, null)
        const image = await client.ownerFileThumbnail(item.id, item.revision, signal)
        if (signal?.aborted) throw Error('thumbnail aborted')
        onProgress?.(image.data.length, image.data.length,
          image.alphaState === 'masked' ? 'data:image/png;base64,' + image.alphaMask
            : image.alphaState === 'opaque' ? '' : null)
        return fakeURL.createObjectURL(new Blob([image.data], { type: image.contentType }))
      },
    }
    throw new Error('unexpected import into Gallery Owner-only source: ' + name)
  }, fakeURL, Blob,
)
const { createXDriveSynologyOwnerGallerySource: create, xDriveSynologyOwnerGalleryQuerySupported: supports } = moduleRef.exports
const record = (id, revision = 7) => ({
  node: { id, parent_id: 17, name: id + '.jpg', type: 'file', size: 120,
    revision, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' },
  metadata: { media_kind: 'image', index_state: 'ready', has_thumbnail: true },
  favorite: false,
})
function fakeClient(rows = [record(1), record(2), record(3)]) {
  return {
    ownerGalleryItemsRange: async (kind, limit, offset, album, signal) => {
      calls.push(['range', kind, limit, offset, album, signal])
      return { items: rows.slice(offset, offset + limit),
        total_count: rows.length, offset, limit }
    },
    ownerGalleryAlbums: async () => [{ id: 'manual:abc', name: 'Verified', kind: 'manual', item_count: 3 }],
    ownerFileThumbnail: async (id, revision, signal) => {
      calls.push(['thumbnail', id, revision, signal])
      return { data: new Uint8Array([137, 80, 78, 71]),
        contentType: 'image/png', alphaState: 'opaque', alphaMask: '' }
    },
    ownerFileMediaRange: async () => { throw Error('not used by thumbnail') },
    ownerFileMediaStreamURL: () =>
      'https://nas.example/webman/3rdparty/xdrivenas/backup.cgi?op=cloud-media-stream',
  }
}

test('genuine Owner Range results and album identity enter the common Gallery, not DSM JSX', async () => {
  const source = create(fakeClient())
  const range = await source.listItemRange(2, 0, {
    sort_by: 'captured', sort_dir: 'desc', fold_duplicates: false, time_zone: 'Asia/Tokyo',
  })
  assert.deepEqual(range.items.map(item => item.node.id), [1, 2])
  assert.equal(range.total_count, 3)
  assert.equal(range.limit, 2)
  assert.deepEqual((await source.listAlbums()).map(a => a.id), ['manual:abc'])
  assert.deepEqual((await source.listAlbumItems('manual:abc', 2, 1)).map(a => a.node.id), [2, 3])
  assert.equal(calls.at(-1)[4], 'manual:abc')
})

test('unknown filters never silently search a partial 100k collection', async () => {
  assert.equal(supports({ sort_by: 'captured', sort_dir: 'desc' }), true)
  for (const query of [
    { search: 'private' }, { favorite: true }, { has_location: true },
    { place_hierarchy: 'country:CN' }, { sort_by: 'added' },
    { sort_dir: 'asc' }, { fold_duplicates: true },
    { unknown_first: true }, { asset_kind: 'image' },
    { anchor_node_id: 77 }, { cameras: ['iPhone'] },
  ]) {
    assert.equal(supports(query), false, JSON.stringify(query))
    await assert.rejects(create(fakeClient()).listItemRange(2, 0, query), /尚未支持/)
  }
})

test('large authorized UI windows are split into sequential bounded Agent ranges', async () => {
  calls.length = 0
  const source = create(fakeClient(Array.from({ length: 230 }, (_, i) => record(i + 1))))
  const page = await source.listItemRange(225, 0)
  assert.equal(page.items.length, 225)
  assert.equal(page.total_count, 230)
  assert.deepEqual(calls.filter(x => x[0] === 'range').map(x => [x[2], x[3]]),
    [[100, 0], [100, 100], [25, 200]])
})

test('disagreeing Owner counts and duplicate second page never publish mixed snapshots', async () => {
  const api = fakeClient()
  let i = 0
  api.ownerGalleryItemsRange = async (_kind, limit, offset) => {
    i++
    return { items: Array.from({ length: limit }, (_, j) => record(offset + j + 1)),
      total_count: i === 1 ? 250 : 251, offset, limit }
  }
  await assert.rejects(create(api).listItemRange(200, 0), /changed/)
  const dup = fakeClient(Array.from({ length: 240 }, (_, j) => record(j + 1)))
  let c = 0
  dup.ownerGalleryItemsRange = async (_kind, limit, offset) => {
    c++
    const slice = Array.from({ length: limit }, (_, j) => record(c === 2 && j === 0 ? 1 : offset + j + 1))
    return { items: slice, total_count: 240, offset, limit }
  }
  await assert.rejects(create(dup).listItemRange(200, 0), /duplicate/)
})

test('thumbnail requires previously authenticated Node/revision and preserves cancellation', async () => {
  calls.length = 0
  const api = fakeClient()
  const source = create(api)
  assert.equal(await source.loadThumbnail(1), null)
  await source.listItemRange(2, 0)
  assert.equal(await source.loadThumbnail(1, undefined, 8), null)
  const signal = new AbortController()
  const progress = []
  assert.equal(await source.loadThumbnail(1, signal.signal, 7,
    (...values) => progress.push(values)), 'blob:owner:1')
  assert.deepEqual(progress, [[0, undefined, null], [4, 4, '']],
    'Gallery must retain shared progress and the verified opaque alpha state')
  assert.deepEqual(calls.filter(x => x[0] === 'thumbnail').map(x => x.slice(1, 3)), [[1, 7]])
  signal.abort()
  assert.equal(await source.loadThumbnail(1, signal.signal, 7), null)
  assert.equal(await source.loadPreviewURL(1, 'image', undefined, '1.jpg', 7), 'blob:verified-original')
  assert.equal(await source.loadPreviewURL(1, 'video'), null)
  assert.equal(await source.loadPreviewURL(1, 'image', undefined, '', 8), null)
})

test('DSM Gallery video reuses verified same-origin media stream, never an image Blob', async () => {
  calls.length = 0
  const movie = { ...record(9),
    node: { ...record(9).node, name: 'clip.mp4', size: 9123 },
    metadata: { media_kind: 'video', index_state: 'ready', has_thumbnail: true },
  }
  const other = record(10)
  const source = create(fakeClient([movie, other]))
  assert.equal(await source.loadPreviewURL(9, 'video', undefined, 'clip.mp4', 7), null,
    'no stream before verified Owner range')
  await source.listItemRange(2, 0)
  assert.equal(await source.loadPreviewURL(9, 'image', undefined, 'clip.mp4', 7), null,
    'a video must never be reinterpreted as an image Blob')
  const url = await source.loadPreviewURL(9, 'video', undefined, 'untrusted.jpg', 7)
  assert.ok(url.startsWith('https://nas.example/'))
  assert.deepEqual(calls.filter(row => row[0] === 'stream').map(row => row.slice(1, 5)),
    [[9, 7, 9123, 'clip.mp4']],
    'trusted Owner row not caller filename selects native streaming')
  assert.equal(await source.loadPreviewURL(9, 'video', undefined, 'clip.mp4', 8), null)
  const cancelled = new AbortController(); cancelled.abort()
  assert.equal(await source.loadPreviewURL(9, 'video', cancelled.signal, 'clip.mp4', 7), null)
  assert.equal(await source.loadPreviewURL(10, 'video', undefined, '10.jpg', 7), null)
  assert.equal(calls.filter(row => row[0] === 'stream').length, 1)
})

test('late DSM Gallery video stream is discarded after new Owner revision or abort', async () => {
  calls.length = 0
  let liveRevision = 7
  const video = revision => ({ ...record(55, revision),
    node: { ...record(55, revision).node, name: 'movie.webm', size: 1024 },
    metadata: { media_kind: 'video', index_state: 'ready', has_thumbnail: true },
  })
  const api = fakeClient()
  api.ownerGalleryItemsRange = async (_kind, limit, offset) => ({
    items: offset ? [] : [video(liveRevision)], total_count: 1, offset, limit,
  })
  const source = create(api)
  await source.listItemRange(1, 0)
  let resolveStale
  deferredNative = new Promise(resolve => { resolveStale = resolve })
  try {
    const stale = source.loadPreviewURL(55, 'video', undefined, 'movie.webm', 7)
    liveRevision = 8
    await source.listItemRange(1, 0)
    resolveStale('https://nas.example/old-stream')
    assert.equal(await stale, null, 'old revision native URL must not reach Viewer')
    const signal = new AbortController()
    let resolveAborted
    deferredNative = new Promise(resolve => { resolveAborted = resolve })
    const pending = source.loadPreviewURL(55, 'video', signal.signal, 'movie.webm', 8)
    signal.abort()
    resolveAborted('https://nas.example/cancelled-stream')
    assert.equal(await pending, null, 'cancelled media URL must not reach Viewer')
  } finally {
    deferredNative = null
  }
})

test('abort, invalid window and non-Owner writes do not contact an Agent', async () => {
  calls.length = 0
  const source = create(fakeClient())
  const a = new AbortController(); a.abort()
  await assert.rejects(source.listItemRange(10, 0, undefined, a.signal), /cancelled/)
  await assert.rejects(source.listItemRange(0, 0), /尚未支持/)
  await assert.rejects(source.listItemRange(501, 0), /尚未支持/)
  assert.equal(calls.length, 0)
  for (const mutation of ['setFavorite', 'deleteItems', 'restoreTrashItems',
    'permanentlyDeleteTrashItems', 'saveVideoPoster', 'submitSelectionFavoriteJob']) {
    assert.equal(Object.hasOwn(source, mutation), false, mutation + ' cannot be fabricated')
  }
})

test('superseded Owner thumbnail and original must not publish an old revision after a new Range', async () => {
  calls.length = 0
  let recordRevision = 7
  let resolveThumbnail
  const api = fakeClient()
  api.ownerGalleryItemsRange = async (_kind, limit, offset) => ({
    items: offset ? [] : [record(1, recordRevision)],
    total_count: 1, offset, limit,
  })
  api.ownerFileThumbnail = async () => new Promise(resolve => {
    resolveThumbnail = resolve
  })
  const source = create(api)
  await source.listItemRange(1, 0)
  const pendingThumbnail = source.loadThumbnail(1, undefined, 7)
  let resolveOriginal
  deferredPreview = new Promise(resolve => { resolveOriginal = resolve })
  const pendingOriginal = source.loadPreviewURL(1, 'image', undefined, '1.jpg', 7)
  recordRevision = 8
  await source.listItemRange(1, 0)
  resolveThumbnail({ data: new Uint8Array([137, 80, 78, 71]),
    contentType: 'image/png' })
  resolveOriginal('blob:verified-old-owner')
  assert.equal(await pendingThumbnail, null)
  assert.equal(await pendingOriginal, null)
  const revoked = calls.filter(x => x[0] === 'revoke').map(x => x[1])
  assert.equal(revoked.length, 2, 'both superseded image URLs must be revoked')
  assert.ok(revoked.some(url => /^blob:owner:\d+$/.test(url)),
    'the stale Owner thumbnail must be revoked')
  assert.ok(revoked.includes('blob:verified-old-owner'),
    'the stale original preview must be revoked')
  deferredPreview = null
})
