'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '../..')
const file = name => fs.readFileSync(path.join(repo, name), 'utf8')

test('Web Files Quick Look passes true RAW preview transfer bytes to the shared Viewer', () => {
  const source = file('web/src/WebFileViewerApps.tsx')
  const start = source.indexOf('const loadThumbnail = useCallback(async (_target: XDriveFilePreviewTarget')
  const surface = source.indexOf('<XDriveFilePreviewSurface', start)
  const end = source.indexOf('</WebViewerFrame>', surface)
  assert.ok(start > 0 && surface > start && end > surface,
    'this test must inspect the actual Files Quick Look, not a lookalike media Viewer')
  const callsite = source.slice(surface, end)
  assert.match(callsite, /loadPreviewURL=\{async \(_target, kind, signal, onProgress\) => \(/)
  assert.match(callsite,
    /api\.mediaAnalysisPreviewURL\(viewer\.node!\.id, signal, viewer\.node!\.revision, onProgress\)/,
    'the current revision and AbortSignal must own the real binary observer')
  assert.match(callsite, /api\.filePreviewURL\(viewer\.node!\.id, signal\)/,
    'native signed media must keep its existing playback reader')
  assert.match(callsite, /api\.mediaLivePhotoStillURL\(viewer\.node!\.id, signal\)/,
    'the Live Photo still remains a signed resource, not a guessed file byte count')
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
