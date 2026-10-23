'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const sessionSource = read('ui/shared/src/media-gallery-places-return-session.ts')
const compiled = ts.transpileModule(sessionSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const holder = { exports: {} }
new Function('exports', 'module', compiled)(holder.exports, holder)
const { xDriveValidPlacesReturnSnapshot: valid,
  xDriveReadPlacesReturn: get, xDriveRememberPlacesReturn: put,
  xDriveClearPlacesReturn: clear, XDRIVE_PLACES_RETURN_TTL_MS: ttl } = holder.exports
const snapshot = { placesPageOffset: 96, focusPlaceID: 'place:0:17990' }

test('place-list return is Owner-scoped, copied and expires after ten minutes', () => {
  clear('web:user-a'); clear('web:user-b')
  assert.equal(get('web:user-a', 1000), undefined)
  assert.equal(put('web:user-a', snapshot, 1000), true)
  assert.deepEqual(get('web:user-a', 1100), snapshot)
  assert.equal(get('web:user-b', 1100), undefined)
  const copy = get('web:user-a', 1200)
  copy.placesPageOffset = 1
  assert.equal(get('web:user-a', 1300).placesPageOffset, 96)
  assert.equal(get('web:user-a', 1000 + ttl), undefined)
  clear('web:user-a')
})

test('place-list return stores NO static geographic camera or GPS data', () => {
  for (const field of ['placesPageOffset']) {
    assert.equal(valid({ ...snapshot, [field]: NaN }), false)
    assert.equal(valid({ ...snapshot, [field]: Infinity }), false)
  }
  for (const bad of [
    { latitude: 90 }, { longitude: 181 }, { zoom: 12 }, { viewportOffset: 0 },
    { placesPageOffset: -1 }, { placesPageOffset: 10_000_001 },
    { focusPlaceID: 'other:foo' }, { focusPlaceID: 'place:' + 'x'.repeat(200) },
  ]) assert.equal(valid({ ...snapshot, ...bad }), false)
  assert.equal(put('', snapshot, 3000), false)
  assert.equal(put('web:user', { ...snapshot, zoom: 19 }, 3000), false)
})

test('place-list return cache holds at most eight independent scopes', () => {
  for (let i = 0; i < 9; i++) assert.equal(put('gallery-' + i, snapshot, 4000 + i), true)
  assert.equal(get('gallery-0', 4100), undefined)
  assert.deepEqual(get('gallery-8', 4100), snapshot)
  for (let i = 0; i < 9; i++) clear('gallery-' + i)
})

test('places return and native BD-09 camera remain separate across Web/Desktop', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const placesMap = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const nativeCamera = read('ui/shared/src/media-gallery-baidu-native-camera-session.ts')
  assert.match(gallery, /xDriveReadPlacesReturn\(preferenceScope\)/)
  assert.match(gallery, /source\.listPlacesPage\(48, placesReturnRef\.current\?\.placesPageOffset \?\? 0\)/)
  assert.match(gallery, /initialNativeCamera=\{baiduNativeCameraSnapshot\}/)
  assert.match(gallery, /onNativeCameraChange=\{onBaiduNativeCameraChange\}/)
  assert.match(placesMap, /xDriveValidBaiduNativeCameraSnapshot\(initialNativeCamera\)/)
  assert.match(placesMap, /onNativeCameraChange/)
  assert.match(placesMap, /clearCamera/)
  assert.match(placesMap, /focusPlaceID/)
  for (const source of [gallery, placesMap, nativeCamera, sessionSource]) {
    assert.doesNotMatch(source, /BMAP_PROXY_URL|new BMap\./)
  }
  assert.doesNotMatch(sessionSource, /latitude|longitude|zoom|mercator|viewportOffset|localStorage|sessionStorage|document\.cookie|indexedDB\.open|fetch\(/i)
})
