'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const relative = 'ui/shared/src/media-gallery-baidu-native-camera-session.ts'
const file = path.join(root, relative)
const js = ts.transpileModule(read(relative), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = new Module(file, module)
mod.filename = file
mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
mod._compile(js, file)
const {
  xDriveValidBaiduNativeCameraSnapshot: valid,
  xDriveReadBaiduNativeCamera: load,
  xDriveRememberBaiduNativeCamera: remember,
  xDriveClearBaiduNativeCamera: clear,
  xDriveCaptureBaiduNativeCamera: capture,
  XDRIVE_BAIDU_NATIVE_CAMERA_TTL_MS: ttl,
} = mod.exports
const bd09 = Object.freeze({ coordinate_space: 'bd09ll',
  latitude: 39.914, longitude: 116.403, zoom: 13 })

test('W3b1 original BD09 camera never accepts WGS84 relabel, invalid points or zoom', () => {
  assert.equal(valid(bd09), true)
  assert.equal(valid({ ...bd09, coordinate_space: 'wgs84' }), false)
  assert.equal(valid({ ...bd09, coordinate_space: undefined }), false)
  for (const camera of [
    { ...bd09, longitude: 181 }, { ...bd09, latitude: -86 },
    { ...bd09, zoom: 2 }, { ...bd09, zoom: 19 },
    { ...bd09, zoom: 13.1 }, { ...bd09, latitude: NaN },
    { ...bd09, longitude: Infinity }, { ...bd09, zoom: '13' },
  ]) assert.equal(valid(camera), false)
})

test('W3b1 Owner native camera is copied, bounded, ephemeral and scope isolated', () => {
  assert.equal(remember('owner-A-signed', bd09, 1000), true)
  assert.equal(load('owner-B-signed', 1001), undefined)
  const first = load('owner-A-signed', 1001)
  assert.deepEqual(first, bd09)
  first.latitude = -33
  assert.deepEqual(load('owner-A-signed', 1002), bd09, 'caller cannot mutate memory cache')
  assert.deepEqual(load('owner-A-signed', 1000 + ttl - 1), bd09)
  assert.equal(load('owner-A-signed', 1000 + ttl), undefined, '10-minute expiry is exact')
  assert.equal(remember('owner-A-signed', { ...bd09, coordinate_space: 'wgs84' }, 1200), false)
  assert.equal(remember('', bd09, 1200), false)
  assert.equal(remember('owner-C-signed', bd09, 1200), true)
  clear('owner-C-signed')
  assert.equal(load('owner-C-signed', 1201), undefined)
  const ghost = { ...bd09, token: 'must-not-persist', sdk: { privateGPS: true } }
  assert.equal(remember('owner-D-signed', ghost, 1200), true)
  assert.deepEqual(load('owner-D-signed', 1201), bd09, 'only four camera primitives are stored')
  clear('owner-D-signed')
})

test('W3b1 real map camera read returns BD09 only and fails closed on invalid provider', () => {
  const native = { getCenter: () => ({ lat: bd09.latitude, lng: bd09.longitude }),
    getZoom: () => bd09.zoom }
  assert.deepEqual(capture(native), bd09)
  assert.equal(capture({ ...native, getCenter: () => ({ lat: 90, lng: 0 }) }), null)
  assert.equal(capture({ ...native, getZoom: () => '13' }), null)
  assert.equal(capture({ ...native, getCenter: () => { throw Error('map disposed') } }), null)
  assert.equal(capture({ getZoom: () => 13 }), null)
  assert.equal(capture(null), null)
})

test('W3b1 uses original Owner Gallery, WGS84/BD09 separated mount and no reflow', () => {
  const loader = read('ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts')
  const mount = read('ui/shared/src/media-gallery-baidu-jsapi4-mount.ts')
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx')
  const isolated = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(mount, /coordinate_space: 'bd09ll'/)
  assert.match(loader, /camera.coordinate_space === 'bd09ll'/)
  assert.match(loader, /await originalPhotoPoint\(namespace, camera, signal\)/)
  assert.match(surface, /map.addEventListener\('moveend', recordNativeCamera\)/)
  assert.match(surface, /map.removeEventListener\('zoomend', recordNativeCamera\)/)
  assert.match(surface, /const camera = xDriveCaptureBaiduNativeCamera\(map\)/)
  assert.match(map, /nativeRestoreRef = useRef/)
  assert.match(map, /nativeRestoreRef.current = null/)
  assert.match(map, /initialCamera=\{nativeRestoreRef\.current\?\?undefined\}/)
  assert.match(isolated, /frame\?\.restoreCamera\(camera\)/)
  assert.match(isolated, /coordinate_space: 'bd09ll' as const/)
  assert.match(gallery, /xDriveReadBaiduNativeCamera\(preferenceScope\)/)
  assert.match(gallery, /onBaiduNativeCameraChange=\{rememberBaiduNativeCamera\}/)
  assert.match(gallery, /onBaiduNativeCameraClear=\{clearBaiduNativeCamera\}/)
  assert.equal(surface.includes('sessionStorage'), false)
  assert.equal(surface.includes('localStorage'), false)
  assert.doesNotMatch(isolated, /sessionStorage|localStorage/)
})
