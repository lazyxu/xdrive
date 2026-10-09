const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('G05 index coverage is explicit, owner-scoped, and never blocks first image', () => {
  const server = read('internal/api/media_index_status.go')
  const router = read('internal/api/router.go')
  assert.match(router, /GET\("\/media\/index-status", s\.listMediaIndexStatus\)/)
  assert.match(read('internal/api/router_contract_test.go'), /path: "\/api\/v1\/media\/index-status"/)
  assert.match(server, /Where\("pa.owner_id = \?", ownerID\)/)
  assert.match(server, /JOIN xd_nodes AS n ON n.id = pa.primary_node_id/)
  assert.match(server, /n.deleted_at IS NULL/)
  assert.match(server, /LEFT JOIN xd_media_metadata AS mm/)
  assert.match(server, /mm\.index_state/)
  assert.match(server, /missing_metadata_assets/)
  assert.match(server, /other_unready_assets/)
  assert.match(server, /known_photo_assets/)
  assert.doesNotMatch(server, /refreshMediaIndexForOwner|refreshMediaIndexForGalleryRead|Store\.Open|ListAll/)
})

test('G05 index status traverses Web and Desktop with a separate explicit request', () => {
  const target = {
    web: read('web/src/api.ts'),
    webAdapter: read('web/src/mediaGalleryAdapter.ts'),
    desktop: read('desktop/src/main/index.cts'),
    preload: read('desktop/src/preload/index.cts'),
    renderer: read('desktop/src/renderer/mediaGalleryAdapter.ts'),
    agent: read('cmd/xdrive-agent/desktop_ipc.go'),
    go: read('internal/client/media.go'),
    ui: read('ui/shared/src/mui/MediaGallery.tsx'),
  }
  assert.match(target.web, /mediaIndexStatus\(\)/)
  assert.match(target.webAdapter, /getIndexStatus: \(\) => api\.mediaIndexStatus\(\)/)
  assert.match(target.desktop, /'agent:get-media-index-status'/)
  assert.match(target.preload, /getMediaIndexStatus: \(\) =>/)
  assert.match(target.renderer, /getIndexStatus: \(\) => agent\.getMediaIndexStatus\(\)/)
  assert.match(target.agent, /media-index-status/)
  assert.match(target.go, /func \(c \*Client\) MediaIndexStatus/)
  assert.match(target.ui, /const requestIndexStatus = useCallback\(async \(\) =>/)
  assert.match(target.ui, /onRequestIndexStatus=\{source\.getIndexStatus \? requestIndexStatus : undefined\}/)
  assert.match(target.ui, /data-xdrive-gallery-index-status-request/)
  assert.match(target.ui, /仅已识别照片资产，不表示全库文件已扫描/)
  const firstPage = target.ui.slice(
    target.ui.indexOf('const loadFirstPage = useCallback'),
    target.ui.indexOf('const loadMemories = useCallback'),
  )
  assert.doesNotMatch(firstPage, /getIndexStatus|requestIndexStatus/)
})
