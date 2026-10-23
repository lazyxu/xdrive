'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('retired Baidu static PNG and live PNG verification have no accessible routes or clients', () => {
  const router = read('internal/api/router.go')
  const ipc = read('cmd/xdrive-agent/desktop_ipc.go')
  const client = read('internal/client/client.go')
  const dts = read('desktop/src/renderer/global.d.ts')
  const web = read('web/src/api.ts')
  const preload = read('desktop/src/preload/index.cts')
  const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  for (const filename of [
    'internal/api/baidu_map.go',
    'internal/api/admin_baidu_map_verify.go',
    'cmd/xdrive-agent/desktop_ipc_admin_baidu_verify.go',
    'ui/shared/src/media-gallery-baidu-camera.ts',
    'ui/shared/src/mui/MediaGalleryBaiduStaticMap.tsx',
  ]) assert.equal(fs.existsSync(path.join(root, filename)), false, filename)
  assert.doesNotMatch(router, /\/media\/places\/(?:baidu-static|map-provider)|\/services\/baidu-map\/verify/)
  assert.doesNotMatch(ipc, /\/v1\/media\/(?:baidu-static|map-provider)|\/v1\/cloud\/admin-baidu-map\/verify/)
  assert.doesNotMatch(client, /MediaBaiduStaticMap|MediaBaiduMapProvider|VerifyAdminBaiduMap/)
  assert.doesNotMatch(dts, /getBaiduMapProvider|getBaiduStaticMap|cloudVerifyAdminBaiduMap/)
  assert.doesNotMatch(web, /mediaBaiduStaticMap|mediaBaiduMapProvider|adminVerifyBaiduMap/)
  assert.doesNotMatch(preload, /getBaiduStaticMap|getBaiduMapProvider|cloudVerifyAdminBaiduMap/)
  assert.match(map, /XDriveMediaGalleryBaiduIsolatedPhotoSurface/)
  assert.doesNotMatch(map, /StaticMap|loadStaticMap|static fallback/)
})
