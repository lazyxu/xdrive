const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const cache = new Map()

function loadTs(file) {
  const resolved = path.posix.normalize(file)
  if (cache.has(resolved)) return cache.get(resolved)
  const source = read(resolved)
  const compiled = ts.transpileModule(source, {
    fileName: resolved, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const errors = (compiled.diagnostics || []).filter((item) =>
    item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, errors.map((item) =>
    ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
  const module = { exports: {} }
  cache.set(resolved, module.exports)
  new Function('exports', 'require', compiled.outputText)(module.exports, (dep) => {
    assert.ok(dep.startsWith('./'), 'unexpected navigation dependency: ' + dep)
    return loadTs(path.posix.join(path.posix.dirname(resolved), dep + '.ts'))
  })
  return module.exports
}

test('System Dependencies has exactly eleven services and one separate management policy', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  assert.equal(nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.length, 11)
  assert.equal(new Set(nav.XDRIVE_SYSTEM_DEPENDENCY_IDS).size, 11)
  assert.equal(nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.includes('photo-auto'), false)
  for (const id of ['database', 'storage', 'background-worker', 'caddy',
    'media-worker', 'photo-face', 'photo-smart', 'photo-semantic',
    'photo-creative', 'baidu-map', 'geonames']) {
    assert.ok(nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.includes(id), 'missing '+id)
  }
})

test('Web hash and Back/Forward accept valid deep links without changing admin-services app identity', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const router = loadTs('ui/shared/src/web-app.ts')
  const inputs = [
    { service: 'database', tab: 'status' },
    { service: 'caddy', tab: 'config' },
    { service: 'geonames', tab: 'verify' },
    { service: 'background-worker', tab: 'history' },
    { policy: 'photo-auto', tab: 'config' },
    { policy: 'photo-auto', tab: 'history' },
  ]
  for (const params of inputs) {
    const url = router.xDriveWebAppHash({ app: 'admin-services', params })
    assert.equal(url.startsWith('#/app/admin-services?'), true)
    assert.deepEqual(router.xDriveParseWebAppHash(url),
      { app: 'admin-services', params }, url)
  }
  assert.deepEqual(router.xDriveParseWebAppHash('#/app/admin-services'),
    { app: 'admin-services', params: {} })
  assert.deepEqual(nav.xDriveNormalizeSystemDependenciesLocation({
    service: 'nonexistent', tab: 'history',
  }), {})
  assert.deepEqual(router.xDriveParseWebAppHash('#/app/admin-services?service=unknown&tab=config'),
    { app: 'admin-services', params: {} })
  assert.deepEqual(router.xDriveParseWebAppHash('#/app/admin-services?service=caddy&tab=invalid'),
    { app: 'admin-services', params: { service: 'caddy', tab: 'status' } })
  assert.deepEqual(router.xDriveParseWebAppHash('#/app/admin-services?policy=photo-auto&tab=unknown'),
    { app: 'admin-services', params: { policy: 'photo-auto', tab: 'config' } })
  assert.equal(nav.xDriveSystemDependenciesLocationKey({}), 'overview')
  assert.notEqual(nav.xDriveSystemDependenciesLocationKey({ service: 'database', tab: 'config' }),
    nav.xDriveSystemDependenciesLocationKey({ service: 'database', tab: 'history' }))
})

test('Web and Desktop render the same shared navigation without replacing the App Frame', () => {
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const registry = read('web/src/webApps.ts')
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const agents = read('AGENTS.md')
  for (const source of [web, desktop, registry, page]) {
    assert.ok(source.includes('系统依赖'))
  }
  assert.equal(web.includes("label: '服务与依赖'"), false)
  assert.equal(desktop.includes("label: '服务与依赖'"), false)
  assert.ok(web.includes("location={route.app === 'admin-services' ? route.params : undefined}"))
  assert.ok(web.includes("onLocationChange={(next, options) => launchWebApp("))
  assert.ok(desktop.includes('navigationResetKey={systemDependenciesNavigationResetKey}'))
  assert.ok(page.includes('data-xdrive-system-dependencies-overview'))
  assert.ok(page.includes('data-xdrive-system-dependency-detail'))
  assert.ok(page.includes('系统依赖页内导航'))
  assert.ok(page.includes('onClick={() => choosePage(\'photo-auto\')}'))
  assert.ok(page.includes("selectedPage === 'overview'"))
  assert.ok(page.includes("currentTab === 'history'"))
  assert.ok(page.includes("currentTab === 'verify'"))
  assert.ok(page.includes('setPendingNavigation('))
  assert.ok(page.includes('disabled={loading || unsavedRef.current}'),
    'manual refresh cannot silently discard an unsaved editor draft')
  assert.ok(page.includes('确认离开将放弃这些修改'))
  assert.ok(page.includes('window.addEventListener(\'beforeunload\''))
  assert.ok(page.includes("selectedPage === 'photo-auto' && source.loadPhotoAutoConfig"))
  assert.ok(page.includes("selectedPage === 'geonames' && currentTab === 'history'"))
  assert.ok(page.includes("selectedPage === 'baidu-map' && currentTab !== 'status'"))
  assert.ok(page.includes('source.load()'))
  assert.ok(agents.includes('系统依赖'))
  assert.ok(page.includes('XDriveWorkspaceSurface'))
  assert.ok(page.includes('onDirtyChange={setChildDirty}'))
  assert.ok(page.includes('onDirtyChange={setCaddyHTTPSDirty}'))
  assert.ok(page.includes('onDirtyChange={setCaddyAliDirty}'))
  assert.equal(page.includes('docker.sock'), false)
})

test('Only an opened service panel fetches its configuration and history', () => {
  const panels = [
    ['PostgresPoolConfigPanel.tsx', 'PostgresPool'],
    ['SourceWorkerConfigPanel.tsx', 'SourceWorker'],
    ['MediaWorkerConfigPanel.tsx', 'MediaWorker'],
    ['CaddyHTTPSDesiredPanel.tsx', 'CaddyHTTPS'],
  ]
  for (const [name, id] of panels) {
    const body = read('ui/shared/src/mui/' + name)
    assert.ok(body.includes("section = 'config'"), 'missing section scope: '+name)
    assert.ok(body.includes("section === 'history' && source.load" + id + "Revisions"),
      'eager history loading: ' + name)
    assert.ok(body.includes('onDirtyChange?.('), 'missing draft guard: ' + name)
  }
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  assert.ok(alidns.includes('onDirtyChange?.(keyID.length > 0 || keySecret.length > 0)'))
})
