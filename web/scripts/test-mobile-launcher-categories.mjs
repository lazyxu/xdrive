import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/mobileLauncherSections.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'category helper must transpile')
const model = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const keys = [
  'files', 'gallery', 'gallery-albums', 'gallery-places', 'device-backup', 'remote-pull', 'transfers',
  'cloud-storage', 'local-storage', 'custom-feature',
]
const input = keys.map(key => ({ key, label: key }))
const groups = model.xDriveMobileLauncherSections(input)
assert.deepEqual(groups.map(group => group.key), ['photos', 'files', 'backup', 'tasks', 'other'])
assert.deepEqual(groups.map(group => group.label), [
  '图库与相册', '文件与存储', '备份与同步', '任务与传输', '其他功能',
])
assert.deepEqual(groups.flatMap(group => group.items.map(item => item.key)), [
  'gallery', 'gallery-albums', 'gallery-places', 'files', 'cloud-storage', 'local-storage', 'device-backup',
  'remote-pull', 'transfers', 'custom-feature',
])
assert.deepEqual(input.map(item => item.key), keys, 'must not mutate authenticated destinations')
assert.equal(groups.some(group => group.key === 'admin'), false,
  'non-admin destination input may never grow new privileged destinations')
assert.deepEqual(model.xDriveMobileSupplementalDynamicDestinationKeys(false), [],
  'ordinary Server Owners never gain the global task shortcut')
assert.deepEqual(model.xDriveMobileSupplementalDynamicDestinationKeys(true), ['global-tasks'])
assert.deepEqual(model.xDriveMobileLauncherSections([
  { key: 'transfers' }, { key: 'global-tasks' },
]).find(group => group.key === 'tasks')?.items.map(item => item.key),
  ['transfers', 'global-tasks'])
const admin = model.xDriveMobileLauncherSections([
  ...input, { key: 'admin-users', label: '用户管理' },
  { key: 'admin-services', label: '系统依赖' },
])
assert.deepEqual(admin.find(group => group.key === 'admin')?.items.map(item => item.key),
  ['admin-users', 'admin-services'])
assert.deepEqual(model.xDriveMobileLauncherSections([]), [])
const duplicate = model.xDriveMobileLauncherSections([
  { key: 'files', label: 'old' }, { key: 'files', label: 'new' },
])
assert.deepEqual(duplicate.flatMap(group => group.items).map(item => item.label), ['new'])
const app = readFileSync(resolve(here, '../src/App.tsx'), 'utf8')
const launcher = readFileSync(resolve(here, '../src/MobileFiveSlotNavigation.tsx'), 'utf8')
assert.match(app, /xDriveMobileLauncherSections\(mobileLauncherDestinations\)/,
  'categories include Gallery subroutes only from authorized Web navigation')
