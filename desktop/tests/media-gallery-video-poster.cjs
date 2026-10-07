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

const { xDriveMediaVideoPosterGeometry } = mod.exports

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
