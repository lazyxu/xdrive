const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FilePreviewImageViewport.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(mod.exports, mod, require)

const {
  xDriveAnchoredImageOffset,
  xDriveClampImageOffset,
  xDriveClampImageScale,
  xDriveImagePanBounds,
} = mod.exports

test('contain pan bounds prevent blank-axis dragging', () => {
  const bounds = xDriveImagePanBounds({
    viewportWidth: 500,
    viewportHeight: 500,
    imageWidth: 1000,
    imageHeight: 500,
    imageFit: 'contain',
    scale: 2,
  })
  assert.deepEqual(bounds, { x: 250, y: 0 })
  assert.deepEqual(
    xDriveClampImageOffset({ x: 999, y: -999 }, bounds),
    { x: 250, y: 0 },
  )
})

test('pointer anchored zoom preserves the content under the pointer', () => {
  const next = xDriveAnchoredImageOffset({
    offset: { x: 0, y: 0 },
    oldScale: 1,
    newScale: 2,
    anchorX: 100,
    anchorY: -50,
  })
  assert.deepEqual(next, { x: -100, y: 50 })
})

test('rotated crop dimensions participate in pan bounds', () => {
  const bounds = xDriveImagePanBounds({
    viewportWidth: 400,
    viewportHeight: 300,
    imageWidth: 1200,
    imageHeight: 800,
    imageFit: 'contain',
    scale: 3,
    mediaTransform: {
      cropX: 0.25,
      cropY: 0,
      cropWidth: 0.5,
      cropHeight: 1,
      rotationDegrees: 90,
    },
  })
  assert.ok(bounds.x > 0)
  assert.ok(bounds.y > 0)
})

test('zoom scale remains bounded and rounded', () => {
  assert.equal(xDriveClampImageScale(0.2), 1)
  assert.equal(xDriveClampImageScale(8), 6)
  assert.equal(xDriveClampImageScale(1.234), 1.23)
})

test('shared image surface wires pointer anchors, decoded metrics and bounded offsets', () => {
  const surface = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx'),
    'utf8',
  )
  const image = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'FilePreviewImage.tsx'),
    'utf8',
  )
  for (const token of [
    'imageViewportRef',
    'setImageZoomAt',
    'xDriveAnchoredImageOffset',
    'xDriveImagePanBounds',
    'clampImageOffset',
    'onReadySize={handleImageReadySize}',
    'data-xdrive-preview-offset-x',
    'data-xdrive-preview-offset-y',
  ]) assert.ok(surface.includes(token), 'bounded image gesture contract missing: ' + token)
  assert.ok(image.includes('onReadySize?.(readyImage.naturalWidth, readyImage.naturalHeight)'))
})
