const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(
  repo,
  'ui',
  'shared',
  'src',
  'mui',
  'MediaGalleryVideoPoster.ts',
)
const source = fs.readFileSync(filename, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(mod.exports, mod, require)

const { xDriveMediaVideoPosterGeometry, xDriveResolveMediaVideoPoster } = mod.exports

test('video poster keeps browser-applied quarter-turn geometry', () => {
  const geometry = xDriveMediaVideoPosterGeometry(
    1080,
    1920,
    1920,
    1080,
    90,
  )
  assert.deepEqual(geometry, {
    canvasWidth: 288,
    canvasHeight: 512,
    drawWidth: 288,
    drawHeight: 512,
    manualRotation: 0,
  })
})

test('video poster applies 90-degree fallback when canvas exposes raw track geometry', () => {
  const geometry = xDriveMediaVideoPosterGeometry(
    1920,
    1080,
    1920,
    1080,
    90,
  )
  assert.deepEqual(geometry, {
    canvasWidth: 288,
    canvasHeight: 512,
    drawWidth: 512,
    drawHeight: 288,
    manualRotation: 90,
  })
})

test('video poster applies 270-degree fallback without changing the display bounds', () => {
  const geometry = xDriveMediaVideoPosterGeometry(
    1920,
    1080,
    1920,
    1080,
    270,
  )
  assert.deepEqual(geometry, {
    canvasWidth: 288,
    canvasHeight: 512,
    drawWidth: 512,
    drawHeight: 288,
    manualRotation: 270,
  })
})

test('video poster leaves ordinary landscape video unrotated and bounded', () => {
  const geometry = xDriveMediaVideoPosterGeometry(
    1920,
    1080,
    1920,
    1080,
    0,
  )
  assert.deepEqual(geometry, {
    canvasWidth: 512,
    canvasHeight: 288,
    drawWidth: 512,
    drawHeight: 288,
    manualRotation: 0,
  })
})

test('Gallery video poster viewport cleanup cancels queued work', () => {
  const preview = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryPreviewMedia.tsx'),
    'utf8',
  )
  assert.ok(preview.includes('const scheduled = scheduleMediaPoster((signal) => xDriveResolveMediaVideoPoster({'))
  assert.ok(preview.includes('task: (signal: AbortSignal) => Promise<string | null>'))
  assert.ok(preview.includes('entry.controller.abort()'), 'a started video-poster request must receive a real abort')
  assert.ok(preview.includes('      signal,\n      onStage: (stage) =>'), 'poster reports persisted lookup and generation phase')
  assert.ok(preview.includes('      capture: (signal, onCapturing) => captureVideoPoster('), 'signal and video-decode phase reach cold capture')
  assert.ok(preview.includes('        signal, onCapturing,'), 'cold video capture must receive cancellation')
  assert.ok(preview.includes('void scheduled.promise'))
  assert.ok(preview.includes('scheduled.cancel()'))
  assert.ok(preview.includes('if (!entry.started) {'))
  assert.ok(preview.includes('mediaPosterQueue.splice(index, 1)'))
  assert.ok(preview.includes('if (entry.cancelled) {'))
  assert.ok(preview.includes('if (value) revokeIfBlob(value)'))
})


test('Gallery warm video poster never opens original video or starts client decode', async () => {
  const calls = []
  const url = await xDriveResolveMediaVideoPoster({
    nodeID: 17,
    revision: 4,
    loadCached: async (id) => { calls.push(['GET', id]); return 'https://example.test/17-poster.jpg' },
    capture: async () => { calls.push(['CAPTURE']); return new Blob(['frame']) },
    save: async () => { calls.push(['PUT']) },
  })
  assert.equal(url, 'https://example.test/17-poster.jpg')
  assert.deepEqual(calls, [['GET', 17]], 'warm poster must bypass original-video preview and decode')
})

