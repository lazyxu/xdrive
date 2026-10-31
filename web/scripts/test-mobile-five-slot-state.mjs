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

const appSource = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
const launcherSource = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
const gallerySource = readFileSync(resolve(here, '../../ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
assert.match(appSource, /xDriveMobileAlbumOwnsBack\(route, mobileOwnerScope, albumBack\?\.owner \?\? null\)/)
assert.match(appSource, /albumBack\?\.back\(\)/)
assert.match(appSource, /onMobileAlbumDetailBackChange=\{compactWorkspace \? registerMobileAlbumBack/)
assert.match(gallerySource, /onMobileAlbumDetailBackChange\?\.\(leaveCollection\)/)
assert.match(gallerySource, /onMobileAlbumDetailBackChange\?\.\(null\)/)
assert.match(gallerySource, /mobileGalleryViewport \|\| section !== 'albums' \|\| !currentAlbum/)
assert.match(appSource, /initialMobileAlbumID=\{compactWorkspace/)
assert.match(appSource, /onMobileAlbumSelectionChange=\{compactWorkspace \? rememberMobileGalleryAlbum/)
assert.match(gallerySource, /acceptedFacetOwner !== preferenceScope/, 'Owner list must be verified')
assert.match(gallerySource, /const verifiedAlbum = albums\.find\(album => album\.id === initialMobileAlbumID\)/)
assert.match(gallerySource, /openAlbum\(verifiedAlbum\)/)
assert.match(gallerySource, /onMobileAlbumSelectionChange\?\.\(album\.id\)/)
assert.match(gallerySource, /onMobileAlbumSelectionChange\?\.\(null\)/)
assert.match(appSource, /favoriteKeys=\{currentMobileNavigation\.favorites\}/)
assert.match(appSource, /onToggleFavorite=\{toggleMobileFavorite\}/)
assert.match(appSource, /!mobileOwnerScope \|\| !mobileDestinations\.some/)
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
console.log('mobile five-slot state: routes, Owner, Viewer, back, role, favorites and Owner-scoped search passed')