assert.match(app, /xDriveBrowserMobileGalleryShortcuts\(\s*mobileDestinations\.some\(item => item\.key === 'gallery'\)/,
  'Album and Map shortcuts need a real allowed Gallery destination')
assert.match(app, /!mobileOwnerScope \|\| !mobileLauncherDestinations\.some/,
  'shortcut favorites are still fenced by the verified Owner and visible destinations')
assert.match(launcher, /sections\.map\(section => showGroup\(String\(section\.label/,
  'Launcher must actually render category headings instead of one flat grid')
assert.match(launcher, /showGroup\('收藏', favoritesItems\)/, 'retain Owner favorites above categories')
assert.match(launcher, /onClick=\{\(\) => onToggleFavorite\(item\.key\)\}/,
  'favorite actions remain controlled by the Owner-scoped parent')
assert.match(launcher, /width: 44, height: 44/,
  'favorite touch hit targets must be at least 44 by 44 CSS pixels')
assert.doesNotMatch(launcher, /setFavorites\(/,
  'category switching must not restore remount-local favorite state')

// These are canonical Gallery sections, never new apps or fabricated albums.
assert.deepEqual(model.xDriveMobileLauncherGalleryRoute('gallery-albums'),
  { app: 'gallery', params: { section: 'albums' } })
assert.deepEqual(model.xDriveMobileLauncherGalleryRoute('gallery-places'),
  { app: 'gallery', params: { section: 'places' } })
assert.equal(model.xDriveMobileLauncherGalleryRoute('files'), null)
assert.equal(model.xDriveMobileLauncherGalleryRoute('admin-users'), null)
assert.equal(model.xDriveMobileLauncherGalleryRoute('gallery'), null)
// The default Map is a Gallery subroute, not a dynamic recent entry.
const expectedMapFallback = { app: 'gallery', params: { section: 'places' } }
assert.deepEqual(model.xDriveMobileEmptyRecentMapRoute(false, true), expectedMapFallback)
assert.equal(model.xDriveMobileEmptyRecentMapRoute(true, true), null)
assert.equal(model.xDriveMobileEmptyRecentMapRoute(false, false), null)
assert.match(app, /xDriveMobileEmptyRecentMapRoute\(/)
assert.match(app, /slot === 'dynamic' && mobileEmptyRecentMapRoute/)
assert.match(app, /emptyRecentFallback=\{mobileEmptyRecentMapRoute/)
assert.match(launcher, /onPickRecent\(emptyRecentFallback\.route\)/)
const withoutGallery = model.xDriveMobileLauncherSections(
  input.filter(item => item.key !== 'gallery' &&
    item.key !== 'gallery-albums' && item.key !== 'gallery-places'))
assert.equal(withoutGallery.some(group => group.key === 'photos'), false,
  'a disabled Gallery must not produce a fallback Album or Map shortcut')

assert.match(launcher, /export function xDriveBrowserMobileGalleryShortcuts\(/)
assert.match(launcher, /if \(!galleryAvailable\) return \[\]/)
assert.match(launcher, /key: 'gallery-albums', label: '相册'/)
assert.match(launcher, /key: 'gallery-places', label: '地图'/)

// Exercise the real App Launcher callback, not an independently coded route
// selector. Both shortcuts must open the fixed Gallery; unknown or denied
// destinations cannot bypass the same authorized-workspace check.
{
  const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const candidates = []
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectMobileLauncher' &&
        node.initializer && ts.isArrowFunction(node.initializer)) candidates.push(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(candidates.length, 1, 'one production Launcher selection callback')
  const code = ts.transpileModule(
    'const selectMobileLauncher = ' + candidates[0].getText(ast) + ';', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
  function makeLauncher(allowGallery = true, overviewSlot = null,
    route = { app: 'overview', params: {} }) {
    const launched = []
    const requestedPermissions = []
    const snapshots = []
    const mobileLauncherDestinations = keys.filter(key =>
      key !== 'gallery' && !key.startsWith('gallery-') || allowGallery).map(key => ({ key }))
    const env = {
      xDriveMobileLauncherGalleryRoute: model.xDriveMobileLauncherGalleryRoute,
      xDriveWebAppRouteForWorkspaceKey: key =>
        key === 'files' ? { app: 'files', params: {} } :
        key === 'gallery' ? { app: 'gallery', params: {} } : null,
      mobileLauncherDestinations,
      route,
      // The callback uses the real canonical hash format to avoid adding
      // duplicate browser history entries after an already-selected route.
      xDriveWebAppHash: target => {
        const query = new URLSearchParams()
        for (const [key, value] of Object.entries(target.params ?? {})) {
          if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
        }
        const suffix = query.toString()
        return '#/app/' + target.app + (suffix ? '?' + suffix : '')
      },
      xDriveWorkspaceNavigationAllowed: key => {
        requestedPermissions.push(key)
        return key === 'files' || key === 'gallery' && allowGallery
      },
      serverAdminVerified: false,
      mobileOverviewSlot: overviewSlot,
      saveVisibleMobileOverviewScroll: () => snapshots.push(overviewSlot),
      launchWebApp: route => launched.push(route),
    }
    const select = new Function(...Object.keys(env),
      code + '\nreturn selectMobileLauncher;')(...Object.values(env))
    return { select, launched, requestedPermissions, snapshots }
  }
  const allowed = makeLauncher()
  allowed.select('gallery-albums')
  allowed.select('gallery-places')
  allowed.select('files')
  allowed.select('unknown-route')
  allowed.select('admin-users')
  assert.deepEqual(allowed.launched, [
    { app: 'gallery', params: { section: 'albums' } },
    { app: 'gallery', params: { section: 'places' } },
    { app: 'files', params: {} },
  ], 'shortcuts use existing Gallery route and never create dynamic/admin routes')
  assert.deepEqual(allowed.requestedPermissions,
    ['gallery', 'gallery', 'files'], 'Gallery authorization gates every photo shortcut')
  const denied = makeLauncher(false)
  denied.select('gallery-albums')
  denied.select('gallery-places')
  denied.select('gallery')
  assert.deepEqual(denied.launched, [],
    'unavailable Gallery cannot be opened through a stale Launcher shortcut')
  assert.deepEqual(allowed.snapshots, [],
    'a non-overview route must not snapshot Launcher scroll')
  assert.deepEqual(denied.snapshots, [],
    'an unapproved route cannot snapshot Launcher scroll')

  // Reuse the ACTUAL production Launcher callback for all/mine. The snapshot
  // happens only when a requested destination passes the existing Owner and
  // workspace admission gate; it does not turn unauthorized routes into UI.
  const fromAll = makeLauncher(true, 'all')
  fromAll.select('gallery-albums')
  fromAll.select('files')
  fromAll.select('unknown-route')
  fromAll.select('admin-users')
  assert.deepEqual(fromAll.launched, [
    { app: 'gallery', params: { section: 'albums' } },
    { app: 'files', params: {} },
  ])
  assert.deepEqual(fromAll.snapshots, ['all', 'all'],
    'accepted Launcher navigation preserves the outgoing All scroll')
  const fromMine = makeLauncher(false, 'mine')
  fromMine.select('gallery-places')
  fromMine.select('files')
  assert.deepEqual(fromMine.snapshots, ['mine'],
    'rejected Gallery does not snapshot Mine; accepted Files does')
  const sameRoute = makeLauncher(true, 'all',
    { app: 'gallery', params: { section: 'albums' } })
  sameRoute.select('gallery-albums')
  assert.deepEqual(sameRoute.launched, [],
    'same Gallery subroute does not add an invisible browser history entry')
  assert.deepEqual(sameRoute.snapshots, [],
    'no-op route does not overwrite the Launcher scroll anchor')
}
console.log('Mobile Launcher categories: authorized destinations, role, search and 44px favorite control passed')
