import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/mobileFiveSlotState.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'route-state TypeScript must transpile')
const nav = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const owner = 'https://example.test:1'
const all = { app: 'overview', params: {} }
const mine = { app: 'overview', params: { section: 'mine' } }
const library = { app: 'gallery', params: { section: 'library' } }
const map = { app: 'gallery', params: { section: 'places' } }
const files = { app: 'files', params: { dir: 6 } }
const preview = { app: 'media-viewer', params: { node: 9 } }
const transfers = { app: 'tasks', params: { scope: 'mine', task: 'a' } }
const admin = { app: 'admin-users', params: { user: 10 } }
assert.deepEqual(nav.XDRIVE_MOBILE_SLOTS, ['all', 'dynamic', 'gallery', 'files', 'mine'])
assert.equal(nav.xDriveMobileSlotForRoute(mine), 'mine')
assert.equal(nav.xDriveMobileSlotForRoute(preview), null)
assert.equal(nav.xDriveMobileSlotForRoute(map), 'gallery')
let state = nav.xDriveInitialMobileNavigation(owner)
for (const item of [all, files, library, transfers, map, preview]) {
  state = nav.xDriveRememberMobileNavigation(state, item, owner, false)
}
assert.deepEqual(nav.xDriveMobileRouteForSlot(state, 'files', false), files)
assert.deepEqual(nav.xDriveMobileRouteForSlot(state, 'gallery', false), map)
assert.deepEqual(nav.xDriveMobileRouteForSlot(state, 'dynamic', false), transfers)
assert.deepEqual(nav.xDriveMobileRouteForSlot(state, 'mine', false), mine)
assert.equal(state.dynamic.length, 1, 'Gallery/map/Viewer must never replace dynamic')
assert.deepEqual(nav.xDriveMobileFeatureParentRoute(map), library)
// The mobile header delegates Back to an actual committed Album, never
// to a stale handler from an earlier Owner or an Albums/Places index.
assert.equal(nav.xDriveMobileAlbumOwnsBack({ app: 'gallery', params: { section: 'albums' } }, owner, owner), true)
assert.equal(nav.xDriveMobileAlbumOwnsBack({ app: 'gallery', params: { section: 'albums' } }, owner, ''), false)
assert.equal(nav.xDriveMobileAlbumOwnsBack({ app: 'gallery', params: { section: 'albums' } }, '', owner), false)
assert.equal(nav.xDriveMobileAlbumOwnsBack(library, owner, owner), false)
assert.equal(nav.xDriveMobileAlbumOwnsBack(map, owner, owner), false)
assert.equal(nav.xDriveMobileAlbumOwnsBack(files, owner, owner), false)
assert.equal(nav.xDriveMobileAlbumOwnsBack({ app: 'gallery', params: { section: 'albums' } }, 'https://example.test:2', owner), false)
// Only an actual map panel hides the five-slot bar; Places list restores L1.
assert.equal(nav.xDriveMobileMapFocused(map, true), true)
assert.equal(nav.xDriveMobileMapFocused(map, false), false, 'Places list must keep bottom tabs')
assert.equal(nav.xDriveMobileMapFocused(library, true), false, 'Gallery library is L1')
assert.equal(nav.xDriveMobileMapFocused(preview, true), false, 'Viewer is separately immersive')
assert.equal(nav.xDriveMobileMapFocused(files, true), false, 'stale Gallery focus never hides Files')
// A voluntary L2 for the cloud photo wall or Files has a real L1 restore path.
// Never treat Places, Album, Viewer, an unverified Owner or wide Web as L2.
const galleryManualFocus = { ownerScope: owner, target: 'gallery-library' }
const filesManualFocus = { ownerScope: owner, target: 'files' }
assert.equal(nav.xDriveMobileManualFocusTarget(library), 'gallery-library')
assert.equal(nav.xDriveMobileManualFocusTarget({ app: 'gallery', params: {} }), 'gallery-library')
assert.equal(nav.xDriveMobileManualFocusTarget(files), 'files')
assert.equal(nav.xDriveMobileManualFocusTarget(map), null)
assert.equal(nav.xDriveMobileManualFocusTarget({ app: 'gallery', params: { section: 'albums' } }), null)
assert.equal(nav.xDriveMobileManualFocusTarget(preview), null)
assert.equal(nav.xDriveMobileManualFocusActive(library, owner, galleryManualFocus), true)
assert.equal(nav.xDriveMobileManualFocusActive(files, owner, filesManualFocus), true)
assert.equal(nav.xDriveMobileManualFocusActive(map, owner, galleryManualFocus), false)
assert.equal(nav.xDriveMobileManualFocusActive(files, owner, galleryManualFocus), false)
assert.equal(nav.xDriveMobileManualFocusActive(preview, owner, filesManualFocus), false)
assert.equal(nav.xDriveMobileManualFocusActive(files, '', filesManualFocus), false)
assert.equal(nav.xDriveMobileManualFocusActive(files, owner, null), false)
assert.equal(nav.xDriveMobileManualFocusActive(files, 'https://example.test:2', filesManualFocus), false)

