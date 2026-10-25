'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const image = read('ui/shared/src/mui/FilePreviewImage.tsx')
const live = read('ui/shared/src/mui/LivePhotoSurface.tsx')
const viewer = read('ui/shared/src/mui/MediaViewerContent.tsx')
const surface = read('ui/shared/src/mui/FilePreviewSurface.tsx')
const mediaQuery = "'@media (prefers-reduced-motion: reduce)': { transition: 'none' }"

// Use the actual TSX parser instead of a text-only success test, so malformed
// JSX/style syntax cannot be accepted as a Reduced Motion implementation.
for (const [filename, source] of [
  ['FilePreviewImage.tsx', image],
  ['LivePhotoSurface.tsx', live],
]) {
  test(filename + ' remains parseable TypeScript/JSX', () => {
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    assert.deepEqual(parsed.parseDiagnostics.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), [])
  })
}

test('ordinary decoded image viewport removes zoom interpolation under Reduced Motion', () => {
  const start = image.indexOf('component="img"')
  const end = image.indexOf('readySource && mediaTransform', start)
  assert.ok(start > 0 && end > start)
  const decoded = image.slice(start, end)
  assert.match(decoded, /transform: viewportTransform \|\| undefined/)
  assert.match(decoded, /transition: viewportTransition/)
  assert.ok(decoded.includes(mediaQuery), 'CSS must override the ordinary zoom transition in reduced-motion mode')
  assert.equal(decoded.split(mediaQuery).length - 1, 1)
})

test('Live Photo still zoom and motion-frame fade respect Reduced Motion independently', () => {
  const start = live.indexOf('transform: interactiveImage')
  const video = live.indexOf('component="video"', start)
  assert.ok(start > 0 && video > start)
  const still = live.slice(start, video)
  assert.match(still, /transition: panRef\.current \|\| pinchRef\.current/)
  assert.ok(still.includes(mediaQuery), 'still zoom must avoid interpolation')
  const motion = live.slice(video, live.indexOf('pointerEvents:', video))
  assert.match(motion, /transition: 'opacity 120ms ease'/)
  assert.ok(motion.includes(mediaQuery), 'Live motion-frame opacity must avoid crossfade')
  assert.equal(live.split(mediaQuery).length - 1, 2)
})

test('the same Preview Engine remains wired to routed and inline Viewer without another media pipeline', () => {
  assert.ok(viewer.includes('<XDriveFilePreviewSurface'))
  assert.ok(viewer.includes('<XDriveLivePhotoSurface'))
  assert.ok(surface.includes('<XDriveDecodedImagePreview'))
  assert.ok(surface.includes('viewportTransition='))
  assert.equal(image.includes('fetch('), false)
  assert.equal(live.includes('fetch('), false)
})
