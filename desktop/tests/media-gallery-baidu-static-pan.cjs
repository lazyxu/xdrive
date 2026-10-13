const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const helperSource = fs.readFileSync(path.join(root, 'ui/shared/src/media-gallery-baidu-camera.ts'), 'utf8')
const mapSource = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx'), 'utf8')
const compiled = ts.transpileModule(helperSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const holder = { exports: {} }
new Function('exports', 'module', compiled)(holder.exports, holder)
const step = holder.exports.xDriveBaiduStaticStepCenter

test('A3 Baidu static camera moves and inverse operations restore WGS84 center', () => {
  const start = { latitude: 39.915, longitude: 116.404 }
  const east = step(start, 12, 80, 0)
  const north = step(start, 12, 0, -80)
  assert.ok(east.longitude > start.longitude)
  assert.ok(Math.abs(east.latitude - start.latitude) < 1e-9)
  assert.ok(north.latitude > start.latitude)
  assert.ok(Math.abs(north.longitude - start.longitude) < 1e-9)
  assert.ok(Math.abs(step(east, 12, -80, 0).longitude - start.longitude) < 1e-9)
  assert.ok(Math.abs(step(north, 12, 0, 80).latitude - start.latitude) < 1e-9)
})

test('A3 Baidu static camera clamps poles and wraps the antimeridian', () => {
  const wrap = step({ latitude: 10, longitude: 179.99 }, 10, 120, 0)
  assert.ok(wrap.longitude >= -180 && wrap.longitude < 0)
  const n = step({ latitude: 84.99, longitude: 0 }, 3, 0, -100000)
  const s = step({ latitude: -84.99, longitude: 0 }, 3, 0, 100000)
  assert.ok(n.latitude <= 85 && n.latitude >= -85)
  assert.ok(s.latitude <= 85 && s.latitude >= -85)
  assert.deepEqual(step({ latitude: 3, longitude: 4 }, 19, 10, 0), { latitude: 3, longitude: 4 })
  assert.equal(step({ latitude: NaN, longitude: 4 }, 12, 10, 0).longitude, 4)
  assert.ok(step({ latitude: 0, longitude: 0 }, 3, 80, 0).longitude >
    step({ latitude: 0, longitude: 0 }, 18, 80, 0).longitude)
  assert.doesNotMatch(helperSource, /fetch\(|XMLHttpRequest|canvas|\.filter\(|\.map\(/)
})

test('A3 shared static Baidu view requests once after drag release and cancels stale PNG', () => {
  assert.match(mapSource, /data-xdrive-baidu-static-step-pan/)
  assert.match(mapSource, /onPointerDown=\{onMapPointerDown\}/)
  assert.match(mapSource, /onPointerUp=\{onMapPointerUp\}/)
  assert.match(mapSource, /Math\.hypot\(deltaX, deltaY\) < 18/)
  assert.match(mapSource, /onKeyDown=\{onMapKeyDown\}/)
  assert.match(mapSource, /new AbortController\(\)/)
  assert.match(mapSource, /controller\.abort\(\)/)
  assert.match(mapSource, /\[enabled, centerLatitude, centerLongitude, loadStaticMap, zoom, requestID\]/)
  assert.match(mapSource, /loadStaticMap\(\{/)
  assert.doesNotMatch(mapSource, /[?&]ak=|api\.map\.baidu\.com|new BMap\./)
})