assert.deepEqual(nav.xDriveMobileFeatureParentRoute(transfers), { app: 'tasks', params: { scope: 'mine' } })
assert.equal(nav.xDriveMobileFeatureParentRoute(library), null)
state = nav.xDriveRememberMobileNavigation(state, admin, owner, true)
assert.equal(state.dynamic[0].app, 'admin-users')
state = nav.xDriveRememberMobileNavigation(state, all, owner, false)
assert.equal(state.dynamic.some(item => item.app === 'admin-users'), false, 'revoked admin must be excluded')
assert.equal(nav.xDriveMobileRouteAllowed({ app: 'tasks', params: { scope: 'global' } }, false), false)
state = nav.xDriveRememberMobileNavigation(state, all, 'https://example.test:2', false)
assert.equal(state.dynamic.length, 0, 'Owner switch must reset recent feature state')
assert.deepEqual(nav.xDriveMobileRouteForSlot(state, 'files', false), { app: 'files', params: {} })
assert.equal(nav.xDriveMobileRouteForSlot(state, 'dynamic', false), null)
state = nav.xDriveRememberMobileNavigation(state, transfers, '', false)
assert.equal(state.dynamic.length, 0, 'Unverified Owner must not capture routes')
// Gallery→Files→Gallery returns to the verified Album, never a prior Owner.
const albumsRoute = { app: 'gallery', params: { section: 'albums' } }
let albumState = nav.xDriveInitialMobileNavigation(owner)
albumState = nav.xDriveRememberMobileNavigation(albumState, albumsRoute, owner, false)
albumState = nav.xDriveRememberMobileGalleryAlbum(albumState, owner, 'album-42')
assert.equal(albumState.galleryAlbumID, 'album-42')
albumState = nav.xDriveRememberMobileNavigation(albumState, files, owner, false)
albumState = nav.xDriveRememberMobileNavigation(albumState, albumsRoute, owner, false)
assert.equal(albumState.galleryAlbumID, 'album-42', 'tab reentry retains committed Album ID')
assert.equal(nav.xDriveRememberMobileGalleryAlbum(albumState, owner, 'album-42'), albumState)
assert.equal(nav.xDriveRememberMobileGalleryAlbum(albumState, 'https://example.test:2', 'stale'), albumState)
assert.equal(nav.xDriveRememberMobileGalleryAlbum(albumState, '', 'stale'), albumState)
assert.equal(nav.xDriveRememberMobileGalleryAlbum(albumState, owner, 'x'.repeat(300)), albumState)
albumState = nav.xDriveRememberMobileGalleryAlbum(albumState, owner, null)
assert.equal(albumState.galleryAlbumID, null, 'confirmed Album Back clears return')
albumState = nav.xDriveRememberMobileGalleryAlbum(albumState, owner, 'album-42')
albumState = nav.xDriveRememberMobileNavigation(albumState, library, owner, false)
assert.equal(albumState.galleryAlbumID, null, 'different Gallery section clears Album')
albumState = nav.xDriveRememberMobileNavigation(albumState, albumsRoute, owner, false)
albumState = nav.xDriveRememberMobileGalleryAlbum(albumState, owner, 'album-42')
albumState = nav.xDriveRememberMobileNavigation(albumState, files, 'https://example.test:2', false)
assert.equal(albumState.galleryAlbumID, null, 'new Owner never inherits previous Album')
albumState = nav.xDriveRememberMobileNavigation(albumState, albumsRoute, owner, false)
assert.equal(albumState.galleryAlbumID, null, 'A→B→A must not resurrect Album')


const galleryLastRoute = { ownerScope: owner, section: 'albums' }
const galleryViewer = { app: 'media-viewer', params: { node: 42 } }
assert.equal(nav.xDriveMobileGallerySectionForViewer(albumsRoute, 'gallery', owner, null),
  'albums', 'direct Gallery route remains the sole source for its own section')
assert.equal(nav.xDriveMobileGallerySectionForViewer(galleryViewer, 'gallery', owner, galleryLastRoute),
  'albums', 'Viewer over a retained Album must not reset it to Library')
assert.equal(nav.xDriveMobileGallerySectionForViewer({ app: 'pdf-viewer', params: { node: 42 } },
  'gallery', owner, { ownerScope: owner, section: 'places' }), 'places',
  'all routed Viewer overlays must leave the current Gallery section unchanged')
assert.equal(nav.xDriveMobileGallerySectionForViewer(galleryViewer, 'files', owner, galleryLastRoute),
  undefined, 'a Files Viewer cannot revive an old Gallery section')
assert.equal(nav.xDriveMobileGallerySectionForViewer(galleryViewer, 'gallery', '', galleryLastRoute),
  undefined, 'unverified Owner cannot recover a Gallery section')
assert.equal(nav.xDriveMobileGallerySectionForViewer(
  galleryViewer, 'gallery', 'https://example.test:2', galleryLastRoute,
), undefined, 'old-Owner Gallery detail must not appear after a session switch')
assert.equal(nav.xDriveMobileGallerySectionForViewer(files, 'gallery', owner, galleryLastRoute),
  undefined, 'other ordinary workspace routes do not inherit Gallery history')
assert.equal(nav.xDriveMobileGallerySectionForViewer(
  { app: 'gallery', params: { section: 'library' } }, 'gallery', owner, galleryLastRoute,
), 'library', 'explicit Gallery Library navigation supersedes retained detail')
assert.equal(nav.xDriveMobileGallerySectionForViewer(
  { app: 'gallery', params: {} }, 'gallery', owner, galleryLastRoute,
), undefined, 'bare Gallery root retains its canonical default Library')

// Favorites live above the Launcher component so tab switching cannot reset them.
let favoriteState = nav.xDriveInitialMobileNavigation(owner)
assert.deepEqual(favoriteState.favorites, ['gallery', 'files'])
favoriteState = nav.xDriveToggleMobileFavorite(favoriteState, owner, 'gallery', false)
assert.deepEqual(favoriteState.favorites, ['files'])
favoriteState = nav.xDriveRememberMobileNavigation(favoriteState, files, owner, false)
favoriteState = nav.xDriveRememberMobileNavigation(favoriteState, library, owner, false)
assert.deepEqual(favoriteState.favorites, ['files'], 'remounting Launcher after Files/Gallery must retain favorites')
favoriteState = nav.xDriveToggleMobileFavorite(favoriteState, owner, 'device-backup', false)
assert.deepEqual(favoriteState.favorites, ['files', 'device-backup'])
favoriteState = nav.xDriveToggleMobileFavorite(favoriteState, owner, 'admin-users', false)
assert.equal(favoriteState.favorites.includes('admin-users'), false)
favoriteState = nav.xDriveToggleMobileFavorite(favoriteState, owner, 'admin-users', true)
assert.equal(favoriteState.favorites.includes('admin-users'), true)
favoriteState = nav.xDriveRememberMobileNavigation(favoriteState, all, owner, false)
assert.equal(favoriteState.favorites.includes('admin-users'), false, 'revoked admin routes cannot remain favorite')
const anonymous = nav.xDriveToggleMobileFavorite(favoriteState, '', 'files', false)
assert.equal(anonymous.ownerScope, '')
assert.deepEqual(anonymous.favorites, ['gallery', 'files'], 'unverified Owner cannot edit a verified session')
favoriteState = nav.xDriveRememberMobileNavigation(favoriteState, all, 'https://example.test:2', false)
assert.deepEqual(favoriteState.favorites, ['gallery', 'files'], 'Owner B sees only default favorites')
favoriteState = nav.xDriveRememberMobileNavigation(favoriteState, all, owner, false)
assert.deepEqual(favoriteState.favorites, ['gallery', 'files'], 'A→B→A cannot resurrect Owner A history')