test('Gallery cold video poster captures once and backfills with the current revision', async () => {
  const calls = []
  const poster = new Blob(['jpeg'], { type: 'image/jpeg' })
  const url = await xDriveResolveMediaVideoPoster({
    nodeID: 17,
    revision: 4,
    loadCached: async (id) => { calls.push(['GET', id]); return null },
    capture: async () => { calls.push(['CAPTURE']); return poster },
    save: async (id, revision, value) => { calls.push(['PUT', id, revision, value]) },
  })
  try {
    assert.ok(url?.startsWith('blob:'))
    assert.deepEqual(calls, [['GET', 17], ['CAPTURE'], ['PUT', 17, 4, poster]])
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
})

test('Gallery cancelled video-poster capture cannot write or publish stale cache data', async () => {
  const controller = new AbortController()
  let written = false
  const result = await xDriveResolveMediaVideoPoster({
    nodeID: 17,
    revision: 4,
    signal: controller.signal,
    loadCached: async () => null,
    capture: async () => { controller.abort(); return new Blob(['stale']) },
    save: async () => { written = true },
  })
  assert.equal(result, null)
  assert.equal(written, false)
})

test('Gallery video-poster cache failure keeps usable local still but skips stale/invalid revision writes', async () => {
  const cases = [
    { revision: 0, expectWrites: 0 },
    { revision: 4, expectWrites: 1 },
  ]
  for (const sample of cases) {
    let writes = 0
    const url = await xDriveResolveMediaVideoPoster({
      nodeID: 18,
      revision: sample.revision,
      loadCached: async () => { throw new Error('cache miss') },
      capture: async () => new Blob(['usable'], { type: 'image/jpeg' }),
      save: async () => { writes += 1; throw new Error('cache unavailable') },
    })
    try {
      assert.ok(url?.startsWith('blob:'))
      assert.equal(writes, sample.expectWrites)
    } finally {
      if (url) URL.revokeObjectURL(url)
    }
  }
})

test('Web and Desktop Gallery share persisted-first poster adapter with revision-aware backfill', () => {
  const gallery = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(repo, 'web', 'src', 'mediaGalleryAdapter.ts'), 'utf8')
  const desktop = fs.readFileSync(path.join(repo, 'desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts'), 'utf8')
  const filmstrip = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryFilmstrip.tsx'), 'utf8')
  assert.ok(gallery.includes('saveVideoPoster={source.saveVideoPoster}'))
  assert.ok(gallery.includes('revision={item.node.revision}'))
  assert.ok(gallery.includes('loadThumbnail={loadThumbnail}'))
  assert.ok(web.includes('api.mediaVideoPoster(nodeID, revision, poster, signal)'))
  assert.ok(desktop.includes('agent.putMediaVideoPoster(nodeID, revision, bytes)'))
  assert.ok(filmstrip.includes("item.metadata.media_kind === 'video'"))
})

test('All three Gallery tile render paths forward persisted poster writes', () => {
  const source = fs.readFileSync(path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx'), 'utf8')
  const tiles = [...source.matchAll(/<MediaTile\b([\s\S]*?)\/>/g)]
  assert.equal(tiles.length, 3, 'grid, virtual grid and timeline must all use the shared tile')
  for (const [, content] of tiles) {
    assert.ok(content.includes('saveVideoPoster={saveVideoPoster}'), 'every tile path must carry revision-checked poster writes')
  }
})

test('Gallery poster status never reads video after persisted poster hit', async () => {
  const phases = []
  let captureCount = 0
  const url = await xDriveResolveMediaVideoPoster({
    nodeID: 109, revision: 3,
    loadCached: async () => 'https://example.test/poster.jpg',
    capture: async () => { captureCount++; return new Blob(['unexpected']) },
    onStage: (phase) => phases.push(phase),
  })
  assert.equal(url, 'https://example.test/poster.jpg')
  assert.deepEqual(phases, ['poster_lookup', 'decode'])
  assert.equal(captureCount, 0)
})

test('Gallery cold poster has separate video-read and capture phases', async () => {
  const phases = []
  const url = await xDriveResolveMediaVideoPoster({
    nodeID: 110, revision: 2,
    loadCached: async () => null,
    capture: async (_signal, onCapture) => {
      onCapture?.()
      return new Blob(['image'], { type: 'image/jpeg' })
    },
    onStage: (phase) => phases.push(phase),
  })
  try {
    assert.deepEqual(phases, ['poster_lookup', 'video_read', 'poster_capture', 'decode'])
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
})
