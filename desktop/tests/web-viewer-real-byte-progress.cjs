'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const file = name => fs.readFileSync(path.join(repo, name), 'utf8')

test('Web Files Quick Look passes true RAW preview transfer bytes to the shared Viewer', () => {
  const source = file('web/src/WebFileViewerApps.tsx')
  const start = source.indexOf('const loadThumbnail = useCallback(async (')
  const surface = source.indexOf('<XDriveFilePreviewSurface', start)
  const end = source.indexOf('</WebViewerFrame>', surface)
  assert.ok(start > 0 && surface > start && end > surface,
    'this test must inspect the actual Files Quick Look, not a lookalike media Viewer')
  const callsite = source.slice(surface, end)
  const loader = source.slice(start, surface)
  assert.match(callsite, /loadPreviewURL=\{loadQuickLookPreview\}/,
    'Quick Look mounts the real stable preview loader instead of a fresh callback each render')
  assert.match(loader, /const loadQuickLookPreview = useCallback<XDriveFilePreviewURLLoader>\(/)
  assert.match(loader, /const id = Number\(currentTarget\.id\)/,
    'the signed request must bind to the current rendered Node, not a captured old Node')
  assert.match(loader,
    /api\.mediaViewerPreviewURL\(id, signal, Number\(currentTarget\.revision\), onProgress\)/,
    '4K WebP/JPEG must use the current revision and abortable byte observer')
  assert.match(loader,
    /api\.mediaAnalysisPreviewURL\(id, signal, Number\(currentTarget\.revision\), onProgress\)/,
    'the older Server JPEG fallback retains the same measured bytes')
  assert.match(loader, /api\.filePreviewURL\(id, signal\)/,
    'native signed media must keep its existing playback reader')
  assert.match(loader, /kind === 'live_photo'\s*\?\s*api\.mediaLivePhotoStillURL\(id, signal\)/,
    'the Live Photo still keeps its signed fallback rather than guessed byte counts')
})

test('RAW Web response progress is measured by existing bounded streaming transport', () => {
  const api = file('web/src/api.ts')
  const binary = file('web/src/mediaBinaryProgress.ts')
  const surface = file('ui/shared/src/mui/FilePreviewImage.tsx')
  assert.match(api, /async mediaAnalysisPreviewURL\(nodeID: number, signal\?: AbortSignal, revision\?: number, onProgress\?:/)
  assert.match(api, /xDriveMediaResponseBlob\(response, signal, onProgress\)/)
  assert.match(binary, /response\.body\.pipeThrough\(meter/)
  assert.match(binary, /!encoding \|\| encoding === 'identity'/)
  assert.match(surface, /setProgress\(\{ loadedBytes, totalBytes \}\)/)
  assert.doesNotMatch(binary, /new Blob\(chunks\)/,
    'progress must not duplicate a potentially large RAW derivative in another byte array')
})


test('Web Files Quick Look forwards measured thumbnail HTTP bytes to the shared renderer', () => {
  const source = file('web/src/WebFileViewerApps.tsx')
  const start = source.indexOf('const loadThumbnail = useCallback(async (')
  const surface = source.indexOf('<XDriveFilePreviewSurface', start)
  assert.ok(start > 0 && surface > start,
    'inspect the existing Owner-scoped Quick Look rather than a new preview pipeline')
  const loader = source.slice(start, surface)
  assert.match(loader, /onProgress\?: XDriveByteProgressHandler/,
    'the optional byte callback must use the common signed media progress type')
  assert.match(loader,
    /api\.mediaThumbnail\([\s\S]*?viewer\.node\.id, signal, viewer\.node\.revision, onProgress/,
    'the current Node revision and AbortSignal own the existing Web media request')
  assert.match(source.slice(surface, source.indexOf('</WebViewerFrame>', surface)),
    /loadImagePreview=\{loadThumbnail\}/)
  const image = file('ui/shared/src/mui/FilePreviewImage.tsx')
  assert.match(image, /attemptsRef\.current\.thumbnail === attempt && !signal\.aborted/,
    'a prior revision/Owner must never publish late progress')
  assert.match(image, /stage=\{showingThumbnailTransfer \? 'transfer'/,
    'thumbnail byte progress remains honest even if the original ticket resolves first')
})
