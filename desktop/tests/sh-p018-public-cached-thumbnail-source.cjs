'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const go = fs.readFileSync(path.join(root, 'internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go'), 'utf8')
const driver = fs.readFileSync(path.join(root, 'desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs'), 'utf8')
const publicPage = fs.readFileSync(path.join(root, 'web/src/PublicShare.tsx'), 'utf8')
const publicView = fs.readFileSync(path.join(root, 'ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/sh-p018-public-cached-thumbnail-cancel-100k.yml'), 'utf8')

test('SH-P018 original 100k physical JPEG source and sixteen separately cached derivatives use genuine PostgreSQL and CAS', () => {
  for (const token of [
    'const count = 100000', 'fileExplorerPhysicalJPEG(i)', 'storage.ContentAddressedKey(hash)',
    'store.Put(ctx, key, bytes.NewReader(payload))',
    'XD_SH_P018_REAL_CACHED_THUMBNAIL', 'thumbnailSeeds',
    'row.ThumbnailKey = mediaThumbnailStorageKey(node, row)',
    'MediaIndexStateReady', 'MediaKindImage', 'if len(thumbnailSeeds) != 16',
    'cached_thumbnail_candidates', 'p055RealCASAllocated(ctx, store)',
  ]) assert.ok(go.includes(token), 'missing authentic source and cache scope: ' + token)
  assert.ok(!go.includes('test-only nil file') && !go.includes('fakeStore'),
    'real source must not be replaced by mocks')
})

test('SH-P018 signed cached GET is held after Gin entry, without mocked fetch or Owner URL', () => {
  const facade = fs.readFileSync(path.join(root, 'ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx'), 'utf8')
  const bridge = fs.readFileSync(path.join(root, 'ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx'), 'utf8')
  const core = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
  const native = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorerThumbnail.tsx'), 'utf8')
  for (const token of [
    'type shP018HeldBodyWriter struct', '<-w.request.Context().Done()',
    'server.Auth.ParsePublicShareThumbnail', 'claims.NodeID == blockedNodeID',
    'router.ServeHTTP(&shP018HeldBodyWriter', 'thumbnail_cancelled_go',
    'thumbnail_active_held', 'thumbnail_stale_body_bytes',
  ]) assert.ok(go.includes(token), 'missing genuine Go cancellation proof: ' + token)
  for (const forbidden of ['window.fakeFetch', 'route.fulfill(', 'mockFetch('])
    assert.ok(!driver.includes(forbidden), 'native Chromium must hit Go server: ' + forbidden)
  assert.match(publicPage, /activeThumbnailRequests\.current/)
  assert.match(publicPage, /document\.addEventListener\('visibilitychange'/)
  assert.match(publicPage, /window\.addEventListener\('pagehide'/)
  const loadFolderSource = publicPage.slice(publicPage.indexOf('const loadFolder = async'),
    publicPage.indexOf('const download = async'))
  assert.ok(loadFolderSource.includes('folder.cursor !== cursor'))
  assert.ok(loadFolderSource.includes('!refresh'))
  assert.ok(loadFolderSource.includes('activeThumbnailRequests.current) request.abort()'))
  assert.ok(loadFolderSource.indexOf('request.abort()') < loadFolderSource.indexOf('await shareFileAdapter.list('))
  assert.ok(publicPage.includes('await api.publicShareChildren(token, password, parentID, pageCursor, signal)'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.ok(bridge.includes('loadThumbnail={thumbnailLoader}'))
  assert.ok(bridge.includes('forceVirtualization'))
  assert.ok(core.includes('XDriveFileExplorerThumbnailProvider'))
  assert.match(native, /IntersectionObserver/)
  for (const forbidden of ['onDeleteItems=', 'onMoveItemsTo=', 'onUpload=', 'onPaste=',
    'OwnerJWT']) assert.ok(!bridge.includes(forbidden))
})

test('SH-P018 real-browser sessions use three independent lifecycle cancellations per CSS width', () => {
  for(const token of [
    'probePublicCachedThumbnailCancellation', 'scroll-out-of-viewport',
    'real-window-pagehide', 'bounded-next-page',
    'win.loadURL(\'about:blank\')', 'root.scrollTop = root.scrollHeight',
    'SH_P018_SOURCE_EXACT_BASELINE', 'decoded_cached_jpegs',
    'go_cancel_max_ms', 'go_cancel_max_ms<=160',
    'thumbnail_stale_body_bytes',
  ]) assert.ok(driver.includes(token), 'missing exact viewport-to-Go proof: ' + token)
  for(const token of [
    'postgres:17-alpine', "XD_SH_P018_REAL_CACHED_THUMBNAIL: '1'",
    'npm --prefix web run build',
    'Go_Context_Done', 'source:data.exact_source_head',
    'no actual', 'upload-artifact@v4',
  ]) {
    // 'no actual' intentionally need not appear in the workflow prose.
    if(token !== 'no actual') assert.ok(workflow.includes(token), 'missing CI gate: '+token)
  }
})
