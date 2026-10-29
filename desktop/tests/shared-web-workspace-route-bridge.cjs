'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const modules = new Map()
function execute(file) {
  if (modules.has(file)) return modules.get(file)
  const compiled = ts.transpileModule(source(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const module = { exports: {} }
  modules.set(file, module.exports)
  const requireModule = name => {
    if (file === 'ui/shared/src/web-app.ts' && name === './system-dependencies-navigation') {
      return { xDriveNormalizeSystemDependenciesLocation: () => ({}) }
    }
    if (!name.startsWith('.')) throw Error('unexpected dependency: ' + name)
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), name))
    const resolved = [relative + '.ts', relative + '.tsx'].find(p => fs.existsSync(path.join(root, p)))
    if (!resolved) throw Error('missing production module: ' + relative)
    return execute(resolved)
  }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, requireModule)
  modules.set(file, module.exports)
  return module.exports
}

const bridge = execute('ui/shared/src/web-workspace-route.ts')
const web = execute('web/src/webApps.ts')
const shared = execute('ui/shared/src/mui/WorkspaceRoute.ts')
const webIds = execute('ui/shared/src/web-app.ts').XDRIVE_WEB_APP_IDS
const appDescriptors = web.XDRIVE_WEB_APPS
const canonical = shared.XDRIVE_APP_WORKSPACE_ROUTES

test('every shared Desktop/DSM route maps only to an actual Web program', () => {
  for (const route of canonical) {
    const expected = route === 'transfers' || route === 'global-tasks'
      ? 'tasks' : webIds.includes(route) ? route : null
    assert.equal(bridge.xDriveWebAppForWorkspaceRoute(route), expected, route)
    assert.equal(web.xDriveWebAppForWorkspaceKey(route), expected, route)
    const actual = web.xDriveWebAppRouteForWorkspaceKey(route)
    assert.equal(actual?.app ?? null, expected, route)
    if (expected && expected !== 'tasks') {
      assert.deepEqual(actual.params, {}, route)
      assert.equal(web.xDriveWebAppWorkspaceKey(expected), route)
    }
  }
})

test('task scopes retain mine/global semantic identity and deep-link behavior', () => {
  assert.deepEqual(web.xDriveWebAppRouteForWorkspaceKey('transfers'),
    { app: 'tasks', params: { scope: 'mine' } })
  assert.deepEqual(web.xDriveWebAppRouteForWorkspaceKey('global-tasks'),
    { app: 'tasks', params: { scope: 'global' } })
  assert.equal(web.xDriveWebAppWorkspaceKey('tasks', { scope: 'mine' }), 'transfers')
  assert.equal(web.xDriveWebAppWorkspaceKey('tasks', { scope: 'global' }), 'global-tasks')
  assert.equal(web.xDriveWebAppWorkspaceKey('tasks'), 'transfers')
  assert.equal(shared.xDriveWorkspaceNavigationAllowed('global-tasks', false), false,
    'the mapping must never be mistaken for admin authorization')
})

test('legacy Source hash remains only a compatibility route, not a new sidebar', () => {
  assert.equal(web.xDriveWebAppWorkspaceKey('sync-folders', { source: 28 }), 'remote-pull')
  assert.equal(web.xDriveWebAppForWorkspaceKey('sync-folders'), null)
  assert.equal(web.xDriveWebAppRouteForWorkspaceKey('sync-folders'), null)
  assert.equal(appDescriptors['sync-folders'].sidebar, false)
})

test('Viewer, non-Web Host routes and untrusted keys cannot enter a Web workspace', () => {
  for (const invalid of ['', 'settings', '__proto__', 'constructor',
    'media-viewer', 'pdf-viewer', 'text-viewer', 'preview', 'audio-player',
    'sync-folders', 'diagnostics', 'conflicts', 'admin-unknown', 'gallery/../admin-users']) {
    assert.equal(web.xDriveWebAppForWorkspaceKey(invalid), null, invalid)
    assert.equal(web.xDriveWebAppRouteForWorkspaceKey(invalid), null, invalid)
  }
  for (const viewer of ['media-viewer', 'pdf-viewer', 'text-viewer', 'preview', 'audio-player']) {
    assert.equal(web.xDriveWebAppWorkspaceKey(viewer), undefined, viewer)
  }
})

test('Web descriptor labels and sidebar surface stay intact, without a second route mapper', () => {
  for (const descriptor of Object.values(appDescriptors)) {
    if (!descriptor.workspaceKey) continue
    assert.equal(web.xDriveWebAppWorkspaceKey(descriptor.id),
      descriptor.workspaceKey, descriptor.id)
  }
  assert.match(source('web/src/webApps.ts'), /xDriveWorkspaceKeyFromWebApp\(app, params\)/)
  assert.doesNotMatch(source('web/src/webApps.ts'), /Object\.values\(XDRIVE_WEB_APPS\)\.find/)
  assert.doesNotMatch(source('ui/shared/src/web-workspace-route.ts'),
    /window\.xdriveDesktop|window\.location|ipcRenderer|backup\.cgi/)
})
