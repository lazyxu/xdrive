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
