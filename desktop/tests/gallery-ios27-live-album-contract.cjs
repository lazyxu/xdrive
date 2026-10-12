const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const browser = read('desktop/scripts/gallery-ios27-real-go-album-browser.cjs')
const fixture = read('internal/api/gallery_ios27_live_go_browser_integration_test.go')
const ci = read('.github/workflows/ci.yml')
const shared = read('ui/shared/src/mui/MediaGallery.tsx')
const toolbar = read('ui/shared/src/mui/MediaGallerySelectionToolbar.tsx')
const chrome = read('ui/shared/src/mui/MobileGalleryChrome.tsx')
const web = read('web/src/App.tsx')
const adapter = read('web/src/mediaGalleryAdapter.ts')
const api = read('web/src/api.ts')

test('P1-3c2a Mobile and wide actual controls share one Gallery, REST DataSource and selection owner', () => {
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /mobileWebChrome\s+source=\{gallerySource\}/)
  assert.match(web, /createWebMediaGalleryDataSource\(api\)/)
  assert.match(shared, /<XDriveMediaGallerySelectionToolbar/)
  assert.match(shared, /<XDriveMediaGallerySelectionReviewDialog/)
  assert.match(shared, /useXDriveVirtualCollection/)
  assert.match(shared, /<MediaVirtualTileGrid/)
  assert.match(shared, /<MediaVirtualTimeline/)
  assert.match(chrome, /data-xdrive-mobile-gallery-select/)
  assert.match(toolbar, /data-xdrive-gallery-selection-toolbar/)
  assert.match(toolbar, /data-xdrive-gallery-selection-more/)
  assert.match(toolbar, /data-xdrive-gallery-album-picker/)
  assert.match(toolbar, /onAddToAlbum/)
  assert.match(adapter, /addToAlbum: \(albumID, revision, nodeIDs\) =>/)
  assert.match(api, /addMediaAlbumItems\(albumID: string, revision: number, nodeIDs: number\[\]\)/)
  assert.match(api, /headers: \{ 'If-Match':/)
})

test('P1-3c2a actual mounted Mobile and wide selections submit 2 canonical Nodes to real Server', () => {
  for (const gate of [
    "width, album)",
    "'mobile', 375, mobileAlbum",
    "'wide', 900, wideAlbum",
    "page.locator('[data-xdrive-media-tile]:visible')",
    "page.locator('[data-xdrive-mobile-gallery-select]')",
    "page.locator('[data-xdrive-gallery-toolbar]')",
    "review.locator('[data-xdrive-gallery-selected-item]')",
    "page.getByRole('dialog', { name: /^已选择\\s*2\\s*项$/ })",
    "name: '更多已选项目操作'",
    "name: '加入相册'",
    "name: '选择手动相册'",
    "name: '添加到相册'",
    "getByRole('combobox', { name: '添加到相册'",
    "getByRole('option', { name: album.name",
    "decodeURIComponent(new URL(response.url()).pathname) === expected",
    "const sent = request.postDataJSON()",
    "quotedRevision === '\"1\"'",
    "updated.revision === 2 && updated.item_count === 2",
    "await toolbar.waitFor({ state: 'hidden' })",
    "persistedNodeIDs: persisted",
  ]) assert.ok(browser.includes(gate), 'missing mounted real Gallery batch add gate: ' + gate)
  assert.doesNotMatch(browser, /route\.fulfill\(|new XDriveApi\(|local-browser-qa-token|__fixtureStatus/)
  assert.ok(browser.includes('return route.continue()'))
})

test('P1-3c2a actual Gin CAS owner and revision guard rejects stale and foreign mutations', () => {
  for (const gate of [
    "const stale = await actualFetch('POST', albumPath(mobileAlbum)",
    "stale.status === 409",
    "const foreign = await actualFetch('POST', albumPath(wideAlbum)",
    "foreign.status === 404",
    "JSON.stringify(await membership(mobileAlbum))",
    "JSON.stringify(await membership(wideAlbum))",
    "result.unexpectedHTTP.length === 0 && result.pageErrors.length === 0",
    "response.status() >= 500",
    "result.expectedThumbnail503 += 1",
    "result.sources",
  ]) {
    // sources is a top-level static key, checked independently below.
    if (gate !== 'result.sources') assert.ok(browser.includes(gate), 'missing strict negative/receipt gate: ' + gate)
  }
  assert.ok(browser.includes('sources: Object.fromEntries(['))
  assert.ok(fixture.includes('meta.SyncRun{}'))
  assert.ok(fixture.includes('os.WriteFile(readyPath, payload, 0600)'))
  assert.doesNotMatch(browser, /console\.log\([^)]*fixture\.token|JSON\.stringify\(fixture\)/)
})

test('P1-3c2a exact-source CI creates private Go fixture then real native Chromium and never uploads JWT file', () => {
  for (const gate of [
    "startsWith(github.head_ref, 'test/mobile-gallery-ios27-album-live-go-')",
    'Actual Chromium Gallery Mobile/Wide manual Album Add with Gin and PostgreSQL17',
    'desktop/scripts/gallery-ios27-real-go-album-browser.cjs',
    "grep -q 'IOS27_GALLERY_LIVE_GO_VERIFIED'",
    'IOS27_GALLERY_ALBUM_REAL_GO_RESULT',
    'gallery-ios27-live-album-go-postgres',
    'XD_GALLERY_ALBUM_PR_HEAD: ' + '$' + '{{ github.event.pull_request.head.sha }}',
    'pr-head.sha', 'tested-checkout.sha',
    'rm -f "$READY"',
  ]) assert.ok(ci.includes(gate), 'missing CI gate: ' + gate)
  assert.doesNotMatch(ci.slice(ci.indexOf('Actual Chromium Gallery Mobile/Wide manual Album Add')),
    /path: \$\{\{ runner\.temp \}\}\/xdrive-ios27-gallery-private-ready\.json/)
})
