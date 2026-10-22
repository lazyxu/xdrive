const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const web = read('web/src/App.tsx')
const webAdapter = read('web/src/mediaGalleryAdapter.ts')
const wide = read('desktop/src/renderer/App.tsx')
const page = read('ui/shared/src/mui/MediaGallery.tsx')
const chrome = read('ui/shared/src/mui/MobileGalleryChrome.tsx')
const collections = read('ui/shared/src/mui/MobileGalleryCollections.tsx')
const navigation = read('ui/shared/src/mui/MediaGalleryNavigation.tsx')

test('Web wide and Mobile Web mount one shared Gallery page and same REST DataSource', () => {
  assert.equal((web.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(web, /mobileWebChrome\s+source=\{gallerySource\}/)
  assert.match(web, /createWebMediaGalleryDataSource\(\s*api\s*(?:,\s*\{\s*onAuthorizedAlbums\s*:|\))/)
  assert.match(wide, /<XDriveMediaGalleryPage\s+source=\{mediaGallerySource\}/)
  assert.match(webAdapter, /listItemRange:\s*\(limit, offset, query, signal\)\s*=>\s*api\.mediaItemRange/)
  assert.match(webAdapter, /listAlbumItemRange:\s*\(albumID, limit, offset, query\)\s*=>\s*api\.mediaAlbumItemRange/)
  assert.match(webAdapter, /listMemories:\s*\(anchorDate.*\)\s*=>/)
})

test('Both Web widths use one VirtualCollection with identical media and Viewer semantics', () => {
  assert.match(page, /useXDriveVirtualCollection(?:<[^>]+>)?\(/)
  assert.match(page, /virtualCollection=\{galleryVirtualCollection\}/)
  assert.match(page, /<MediaVirtualTileGrid/)
  assert.match(page, /<MediaVirtualTimeline/)
  assert.match(page, /<XDriveMediaGalleryViewer/)
  assert.match(page, /onOpenViewer=\{onOpenViewer\s*\?/)
  assert.match(page, /const compactGallery = useMediaQuery\([^\n]+&& mobileWebChrome/)
  assert.match(page, /firstAtLatest \? 'latest' : undefined/)
  assert.match(page, /XDriveMediaThumbnailScheduler/)
  assert.doesNotMatch(collections, /listItemRange\(|fetch\(|new XMLHttpRequest\(/)
})

test('All wide Web Gallery root sections remain reachable from mobile primary tabs / Collections', () => {
  for (const section of ['library', 'memories', 'people', 'places', 'albums',
    'favorites', 'media-types', 'cleanup', 'trash']) {
    assert.match(navigation, new RegExp("value: '" + section + "'"))
    const found = section === 'library'
      ? chrome.includes("['library', '图库']")
      : collections.includes("open('" + section + "')")
    assert.ok(found, 'Mobile Gallery missing category: ' + section)
  }
  assert.match(chrome, /data-xdrive-mobile-gallery-primary-tabs/)
  assert.match(chrome, /data-xdrive-mobile-gallery-search/)
  assert.doesNotMatch(chrome, /data-xdrive-mobile-gallery-category/)
})

test('Mobile Collections fetches bounded genuine previews without invalidating Library range', () => {
  assert.match(page, /source\.listMemories\(day, 8, timeZone\)/)
  assert.match(page, /if \(!mobileGalleryViewport\) return/)
  assert.match(page, /collectionsPreviewRef\.current\.key !== key/)
  assert.match(page, /warmMobileCollectionsPreview\(\)/)
  assert.match(page, /virtualCollection\.primePage\(/)
  assert.match(page, /if \(mobileCollectionsOverview\)/)
  assert.match(page, /filterContent=\{showCollectionFilters \|\| mobileCollectionsOverview \? filters : undefined\}/)
  assert.match(page, /onMobileCollectionsOverviewChange\?\.\(false\)/)
  assert.match(collections, /IntersectionObserver/)
  assert.match(collections, /rootMargin: '180px'/)
})

test('The mobile appearance preserves the 52px App header and delegates all mutations', () => {
  const appHeader=read('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(appHeader, /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.match(page, /MediaGallerySelectionToolbar/)
  assert.match(page, /onSetFavoriteBatch/)
  assert.match(page, /onAddTagsBatch/)
  assert.match(page, /onAddItemsToAlbum/)
  assert.match(page, /onDeleteItems/)
  assert.match(page, /onDownloadItems/)
  assert.match(page, /onExportLivePhoto/)
  assert.match(page, /onRemoveFromAlbum/)
  assert.doesNotMatch(collections, /create.*DataSource|new.*VirtualCollection/)
})


test('P0-3a Mobile Collections reuses wide Web album pin preferences and same callback',()=>{
  const organizer=read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
  const organization=read('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts')
  assert.match(organizer,/readMediaAlbumPreferences\(accountScope\)/)
  assert.match(organizer,/writeMediaAlbumPreferences\(accountScope, next\)/)
  assert.match(organization,/export function sortedMediaAlbums\(/)
  assert.match(collections,/const canonicalAlbumPrefs = readMediaAlbumPreferences\(accountScope\)/)
  assert.match(collections,/sortedMediaAlbums\(albums, canonicalAlbumPrefs\)/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.doesNotMatch(collections,/create.*DataSource|new.*VirtualCollection|fetch\(/)
})


test('P0-3b mobile layout and per-group collapse are presentation-only',()=>{
  assert.match(collections,/xdrive\.gallery\.mobile\.collections\.layout\.v1/)
  assert.match(collections,/data-xdrive-mobile-gallery-layout-trigger/)
  assert.match(collections,/data-xdrive-mobile-gallery-collapse-group/)
  assert.match(collections,/readMediaAlbumPreferences\(accountScope\)/)
  assert.match(collections,/onOpenAlbum\(album\)/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.doesNotMatch(collections,/listItemRange\(|new XMLHttpRequest\(|fetch\(/)
})


test('P0-3c1 Collections reorder is presentation state, not a new media controller',()=>{
  assert.match(collections,/xdrive\.gallery\.mobile\.collections\.group-order\.v1/)
  assert.match(collections,/data-xdrive-mobile-gallery-reorder-handle/)
  assert.match(collections,/onPointerMove=\{moveDrag\}/)
  assert.match(collections,/data-xdrive-mobile-gallery-reorder-done/)
  assert.match(collections,/xDriveReadMobileGalleryGroupOrder\(accountScope\)/)
  assert.doesNotMatch(collections,/listItemRange\(|fetch\(|new XMLHttpRequest\(/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})


test('P0-3c2 pinned edit shares canonical wide-Web album preferences',()=>{
  const organization=read('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts')
  assert.match(collections,/xdrive\.gallery\.mobile\.collections\.pinned-order\.v1/)
  assert.match(collections,/changeAlbumPin\(albums, readMediaAlbumPreferences\(accountScope\), albumID\)/)
  assert.match(collections,/writeMediaAlbumPreferences\(accountScope/)
  assert.match(collections,/data-xdrive-mobile-gallery-edit-pinned/)
  assert.match(collections,/data-xdrive-mobile-gallery-pinned-editor/)
  assert.match(collections,/data-xdrive-mobile-gallery-pin-handle/)
  assert.match(collections,/data-xdrive-mobile-gallery-pin-remove/)
  assert.match(collections,/data-xdrive-mobile-gallery-pin-add/)
  assert.match(organization,/export function changeAlbumPin\(/)
  assert.match(organization,/export function readMediaAlbumPreferences\(/)
  assert.doesNotMatch(collections,/listItemRange\(|new XMLHttpRequest\(|fetch\(/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
})


test('P0-3d quick Pin and remove confirmation keep common Gallery semantics',()=>{
  assert.match(collections,/data-xdrive-mobile-gallery-quick-pin-action/)
  assert.match(collections,/onContextMenu=\{\(event\) =>/)
  assert.match(collections,/setTimeout\(\(\) => \{/)
  assert.match(collections,/onScroll=\{cancelHold\}/)
  assert.match(collections,/data-xdrive-mobile-gallery-pin-confirm-remove/)
  assert.match(collections,/data-xdrive-mobile-gallery-pin-cancel-remove/)
  assert.match(collections,/changeAlbumPin\(albums, readMediaAlbumPreferences\(accountScope\), albumID\)/)
  assert.doesNotMatch(collections,/listItemRange\(|fetch\(|new XMLHttpRequest\(/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})


test('P0-3e native collection heading is the only View All affordance, using original callbacks',()=>{
  assert.match(collections,/data-xdrive-mobile-gallery-section-heading=\{id\}/)
  assert.match(collections,/aria-label=\{'查看全部' \+ title\} onClick=\{onViewAll\}/)
  assert.match(collections,/minHeight: 44, minWidth: 0, maxWidth: '100%'/)
  assert.match(collections,/onEdit: enterPinEdit/)
  assert.doesNotMatch(collections,/onViewAll: pinnedAlbumCount/)
  assert.doesNotMatch(collections,/listItemRange\(|fetch\(|new XMLHttpRequest\(/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})


test('P0-3f mounted Web and Mobile share same account-pinned album notifications',()=>{
  const organization=read('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts')
  const organizer=read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
  assert.match(organization,/export function subscribeMediaAlbumPreferences\(/)
  assert.match(organization,/albumPreferenceListeners\.get\(accountScope\)/)
  assert.match(organization,/addEventListener\?\.\('storage', onStorage\)/)
  assert.match(organization,/removeEventListener\?\.\('storage', onStorage\)/)
  assert.match(organizer,/return subscribeMediaAlbumPreferences\(accountScope, \(\) => \{/)
  assert.match(collections,/useEffect\(\(\) => subscribeMediaAlbumPreferences\(accountScope, \(\) => \{/)
  assert.match(collections,/readMediaAlbumPreferences\(accountScope\)/)
  assert.match(page,/accountScope=\{preferenceScope\}/)
  assert.doesNotMatch(collections,/create.*DataSource|new.*VirtualCollection|listItemRange\(|fetch\(/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'),
    /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})

test('P1-1a Mobile Collections overview reuses the Wide Web Gallery upload entry and native picker', () => {
  assert.match(page, /const galleryUploadAction = onUploadRequested &&/)
  assert.match(page, /!isTrashSection \|\| \(compactGallery && mobileCollectionsOverview\)/)
  // Map is a second authorized entry; it must not hide the existing upload entry.
  assert.match(page, /showOverviewActions=\{Boolean\(galleryUploadAction \|\| onShowMap\)\}/)
  assert.match(page, /extraActions=\{mobileCollectionsOverview \? galleryUploadAction :/)
  assert.match(chrome, /data-xdrive-mobile-gallery-show-map/)
  assert.match(page, /extraActions=\{mobileCollectionsOverview \? galleryUploadAction :/)
  assert.match(page, /\{contextualHeaderActions\}/)
  assert.match(page, /data-xdrive-gallery-upload/)
  assert.match(page, /\{querySelectionControls\}/)
  assert.match(page, /extraActions=\{mobileCollectionsOverview \? galleryUploadAction :/)
  assert.doesNotMatch(page, /mobileCollectionsOverview \? contextualHeaderActions/)
  assert.match(web, /ref=\{galleryUploadInputRef\}[\s\S]*?multiple[\s\S]*?onUploadRequested=\{\(\) => galleryUploadInputRef\.current\?\.click\(\)\}/)
  assert.match(chrome, /const canShowMore =/)
  assert.match(chrome, /if \(!canShowMore\) setMoreOpen\(false\)/)
  assert.doesNotMatch(chrome, /fetch\(|listItemRange\(|new XMLHttpRequest\(/)
  const realWebFixture = read('desktop/scripts/mobile-web-app-browser.cjs')
  assert.match(realWebFixture, /const expectedVersion = sourceMIME === 'image\/png' \? '4' : '3'/)
  assert.match(realWebFixture, /thumbnail URL version must match the fixture source MIME/)
})


test('P1-1b Mobile filters reuse the exact wide-Web owner-scoped Server facets query', () => {
  assert.match(page, /onOpenMobileFilters=\{\(\) => \{ void requestFacets\(\) \}\}/)
  assert.match(page, /onFilterOpen=\{onOpenMobileFilters\}/)
  assert.match(page, /source\.listFacets\(facetQuery, albumID\)/)
  assert.match(webAdapter, /listFacets: \(query, albumID\) => api\.mediaFacets\(query, albumID\)/)
  assert.match(chrome, /if \(searchOpen\) onFilterOpenRef\.current\?\.\(\)/)
  assert.match(chrome, /\}, \[searchOpen\]\)/)
  assert.match(page, /useXDriveVirtualCollection(?:<[^>]+>)?\(/)
  assert.doesNotMatch(chrome, /\bfetch\(|listItemRange\(|new XMLHttpRequest\(/)
})



test('P1-1c Web and Mobile sorting/time-scale affordances share Page eligibility', () => {
  assert.match(page, /const canSortPhotoCollection =\s*showPhotoCollection &&[\s\S]*?Boolean\(onSortChange\)/)
  assert.match(page, /canSort=\{canSortPhotoCollection\}/)
  assert.match(page, /showTimeScale=\{showCollectionTimeScale\}/)
  assert.match(page, /\{canSortPhotoCollection \? \(/)
  assert.match(chrome, /\{canSort \? \(\[/)
  assert.match(chrome, /showCollection && showTimeScale \? \(/)
  assert.match(chrome, /timeScale === 'day' && onJumpDay/)
  assert.doesNotMatch(chrome, /\bfetch\(|listItemRange\(|new XMLHttpRequest\(/)
})


test('P1-3b Mobile Gallery restores selection focus through the visible Chrome Select', () => {
  assert.match(page, /selectionControlRef=\{selectionControlRef\}/)
  assert.match(page, /ref=\{compactGallery \? undefined : selectionControlRef\}/)
  assert.match(chrome, /<Button ref=\{selectionControlRef\} size="small" aria-pressed=\{selectionMode\}/)
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  assert.match(browser, /galleryToolbar = page\.locator\('\[data-xdrive-mobile-gallery-actions\]'\)/)
  assert.match(read('desktop/scripts/mobile-web-app-browser.cjs'), /Gallery 900px: wide Select and album dropdown remain reachable/)
  assert.match(browser, /Gallery album Cancel restores the live visible More trigger/)
  assert.match(browser, /Actual403 remains readable/)
  assert.match(browser, /Successful Add focuses the real visible iOS27 Mobile Gallery selection control/)
})


test('P1-3b built Web Gallery selection preflight uses the actual Mobile Files surface', () => {
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  assert.match(browser, /galleryIos27Fixture \|\| gallerySelectionScenario/)
  assert.match(browser, /await page\.getByText\('document-001\.txt', \{ exact: true \}\)\.first\(\)\.waitFor\(\)/)
  assert.match(browser, /await galleryToolbar\.getByRole\('button', \{ name: '选择', exact: true \}\)\.tap\(\)/)
})


test('P1-3b Gallery selection native REST fixture uses iOS27 sparse-tail query validation', () => {
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  const query = browser.split("case 'GET /api/v1/media/items': {")[1]
    .split("case 'GET /api/v1/media/facets':")[0]
  assert.equal((query.match(/galleryIos27Fixture \|\| gallerySelectionScenario/g) || []).length, 4)
  assert.match(query, /initial_position', 'unknown_first', 'anchor_node_id'/)
  assert.match(query, /assert\.equal\(direction, 'asc', 'latest-at-bottom requires ascending sort'\)/)
  assert.match(query, /initial_position and explicit anchor cannot both choose the initial position/)
  assert.match(query, /anchor_index: mediaItems\.length - 1/)
})


test('P1-3b real Gallery selection thumbnails preserve exact v4 PNG and Node revision query', () => {
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  const thumbnail = browser.split("match = /^GET \\/api\\/v1\\/media\\/items\\/(\\d+)\\/thumbnail$/.exec(key);")[1]
    .split("match = /^POST \\/api\\/v1\\/files")[0]
  assert.match(thumbnail, /galleryIos27Fixture \|\| gallerySelectionScenario/)
  assert.match(thumbnail, /queryOnly\(url, \(galleryIos27Fixture \|\| gallerySelectionScenario\)/)
  assert.match(thumbnail, /assert\.equal\(url\.searchParams\.get\('v'\), expectedVersion/)
  assert.match(thumbnail, /assert\.equal\(url\.searchParams\.get\('revision'\)/)
  assert.match(thumbnail, /String\(mediaByID\.get\(Number\(match\[1\]\)\)\.node\.revision\)/)
})


test('P1-3b selection scrolls the genuine virtual Gallery owner from iOS27 latest tail to item zero', () => {
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  assert.match(browser, /Gallery actual Mobile Select has entered selection mode/)
  assert.match(browser, /await page\.locator\('main'\)\.evaluate\(element => \{ element\.scrollTop = 0 \}\)/)
  assert.match(browser, /\[data-xdrive-media-tile\]\[data-xdrive-media-index="0"\]/)
  assert.match(browser, /Gallery virtualized tail-to-top exposes original canonical row zero/)
  assert.match(browser, /Gallery selection uses the observed first three media rows/)
  assert.match(browser, /node_ids:\[1000,1001,1002\]/)
})


test('P1-3b Gallery selection empty tail page matches Go nonnegative-offset contract with bounded prefetch', () => {
  const server = read('internal/api/media.go')
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  const pageQuery = browser.split("case 'GET /api/v1/media/items': {")[1]
    .split("case 'GET /api/v1/media/facets':")[0]
  assert.match(server, /offset must be zero or greater/)
  assert.match(pageQuery, /const endPageOffset = Math\.ceil\(mediaItems\.length \/ limit\) \* limit/)
  assert.match(pageQuery, /gallerySelectionScenario \? endPageOffset : mediaItems\.length/)
  assert.match(pageQuery, /only one page-aligned empty tail range is allowed/)
  assert.match(pageQuery, /empty range must start at a sparse page boundary/)
  assert.match(pageQuery, /mediaItems\.slice\(offset, offset \+ limit\)/)
})


test('P1-3b selection survival uses stable semantic scope, not volatile virtual range requestID', () => {
  const scope = read('ui/shared/src/media-gallery-selection-scope.ts')
  assert.match(scope, /function xDriveMediaGallerySelectionScopeKey\(/)
  assert.match(scope, /requestID/)
  assert.match(scope, /sort_by/)
  assert.match(scope, /sort_dir/)
  assert.match(scope, /unknown_first/)
  assert.match(scope, /anchor_node_id/)
  assert.match(scope, /accountScope/)
  assert.match(page, /selectionScopeKey=\{xDriveMediaGallerySelectionScopeKey\(collectionTarget, preferenceScope\)\}/)
  assert.match(page, /collectionKey=\{mediaGalleryCollectionKey\(collectionTarget\)\}/)
  assert.match(page, /selectionScopeKey = collectionKey/)
  const reset = page.slice(page.indexOf('selectionActionGenerationRef.current += 1'))
    .split('  useEffect(() => {\n    if (!selectionMode) return')[0]
  assert.match(reset, /selectionScopeKey,/)
  assert.doesNotMatch(reset.split('  useEffect(() => {\n    setSelectionAnchorIndex')[0], /collectionKey,/)
  assert.match(reset, /setSelectionAnchorIndex\(null\)/)
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  assert.match(browser, /Gallery 900px: wide Select and album dropdown remain reachable/)
  assert.match(browser, /await join\.waitFor\(\{ state: 'visible' \}\);\n    \/\/ The MUI Grow/)
  assert.match(browser, /await finishTransition\(\);\n    await page\.screenshot\(\{ path: path\.join\(outputDir, 'gallery-selection-more-stable\.png'\) \}\)/)
})

test('P1-3b native 900px sparse remount verifies exact logical selected Node identities via shared Review', () => {
  const browser = read('desktop/scripts/mobile-web-app-browser.cjs')
  const acceptance = browser.split('async function gallerySelectionAcceptance() {')[1]
    .split('async function mobilePanelsAcceptance() {')[0]
  for (const gate of [
    "width === 900 || JSON.stringify(currentSelectedIndexes) === '[0,1,2]'",
    String.raw`page.getByRole('dialog', { name: /^已选择\s*3\s*项$/ })`,
    String.raw`review.getByRole('heading', { name: /^已选择\s*3\s*项$/ })`,
    'Gallery 900px: Review exposes accessible selected-count heading',
    "review.locator('[data-xdrive-gallery-selected-item]')",
    'row.nodeID === 1000 + index',
    'row.label.includes(',
    "await review.waitFor({ state: 'hidden' })",
    'Gallery 900px: closing selection review preserves the same three chosen assets',
    'Actual album POST carries complete node IDs and the quoted revision',
    'Retry sends one new actual request for the retained album and unchanged selection',
  ]) {
    assert.ok(acceptance.includes(gate), `Gallery sparse selection acceptance lost gate: ${gate}`)
  }
})
