const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const browser = read('desktop/scripts/gallery-ios27-real-go-conflict-browser.cjs')
const workflow = read('.github/workflows/ci.yml')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const toolbar = read('ui/shared/src/mui/MediaGallerySelectionToolbar.tsx')
const web = read('web/src/App.tsx')
const adapter = read('web/src/mediaGalleryAdapter.ts')
const api = read('web/src/api.ts')
const go = read('internal/api/media_manual_albums.go')

test('P1-3c2c Mobile/Wide retain a single shared Gallery/DataSource/controller and Server CAS', () => {
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /mobileWebChrome\s+source=\{gallerySource\}/)
  assert.match(web, /createWebMediaGalleryDataSource\(\s*api\s*(?:,\s*\{\s*onAuthorizedAlbums\s*:|\))/)
  assert.match(gallery, /useXDriveVirtualCollection/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(gallery, /<XDriveMediaGallerySelectionToolbar/)
  assert.match(toolbar, /data-xdrive-gallery-album-picker/)
  assert.match(adapter, /addToAlbum: \(albumID, revision, nodeIDs\) =>/)
  assert.match(api, /addMediaAlbumItems\(albumID: string, revision: number, nodeIDs: number\[\]\)/)
  assert.match(go, /func \(s \*Server\) addMediaAlbumItems\(c \*gin\.Context\)/)
})

test('P1-3c2c real 409 is induced by another authorized writer after initial album render', () => {
  for (const term of [
    "'mobile', mobileAlbum", "'wide', wideAlbum",
    "'[data-xdrive-mobile-gallery-select]'",
    "'[data-xdrive-gallery-toolbar]'",
    "'[data-xdrive-gallery-selected-item]'",
    "'[data-xdrive-gallery-selection-toolbar]'",
    "name: '选择手动相册'",
    "name: '加入相册'",
    "getByRole('combobox', { name: '添加到相册'",
    "const concurrent = await actualFetch('POST'",
    "concurrent.body?.revision === 2",
    "check(JSON.stringify(await membership(album)) === JSON.stringify([seedNode])",
    "const staleResponse = postObserver(page, album)",
    "const refreshResponse = refreshedCatalogObserver(page)",
    "inspectResponse(refused, 409, 1, chosen)",
    "fetchedAlbums.find(entry => entry.id === album.id)",
    "fresh?.revision === 2 && fresh?.item_count === 1",
    "await picker.getByRole('alert').getByText(/相册已更新/).waitFor()",
    "selectionStatus.replace(/\\s/g, '') === '已选择2项'",
  ]) assert.ok(browser.includes(term), 'missing stale UI test gate: ' + term)
  assert.doesNotMatch(browser, /route\.fulfill\(|__fixtureStatus|local-browser-qa-token/)
  assert.ok(browser.includes('return route.continue()'))
})

test('P1-3c2c refreshed revision explicitly retried (never silently auto-submitted)', () => {
  for (const term of [
    "const retryResponse = postObserver(page, album)",
    "inspectResponse(accepted, 200, 2, chosen)",
    "updated?.revision === 3",
    "updated?.item_count === 3",
    "JSON.stringify(persisted) === JSON.stringify(sorted([seedNode, ...chosen]))",
    "await toolbar.waitFor({ state: 'hidden' })",
    "result.accepted.length === 2",
    "result.httpErrors.length === 0 && result.pageErrors.length === 0",
    "result.expectedCAS503 += 1",
    "metadataOnly: true, physicalIOS27: false",
  ]) assert.ok(browser.includes(term), 'missing explicit retry/persistence gate: ' + term)
  const conflict = browser.indexOf('inspectResponse(refused, 409, 1, chosen)')
  const refresh = browser.indexOf('const refreshState = await refreshResponse', conflict)
  const retry = browser.indexOf('const retryResponse = postObserver(page, album)', refresh)
  assert.ok(conflict >= 0 && refresh > conflict && retry > refresh,
    '409 -> canonical GET -> deliberate UI retry is the required order')
  assert.doesNotMatch(browser, /console\.log\([^)]*fixture\.token|JSON\.stringify\(fixture\)/)
})

test('P1-3c2c source-exact CI runs only on scoped PR with private JWT and real Gin/PostgreSQL17', () => {
  for (const term of [
    "startsWith(github.head_ref, 'test/mobile-gallery-ios27-album-conflict-real-go-')",
    'Actual Chromium Gallery Mobile/Wide Album 409 conflict and explicit retry in Gin PostgreSQL17',
    'desktop/scripts/gallery-ios27-real-go-conflict-browser.cjs',
    'IOS27_GALLERY_ALBUM_CONFLICT_REAL_GO_RESULT',
    'IOS27_GALLERY_LIVE_GO_VERIFIED',
    'gallery-ios27-album-conflict-real-go-postgres',
    'XD_GALLERY_CONFLICT_PR_HEAD: ' + '$' + '{{ github.event.pull_request.head.sha }}',
    'pr-head.sha', 'tested-checkout.sha', 'rm -f "$READY"',
  ]) assert.ok(workflow.includes(term), 'missing authentic conditional CI: ' + term)
})


test('P1-3c2c 409 refresh is owner-fenced and never silently replays selected mutations', () => {
  assert.match(gallery, /const status = albumError && typeof albumError === 'object' && 'status' in albumError/)
  assert.match(gallery, /if \(status === 409\)/)
  assert.match(gallery, /await source\.listAlbums\(\)/)
  assert.match(gallery, /\(entry\.revision \?\? 0\) > \(album\.revision \?\? 0\)/)
  assert.match(gallery, /\(current\.revision \?\? 0\) <= \(latest\.revision \?\? 0\)/)
  assert.match(gallery, /ownerScope === deletePreferenceScopeRef\.current/)
  assert.match(gallery, /setAlbums\(\(current\) => ownerScope === deletePreferenceScopeRef\.current/)
  assert.match(gallery, /setCurrentAlbum\(\(current\) => ownerScope === deletePreferenceScopeRef\.current/)
  assert.match(gallery, /相册已更新，已获取最新版本，请确认后重新点击加入相册/)
  // The UI must explicitly re-submit: a 409 never makes this business callback
  // call source.addToAlbum a second time on its own.
  const block = gallery.slice(gallery.indexOf('  const addItemsToAlbum = useCallback('),
    gallery.indexOf('  const deleteItems = useCallback(', gallery.indexOf('  const addItemsToAlbum = useCallback(')))
  assert.equal((block.match(/await source\.addToAlbum\(/g) || []).length, 1)
  assert.ok(browser.includes('error => ({ value: null, error: String(error) })'))
  assert.ok(browser.includes('const refreshState = await refreshResponse'))
  assert.ok(browser.includes('refreshState.error'))
})

test('P1-3c2c POST observer normalizes BOTH sides of a percent-encoded album path', () => {
  // The real Gin route uses an owner-scoped manual:ID; encodeURIComponent()
  // escapes its colon, but decodeURIComponent(pathname) returns the literal ID.
  // Our first native 409 reached Gin yet the mismatched observer timed out.
  assert.ok(browser.includes("const expected = decodeURIComponent(albumPath(album) + '/items')"))
  assert.ok(browser.includes('decodeURIComponent(new URL(response.url()).pathname) === expected'))
  const albumID = 'manual:12345'
  const path = '/api/v1/media/albums/' + encodeURIComponent(albumID) + '/items'
  assert.notEqual(path, decodeURIComponent(path))
  assert.equal(decodeURIComponent(new URL('http://127.0.0.1:18080' + path).pathname),
    decodeURIComponent(path))
})
