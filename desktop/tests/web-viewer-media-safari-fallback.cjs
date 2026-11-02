'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
function loadTS(filename, bindings = {}) {
  const output = ts.transpileModule(read(filename), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, name => {
    if (Object.hasOwn(bindings, name)) return bindings[name]
    return require(name)
  })
  return mod.exports
}
const media = loadTS('web/src/mediaBinaryProgress.ts')
const preview = loadTS('ui/shared/src/file-preview.ts')
const shared = {
  ...preview,
  xDriveCompleteLivePhotoOriginalNodeIDs: () => [],
}
const adapter = loadTS('web/src/mediaGalleryAdapter.ts', {
  '@xdrive/ui/mui': {
    createXDriveMediaGalleryDataSource: port => port,
    xDriveMediaGalleryTrashRoots: () => [],
  },
  '../../ui/shared/src': shared,
  './mediaBinaryProgress': { xDriveAssertMediaReadActive: media.xDriveAssertMediaReadActive },
})
const { createWebMediaGalleryDataSource } = adapter

function legacyController(abort = false) {
  const controller = new AbortController()
  Object.defineProperty(controller.signal, 'throwIfAborted', { configurable: true, value: undefined })
  if (abort) controller.abort()
  return controller
}

test('Gallery HEIC/RAW and Live Photo fallbacks work on legacy WebKit and stop after cancellation', async () => {
  const calls = []
  const api = {
    mediaViewerPreviewURL: async (...args) => {
      calls.push(['viewer', ...args])
      throw new Error('new 4K derivative endpoint unavailable')
    },
    mediaAnalysisPreviewURL: async (...args) => {
      calls.push(['legacy-jpeg', ...args])
      return 'blob:legacy-jpeg'
    },
    mediaLivePhotoStillURL: async (...args) => {
      calls.push(['live-still', ...args])
      return 'https://xdrive.test/live-still'
    },
    filePreviewURL: async (...args) => {
      calls.push(['original', ...args])
      return 'https://xdrive.test/original'
    },
  }
  const port = createWebMediaGalleryDataSource(api)
  const active = legacyController()
  const progress = () => {}

  assert.equal(await port.loadPreviewURL(41, 'image', active.signal, 'photo.HEIC', 7, progress),
    'blob:legacy-jpeg')
  assert.deepEqual(calls.map(call => call[0]), ['viewer', 'legacy-jpeg'])
  assert.equal(calls[1][1], 41)
  assert.equal(calls[1][2], active.signal)
  assert.equal(calls[1][3], 7)
  assert.equal(calls[1][4], progress)

  calls.length = 0
  assert.equal(await port.loadPreviewURL(42, 'image', active.signal, 'camera.DNG', 8, progress),
    'blob:legacy-jpeg')
  assert.deepEqual(calls.map(call => call[0]), ['viewer', 'legacy-jpeg'])

  calls.length = 0
  assert.equal(await port.loadPreviewURL(43, 'live_photo', active.signal, 'motion.LIVP', 9, progress),
    'https://xdrive.test/live-still')
  assert.deepEqual(calls.map(call => call[0]), ['viewer', 'live-still'])

  calls.length = 0
  const cancelled = legacyController(true)
  await assert.rejects(
    port.loadPreviewURL(44, 'image', cancelled.signal, 'cancelled.HEIC', 10, progress),
    error => error?.name === 'AbortError',
  )
  assert.deepEqual(calls.map(call => call[0]), ['viewer'],
    'a cancelled legacy-WebKit request must never start the fallback JPEG')
})
