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
  assert.match(web, /createWebMediaGalleryDataSource\(api\)/)
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
  assert.match(page, /showOverviewActions=\{Boolean\(galleryUploadAction\)\}/)
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