// The Launcher unmounts when another fixed tab is active. Search and favorites
// must be retained in the verified Owner's volatile navigation state only.
let searchState = nav.xDriveInitialMobileNavigation(owner)
searchState = nav.xDriveSetMobileLauncherSearch(searchState, owner, '图库')
assert.equal(searchState.launcherSearch, '图库')
searchState = nav.xDriveRememberMobileNavigation(searchState, files, owner, false)
searchState = nav.xDriveRememberMobileNavigation(searchState, library, owner, false)
assert.equal(searchState.launcherSearch, '图库', 'Files/Gallery tab switches must retain Launcher query')
assert.equal(nav.xDriveSetMobileLauncherSearch(searchState, owner, '图库'), searchState,
  'same text must not mutate navigation state')
searchState = nav.xDriveSetMobileLauncherSearch(searchState, owner, 'x'.repeat(300))
assert.equal(searchState.launcherSearch.length, 120, 'untrusted queries are bounded')
const anonymousSearch = nav.xDriveSetMobileLauncherSearch(searchState, '', 'secret')
assert.equal(anonymousSearch, searchState, 'unverified Owner cannot capture search')
searchState = nav.xDriveRememberMobileNavigation(searchState, all, 'https://example.test:2', false)
assert.equal(searchState.launcherSearch, '', 'new Owner cannot inherit another Owner query')
const staleSearch = nav.xDriveSetMobileLauncherSearch(searchState, owner, 'stale')
assert.equal(staleSearch, searchState, 'late callback from previous Owner must be ignored')
searchState = nav.xDriveRememberMobileNavigation(searchState, all, owner, false)
assert.equal(searchState.launcherSearch, '', 'A→B→A must not recover old search')

// All and Mine share one host, but their viewport and Owner-scoped scroll
// positions must remain independent. Virtualized Files/Gallery are excluded.
assert.equal(nav.xDriveMobileOverviewScrollSlot(all), 'all')
assert.equal(nav.xDriveMobileOverviewScrollSlot(mine), 'mine')
assert.equal(nav.xDriveMobileOverviewScrollSlot(files), null)
assert.equal(nav.xDriveMobileOverviewScrollSlot(library), null)
assert.equal(nav.xDriveMobileOverviewScrollSlot(preview), null)
let overviewScroll = nav.xDriveInitialMobileOverviewScroll(owner, 390)
overviewScroll = nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'all', 241.6)
overviewScroll = nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'mine', 63)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, owner, 390, 'all'), 242)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, owner, 390, 'mine'), 63)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, owner, 375, 'all'), 0)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, '', 390, 'all'), 0)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, 'https://example.test:2', 390, 'mine'), 0)
assert.equal(nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'all', NaN),
  overviewScroll, 'nonfinite scroll never changes memory')
overviewScroll = nav.xDriveRememberMobileOverviewScroll(overviewScroll,
  'https://example.test:2', 390, 'mine', 18)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, owner, 390, 'all'), 0,
  'Owner B must revoke A scroll history')
overviewScroll = nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'all', 0)
assert.equal(nav.xDriveMobileOverviewScrollOffset(overviewScroll, owner, 390, 'mine'), 0,
  'A→B→A must not recover Mine position')
assert.equal(nav.xDriveMobileOverviewScrollOffset(
  nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'all', -1),
  owner, 390, 'all',
), 0, 'negative scroll is never retained')
assert.equal(nav.xDriveMobileOverviewScrollOffset(
  nav.xDriveRememberMobileOverviewScroll(overviewScroll, owner, 390, 'all', 99_999_999),
  owner, 390, 'all',
), 10_000_000, 'offset is bounded')

// Restoring Gallery after Files is distinct from restoring All/Mine pixel
// offsets: only a same-live-source confirmed Library query can be hinted.
const galleryQueryReturnSource = readFileSync(resolve(
  here, '../../ui/shared/src/mui/MobileGalleryLibraryQueryReturn.ts',
), 'utf8')
const galleryQueryCompiled = ts.transpileModule(galleryQueryReturnSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(galleryQueryCompiled.diagnostics?.length ?? 0, 0)
const galleryQueryReturn = await import('data:text/javascript;base64,' +
  Buffer.from(galleryQueryCompiled.outputText).toString('base64'))
const gallerySourceA = {}
const gallerySourceB = {}
assert.equal(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceA, owner), null)
galleryQueryReturn.xDriveRememberMobileLibraryQuery(gallerySourceA, owner, {
  search: 'sunset', cameras: ['camera A'], favorite: true, has_location: false,
  anchor_node_id: 42, initial_position: 'latest',
  folder_id: 7, include_descendants: true, nearby: '1,2,3', bbox: '1,2,3,4',
  place: 'place:1', place_hierarchy: 'world', fold_member_ids: [9, 10],
  sort_dir: 'asc', sort_by: 'added', time_zone: 'UTC',
})
const restoredGalleryQuery = galleryQueryReturn.xDriveReadMobileLibraryQuery(
  gallerySourceA, owner)
assert.deepEqual(restoredGalleryQuery, {
  search: 'sunset', cameras: ['camera A'], favorite: true, has_location: false,
}, 'query hints keep ordinary filters but never map, folder, one-shot or sort authority')
restoredGalleryQuery.cameras.push('mutated')
assert.deepEqual(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceA, owner)?.cameras,
  ['camera A'], 'return reads cannot mutate cached accepted filters')
assert.equal(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceA,
  'https://example.test:2'), null, 'Owner B never inherits A filters')
assert.equal(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceB,
  owner), null, 'same Owner with a fresh API session cannot inherit old filters')
assert.equal(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceA,
  ''), null, 'unverified Owner cannot restore filters')
galleryQueryReturn.xDriveRememberMobileLibraryQuery(gallerySourceA, owner, {})
assert.deepEqual(galleryQueryReturn.xDriveReadMobileLibraryQuery(gallerySourceA, owner),
  {}, 'accepted clear-filters replaces the previous search')

