'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

test('shared Viewer no longer offers per-photo map opt-in, grant, renewal or revoke', () => {
  const dialog = read('ui/shared/src/mui/MediaGalleryViewerLocationDialog.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(dialog, /validGPS/)
  assert.match(dialog, /无需单独授权/)
  assert.match(dialog, /打开照片地图/)
  assert.doesNotMatch(dialog, /地图位置隐私授权|授权一小时|撤销授权|同意将此照片的位置|issueConsent\(/)
  assert.doesNotMatch(dialog, /\bCheckbox\b|\bFormControlLabel\b/)
  assert.match(gallery, /有效 GPS 照片自动参与地图索引，无需逐张授权/)
})

test('Owner GPS map API scope never implies an extra per-photo grant', () => {
  const go = read('internal/api/baidu_jsapi4_native_viewport_http.go')
  const types = read('ui/shared/src/models.ts')
  const cells = read('ui/shared/src/media-gallery-baidu-jsapi4-cells.ts')
  const viewport = read('ui/shared/src/media-gallery-baidu-jsapi4-bd09-photo.ts')
  const photoMap = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  for (const source of [go, types, cells, viewport]) {
    assert.match(source, /owner_gps_auto_index/)
    assert.doesNotMatch(source, /explicit_opt_in_only/)
  }
  assert.doesNotMatch(photoMap, /已授权 BD-09|获授权且来源有效|已授权照片范围/)
})

test('Owner map SQL and Router do not require or expose an extra grant', () => {
  const map = read('internal/api/baidu_photo_map_viewport.go')
  const writer = read('internal/api/baidu_photo_map_index_write.go')
  const intent = read('internal/api/baidu_photo_map_index_intent.go')
  const routes = read('internal/api/router.go')
  assert.doesNotMatch(map, /JOIN xd_baidu_photo_map_consents/)
  assert.doesNotMatch(writer, /verifyBaiduPhotoMapConsentTx/)
  assert.doesNotMatch(intent, /verifyBaiduPhotoMapConsentTx/)
  assert.match(map, /pa.owner_id = p.owner_id/)
  assert.match(map, /m.node_revision = n.revision/)
  assert.doesNotMatch(routes, /authed\.(GET|PUT|DELETE)\("\/media\/items\/:id\/baidu-map-consent"/)
  assert.doesNotMatch(routes, /authed\.(POST|DELETE)\("\/media\/items\/:id\/baidu-map-index-job"/)
})

test('policy supersedes historical photo consent without removing account isolation', () => {
  const policy = read('docs/gallery-places-no-photo-consent-policy.md')
  const agents = read('docs/history/AGENTS-2026-10-27-before-consolidation.md')
  assert.match(policy, /no additional consent/)
  assert.match(agents, /Permanent photo-map no-extra-consent policy/)
  assert.match(agents, /strict Owner/)
})
