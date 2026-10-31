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
function mobileTabHarness(route, memory) {
  const launched = []
  const recent = []
  const select = originalMobileSlotSelector({
    currentMobileNavigation: memory,
    serverAdminVerified: false,
    route,
    xDriveMobileRouteForSlot: nav.xDriveMobileRouteForSlot,
    xDriveWebAppHash: testCanonicalHash,
    launchWebApp: next => launched.push(next),
    setMobileRecentOpen: open => recent.push(open),
  })
  return { select, launched, recent }
}
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