// Cold Gallery's first valid Owner Range must precede applying the old query;
// only the first remount may consume it, not a later manual Library tap.
const galleryPageReturnSource = readFileSync(resolve(
  here, '../../ui/shared/src/mui/MediaGallery.tsx',
), 'utf8')
assert.match(galleryPageReturnSource,
  /firstReturn\?\.owner === preferenceScope && firstReturn\.source === source/,
  'Gallery query return must be fenced by the current Owner and API source')
assert.match(galleryPageReturnSource,
  /const savedQuery = nextSection === 'library'/,
  'only initial Library may replay the cached query')
assert.match(galleryPageReturnSource,
  /xDriveRememberMobileLibraryQuery\(source, preferenceScope, nextQuery\)/,
  'accepted Library range must replace the remembered query')
assert.match(galleryPageReturnSource,
  /section === 'library' && acceptedKind === 'all' &&[\s\S]*?!currentAlbum && !currentFolderView && preferenceScope/,
  'only accepted unscoped Library filter updates may refresh return hints')

// The Collections overview is presentation only, but bottom-tab reentry
// should not return to Library if the same verified Gallery source is alive.
const mobileCollectionsReturnSource = readFileSync(resolve(
  here, '../../ui/shared/src/mui/MobileGalleryCollectionsReturn.ts',
), 'utf8')
const mobileCollectionsCompiled = ts.transpileModule(mobileCollectionsReturnSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(mobileCollectionsCompiled.diagnostics?.length ?? 0, 0)
const mobileCollectionsReturn = await import('data:text/javascript;base64,' +
  Buffer.from(mobileCollectionsCompiled.outputText).toString('base64'))
const collectionSourceA = {}
const collectionSourceB = {}
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library'), false, 'cold Gallery opens Library')
mobileCollectionsReturn.xDriveRememberMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library', true)
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library'), true, 'same source and Owner resume Collections')
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, undefined), true, 'bare Gallery root is Library')
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'albums'), false, 'Album route never reopens Collections')
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, 'https://example.test:2', 'library'), false, 'Owner B never sees A presentation')
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceB, owner, 'library'), false, 'new API/source never inherits stale state')
mobileCollectionsReturn.xDriveRememberMobileGalleryCollectionsReturn(
  collectionSourceA, 'https://example.test:2', 'library', false)
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library'), false, 'A→B→A cannot revive old Collections')
mobileCollectionsReturn.xDriveRememberMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library', true)
mobileCollectionsReturn.xDriveRememberMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'albums', true)
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library'), false, 'entering Album clears pending Collections return')
mobileCollectionsReturn.xDriveRememberMobileGalleryCollectionsReturn(
  collectionSourceA, '', 'library', true)
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, '', 'library'), false, 'unverified session cannot restore Collections')
assert.equal(mobileCollectionsReturn.xDriveReadMobileGalleryCollectionsReturn(
  collectionSourceA, owner, 'library'), false, 'unverified writes are ignored')

// Execute the real shared Gallery callback, not a rewritten test-only replica.
// It must show the old Collections after the first accepted Owner Range and
// must exit Collections after a later explicit Library selection.
assert.match(galleryPageReturnSource,
  /const initialMobileCollectionsReturn = mobileGalleryViewport &&/,
  'Only compact Gallery can restore its Collections presentation')
assert.match(galleryPageReturnSource,
  /if \(mobileCollectionsReturnScopeRef\.current\.source !== source \|\|[\s\S]*?mobileCollectionsReturnScopeRef\.current\.owner !== preferenceScope\)/,
  'Owner/source replacement must retire the previously visible Collections')
assert.match(galleryPageReturnSource,
  /mobileCollectionsOverview=\{mobileCollectionsOverview &&[\s\S]*?mobileCollectionsReturnScopeRef\.current\.owner === preferenceScope\}/,
  'Old Owner Collections cannot flash during a source transition')
{
  const ast = ts.createSourceFile(
    'MediaGallery.tsx', galleryPageReturnSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const found = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) &&
        node.name.getText(ast) === 'openCompactPhotoSection') found.push(node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1, 'one shared Gallery compact photo-tab loader')
  const js = ts.transpileModule(
    'function make() { const ' + found[0] + '; return openCompactPhotoSection; }',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const loaded = []
  const overviewCommits = []
  const warmed = []
  const firstMobileCollectionsReturnRef = { current: true }
  const mobileCollectionsReturnScopeRef = { current: { source: collectionSourceA, owner } }
  const firstMobileLibraryQueryRef = { current: null }
  const env = {
    useCallback: callback => callback,
    source: collectionSourceA,
    preferenceScope: owner,
    firstMobileCollectionsReturnRef, mobileCollectionsReturnScopeRef,
    firstMobileLibraryQueryRef,
    mediaGallerySectionDraft: () => ({}),
    mediaGalleryDraftFromQuery: () => ({}),
    mediaGalleryQueryFromDraft: () => ({}),
    loadFirstPage: (...args) => loaded.push(args),
    xDriveRememberMobileLibraryQuery: () => {},
    placesReturnPageRef: { current: null },
    placeOpenedFromCollectionsRef: { current: false },
    setLastOpenedPlaceID: () => {},
    placePageRequestID: { current: 0 },
    setPlacesPagePending: () => {},
    setPlacesPageError: () => {},
    syncFolderRequestID: { current: 0 },
    setCurrentFolderView: () => {},
    setCurrentPet: () => {},
    setCurrentMemory: () => {},
    setCurrentCleanupReview: () => {},
    placesExpandedRef: { current: false },
    setSection: () => {},
    setActiveMediaType: () => {},
    setDraftFilters: () => {},
    setQuery: () => {},
    setMobileCollectionsOverview: visible => overviewCommits.push(visible),
    warmMobileCollectionsPreview: () => warmed.push(true),
    routeSectionAppliedRef: { current: null },
    onSectionRouteChange: () => {},
  }
  const openCompact = new Function(...Object.keys(env),
    js + '\nreturn make();')(...Object.values(env))
  openCompact('library')
  assert.equal(firstMobileCollectionsReturnRef.current, true,
    'a pending first Range cannot consume the cold Collections retry hint')
  assert.deepEqual(overviewCommits, [],
    'a slow or denied first Range cannot prematurely replace Gallery presentation')
  assert.equal(loaded.length, 1)
  loaded[0][8]()
  assert.equal(firstMobileCollectionsReturnRef.current, false,
    'the winning first Range consumes the one-shot Collections return')
  assert.deepEqual(overviewCommits, [true],
    'confirmed first Range retains the original Collections selection')
  assert.deepEqual(warmed, [true], 'restored Collections must request bounded preview')
  openCompact('library')
  loaded[1][8]()
  assert.deepEqual(overviewCommits, [true, false],
    'a subsequent explicit Library selection must exit Collections')
  assert.deepEqual(warmed, [true],
    'normal Library navigation does not fetch the Collections preview')

  // An unsuccessful first counted Range never calls onCommitted. Reentering
  // Library after failure must still restore Collections, and a subsequent
  // request that supersedes it must be the sole one allowed to commit.
  firstMobileCollectionsReturnRef.current = true
  overviewCommits.length = 0
  warmed.length = 0
  loaded.length = 0
  openCompact('library')
  assert.equal(firstMobileCollectionsReturnRef.current, true,
    'first cold Library request remains retryable until accepted')
  assert.deepEqual(overviewCommits, [])
  // The first request fails or is superseded: no onCommitted callback.
  openCompact('library')
  assert.equal(firstMobileCollectionsReturnRef.current, true,
    'a superseding Library request retains the cold Collections hint')
  assert.deepEqual(overviewCommits, [],
    'a failed/held first read cannot drop the previously visible Collections')
  assert.equal(loaded.length, 2)
  loaded[1][8]()
  assert.equal(firstMobileCollectionsReturnRef.current, false,
    'only the winning retried Range consumes the hint')
  assert.deepEqual(overviewCommits, [true],
    'the accepted retry preserves the requested Collections index')
  assert.deepEqual(warmed, [true],
    'the accepted retry refreshes bounded Collections previews exactly once')
  openCompact('library')
  loaded[2][8]()
  assert.deepEqual(overviewCommits, [true, false],
    'a later explicit Library tap exits Collections normally')

  firstMobileCollectionsReturnRef.current = true
  openCompact('favorites')
  assert.equal(firstMobileCollectionsReturnRef.current, false,
    'explicit Favorites intent must not replay an obsolete Library return')
}

