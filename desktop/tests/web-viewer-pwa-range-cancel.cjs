'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'web/src/webViewerContext.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', compiled)(mod.exports, mod, (name) => {
  if (name === '../../ui/shared/src') {
    return { xDriveClassifyFilePreview: () => 'image' }
  }
  return require(name)
})
const { createXDriveWebViewerSession } = mod.exports

function heldOwnerRange() {
  let started
  const entered = new Promise((resolve) => { started = resolve })
  return {
    entered,
    read(...args) {
      const signal = args[args.length - 1]
      started(signal)
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) return reject(new Error('range cancelled'))
        signal?.addEventListener('abort', () => reject(new Error('range cancelled')), { once: true })
      })
    },
  }
}

const node = (id) => ({ id, revision: 1, name: String(id) + '.jpg', type: 'file', size: 1 })
const photo = (id) => ({ node: node(id), metadata: {}, favorite: false })
const scenarios = [
  { name: 'Gallery all', context: {
    kind: 'gallery', target: { kind: 'all', query: {} },
    activeIndex: 0, totalCount: 1,
  }, method: 'listItemRange', location: 'source' },

  { name: 'Gallery album', context: {
    kind: 'gallery', target: { kind: 'album', id: 'album-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listAlbumItemRange', location: 'source' },
  { name: 'Gallery person', context: {
    kind: 'gallery', target: { kind: 'person', id: 'person-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listPersonItemRange', location: 'source' },
  { name: 'Gallery memories', context: {
    kind: 'gallery', target: { kind: 'memory', id: 'memory-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listMemoryItemRange', location: 'source' },
  { name: 'Gallery trash', context: {
    kind: 'gallery', target: { kind: 'trash', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listTrashItemRange', location: 'source' },
  { name: 'Gallery duplicates', context: {
    kind: 'gallery', target: { kind: 'duplicate-review', id: 'dup-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listDuplicateItemRange', location: 'source' },
  { name: 'Gallery bursts', context: {
    kind: 'gallery', target: { kind: 'burst-review', id: 'burst-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listBurstReviewItemRange', location: 'source' },
  { name: 'Gallery pets', context: {
    kind: 'gallery', target: { kind: 'pet', id: 'cat', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listPetItemRange', location: 'source' },
  { name: 'Gallery person suggestions', context: {
    kind: 'gallery', target: { kind: 'suggested-person', id: 'suggestion-x', query: {} }, activeIndex: 0, totalCount: 1,
  }, method: 'listSuggestedPersonItemRange', location: 'source' },
  { name: 'Files directory', context: {
    kind: 'directory', directoryID: 7, activeIndex: 0,
    sort: { key: 'name', direction: 'asc' },
  }, method: 'listRange', location: 'api' },
  { name: 'Files search', context: {
    kind: 'search', query: 'photo', filters: {}, activeIndex: 0,
    sort: { key: 'name', direction: 'asc' },
  }, method: 'searchRange', location: 'api' },
]

test('PWA Viewer forwards its exact Owner abort to ordinary Gallery, Files and Search ranges', async () => {
  for (const variant of scenarios) {
    const held = heldOwnerRange()
    const api = { node: async (id) => node(id), mediaItem: async (id) => photo(id) }
    const source = {}
    const owner = variant.location === 'api' ? api : source
    owner[variant.method] = held.read
    const viewer = createXDriveWebViewerSession(api, source, variant.context)
    const running = viewer.candidateAt(0)
    const signal = await held.entered
    assert.ok(signal instanceof AbortSignal, variant.name + ' dropped AbortSignal')
    assert.equal(signal.aborted, false)
    viewer.dispose()
    assert.equal(signal.aborted, true, variant.name + ' did not cancel its active HTTP request')
    await assert.rejects(running, /range cancelled/, variant.name + ' did not release pending range')
  }
})

test('cancelled Gallery range must not launch stale direct-item fallback HTTP', async () => {
  const held = heldOwnerRange()
  let fallbackCalls = 0
  const api = {
    node: async (id) => { fallbackCalls++; return node(id) },
    mediaItem: async (id) => { fallbackCalls++; return photo(id) },
  }
  const viewer = createXDriveWebViewerSession(api, { listItemRange: held.read }, scenarios[0].context)
  const running = viewer.current(1, 0, true)
  const signal = await held.entered
  viewer.dispose()
  assert.equal(signal.aborted, true)
  await assert.rejects(running, /range cancelled/)
  assert.equal(fallbackCalls, 0, 'old Owner page must not initiate new HTTP after exit')
})

test('direct-link media reads are cancelled when the Viewer session closes', async () => {
  const held = heldOwnerRange()
  let nodeCalls = 0
  const api = {
    node: async (id) => { nodeCalls++; return node(id) },
    mediaItem: held.read,
  }
  const viewer = createXDriveWebViewerSession(api, {}, null)
  const running = viewer.current(1, 0, true)
  const signal = await held.entered
  assert.ok(signal instanceof AbortSignal)
  viewer.dispose()
  assert.equal(signal.aborted, true)
  await assert.rejects(running, /range cancelled/)
  assert.equal(nodeCalls, 0)
})

test('a transport that resolves after cancellation cannot publish old Owner metadata', async () => {
  let release
  const entered = new Promise((resolve) => { release = resolve })
  let finish
  const returned = new Promise((resolve) => { finish = resolve })
  let fallbackCalls = 0
  const source = { listItemRange: (_limit, _offset, _query, signal) => {
    assert.ok(signal instanceof AbortSignal)
    release(signal)
    return returned
  } }
  const api = {
    node: async (id) => { fallbackCalls++; return node(id) },
    mediaItem: async (id) => { fallbackCalls++; return photo(id) },
  }
  const viewer = createXDriveWebViewerSession(api, source, scenarios[0].context)
  const running = viewer.current(1, 0, true)
  const signal = await entered
  viewer.dispose()
  assert.equal(signal.aborted, true)
  finish({ items: [photo(1)], total_count: 1 })
  await assert.rejects(running, /abort|cancel/i)
  assert.equal(fallbackCalls, 0)
})

test('React StrictMode reactivation cannot let an old cancelled Owner page borrow the new controller', async () => {
  const held = heldOwnerRange()
  let stalePointCalls = 0
  const api = {
    node: async (id) => { stalePointCalls++; return node(id) },
    mediaItem: async (id) => { stalePointCalls++; return photo(id) },
  }
  const viewer = createXDriveWebViewerSession(api, { listItemRange: held.read }, scenarios[0].context)
  const oldRead = viewer.current(1, 0, true)
  const oldSignal = await held.entered
  viewer.dispose()
  viewer.activate()
  assert.equal(oldSignal.aborted, true)
  await assert.rejects(oldRead, /abort|cancel/i)
  assert.equal(stalePointCalls, 0, 'old Owner must not initiate fallback under renewed signal')
})

test('aborted neighbor resolution cannot continue paging after StrictMode reactivation', async () => {
  let announce
  const entered = new Promise((resolve) => { announce = resolve })
  let finish
  const stalled = new Promise((resolve) => { finish = resolve })
  const source = { listItemRange(_limit, _offset, _query, signal) {
    announce(signal)
    return stalled
  } }
  const viewer = createXDriveWebViewerSession({}, source, {
    kind: 'gallery', target: { kind: 'all', query: {} }, activeIndex: 0, totalCount: 3,
  })
  const pendingNeighbor = viewer.neighbor(0, 1, () => true)
  const signal = await entered
  viewer.dispose()
  viewer.activate()
  assert.equal(signal.aborted, true)
  finish({ items: [photo(1), photo(2), photo(3)], total_count: 3 })
  await assert.rejects(pendingNeighbor, /abort|cancel/i)
})

test('all optional Collection Range transports expose the same signal from Viewer to HTTP', () => {
  const webAPI = fs.readFileSync(path.join(root, 'web/src/api.ts'), 'utf8')
  const adapter = fs.readFileSync(path.join(root, 'web/src/mediaGalleryAdapter.ts'), 'utf8')
  const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const sharedBridge = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryAdapter.ts'), 'utf8')
  const names = [
    ['mediaTrashRange', 'listTrashItemRange'],
    ['mediaMemoryItemRange', 'listMemoryItemRange'],
    ['mediaDuplicateItemRange', 'listDuplicateItemRange'],
    ['mediaBurstReviewItemRange', 'listBurstReviewItemRange'],
    ['mediaPetItemRange', 'listPetItemRange'],
    ['mediaSuggestedPersonItemRange', 'listSuggestedPersonItemRange'],
    ['mediaPersonItemRange', 'listPersonItemRange'],
    ['mediaAlbumItemRange', 'listAlbumItemRange'],
  ]
  for (const [apiMethod, sourceMethod] of names) {
    const begin = webAPI.indexOf('  ' + apiMethod + '(')
    const end = webAPI.indexOf('\n  }\n', begin)
    assert.ok(begin !== -1 && end > begin, apiMethod + ' API required')
    const method = webAPI.slice(begin, end)
    assert.match(method, /signal\?: AbortSignal/)
    assert.match(method, /\{ signal \}/, apiMethod + ' must actually cancel HTTP')
    const adapterAt = adapter.indexOf(sourceMethod + ':')
    assert.ok(adapterAt >= 0)
    assert.match(adapter.slice(adapterAt, adapterAt + 280), /signal/)
    const interfaceAt = shared.indexOf('export interface MediaGalleryDataSource')
    const typeAt = shared.indexOf('  ' + sourceMethod, interfaceAt)
    assert.ok(typeAt > interfaceAt && typeAt - interfaceAt < 12000)
    assert.match(shared.slice(typeAt, typeAt + 250), /signal\?: AbortSignal/)
    const portStart = sharedBridge.indexOf('export interface XDriveMediaGalleryPort')
    const portAt = sharedBridge.indexOf('  ' + sourceMethod, portStart)
    assert.ok(portAt > portStart && portAt - portStart < 16000)
    assert.match(sharedBridge.slice(portAt, portAt + 270), /signal\?: AbortSignal/,
      sourceMethod + ' shared transport port must be cancelable')
    const factoryStart = sharedBridge.indexOf('export function createXDriveMediaGalleryDataSource')
    const factoryAt = sharedBridge.indexOf('    ' + sourceMethod + ':', factoryStart)
    assert.ok(factoryAt > factoryStart, sourceMethod + ' factory mapping is required')
    const mapping = sharedBridge.slice(factoryAt, factoryAt + 350)
    assert.ok(mapping.includes('port.' + sourceMethod), sourceMethod + ' factory must invoke its port')
    assert.ok(mapping.includes(', signal)'), sourceMethod + ' factory must forward to port')
  }
})

test('shared Gallery transport factory actually forwards original Owner AbortSignal and timezone', async () => {
  const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryAdapter.ts')
  const compiledPort = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', compiledPort)(loaded.exports, loaded, (name) => {
    if (name === '../transport-result') return { resolveXDriveTransport: async x => x }
    if (name === './MediaGalleryCleanupTask') return { xDriveMediaGalleryDeleteOperation: () => undefined }
    throw Error('Unexpected Gallery adapter dependency ' + name)
  })
  for (const [name, params] of [
    ['listTrashItemRange', [48, 0]],
    ['listMemoryItemRange', ['memory-a', 48, 0, 'Asia/Tokyo']],
    ['listDuplicateItemRange', ['dup-a', 48, 0]],
    ['listBurstReviewItemRange', ['burst-a', 48, 0]],
    ['listPetItemRange', ['cat', 48, 0]],
    ['listSuggestedPersonItemRange', ['suggestion-a', 48, 0, {}]],
    ['listPersonItemRange', ['person-a', 48, 0, {}]],
    ['listAlbumItemRange', ['album-a', 48, 0, {}]],
  ]) {
    const controller = new AbortController()
    let forwarded = null
    const source = loaded.exports.createXDriveMediaGalleryDataSource({
      listItems: async () => [], listItemRange: async () => ({ items: [], total_count: 0 }),
      listAlbums: async () => [], listAlbumItems: async () => [],
      loadThumbnail: async () => '',
      ...(name === 'listAlbumItemRange' ? {} : { listAlbumItemRange: async () => ({ items: [], total_count: 0 }) }),
      [name]: async (...args) => {
        forwarded = args
        return { items: [], total_count: 0 }
      },
    })
    await source[name](...params, controller.signal)
    assert.ok(forwarded, name + ' not invoked')
    assert.equal(forwarded.at(-1), controller.signal, name + ' dropped original session signal')
    if (name === 'listMemoryItemRange') assert.equal(forwarded[3], 'Asia/Tokyo')
    controller.abort()
    assert.equal(forwarded.at(-1).aborted, true)
  }
})
