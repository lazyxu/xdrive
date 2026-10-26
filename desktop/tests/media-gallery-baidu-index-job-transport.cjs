'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = name => fs.readFileSync(path.resolve(__dirname, '..', '..', name), 'utf8')

test('photo map indexing never asks Viewer users for an extra authorization or manual job', () => {
  const dialog = read('ui/shared/src/mui/MediaGalleryViewerLocationDialog.tsx')
  assert.match(dialog, /无需单独授权/)
  assert.match(dialog, /位置索引完成后显示/)
  assert.doesNotMatch(dialog, /确认单独提交|加入索引等待队列|授权一小时|撤销授权/)
  assert.doesNotMatch(dialog, /enqueueBaiduMapIndexJob\(nodeID|cancelBaiduMapIndexJob\(nodeID/)
})

test('Owner source queue is independent of the old map-consent table', () => {
  const map = read('internal/api/baidu_photo_map_viewport.go')
  const writer = read('internal/api/baidu_photo_map_index_write.go')
  const intent = read('internal/api/baidu_photo_map_index_intent.go')
  const api = read('internal/api/router.go')
  assert.doesNotMatch(intent, /verifyBaiduPhotoMapConsentTx/)
  assert.match(intent, /consentRevision: 0/)
  assert.match(writer, /ConsentRevision:\s+0/)
  assert.match(writer, /verifyPrivacy\(ctx, tx, owner.ID, asset.ID\)/)
  assert.match(map, /n.deleted_at IS NULL/)
  assert.doesNotMatch(api, /authed\.POST\("\/media\/items\/:id\/baidu-map-index-job"/)
  assert.doesNotMatch(api, /authed\.DELETE\("\/media\/items\/:id\/baidu-map-index-job"/)
})

test('retained Server-only provider and retry controls do not automatically dispatch raw GPS', () => {
  const worker = read('internal/api/baidu_photo_map_index_execute.go')
  const retry = read('internal/api/baidu_photo_map_index_retry.go')
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  assert.match(worker, /validateBaiduPhotoMapIndexLease/)
  assert.match(worker, /settleFailedBaiduPhotoMapIndexAttempt/)
  assert.match(retry, /baiduMapIndexNextRetry/)
  assert.match(policy, /return ErrGateClosed/)
})