const appSource = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
assert.match(appSource, /const mobileOverviewSlot = compactWorkspace \? xDriveMobileOverviewScrollSlot\(route\) : null/)
assert.match(appSource, /xDriveMobileOverviewScrollOffset\(mobileOverviewScrollRef\.current/)
assert.match(appSource, /main\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/)
assert.match(appSource, /main\.removeEventListener\('scroll', onScroll\)/)


/** Execute the original App's navigation callback, not a copy of its logic. */
function originalMobileSlotSelector(env) {
  const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectMobileSlot') {
      declarations.push(node.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(declarations.length, 1, 'must execute exactly one actual mobile Tab handler')
  const js = ts.transpileModule(
    'function getHandler() { const ' + declarations[0] + '; return selectMobileSlot; }',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  return new Function(...Object.keys(env), js + '\nreturn getHandler();')(...Object.values(env))
}

// Duplicate fixed-Tab taps used to call launchWebApp on the current Hash.
// The real browser runtime turns that call into history.pushState even when
// the destination is unchanged, creating invisible Safari Back-swipe steps.
const testCanonicalHash = route => [route.app, ...Object.entries(route.params)
  .filter(([,value]) => value !== undefined)
  .sort(([left],[right]) => left.localeCompare(right))
  .map(([key,value]) => key + '=' + value)].join('|')
function mobileTabHarness(route, memory, overviewSlot = null) {
  const launched = []
  const recent = []
  const snapshots = []
  const select = originalMobileSlotSelector({
    currentMobileNavigation: memory,
    serverAdminVerified: false,
    route,
    xDriveMobileRouteForSlot: nav.xDriveMobileRouteForSlot,
    xDriveWebAppHash: testCanonicalHash,
    launchWebApp: next => launched.push(next),
    setMobileRecentOpen: open => recent.push(open),
    mobileOverviewSlot: overviewSlot,
    saveVisibleMobileOverviewScroll: () => snapshots.push(true),
  })
  return { select, launched, recent, snapshots }
}
const overviewTabs = mobileTabHarness(all, nav.xDriveInitialMobileNavigation(owner), 'all')
overviewTabs.select('mine')
assert.deepEqual(overviewTabs.snapshots, [true],
  'All scroll is captured before a real tab switch')
assert.deepEqual(overviewTabs.launched, [mine])
overviewTabs.select('all')
assert.deepEqual(overviewTabs.snapshots, [true],
  'tapping the active All destination does not create a new snapshot')

const activeAlbums = { app: 'gallery', params: { section: 'albums' } }
const galleryTabs = {
  ...nav.xDriveInitialMobileNavigation(owner),
  gallery: { app: 'gallery', params: { section: 'albums' } },
  files,
}
const sameGallery = mobileTabHarness(activeAlbums, galleryTabs)
sameGallery.select('gallery')
sameGallery.select('gallery')
assert.deepEqual(sameGallery.launched, [], 'repeat Gallery tab cannot push invisible History')
assert.deepEqual(sameGallery.recent, [])
sameGallery.select('files')
assert.deepEqual(sameGallery.launched, [files], 'real destination switch still launches')
sameGallery.select('dynamic')
assert.deepEqual(sameGallery.recent, [true], 'empty dynamic Tab still opens recent picker')

const otherGallery = mobileTabHarness(activeAlbums, {
  ...galleryTabs, gallery: { app: 'gallery', params: { section: 'places' } },
})
otherGallery.select('gallery')
assert.deepEqual(otherGallery.launched, [{ app: 'gallery', params: { section: 'places' } }],
  'another Gallery section must not be suppressed')
const galleryReordered = mobileTabHarness(
  { app: 'files', params: { select: 21, dir: 5 } },
  { ...galleryTabs, files: { app: 'files', params: { dir: 5, select: 21 } } },
)
galleryReordered.select('files')
assert.equal(galleryReordered.launched.length, 0,
  'same canonical Files route is not a new history destination')
galleryReordered.select('all')
assert.deepEqual(galleryReordered.launched, [all], 'all-tab navigation remains reachable')
const sameHome = mobileTabHarness(all, galleryTabs)
sameHome.select('all')
assert.equal(sameHome.launched.length, 0, 'repeat All tab is idempotent')
sameHome.select('mine')
assert.deepEqual(sameHome.launched, [mine], 'Mine remains a separate fixed tab')


// The original Web Mobile App header Back callback is evaluated directly with
// deferred real-controller results; this is not a reimplemented navigator.
function originalMobileHeaderBack(env) {
  const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = []
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'goBackWithinMobileFeature')
      declarations.push(node.getText(ast))
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(declarations.length, 1, 'one original mobile feature Back callback')
  const js = ts.transpileModule(
    'function getHandler() { const ' + declarations[0] + '; return goBackWithinMobileFeature; }',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  return new Function(...Object.keys(env), js + '\nreturn getHandler();')(...Object.values(env))
}
const filesBackCrumbs = [
  { id: 1, name: '根目录' }, { id: 4, name: '父目录' }, { id: 9, name: '子目录' },
]
const filesChildRoute = { app: 'files', params: { dir: 9 } }
function filesBackHarness(route = filesChildRoute, overrides = {}) {
  const launched = []
  const reads = []
  const pending = []
  const location = { hash: testCanonicalHash(route) }
  const context = { current: { owner, route } }
  const mobileParent = nav.xDriveMobileFeatureParentRoute(route)
  const crumbs = overrides.crumbs ?? filesBackCrumbs
  const mobileFolderParent = route.app === 'files' && crumbs.length > 1
    ? crumbs[crumbs.length - 2] : null
  const back = originalMobileHeaderBack({
    mobileAlbumBackRef: { current: overrides.albumBack ?? null },
    xDriveMobileAlbumOwnsBack: nav.xDriveMobileAlbumOwnsBack,
    route, mobileOwnerScope: owner, mobileParent, mobileFolderParent,
    crumbs, mobileBackContextRef: context,
    xDriveWebAppHash: testCanonicalHash, window: { location },
    loadDirectory: (id, nextCrumbs) => {
      reads.push({ id, crumbs: nextCrumbs })
      return new Promise(resolve => pending.push(resolve))
    },
    launchWebApp: (next, options) => launched.push({ next, options }),
  })
  return { back, launched, reads, pending, location, context }
}
const flushBack = async (h, committed) => {
  assert.equal(h.pending.length, 1)
  h.pending[0](committed)
  await Promise.resolve()
}
{
  const h = filesBackHarness()
  h.back()
  assert.deepEqual(h.reads, [{ id: 4, crumbs: filesBackCrumbs.slice(0, -1) }])
  assert.deepEqual(h.launched, [], 'pending authenticated Files parent Range cannot rewrite URL')
  await flushBack(h, true)
  assert.deepEqual(h.launched, [{ next: { app: 'files', params: { dir: 4 } },
    options: { replace: true } }], 'only committed parent Range permits header Back')
}
{
  const h = filesBackHarness()
  h.back()
  await flushBack(h, false)
  assert.deepEqual(h.launched, [], 'failed or superseded first Range preserves old route')
}
{
  const h = filesBackHarness()
  h.back()
  h.location.hash = 'gallery|section=library'
  await flushBack(h, true)
  assert.deepEqual(h.launched, [], 'switching to Gallery while Files Back is pending wins')
}
{
  const h = filesBackHarness()
  h.back()
  h.context.current.owner = 'https://example.test:other'
  await flushBack(h, true)
  assert.deepEqual(h.launched, [], 'late old-Owner receipt cannot navigate new Owner')
}
{
  const h = filesBackHarness()
  h.back()
  h.context.current.route = { app: 'files', params: { dir: 9 } }
  await flushBack(h, true)
  assert.deepEqual(h.launched, [], 'same Hash after a later A→B→A intent is still stale')
}
{
  const route = { app: 'files', params: { dir: 9, select: 42 } }
  const h = filesBackHarness(route)
  h.back()
  assert.equal(h.reads.length, 0, 'selection Back clears selected file before parent folder')
  assert.deepEqual(h.launched, [{
    next: { app: 'files', params: { dir: 9 } }, options: { replace: true },
  }])
}
{
  let called = 0
  const route = { app: 'gallery', params: { section: 'albums' } }
  const h = filesBackHarness(route, { albumBack: { owner, back: () => { called += 1 } } })
  h.back()
  assert.equal(called, 1, 'Album owns Back through the existing shared Gallery')
  assert.deepEqual(h.launched, [])
  assert.deepEqual(h.reads, [])
}
{
  const route = { app: 'gallery', params: { section: 'albums' } }
  const h = filesBackHarness(route)
  h.back()
  assert.deepEqual(h.launched, [{ next: library, options: { replace: true } }],
    'Albums index keeps the ordinary Gallery-internal parent')
}
const controllerSource = readFileSync(resolve(here,
  '../../ui/shared/src/mui/CloudFilesController.ts'), 'utf8')
const controllerStart = controllerSource.indexOf('  const loadDirectory = useCallback')
const controllerEnd = controllerSource.indexOf('\n\n  const refreshChangedDirectory', controllerStart)
assert.ok(controllerStart > 0 && controllerEnd > controllerStart)
const committedDirectory = controllerSource.slice(controllerStart, controllerEnd)
assert.ok(committedDirectory.indexOf('xDriveAdmitCloudFilesCountedFirstPage(read.page)') >
  committedDirectory.indexOf('requestID !== directoryRequestRef.current'))
assert.ok(committedDirectory.indexOf('return true') >
  committedDirectory.indexOf('setCrumbs(copiedCrumbs)'),
  'Files Back promise resolves true only after Server first Range/crumbs commit')
assert.match(appSource, /mobileBackContextRef\.current\.owner !== mobileOwnerScope/)
assert.match(appSource, /mobileBackContextRef\.current\.route !== route/)
assert.match(appSource, /window\.location\.hash !== fromHash/)

const launcherSource = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
const gallerySource = readFileSync(resolve(here, '../../ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
assert.match(appSource, /xDriveMobileAlbumOwnsBack\(route, mobileOwnerScope, albumBack\?\.owner \?\? null\)/)
assert.match(appSource, /albumBack\?\.back\(\)/)
assert.match(appSource, /onMobileAlbumDetailBackChange=\{compactWorkspace \? registerMobileAlbumBack/)
assert.match(gallerySource, /onMobileAlbumDetailBackChange\?\.\(leaveCollection\)/)
assert.match(gallerySource, /onMobileAlbumDetailBackChange\?\.\(null\)/)
assert.match(gallerySource, /mobileGalleryViewport \|\| section !== 'albums' \|\|\s*\(!currentAlbum && !currentFolderView\)/)
assert.match(appSource, /xDriveMobileGallerySectionForViewer\(\s*route, appView, mobileOwnerScope, retainedGallerySectionRef\.current/)
assert.match(appSource, /else if \(route\.app === 'gallery'\) \{\s*retainedGallerySectionRef\.current = \{/)
assert.match(appSource, /if \(!mobileOwnerScope\) retainedGallerySectionRef\.current = null/)
assert.match(appSource, /initialMobileAlbumID=\{compactWorkspace/)
assert.match(appSource, /onMobileAlbumSelectionChange=\{compactWorkspace \? rememberMobileGalleryAlbum/)
assert.match(gallerySource, /acceptedFacetOwner !== preferenceScope/, 'Owner list must be verified')
assert.match(gallerySource, /const verifiedAlbum = albums\.find\(album => album\.id === initialMobileAlbumID\)/)
assert.match(gallerySource, /openAlbum\(verifiedAlbum\)/)
assert.match(gallerySource, /onMobileAlbumSelectionChange\?\.\(album\.id\)/)
assert.match(gallerySource, /onMobileAlbumSelectionChange\?\.\(null\)/)
assert.match(appSource, /favoriteKeys=\{currentMobileNavigation\.favorites\}/)
assert.match(appSource, /onToggleFavorite=\{toggleMobileFavorite\}/)
assert.match(appSource, /!mobileOwnerScope \|\| !mobileLauncherDestinations\.some/)
assert.match(appSource, /const galleryShortcut = xDriveMobileLauncherGalleryRoute\(destination\)/)
assert.match(appSource, /const allowedWorkspace = galleryShortcut \? 'gallery' : destination/)
assert.match(appSource, /mobileLauncherDestinations\.some\(item => item\.key === destination\)/)
assert.match(launcherSource, /onClick=\{\(\) => onToggleFavorite\(item\.key\)\}/)
assert.doesNotMatch(launcherSource, /setFavorites\(/, 'Launcher must not own remount-volatile favorites')
assert.match(appSource, /search=\{currentMobileNavigation\.launcherSearch\}/)
assert.match(appSource, /onSearchChange=\{setMobileLauncherSearch\}/)
assert.match(launcherSource, /onChange=\{event => onSearchChange\(event\.target\.value\)\}/)
assert.match(gallerySource, /const mobileMapFocusActive = compactGallery && showPlacesIndex && placesPanels\.map/,
  'Gallery reports its actual map/list presentation rather than route-only Places')
assert.match(gallerySource, /onMobileMapFocusChange=\{onMobileMapFocusChange\}/,
  'the page passes its callback to the inner Gallery that actually owns Map/List mode')
assert.match(gallerySource, /export function XDriveMediaGallery\(\{\s*mobileWebChrome = false,\s*onMobileMapFocusChange,/,
  'the inner Gallery must receive the callback used by its layout effect')
assert.match(gallerySource, /onMobileMapFocusChange\?\.\(mobileMapFocusActive\)/,
  'Gallery must report active focus to the shell')
assert.match(gallerySource, /onMobileMapFocusChange\?\.\(false\)/,
  'Gallery must release focus on unmount or transition')
assert.match(gallerySource, /mapImmersive=\{mobileMapFocusActive\}/,
  "Gallery's own immersive chrome and the shell share one map truth")
assert.match(appSource, /onMobileMapFocusChange=\{onMobileMapFocusChange\}/)
assert.match(appSource, /mobileMapVisibility\.owner === mobileOwnerScope/,
  'old Owner map visibility cannot hide new Owner tabs')
assert.match(appSource, /xDriveMobileMapFocused\(route,/,
  'bottom nav must use actual map focus instead of route-only section')
assert.doesNotMatch(launcherSource, /const \[search, setSearch\] = useState/,
  'Launcher must not own a query that is lost on tab unmount')

// Run the actual App navigation-overlay effect and inspect its real React
// dependency array. Safari browser Back/Forward may change a tab without a
// click on the drawer; L2 map focus temporarily unmounts the five-slot bar.
// Both transitions (and Owner changes) must retire the open modal before the
// bar is mounted again. This is not a duplicated route-state implementation.
{
  const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const matches = []
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
        node.getText(ast).includes('setMobileRecentOpen(false)') &&
        node.getText(ast).includes('setTransferPopoverOpen(false)')) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, 'only one App navigation-overlay lifecycle effect')
  const [callback, dependencies] = matches[0].arguments
  assert.ok(ts.isArrayLiteralExpression(dependencies), 'effect must declare explicit dependencies')
  const keys = dependencies.elements.map(item => item.getText(ast))
  for (const key of ['compactWorkspace', 'viewerActive', 'route', 'mobileOwnerScope',
    'mobileMapVisibility.owner', 'mobileMapVisibility.visible']) {
    assert.ok(keys.includes(key), key + ' must dismiss stale navigation drawers')
  }
  const closed = []
  const originalEffect = new Function('setMobileRecentOpen', 'setTransferPopoverOpen',
    'return (' + callback.getText(ast) + ')')(
    value => closed.push(['recent', value]), value => closed.push(['transfer', value]))
  originalEffect()
  assert.deepEqual(closed, [['recent', false], ['transfer', false]],
    'route/Owner/map transitions close both live navigation overlays')
}
// Standalone/reloaded Gallery media Viewers have no trusted browser-return
// entry. Only a safe Gallery Library root is permitted, never an Album or
// private map Cell reconstructed from sessionStorage. File Viewers remain in Files.
{
  const media = { app: 'media-viewer', params: { node: 13, context: 'normal' } }
  const privateMap = { app: 'media-viewer', params: { node: 13, context: 'map-expired' } }
  const galleryRoot = { app: 'gallery', params: { section: 'library' } }
  const fileParent = { app: 'files', params: { dir: 8 } }
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(media, 'gallery', false, 8), galleryRoot)
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(privateMap, null, true, 8), galleryRoot,
    'expired/one-use private map marker may only navigate to Gallery safe root')
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(media, 'directory', false, 8), fileParent)
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(media, 'search', false, 8), fileParent)
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(media, null, false, 8), fileParent)
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(
    { app: 'pdf-viewer', params: { node: 13 } }, 'gallery', true, 8), fileParent,
    'non-media Viewer must not accept an untrusted Gallery/Map hint')
  assert.deepEqual(nav.xDriveMobileViewerSafeFallbackRoute(media, 'gallery', false, undefined),
    galleryRoot, 'missing media metadata never opens an unverified File directory')
}

// Run the App's actual onClose prop callback (not a separately recreated
// route selector). Runtime closeViewer() still owns normal History Back;
// this listener supplies only its missing-History fallback.
{
  const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const matches = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onClose' &&
      node.getText(ast).includes('xDriveMobileViewerSafeFallbackRoute')) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, 'one real routed Viewer Close callback')
  assert.ok(ts.isJsxExpression(matches[0].initializer))
  const callback = matches[0].initializer.expression
  assert.ok(callback && ts.isArrowFunction(callback))
  const code = ts.transpileModule('const listener = ' + callback.getText(ast) + ';', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const runClose = (compactWorkspace, route, context) => {
    const closed = []
    const env = {
      compactWorkspace, route,
      xDriveReadWebAppBrowseSession: () => context,
      xDriveIsPrivateMapBrowseSessionID: id => Boolean(id?.startsWith('map-')),
      xDriveMobileViewerSafeFallbackRoute: nav.xDriveMobileViewerSafeFallbackRoute,
      closeViewer: target => closed.push(target),
    }
    new Function(...Object.keys(env), code + '\nreturn listener;')
      (...Object.values(env))({ parent_id: 8 })
    assert.equal(closed.length, 1, 'one Viewer Close per user action')
    return closed[0]
  }
  const route = { app: 'media-viewer', params: { node: 13, context: 'ordinary-1' } }
  assert.deepEqual(runClose(true, route, { kind: 'gallery' }),
    { app: 'gallery', params: { section: 'library' } })
  assert.deepEqual(runClose(true, { ...route, params: { ...route.params, context: 'map-expired' } }, null),
    { app: 'gallery', params: { section: 'library' } })
  assert.deepEqual(runClose(true, route, { kind: 'directory' }),
    { app: 'files', params: { dir: 8 } })
  assert.deepEqual(runClose(false, route, { kind: 'gallery' }),
    { app: 'files', params: { dir: 8 } }, 'wide Web behavior unchanged')
  assert.deepEqual(runClose(true, { app: 'pdf-viewer', params: { node: 13 } }, { kind: 'gallery' }),
    { app: 'files', params: { dir: 8 } })
}

// The original Browser runtime must continue to privilege a real Viewer
// history receipt before ever using the caller's safe fallback.
const browserRuntime = readFileSync(resolve(here, '../src/webAppRuntime.ts'), 'utf8')
assert.match(browserRuntime, /if \(state\?\.viewerReturn\) \{\s*window\.history\.back\(\)/)
// A real Gallery Places map is L2: neither the five-slot bar nor its 52px
// L1 app header should consume the canvas. The Places *list* remains L1,
// and only the current Owner's actual map focus can suppress both chrome tiers.
{
  const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const headerBranches = []
  function visit(node) {
    if (ts.isConditionalExpression(node) &&
        node.whenTrue.getText(ast).includes('<XDriveMobileAppHeader')) headerBranches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(headerBranches.length, 1, 'one canonical Web Mobile L1 app header')
  const condition = headerBranches[0].condition.getText(ast)
  assert.equal(condition, 'compactWorkspace && !mobileMapFocused && !mobileManualFocused',
    'the map or voluntary Owner-scoped L2 may hide the full L1 app header')
  const showsHeader = new Function('compactWorkspace', 'mobileMapFocused', 'mobileManualFocused',
    'return (' + condition + ')')
  assert.equal(showsHeader(true, true, false), false, 'L2 map hides L1 header')
  assert.equal(showsHeader(true, false, true), false, 'explicit L2 hides L1 header')
  assert.equal(showsHeader(true, false, false), true, 'ordinary Places/Library/Files keep L1')
  assert.equal(showsHeader(false, true, true), false, 'wide Web keeps its own workspace chrome')
  assert.match(appSource,
    /compactWorkspace && !viewerActive && !mobileMapFocused && !mobileManualFocused/,
    'L2 must hide the five-slot bar, not only its top header')
  assert.match(appSource, /data-xdrive-mobile-enter-focus/,
    'Library/Files have a visible explicit entry affordance')
  assert.match(appSource, /data-xdrive-mobile-restore-navigation/,
    'L2 always offers a visible 44px restore-navigation control')
  assert.match(appSource, /useEffect\(\(\) => \{ setMobileManualFocus\(null\) \}, \[mobileOwnerScope\]\)/,
    'Owner A→B→A must revoke voluntary L2')
  assert.match(appSource, /mobileMapVisibility\.owner === mobileOwnerScope/,
    'L2 focus remains fenced by a verified current Owner')
  const mapSource = readFileSync(resolve(here, '../../ui/shared/src/mui/MediaGalleryPlacesMap.tsx'), 'utf8')
  assert.match(mapSource, /\{onCloseMap && !desktopOnly \? \(/,
    'mobile L2 map retains a visible close affordance when L1 header is hidden')
  assert.match(mapSource, /aria-label="关闭地图" onClick=\{onCloseMap\}/)
  assert.match(mapSource, /minWidth:44,minHeight:44/,
    'map close must remain a 44px touch target')
  assert.match(gallerySource, /onCloseMap=\{onBack && onSectionChange/,
    'map Close reuses the actual authenticated Gallery Back contract')
  assert.match(gallerySource, /if \(canReturnToMapEntry\) onBack\(\)\s*else onSectionChange\('library'\)/,
    'return to current Owner collection or safe Gallery library, never another tab')
}
console.log('mobile five-slot state: routes, Owner, Viewer, back, role, favorites and Owner-scoped search passed')
