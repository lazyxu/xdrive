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

const appSource = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
const launcherSource = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
assert.match(appSource, /favoriteKeys=\{currentMobileNavigation\.favorites\}/)
assert.match(appSource, /onToggleFavorite=\{toggleMobileFavorite\}/)
assert.match(appSource, /!mobileOwnerScope \|\| !mobileDestinations\.some/)
assert.match(launcherSource, /onClick=\{\(\) => onToggleFavorite\(item\.key\)\}/)
assert.doesNotMatch(launcherSource, /setFavorites\(/, 'Launcher must not own remount-volatile favorites')
console.log('mobile five-slot state: routes, Owner, Viewer, back, role and Launcher favorites passed')
