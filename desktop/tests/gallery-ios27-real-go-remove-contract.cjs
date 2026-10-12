const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const browser = read('desktop/scripts/gallery-ios27-real-go-remove-browser.cjs')
const ci = read('.github/workflows/ci.yml')
const shared = read('ui/shared/src/mui/MediaGallery.tsx')
const inspector = read('ui/shared/src/mui/MediaGalleryInspector.tsx')
const details = read('ui/shared/src/mui/MediaGalleryDetails.tsx')
const mobile = read('ui/shared/src/mui/MobileGalleryCollections.tsx')
const source = read('web/src/mediaGalleryAdapter.ts')
const web = read('web/src/App.tsx')
const go = read('internal/api/media_manual_albums.go')
const fixture = read('internal/api/gallery_ios27_live_go_browser_integration_test.go')

test('P1-3c2b mobile and wide remain single Gallery/REST/virtualizer/Inspector implementations', () => {
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /mobileWebChrome\s+source=\{gallerySource\}/)
  assert.match(source, /removeFromAlbum: \(albumID, revision, nodeID\) =>/)
  assert.match(shared, /onRemoveFromAlbum=\{isTrashSection \? undefined : onRemoveFromAlbum\}/)
  assert.match(shared, /useXDriveVirtualCollection/)
  assert.match(shared, /<MediaVirtualTileGrid/)
  assert.match(shared, /<MediaVirtualTimeline/)
  assert.match(details, /从当前相册移除/)
  assert.match(inspector, /data-xdrive-media-details-drawer/)
  assert.match(inspector, /data-xdrive-media-inspector/)
  assert.match(mobile, /data-xdrive-mobile-gallery-collection-card/)
  assert.match(go, /func \(s \*Server\) removeMediaAlbumItem\(c \*gin\.Context\)/)
  assert.match(go, /Delete\(&meta\.PhotoCollectionAsset\{\}\)/)
  assert.match(fixture, /meta.SyncRun\{\}/)
  assert.match(fixture, /meta.PhotoAlbumFolder\{\}/)
  assert.match(fixture, /meta.SourceItemMetadata\{\}/)
  assert.match(details, /disabled=\{albumBusy\}\s+sx=\{\{ '@media \(max-width:899\.95px\)': \{ minHeight: 44 \} \}\}\s+onClick/)
})

test('P1-3c2b native touch hold and wide context both open real shared Inspector remove', () => {
  for (const label of [
    "'mobile', albumMobile",
    "'wide', albumWide",
    "page.getByRole('tab', { name: '精选集', exact: true })",
    "'[data-xdrive-mobile-gallery-collection-card=\"album-'",
    "'[data-xdrive-gallery-section=\"albums\"]'",
    "'[data-xdrive-gallery-album=\"'",
    "pointerType: 'touch'",
    "await page.waitForTimeout(500)",
    "await tile.dispatchEvent('pointerdown', pointer)",
    "await tile.dispatchEvent('pointerup', pointer)",
    "tile.click({ button: 'right' })",
    "'[data-xdrive-gallery-media-context-menu]'",
    "name: '属性', exact: true",
    "'[data-xdrive-media-details-drawer], [data-xdrive-media-inspector]'",
    "name: '从当前相册移除', exact: true",
    "removeHitHeight >= 43.9",
  ]) assert.ok(browser.includes(label), 'missing actual UI remove gate: ' + label)
  assert.doesNotMatch(browser, /route\.fulfill\(|new XDriveApi\(|local-browser-qa-token/)
  assert.ok(browser.includes('return route.continue()'))
})

test('P1-3c2b exact actual DELETE authorization/revision/membership and preserved original bytes', () => {
  for (const label of [
    "resp.request().method() === 'DELETE'",
    "const actualHeader = response.request().headers()['if-match']",
    "actualHeader === '\"2\"'",
    "updated.revision === 3 && updated.item_count === 1",
    "const remaining = await persistedMembers(album)",
    "remaining[0] === album.nodeIDs.find(id => id !== removedNodeID)",
    "actualFetch('GET', '/api/v1/media/items/' + removedNodeID)",
    "canonical.status === 200",
    "stale.status === 409", "foreign.status === 404",
    "after.body.total_count === 10000",
    "results.unexpectedHTTP.length === 0 && results.pageErrors.length === 0",
    "results.expectedMissingCAS503 += 1",
    "metadataOnly: true, physicalIOS27: false",
  ]) assert.ok(browser.includes(label), 'missing real server/safety assertion: ' + label)
  assert.doesNotMatch(browser, /JSON\.stringify\(fixture\)|results\.token|console\.log\([^)]*fixture\.token/)
})

test('P1-3c2b conditional CI must have exact source head, private JWT and actual Chromium on PostgreSQL17', () => {
  for (const label of [
    "startsWith(github.head_ref, 'test/mobile-gallery-ios27-remove-live-go-')",
    'Actual Chromium Gallery Mobile/Wide remove from manual album to Gin PostgreSQL17',
    'desktop/scripts/gallery-ios27-real-go-remove-browser.cjs',
    'IOS27_GALLERY_ALBUM_REMOVE_REAL_GO_RESULT',
    'IOS27_GALLERY_LIVE_GO_VERIFIED',
    'gallery-ios27-real-album-remove',
    'XD_GALLERY_REMOVE_PR_HEAD: ' + '$' + '{{ github.event.pull_request.head.sha }}',
    'pr-head.sha', 'tested-checkout.sha',
    'rm -f "$READY"',
  ]) assert.ok(ci.includes(label), 'missing exact-head CI: ' + label)
})
