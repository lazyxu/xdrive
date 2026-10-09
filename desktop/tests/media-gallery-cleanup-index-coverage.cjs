const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('G11 Cleanup shows explicit known-asset coverage even when no Burst suggestions exist', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const cleanup = read('ui/shared/src/mui/MediaGalleryCleanup.tsx')
  const component = read('ui/shared/src/mui/MediaGalleryCleanupIndexStatus.tsx')
  const server = read('internal/api/media_index_status.go')
  const apiCoverage = read('internal/api/router_contract_test.go')

  assert.match(server, /Scope:\s+"known_photo_assets"/)
  assert.match(apiCoverage, /path: "\/api\/v1\/media\/index-status"/)

  // Scope the test to the Cleanup call, not an unrelated gallery feedback
  // strip which already uses the index status capability.
  const jsxStart = gallery.indexOf('<XDriveMediaGalleryCleanup')
  assert.notEqual(jsxStart, -1)
  const cleanupCall = gallery.slice(jsxStart, gallery.indexOf('/>', jsxStart) + 2)
  for (const prop of [
    'indexStatus={indexStatus}',
    'indexStatusLoading={indexStatusLoading}',
    'indexStatusError={indexStatusError}',
    'onRequestIndexStatus={onRequestIndexStatus}',
  ]) {
    assert.ok(cleanupCall.includes(prop), 'Cleanup index status not passed: ' + prop)
  }
  assert.match(cleanup, /XDriveMediaGalleryCleanupIndexStatus/)
  assert.match(cleanup, /const indexCoverage =/)
  assert.match(cleanup, /\{indexCoverage\}/)
  assert.match(cleanup, /当前已索引素材暂时没有连拍清理建议/)
  assert.doesNotMatch(cleanup, /DuplicateCard|onOpenDuplicate|加载更多重复组/)

  assert.match(component, /data-xdrive-media-cleanup-index-coverage/)
  assert.match(component, /data-xdrive-media-cleanup-check-index/)
  assert.match(component, /ready_assets/)
  assert.match(component, /failed_assets/)
  assert.match(component, /unsupported_assets/)
  assert.match(component, /missing_metadata_assets/)
  assert.match(component, /other_unready_assets/)
  assert.match(component, /status\?\.checked_at/)
  assert.match(component, /尚未扫描、尚未形成资产的文件不计入/)
  assert.match(component, /不能据此认定全库没有重复照片/)
  assert.doesNotMatch(component, /useEffect|setInterval|fetch\(/)
  const firstPage = gallery.slice(
    gallery.indexOf('const loadFirstPage = useCallback'),
    gallery.indexOf('const loadMemories = useCallback'),
  )
  assert.doesNotMatch(firstPage, /getIndexStatus|requestIndexStatus/)
  const loadCleanup = gallery.slice(
    gallery.indexOf('const loadCleanup = useCallback'),
    gallery.indexOf('const loadMoreCleanupGroups = useCallback'),
  )
  assert.doesNotMatch(loadCleanup, /getIndexStatus|requestIndexStatus/)
})
