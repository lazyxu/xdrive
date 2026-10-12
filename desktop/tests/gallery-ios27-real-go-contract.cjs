const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const go = read('internal/api/gallery_ios27_live_go_browser_integration_test.go')
const chrome = read('desktop/scripts/gallery-ios27-real-go-browser.cjs')
const workflow = read('.github/workflows/ci.yml')
const web = read('web/src/App.tsx')
const adapter = read('web/src/mediaGalleryAdapter.ts')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')

test('P1-3c1 genuine Gin PostgreSQL17 fixture preserves owner and 10k logical assets', () => {
  for (const evidence of [
    'TestIOS27GalleryLiveGoFixture', 'fileExplorerMediaPerfDatabase(t, dsn)',
    'mediaGallerySeedFirstOpenScaled(t, db, ownerRoot.OwnerID, folder.ID, 10_000)',
    'meta.InstallNodeChangeJournal(db)', 'router.ServeHTTP(w, r)',
    'createTestUser(t, db, router, "gallery-live-foreign"',
    'foreign.TotalCount != 0', 'http.StatusNotFound',
    'readRange', 'no-store', 'os.WriteFile(readyPath, payload, 0600)',
    'IOS27_GALLERY_LIVE_GO_VERIFIED',
    'meta.FileOperation{}', 'meta.UploadSession{}', 'meta.SyncRun{}',
    'meta.PhotoPersonCluster{}', 'meta.PhotoPerson{}',
    'meta.PhotoVisualLabel{}', 'meta.PhotoPlaceLabel{}',
  ]) assert.ok(go.includes(evidence), 'missing real-Go test contract: ' + evidence)
})

test('P1-3c1 native Chromium four widths actually consume Go Range response', () => {
  for (const width of [375, 390, 899, 900]) {
    assert.ok(chrome.includes('width: ' + width), 'missing viewport ' + width)
  }
  for (const evidence of [
    'actualGoServer: true, postgresql17: true', 'interceptedAPI: false',
    "url.pathname === '/api/v1/media/items'",
    "url.searchParams.get('range') === 'true'",
    'const listResponse = page.waitForResponse(',
    "await page.reload({ waitUntil: 'domcontentloaded' })",
    'const response = await listResponse', 'const pageData = await response.json()',
    'pageData.total_count === 10000', 'pageData.items.length <= 128',
    "page.locator('[data-xdrive-media-tile]')",
    'mounted > 0 && mounted < 400',
    "'[data-xdrive-mobile-app-header]'",
    'Math.abs(headerHeight - 52) <= 1',
    'denied.detailStatus === 404', 'denied.unauthenticatedStatus === 401',
    'metadataOnlyThumbnail503', 'response.status() === 503',
    'response.status() >= 500',
  ]) assert.ok(chrome.includes(evidence), 'missing browser contract: ' + evidence)
  assert.doesNotMatch(chrome, /route\.fulfill\(|__fixtureStatus|local-browser-qa-token/)
  assert.ok(chrome.includes('return route.continue()'))
  const listen = chrome.indexOf('const listResponse = page.waitForResponse(')
  const reload = chrome.indexOf("await page.reload({ waitUntil: 'domcontentloaded' })", listen)
  const body = chrome.indexOf('const pageData = await response.json()', reload)
  assert.ok(listen > 0 && reload > listen && body > reload,
    'arm real Go Range listener before reload, then consume its actual response body')
})

test('P1-3c1 both widths use the same Web Gallery business/controller/virtualizer', () => {
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /mobileWebChrome\s+source=\{gallerySource\}/)
  assert.match(web, /createWebMediaGalleryDataSource\(api\)/)
  assert.match(adapter, /listItemRange: \(limit, offset, query, signal\) => api\.mediaItemRange/)
  assert.match(gallery, /useXDriveVirtualCollection/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(gallery, /data-xdrive-media-tile/)
  assert.doesNotMatch(chrome, /new XDriveApi\(|new XDriveMediaGalleryPage\(/)
})

test('P1-3c1 exact-PR-head CI uses a private JWT ready file and stores no secrets', () => {
  for (const evidence of [
    "startsWith(github.head_ref, 'test/mobile-gallery-ios27-real-go-')",
    'Actual Chromium Gallery 375/390/899/900 to Gin and PostgreSQL17',
    'go test -c -o "$RUNNER_TEMP/xdrive-gallery-live-go-api.test"',
    'desktop/scripts/gallery-ios27-real-go-browser.cjs',
    'IOS27_GALLERY_LIVE_GO_VERIFIED',
    'gallery-ios27-real-go-postgres',
    'XD_GALLERY_PR_HEAD: ' + '$' + '{{ github.event.pull_request.head.sha }}',
    'rm -f "$READY"',
  ]) assert.ok(workflow.includes(evidence), 'missing scoped Gallery CI: ' + evidence)
  assert.doesNotMatch(chrome, /JSON\.stringify\(fixture\)|result\.token/)
  assert.ok(workflow.includes('pr-head.sha') && workflow.includes('tested-checkout.sha'))
})
