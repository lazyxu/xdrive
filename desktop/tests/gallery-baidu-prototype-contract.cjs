'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

test('Places gallery defaults to native Baidu SDK for the prototype', () => {
  const entry = source('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(entry, /const prototypeMap = Boolean\(listPlacesMapOverview && getBaiduJSAPIPrototype\)/)
  assert.match(entry, /prototypeMap && getBaiduJSAPIPrototype && listPlacesMapOverview \? \(/)
  assert.match(entry, /<XDriveMediaGalleryBaiduPrototypeMap/)
  assert.match(entry, /onOpenPlace=\{onOpenPlace\}/)
  assert.match(entry, /const prototypePlaces = places/)
  assert.match(entry, /listPlacesMapOverview=\{listPlacesMapOverview\}/)
  assert.doesNotMatch(entry, /listPlacesPage\(100,offset\)/)
  assert.match(entry, /loadThumbnail=\{loadPhotoCoverThumbnail\}/)
})

test('Baidu owns camera gestures, WGS84 conversion and geojson clustering', () => {
  const map = source('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  assert.match(map, /new api\.Map\(node\)/)
  assert.match(map, /new api\.ClusterLayer/)
  assert.match(map, /fitViewOnClick: true/)
  assert.match(map, /activeMap\.addLayer\(activeLayer\)/)
  assert.match(map, /runtime\.map\.setViewport\?\.\(points,/)
  assert.match(map, /manualCamera\.current/)
  assert.match(map, /node\.addEventListener\('pointerdown', userGesture\)/)
  assert.match(map, /xDriveConvertBaiduJSAPI4MarkerWindow/)
  assert.match(map, /runtime\.layer\.setData\(collection\)/)
  assert.match(map, /listPlacesMapOverview\(bounds, detail, controller.signal\)/)
  assert.match(map, /clusterMaxZoom: 16/)
  assert.match(map, /xDriveProjectBaiduPrototypeCoverPins/)
  assert.match(map, /<XDriveMediaGalleryCoverThumbnail/)
  assert.match(map, /selected\.isCluster !== false/)
  assert.match(map, /openRef\.current\?\.\(place\)/)
  assert.doesNotMatch(map, /xDrivePlacesPrototypeClusters|xDriveBaiduStaticViewportBounds/)
})

test('public browser key is separate from private server key and authenticated', () => {
  const handler = source('internal/api/baidu_jsapi4_prototype.go')
  const router = source('internal/api/router.go')
  assert.match(handler, /baiduJSAPISecretName/)
  assert.match(handler, /ConnectorSecrets\.Open/)
  assert.match(handler, /"browser_ak": string\(plaintext\)/)
  assert.doesNotMatch(handler, /baiduStaticMapURL|baiduMapSecret/)
  assert.match(router, /authed\.GET\("\/media\/places\/baidu-jsapi\/prototype", s\.mediaBaiduJSAPIPrototype\)/)
})

test('Web, Mobile Web and Desktop use the same Gallery component', () => {
  const gallery = source('ui/shared/src/mui/MediaGallery.tsx')
  const web = source('web/src/mediaGalleryAdapter.ts')
  const desktop = source('desktop/src/renderer/mediaGalleryAdapter.ts')
  const preload = source('desktop/src/preload/index.cts')
  assert.match(gallery, /getBaiduJSAPIPrototype=\{getBaiduJSAPIPrototype\}/)
  assert.match(web, /getBaiduJSAPIPrototype: signal => api\.mediaBaiduJSAPIPrototype\(signal\)/)
  assert.match(desktop, /getBaiduJSAPIPrototype: \(_signal\) => agent\.getBaiduJSAPIPrototype\(\)/)
  assert.match(preload, /agent:get-baidu-jsapi-prototype/)
})
