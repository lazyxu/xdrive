const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const go = read('internal', 'api', 'baidu_map.go')
const router = read('internal', 'api', 'router.go')
const ui = read('ui', 'shared', 'src', 'mui', 'MediaGalleryBaiduStaticMap.tsx')
const places = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPlacesMap.tsx')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const web = read('web', 'src', 'mediaGalleryAdapter.ts')
const desktop = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
const agent = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const admin = read('internal', 'api', 'admin_service_dependencies.go')

test('Baidu map is a server-only bounded PNG source using WGS84 without exposing the AK', () => {
  assert.match(go, /https:\/\/api\.map\.baidu\.com\/staticimage\/v2/)
  assert.ok(go.includes('values.Set("coordtype", "wgs84ll")'))
  assert.ok(go.includes('values.Set("scaler", "2")'))
  assert.ok(go.includes('client.CheckRedirect'))
  assert.ok(go.includes('baiduMapMaxBytes'))
  assert.ok(go.includes('Cache-Control'))
  assert.ok(router.includes('authed.GET("/media/places/baidu-static"'))
  assert.ok(router.includes('authed.GET("/media/places/map-provider"'))
  assert.equal(ui.includes('api.map.baidu.com'), false)
  assert.equal(web.includes('api.map.baidu.com'), false)
})

test('Gallery Places uses only Baidu maps and never renders an offline substitute', () => {
  assert.ok(places.includes('data-xdrive-gallery-places-map'))
  assert.ok(places.includes('<XDriveMediaGalleryBaiduStaticMap'))
  assert.ok(places.includes('仅使用百度地图 Server API'))
  assert.ok(places.includes('选择地图地点'))
  assert.ok(gallery.includes('getBaiduMapProvider={source.getBaiduMapProvider}'))
  assert.ok(web.includes('loadBaiduStaticMap:'))
  assert.ok(desktop.includes('loadBaiduStaticMap:'))
  for (const retired of ['WORLD_OUTLINES', 'component="svg"', 'xDriveMediaPlacesCluster',
    'xDriveMediaPlacesProject', 'xDriveMediaPlacesPanViewport', 'GRATICULE_', 'useXDrivePointerDrag']) {
    assert.equal(places.includes(retired), false, 'offline map still used: ' + retired)
  }
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'ui', 'shared', 'src', 'mui',
    'MediaGalleryPlacesMapModel.ts')), false, 'offline map projection must be removed')
})

test('Disabled, unsupported or failing Baidu renders a visible error state without a map fallback', () => {
  for (const token of [
    "provider.kind === 'checking'",
    "provider.kind === 'unavailable'",
    '百度地图未启用',
    '无法连接百度地图服务',
    '百度地图加载失败',
    '百度地图返回的图片无法显示',
    'role="status"',
    'AbortController',
    'URL.revokeObjectURL(imageObjectURL)',
  ]) {
    assert.ok(ui.includes(token), 'Baidu-only error/cleanup contract missing: ' + token)
  }
  assert.equal(ui.includes('return null'), false)
  assert.equal(ui.includes('本地地图'), false)
  assert.equal(ui.includes('离线底图'), false)
  assert.equal(ui.includes('offline Places'), false)
})

test('Desktop PNG uses binary Agent IPC with request-scoped cancellation', () => {
  assert.ok(agent.includes('"GET /v1/media/baidu-static"'))
  assert.ok(agent.includes('w.Header().Set("Content-Type", "image/png")'))
  assert.ok(preload.includes("'agent:get-baidu-static-map'"))
  assert.ok(main.includes("'agent:get-baidu-static-map'"))
  assert.ok(main.includes('viewportRequests.run(event.sender, requestID'))
  assert.ok(desktop.includes('xDriveDesktopViewportRequest(signal'))
  assert.equal(desktop.includes('base64'), false)
})

test('Admin status distinguishes configured/unverified from falsely claiming healthy Baidu service', () => {
  assert.ok(admin.includes('s.effectiveBaiduMapConfig(ctx)'))
  assert.ok(admin.includes('services[7].Status = "unknown"'))
  assert.ok(admin.includes('Label: "百度地图 Server API"'))
})
