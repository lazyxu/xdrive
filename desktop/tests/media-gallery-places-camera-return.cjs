'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const sessionSource = read('ui/shared/src/media-gallery-places-camera-session.ts')
const compiled = ts.transpileModule(sessionSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const holder = { exports: {} }
new Function('exports', 'module', compiled)(holder.exports, holder)
const { xDriveValidPlacesCameraSnapshot: valid,
  xDriveReadPlacesCamera: get, xDriveRememberPlacesCamera: put,
  xDriveClearPlacesCamera: clear, XDRIVE_PLACES_CAMERA_TTL_MS: ttl } = holder.exports
const snapshot = { latitude: 0, longitude: 179.9, zoom: 12,
  viewportOffset: 48, placesPageOffset: 96, focusPlaceID: 'place:0:17990' }

test('A3b3a2c transient camera/page return is owner scoped and has a ten-minute TTL', () => {
  clear('web:user-a'); clear('web:user-b')
  assert.equal(get('web:user-a', 1000), undefined)
  assert.equal(put('web:user-a', snapshot, 1000), true)
  assert.deepEqual(get('web:user-a', 1100), snapshot)
  assert.equal(get('web:user-b', 1100), undefined)
  const copy = get('web:user-a', 1200)
  copy.latitude = 40
  assert.equal(get('web:user-a', 1300).latitude, 0)
  assert.equal(get('web:user-a', 1000 + ttl), undefined)
  clear('web:user-a')
})

test('A3b3a2c invalid GPS, zoom, offsets, scope cannot enter the cache', () => {
  for (const field of ['latitude', 'longitude', 'zoom', 'viewportOffset', 'placesPageOffset']) {
    assert.equal(valid({ ...snapshot, [field]: NaN }), false)
    assert.equal(valid({ ...snapshot, [field]: Infinity }), false)
  }
  for (const bad of [{ latitude: 90 }, { longitude: 181 }, { zoom: 2 },
    { zoom: 18.5 }, { viewportOffset: -1 }, { placesPageOffset: 10_000_001 },
    { focusPlaceID: 'other:foo' }, { focusPlaceID: 'place:' + 'x'.repeat(200) }]) {
    assert.equal(valid({ ...snapshot, ...bad }), false)
  }
  assert.equal(put('', snapshot, 3000), false)
  assert.equal(put('web:user', { ...snapshot, zoom: 19 }, 3000), false)
})

test('A3b3a2c cache is bounded to eight slots with deterministic eviction', () => {
  for (let i = 0; i < 9; i++) assert.equal(put('gallery-' + i, snapshot, 4000 + i), true)
  assert.equal(get('gallery-0', 4100), undefined)
  assert.deepEqual(get('gallery-8', 4100), snapshot)
  for (let i = 0; i < 9; i++) clear('gallery-' + i)
})

test('A3b3a2c Page, static map and viewport preserve Back identity on all clients', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const placesMap = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const staticMap = read('ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx')
  assert.match(gallery, /xDriveReadPlacesCamera\(preferenceScope\)/)
  assert.match(gallery, /persistPlacesCamera\(\{ \.\.\.placesCameraRef\.current, focusPlaceID: place\.id,/)
  assert.match(gallery, /source\.listPlacesPage\(48, placesCameraRef\.current\?\.placesPageOffset \?\? 0\)/)
  assert.match(gallery, /placesCameraSnapshot=\{placesCameraSnapshot\}/)
  assert.match(gallery, /onPlacesCameraChange=\{rememberPlacesCamera\}/)
  assert.match(placesMap, /initialView = boundsRef\.current === null/)
  assert.match(placesMap, /viewportOffsetRef\.current = 0/)
  assert.match(placesMap, /onCameraChange\?\.\(\{ \.\.\.position, viewportOffset: viewportOffsetRef\.current \}\)/)
  assert.match(placesMap, /data-xdrive-places-viewport-return-anchor/)
  assert.match(staticMap, /key: originKey, latitude: restoredCamera\.latitude, longitude: restoredCamera\.longitude/)
  assert.match(staticMap, /onCameraChange\?\.\(\{ latitude: centerLatitude, longitude: centerLongitude, zoom \}\)/)
  for (const source of [gallery, placesMap, staticMap, sessionSource]) {
    assert.doesNotMatch(source, /BMAP_PROXY_URL|new BMap\./)
  }
  assert.doesNotMatch(sessionSource, /window\.localStorage|window\.sessionStorage|document\.cookie|indexedDB\.open|fetch\(/)
})
