'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const cameraSource = read('ui/shared/src/media-gallery-baidu-camera.ts')
const compiled = ts.transpileModule(cameraSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const holder = { exports: {} }
new Function('exports', 'module', compiled)(holder.exports, holder)
const bounds = holder.exports.xDriveBaiduStaticViewportBounds

test('A3b3a2b static WGS84 envelope accepts 0/0, poles and dateline wrap', () => {
  const zero = bounds({ latitude: 0, longitude: 0 }, 10)
  assert.ok(zero.west < 0 && zero.east > 0 && zero.south < 0 && zero.north > 0)
  const crossing = bounds({ latitude: 10, longitude: 179.99 }, 10)
  assert.ok(crossing.west > crossing.east, 'antimeridian must keep west>east')
  const polar = bounds({ latitude: 85, longitude: 0 }, 10)
  assert.ok(polar.north <= 85 && polar.south < polar.north)
  assert.equal(bounds({ latitude: 90, longitude: 0 }, 10), null)
  assert.equal(bounds({ latitude: NaN, longitude: 0 }, 10), null)
  assert.equal(bounds({ latitude: 0, longitude: 0 }, 1), null)
  assert.equal(bounds({ latitude: 0, longitude: 0 }, 10, 0, 200), null)
  assert.equal(bounds({ latitude: 0, longitude: 0 }, 3, 8192, 200), null)
})

test('A3b3a2b shared camera triggers Owner viewport; stale queries abort', () => {
  const staticMap = read('ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx')
  const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(staticMap, /xDriveBaiduStaticViewportBounds/)
  assert.match(staticMap, /onViewportChange\?\.\(bounds\)/)
  assert.match(map, /onViewportChange=\{onCameraViewport\}/)
  assert.match(map, /listPlacesViewport\(viewportBounds, 24, viewportOffset, controller\.signal\)/)
  assert.match(map, /activeRequest\.current\?\.abort\(\)/)
  assert.match(map, /controller\.abort\(\)/)
  assert.match(map, /generation !== requestGeneration\.current/)
  assert.match(map, /page\.total_photo_count/)
  assert.match(map, /sameViewport\(viewportResult\.bounds, viewportBounds\)/)
  assert.match(map, /data-xdrive-places-viewport-results/)
  assert.match(map, /onOpenPlace\?\.\(place\)/)
  assert.match(gallery, /listPlacesViewport=\{source\.listPlacesViewport\}/)
  assert.match(gallery, /listPlacesViewport=\{listPlacesViewport\}/)
  assert.doesNotMatch(map, /BMAP_PROXY_URL|api\.map\.baidu\.com|new BMap\./)
  assert.doesNotMatch(staticMap, /BMAP_PROXY_URL|new BMap\./)
})
