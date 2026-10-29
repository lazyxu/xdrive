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
    { service: 'photo-smart', tab: 'verify' },
    { service: 'photo-semantic', tab: 'verify' },
    { service: 'photo-creative', tab: 'verify' },
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
  const agents = read('docs/history/AGENTS-2026-10-27-before-consolidation.md')
  // Route names moved to shared titles; both Hosts still use the same page.
  const routeTitles = read('ui/shared/src/mui/WorkspaceRouteTitles.ts')
  for (const source of [web, desktop, routeTitles, page]) {
    assert.ok(source.includes('系统依赖'))
  }
  assert.equal(web.includes("label: '服务与依赖'"), false)
  assert.equal(desktop.includes("label: '服务与依赖'"), false)
  assert.ok(web.includes("const adminServicesLocation = route.app === 'admin-services' ? route.params : undefined"))
  assert.ok(web.includes('location: adminServicesLocation'))
  assert.ok(web.includes('adminServices: serverAdminVerified ? {'))
  assert.ok(read('web/src/browserWorkspaceHost.ts').includes('adminServicesPage: ports.adminServices'))
  assert.ok(web.includes('onLocationChange: (next, options) => launchWebApp('))
  assert.ok(desktop.includes('navigationResetKey: systemDependenciesNavigationResetKey'))
  assert.ok(page.includes('data-xdrive-system-dependencies-overview'))
  assert.ok(page.includes('data-xdrive-system-dependency-detail'))
  assert.ok(page.includes('系统依赖页内导航'))
  assert.ok(page.includes('onClick={() => choosePage(\'photo-auto\')}'))
  assert.ok(page.includes("selectedPage === 'overview'"))
  assert.ok(page.includes("currentTab === 'history'"))
  assert.ok(page.includes("currentTab === 'verify'"))
  assert.ok(page.includes('setPendingNavigation('))
  assert.ok(page.includes('disabled={loading || refreshing || unsavedRef.current}'),
    'manual refresh cannot silently discard an unsaved editor draft')
  assert.ok(page.includes('确认离开将放弃这些修改'))
  assert.ok(page.includes('window.addEventListener(\'beforeunload\''))
  assert.ok(page.includes("selectedPage === 'photo-auto' && source.loadPhotoAutoConfig"))
  assert.ok(page.includes("selectedPage === 'geonames' && source.loadGeoNamesRevisions"))
  assert.ok(page.includes("historyExpanded"))
  assert.ok(page.includes("selectedPage === 'baidu-map' && source.loadBaiduMapConfig"))
  assert.ok(page.includes('source.load()'))
  assert.ok(agents.includes('系统依赖'))
  assert.ok(page.includes('XDriveWorkspaceSurface'))
  assert.ok(page.includes("onDirtyChange={selectedPage === 'photo-face' ? setChildDirty : undefined}"))
  assert.ok(page.includes("onDirtyChange={currentTab === 'config' ? setCaddyHTTPSDirty : undefined}"))
  assert.ok(page.includes('onDirtyChange={setCaddyAliDirty}'))
  assert.equal(page.includes('docker.sock'), false)
})

test('only the active service panel loads config; flat core/media panels include history', () => {
  const panels = [
    ['PostgresPoolConfigPanel.tsx', 'PostgresPool'],
    ['SourceWorkerConfigPanel.tsx', 'SourceWorker'],
    ['MediaWorkerConfigPanel.tsx', 'MediaWorker'],
    ['CaddyHTTPSDesiredPanel.tsx', 'CaddyHTTPS'],
  ]
  for (const [name, id] of panels) {
    const body = read('ui/shared/src/mui/' + name)
    assert.ok(body.includes("section = 'config'"), 'missing section scope: '+name)
    const allowFullHistory = name === 'PostgresPoolConfigPanel.tsx' ||
      name === 'SourceWorkerConfigPanel.tsx' ||
      name === 'MediaWorkerConfigPanel.tsx'
    assert.ok(body.includes((allowFullHistory
      ? "(section === 'history' || section === 'all') && source.load"
      : "section === 'history' && source.load") + id + "Revisions"),
      'unexpected history loading: ' + name)
    assert.ok(body.includes('onDirtyChange?.('), 'missing draft guard: ' + name)
  }
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  // Pending credential clear is also a dirty draft; it must be guarded like AK/SK edits.
  assert.ok(alidns.includes("const action = pendingClear ? 'clear' : keyID || keySecret ? 'replace' : 'keep'"))
  assert.ok(alidns.includes("onDirtyChange?.(action !== 'keep')"))
  assert.ok(alidns.includes('host_pending: config.host_apply_pending === true'))
})

test('only eleven fixed, correctly grouped services reach the administrator overview', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const valid = nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.map((id) => ({
    id,
    group: ['database', 'storage', 'background-worker', 'caddy'].includes(id)
      ? 'core' : id === 'media-worker' ? 'media'
      : ['photo-face', 'photo-smart', 'photo-semantic', 'photo-creative'].includes(id)
        ? 'intelligence' : 'location',
  }))
  const poisoned = [
    { id: 'yike', group: 'core', account: 'sensitive-cookie' },
    { id: 'sync-folders', group: 'location', account: 'per-user-source' },
    { id: 'caddy', group: 'location', credential: 'wrong-group' },
    { id: 'database', group: 'core', credential: 'duplicated-entry' },
    ...valid.slice().reverse(),
    { id: 'photo-auto', group: 'intelligence', credential: 'not-a-service' },
  ]
  const result = nav.xDriveVisibleSystemDependencies(poisoned)
  assert.equal(result.length, 10, 'ambiguous duplicate IDs are hidden, not claimed healthy')
  assert.deepEqual(result.map((item) => item.id),
    nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.filter((id) => id !== 'database'))
  assert.equal(result.some((item) => 'account' in item || 'credential' in item), false,
    'old/malformed provider entries must not leak into global admin inventory')
  const clean = nav.xDriveVisibleSystemDependencies(valid.slice().reverse())
  assert.equal(clean.length, 11)
  assert.deepEqual(clean.map((item) => item.id), nav.XDRIVE_SYSTEM_DEPENDENCY_IDS)
  assert.deepEqual(nav.xDriveVisibleSystemDependencies([]), [])
  assert.deepEqual(nav.xDriveVisibleSystemDependencies([
    { id: 'baidu-map', group: 'core' },
    { id: 'other', group: 'media' },
  ]), [])
})

test('overview projects all eleven fixed services with safe missing-only entries', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const partial = [
    { id: 'database', group: 'core', label: 'DB', health_state: 'ready' },
    { id: 'database', group: 'core', label: 'duplicate', health_state: 'ready' },
    { id: 'photo-face', group: 'intelligence', label: 'Face', health_state: 'failed' },
    { id: 'yike', group: 'core', label: 'Secret', credential: 'sensitive' },
    { id: 'caddy', group: 'media', label: 'Invalid', health_state: 'ready' },
  ]
  const entries = nav.xDriveSystemDependenciesOverviewEntries(partial)
  assert.equal(entries.length, 11)
  assert.deepEqual(entries.map((item) => item.id), nav.XDRIVE_SYSTEM_DEPENDENCY_IDS)
  assert.deepEqual(entries.filter((item) => item.service !== null).map((item) => item.id), ['photo-face'])
  assert.deepEqual(entries.filter((item) => item.service === null).map((item) => item.id),
    nav.XDRIVE_SYSTEM_DEPENDENCY_IDS.filter((id) => id !== 'photo-face'))
  assert.deepEqual(entries.filter((item) => item.group === 'core').map((item) => item.id),
    ['database', 'storage', 'background-worker', 'caddy'])
  assert.equal(entries.find((item) => item.id === 'database').label, 'PostgreSQL')
  assert.equal(entries.some((item) => 'credential' in item || item.id === 'yike'), false)
  assert.ok(nav.xDriveSystemDependenciesOverviewEntries([]).every((item) => item.service === null))
})

test('valid fixed service deep links fail closed when old Server omits their inventory rows', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const available = nav.xDriveVisibleSystemDependencies([
    { id: 'database', group: 'core', status: 'ready' },
    { id: 'media-worker', group: 'media', status: 'unknown' },
  ])
  assert.equal(nav.xDriveSystemDependencySelectionMissing('database', available), false)
  assert.equal(nav.xDriveSystemDependencySelectionMissing('media-worker', available), false)
  assert.equal(nav.xDriveSystemDependencySelectionMissing('geonames', available), true)
  assert.equal(nav.xDriveSystemDependencySelectionMissing('user-source', available), false)
  for (const id of nav.XDRIVE_SYSTEM_DEPENDENCY_IDS)
    assert.equal(nav.xDriveSystemDependencySelectionMissing(id, []), true)
  const duplicates = nav.xDriveVisibleSystemDependencies([
    { id: 'caddy', group: 'core', status: 'ready' },
    { id: 'caddy', group: 'core', status: 'unavailable' },
    { id: 'sync-folders', group: 'core', status: 'ready' },
  ])
  assert.equal(nav.xDriveSystemDependencySelectionMissing('caddy', duplicates), true)
  assert.deepEqual(duplicates, [])
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes('xDriveSystemDependencySelectionMissing(selectedPage, systemServices)'))
  assert.ok(page.includes('data-xdrive-system-dependency-unreported'))
  assert.ok(page.includes('!loading && snapshot && selectedServiceMissing'))
  assert.equal(page.includes('<MenuItem value={selectedPage} disabled>'), false)
  assert.ok(page.includes("onClick={() => navigateTo({})}>返回总览"))
  assert.ok(page.includes('不会伪造默认绿色状态'))
})

test('mobile selector keeps all eleven fixed dependencies navigable when Server or Agent omits rows', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const entries = nav.xDriveSystemDependenciesOverviewEntries([
    { id: 'database', group: 'core', label: 'PostgreSQL (observed)' },
    { id: 'baidu-map', group: 'location', label: 'Baidu (observed)' },
    { id: 'photo-face', group: 'core', label: 'wrong group must be ignored' },
    { id: 'sync-folders', group: 'core', label: 'personal data must be ignored' },
  ])
  assert.deepEqual(entries.map((item) => item.id), nav.XDRIVE_SYSTEM_DEPENDENCY_IDS)
  assert.equal(entries.filter((item) => item.service !== null).length, 2)
  assert.equal(entries.find((item) => item.id === 'photo-face').service, null)
  assert.equal(entries.find((item) => item.id === 'photo-face').label, '人脸检测与人物聚类')
  const source = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const selector = source.split('<TextField select size="small" fullWidth label="选择系统依赖"')[1]?.split('</TextField>')[0]
  assert.ok(selector, 'compact selector must exist for Mobile Web')
  assert.ok(selector.includes('overviewEntries.filter((item) => item.group === group.id)'),
    'mobile must use the same allowlisted projection as the overview and desktop local nav')
  assert.ok(selector.includes('item.service?.label ?? item.label'))
  assert.ok(selector.includes("item.service ? '' : '（未报告）'"))
  assert.equal(selector.includes('systemServices.filter'), false,
    'partial or old Agent inventory must not hide entries from mobile navigation')
  assert.equal(selector.includes('<MenuItem value={selectedPage} disabled>'), false,
    'missing fixed ID must be navigable to read-only missing-state explanation')
  assert.ok(source.includes('data-xdrive-system-dependency-unreported'))
  assert.ok(source.includes('不会伪造默认绿色状态'))
})

test('Baidu map uses one concise UI name for reported and unreported services', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const missing = nav.xDriveSystemDependenciesOverviewEntries([]).find((item) => item.id === 'baidu-map')
  assert.equal(missing.label, '百度地图')
  const observed = { id: 'baidu-map', group: 'location', label: '百度地图 Server API',
    status: 'ready', detail: 'Server API for coordinate conversion', revision: 7 }
  const display = nav.xDriveSystemDependencyForDisplay(observed)
  assert.notStrictEqual(display, observed)
  assert.equal(display.label, '百度地图')
  assert.equal(observed.label, '百度地图 Server API', 'Server response must be unchanged')
  assert.equal(display.status, 'ready')
  assert.equal(display.detail, observed.detail)
  assert.equal(display.revision, 7)
  const other = { id: 'database', label: 'PostgreSQL' }
  assert.strictEqual(nav.xDriveSystemDependencyForDisplay(other), other)
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes('xDriveVisibleSystemDependencies(snapshot?.services ?? []).map(xDriveSystemDependencyForDisplay)'),
    'project names once before sidebar, compact selector, overview cards and selected title')
  assert.ok(page.includes('service.service?.label ?? service.label'))
  assert.ok(page.includes('item.service?.label ?? item.label'))
  assert.ok(page.includes('selectedItem?.label'))
})

test('Baidu capability links require real JSAPI4 API rather than retired Static Map probe', () => {
  const mod = loadTs('ui/shared/src/system-dependencies-capabilities.ts')
  const capability = mod.XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES['baidu-map']
  assert.equal(capability.enable, 'Server API 坐标转换开关可编辑')
  assert.match(capability.verify, /JSAPI 4\.0 .*Loader.*Browser AK/)
  assert.equal(capability.activationLabel, '管理坐标转换与 Server AK')
  const runtime = [{ id: 'baidu-map', status: 'ready',
    config_mode: 'in-app', apply_mode: 'immediate' }]
  const oldPort = { loadBaiduMapConfig() {}, saveBaiduMapConfig() {}, verifyBaiduMap() {} }
  const resolvedLegacy = mod.xDriveSystemDependencyAvailableTargets('baidu-map', runtime, oldPort)
  assert.equal(resolvedLegacy.verifyTarget, undefined,
    'retired Static Map probing must not unlock JSAPI4 verification')
  assert.deepEqual(resolvedLegacy.configTarget, { service: 'baidu-map', tab: 'config' })
  const readOnlyJSAPI4 = { ...oldPort, loadBaiduJSAPIConfig() {} }
  assert.equal(mod.xDriveSystemDependencyAvailableTargets('baidu-map', runtime, readOnlyJSAPI4).verifyTarget,
    undefined, 'Loader probe API must also be present')
  const fullJSAPI4 = { ...readOnlyJSAPI4, verifyBaiduJSAPI4Loader() {} }
  assert.deepEqual(mod.xDriveSystemDependencyAvailableTargets('baidu-map', runtime, fullJSAPI4).verifyTarget,
    { service: 'baidu-map', tab: 'verify' })
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(page, /<XDriveBaiduJSAPIDesiredPanel source=\{source\}/)
  assert.match(page, /mode="all"/)
})

test('shared Web and Desktop service rows expose true configuration ownership, not fake activation', () => {
  const model = read('ui/shared/src/service-dependencies.ts')
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(model.includes("XDriveServiceConfigMode = 'in-app' | 'deployment' | 'planned'"))
  assert.ok(page.includes("Record<XDriveServiceConfigMode | 'unknown', string>"))
  for (const label of [
    '配置能力未知（请核对 Server/Agent 版本）',
    '模型／资源由受控部署管理（具体能力见详情）',
    '暂未提供应用内配置',
    '应用内可配置（能否启停以详情页为准）',
  ]) assert.ok(page.includes(label))
  // Shared host has a reviewed enable-only operation: the display contract
  // cannot regress to claiming that absolutely no in-app host operation exists.
  assert.ok(page.includes('共享宿主仅支持审计后的安全启用'))
  assert.ok(page.includes('管理共享 Photo Intelligence 宿主（仅支持安全启用）'))
  assert.ok(page.includes('data-xdrive-direct-shared-photo-verify'))
  assert.ok(page.includes("['photo-smart', 'photo-semantic', 'photo-creative'].includes(selectedPage) &&"))
  assert.ok(page.includes("currentTab === 'verify')) &&"))
  assert.equal((page.match(/<XDrivePhotoHostDesiredPanel source=/g) || []).length, 1,
    'per-model verification must reuse one lazy shared panel')
  assert.equal(page.includes('检测共享宿主与四类模型 Info（手动、只读）'), false,
    'do not require an extra redirect to the shared host for model diagnostics')
  assert.equal(page.includes('尚无受限容器启停接口'), false)
  assert.ok(page.includes('data-xdrive-service-config-mode'))
  assert.ok(page.includes("configModeLabels[service.config_mode ?? 'unknown']"))
  assert.ok(page.includes("configModeLabels[service.config_mode ?? 'unknown']"))
  assert.ok(page.includes("service.config_mode !== 'in-app'"))
  assert.equal((page.match(/\?\? configModeLabels\.unknown/g) || []).length, 2,
    'unrecognized modes from malformed/old Servers must fail closed as unknown')
  assert.equal(page.includes('docker.sock'), false)
})

test('global App exits never silently discard unsaved System Dependencies drafts', () => {
  const nav = loadTs('ui/shared/src/system-dependencies-navigation.ts')
  const shouldPrompt = nav.xDriveSystemDependenciesNeedsExitConfirmation
  assert.equal(shouldPrompt('admin-services', 'files', true), true)
  assert.equal(shouldPrompt('admin-services', 'gallery', true), true)
  assert.equal(shouldPrompt('admin-services', 'overview', true), true)
  assert.equal(shouldPrompt('admin-services', 'admin-services', true), false,
    'in-page navigation is protected by its independent editor guard')
  assert.equal(shouldPrompt('admin-services', 'files', false), false)
  assert.equal(shouldPrompt('admin-services', 'files', true, true), false,
    'opening a new browser tab does not unmount the active draft')
  assert.equal(shouldPrompt('files', 'admin-services', true), false)
  assert.equal(shouldPrompt('admin-services', 'files', true, false), true)
})

test('Web, Mobile Web, Desktop and shared editor all use the pre-unmount guard', () => {
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const nav = read('ui/shared/src/system-dependencies-navigation.ts')
  assert.ok(nav.includes('export function xDriveVisibleSystemDependencies'))
  assert.ok(page.includes('xDriveVisibleSystemDependencies(snapshot?.services ?? [])'))
  assert.ok(page.includes('onUnsavedChange?.(hasUnsavedEdits)'))
  assert.ok(page.includes('onUnsavedChange?.(false)'))
  assert.ok(web.includes('launch: launchWebAppRuntime'))
  assert.ok(web.includes('xDriveSystemDependenciesNeedsExitConfirmation('))
  assert.ok(web.includes('onUnsavedChange: setSystemDependenciesDraftDirty'))
  assert.ok(read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
    .includes('<XDriveServiceDependenciesPage {...services.adminServicesPage} />'))
  assert.ok(web.includes('onBack={exitWebApp}'), 'Mobile Web back must be guarded')
  assert.ok(web.includes("if (pending.kind === 'exit') exitApp()"))
  assert.ok(web.includes('else launchWebAppRuntime(pending.next, pending.options)'))
  assert.ok(desktop.includes('useXDriveWorkspaceNavigationState({'))
  assert.ok(desktop.includes('xDriveSystemDependenciesNeedsExitConfirmation('))
  assert.ok(desktop.includes('onUnsavedChange: setSystemDependenciesDraftDirty'))
  assert.ok(desktop.includes('navigateWorkspace(next)'))
  assert.ok(desktop.includes('revision={pageRevision}'))
  for (const content of [web, desktop]) {
    assert.ok(content.includes('open={pendingSystemDependenciesExit !== null}'))
    assert.ok(content.includes('放弃修改并离开'))
  }
  assert.equal(nav.includes('docker.sock'), false)
})

test('Status refresh preserves mounted editor, saved draft and last successful inventory on failure', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes("}, [source, selectedPage])"),
    'editor scope must follow the service, not same-page accordion or health refresh')
  assert.ok(page.includes("}, [source, selectedPage, historyExpanded])"),
    'only the history accordion requests revision lists')
  assert.equal(page.includes("}, [source, refreshID, selectedPage, currentTab])"), false)
  assert.ok(page.includes('const sourceChanged = snapshotSourceRef.current !== source'))
  assert.ok(page.includes('cachedSnapshotRef.current = null'))
  assert.ok(page.includes('cachedSnapshotRef.current = next'))
  assert.ok(page.includes('if (cachedSnapshotRef.current === null)'))
  assert.ok(page.includes('setRefreshing(true)'))
  assert.ok(page.includes('刷新失败，当前显示上次成功检测的快照'))
  assert.ok(page.includes("disabled={loading || refreshing || unsavedRef.current}"))
  assert.equal((page.match(/setSnapshot\(null\)/g) || []).length, 1,
    'health refresh must not unmount active forms; only a source change may clear inventory')
  assert.ok(page.includes("  }, [source, refreshID])"),
    'the independent inventory effect must respond to explicit refresh')
  assert.ok(page.includes("selectedPage === 'media-worker' && currentTab === 'status'"))
  assert.ok(page.includes("<XDriveCoreDependencyDetail"))
  const core = read('ui/shared/src/mui/CoreDependencyDetail.tsx')
  assert.ok(core.includes('section="all" singlePage onDirtyChange={onDirtyChange}'))
  assert.ok(core.includes('if (controlsLocked) return'))
  assert.ok(page.includes('section="all" onDirtyChange={setChildDirty} onBusyChange={setRuntimeBusy}'))
  assert.ok(page.includes('refreshID={refreshID}'),
    'only one active runtime editor refreshes its configuration alongside status')
  assert.ok(page.includes('refreshID={caddyEvidenceRevision}'),
    'Caddy preflight changes only when its own target credentials/revision changes')
})

test('Runtime verification tabs load exact service-specific status without eager history or edit controls', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes("section={selectedPage === 'photo-face' ? 'all' : 'verify'}"))
  for (const [name, key] of [
    ['PostgresPoolConfigPanel.tsx', 'PostgresPool'],
    ['SourceWorkerConfigPanel.tsx', 'SourceWorker'],
    ['MediaWorkerConfigPanel.tsx', 'MediaWorker'],
  ]) {
    const panel = read('ui/shared/src/mui/' + name)
    assert.ok(panel.includes("section?: 'config' | 'history' | 'verify'"), name)
    assert.ok(panel.includes("section === 'config'"), name)
    assert.ok(panel.includes("section === 'history'"), name)
    const flatCore = name === 'PostgresPoolConfigPanel.tsx' ||
      name === 'SourceWorkerConfigPanel.tsx'
    assert.ok(panel.includes("(section === 'history' || section === 'all') && source.load" + key + "Revisions)"),
      'incorrect history scope for ' + name)
    assert.ok(panel.includes('const reload = async () => {'), name)
  }
  assert.ok(page.includes("!['baidu-map', 'geonames']"),
    'Baidu and GeoNames keep separate bounded verification panels; Caddy also shows current Server evidence')
  const core = read('ui/shared/src/mui/CoreDependencyDetail.tsx')
  assert.ok(core.includes('data-xdrive-core-readonly-scope={service.id}'))
  for (const service of ['database', 'storage', 'background-worker']) {
    assert.ok(core.includes(service), service + ' must be covered by the shared scope')
  }
  for (const [service, proof] of [
    ['media-worker', 'data-xdrive-media-worker-liveness-scope'],
    ['caddy', 'data-xdrive-caddy-liveness-scope'],
  ]) {
    assert.ok(page.includes("selectedPage === '" + service + "' ? ("))
    assert.ok(page.includes(proof))
  }
  assert.equal(page.includes('docker.sock'), false)
})


test('Caddy, core services and remaining dependencies share persistent detail sections', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const workspace = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const editor = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  const preflight = read('ui/shared/src/mui/CaddyPreflightPanel.tsx')

  // All fixed service pages now use stable, always-visible sections rather
  // than disclosure state; read-only history remains a separate fenced GET.
  const core = read('ui/shared/src/mui/CoreDependencyDetail.tsx')
  assert.ok(page.includes('<XDriveCoreDependencyDetail'))
  assert.ok(core.includes('section="all" singlePage'))
  assert.ok(core.includes('data-xdrive-core-dependency-flat'))
  assert.ok(page.includes("selectedTabs.filter((tab) => tab !== 'verify' &&"))
  assert.ok(page.includes('data-xdrive-flat-dependency-section={sectionTab}'))
  assert.equal(page.includes('<AccordionSummary'), false)
  assert.equal(page.includes('<AccordionDetails'), false)
  assert.ok(page.includes("const historyExpanded = selectedTabs.includes('history')"))
  assert.ok(page.includes("if (!historyExpanded) return"))
  assert.ok(page.includes("}, [source, selectedPage, historyExpanded])"))
  assert.ok(page.includes('onConfigurationChanged={invalidateCaddyEvidence}'))

  // Caddy has no accordion or editable lazy history; recent Host terminal history is readonly.
  assert.ok(workspace.includes('data-xdrive-caddy-single-page="true"'))
  assert.ok(workspace.includes("activeTab === 'history' ? 'caddy-v1-history'"))
  assert.ok(workspace.includes("activeTab === 'config' ? 'caddy-v1-config'"))
  assert.ok(workspace.includes('id="caddy-v1-history"'))
  for (const forbidden of [
    'showHistory', 'historyOpen', 'showEvidence', 'evidenceOpen',
    'section="history"', 'XDriveCaddyHostBaselinePreviewPanel',
    'data-xdrive-caddy-v1-runtime-desired-drift',
  ]) assert.equal(workspace.includes(forbidden), false, 'obsolete Caddy UI: ' + forbidden)
  assert.ok(workspace.includes('data-xdrive-caddy-v11-atomic-save'))
  assert.ok(workspace.includes('<XDriveCaddyPreflightPanel source={source}'))
  assert.ok(workspace.includes('onConfigurationChanged={changed}'))
  assert.ok(preflight.includes("onClick={() => { void check() }}"), 'preflight must be explicit')
  assert.equal(alidns.includes('manageOpen'), false, 'masked AliDNS editor stays visible')
  assert.ok(editor.includes('(lanEnabled || enabled)'), 'both entries cannot be off')
  assert.ok(editor.includes('data-xdrive-caddy-running-lan-ip'), 'only verified runtime IP is shown')
  for (const forbidden of ['docker.sock', 'adminRestartHost', 'adminStopHost', 'source.deploy'])
    assert.equal(workspace.includes(forbidden), false)
})

test('Caddy editor keeps dirty draft, account/source fence, and no duplicate status or lazy history UI', () => {
  const editor = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const workspace = read('ui/shared/src/mui/CaddyDetailV1.tsx')
  const ali = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')

  assert.ok(editor.includes('if (!source.loadCaddyHTTPSConfig || busy || atomicSaving || changed) return'))
  assert.ok(editor.includes('disabled={busy || loading || atomicSaving || changed || !source.loadCaddyHTTPSConfig}'))
  assert.ok(editor.includes('data-xdrive-caddy-draft-refresh-guard'))
  assert.ok(editor.includes('重新读取已保存配置'))
  assert.ok(editor.includes('disabled={!canEdit || !supportsLAN || (lanEnabled && !enabled)}'))
  assert.ok(editor.includes('disabled={!canEdit || (enabled && !lanEnabled)}'))
  assert.ok(editor.includes('(lanEnabled || enabled)'))
  assert.ok(editor.includes('onAtomicDraft?.(config && section === \'config\''))
  assert.ok(workspace.includes('++saveEpoch.current'))
  assert.ok(workspace.includes('savePendingRef.current'))
  assert.ok(workspace.includes('source.saveCaddyConfiguration(input)'))
  assert.equal(workspace.includes('source.saveCaddyHTTPSConfig('), false)
  assert.equal(workspace.includes('source.saveCaddyAliDNS('), false)
  assert.equal(workspace.includes('section="history"'), false)
  assert.ok(ali.includes('Math.min(30, shown.expires_in_seconds)'))
  assert.ok(ali.includes("document.addEventListener('visibilitychange'"))
  assert.ok(ali.includes("window.addEventListener('blur', hide)"))
  assert.ok(page.includes('caddyEvidenceRevision'))
  const reload = editor.slice(editor.indexOf('  const reload = async () => {'), editor.indexOf('  const save = async () => {'))
  assert.ok(reload.includes('if (section === \'history\' && source.loadCaddyHTTPSRevisions)') || reload.includes("section === 'history'"))
  const save = editor.slice(editor.indexOf('  const save = async () => {'), editor.indexOf('  const rollback = async () => {'))
  assert.equal(save.includes('loadCaddyHTTPSRevisions'), false, 'Save must not read history')
})

test('Photo model details expose shared manual verification but only the host owns mutable configuration', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const hostPanel = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const start = page.indexOf('function dependencyTabsFor(')
  const end = page.indexOf('const statusLabels:', start)
  assert.ok(start >= 0 && end > start, 'dependency tab allowlist must remain explicit')
  const tabs = page.slice(start, end)
  assert.ok(tabs.includes("case 'photo-face': return ['status', 'config', 'verify', 'history']"))
  assert.ok(tabs.includes("case 'photo-creative': return ['status', 'verify']"))
  assert.ok(tabs.includes("case 'photo-smart':"))
  assert.ok(tabs.includes("case 'photo-semantic':"))
  assert.equal(tabs.includes("case 'photo-smart': return ['status', 'config'"), false)
  assert.equal(tabs.includes("case 'photo-semantic': return ['status', 'config'"), false)
  assert.equal(tabs.includes("case 'photo-creative': return ['status', 'config'"), false)
  assert.equal((page.match(/<XDrivePhotoHostDesiredPanel source=/g) || []).length, 1,
    'all model diagnostics must use the one shared existing host panel')
  assert.ok(page.includes("currentTab === 'verify')) &&"),
    'submodel verification must not mount a mutable host section')
  assert.ok(hostPanel.includes("if ((section !== 'verify' && section !== 'all') || !source.loadPhotoHostPreflight"),
    'private model inference must remain behind an explicit administrator click')
  assert.ok(hostPanel.includes('source.loadPhotoHostPreflight()'))
})


test('all remaining system dependency details stay visible with safe in-page anchors', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes("selectedTabs.filter((tab) => tab !== 'verify' &&"))
  assert.ok(page.includes("sectionTab === 'status' && selectedTabs.includes('verify')"))
  assert.ok(page.includes("sectionTab === 'status' && showVerify ? ['verify' as XDriveSystemDependencyTab]"))
  assert.ok(page.includes('data-xdrive-flat-dependency-section={sectionTab}'))
  assert.ok(page.includes('data-xdrive-flat-dependency-refresh={selectedPage}'))
  assert.equal(page.includes('data-xdrive-unified-verify-toggle'), false)
  assert.equal(page.includes('expandDependencySection('), false)
  assert.ok(page.includes('id={`dependency-${selectedPage}-verify-header`}'))
  assert.ok(page.includes("const historyExpanded = selectedTabs.includes('history')"))
  assert.ok(page.includes("if (!historyExpanded) return"))
  assert.ok(page.includes("currentTab === 'verify' && !showVerify"))
  assert.ok(page.includes("selectedPage === 'caddy' && currentTab === 'verify'"))
  assert.ok(page.includes('unsavedRef.current'))
  assert.ok(page.includes('currentTab === \'history\' && hasUnsavedEdits'))
})
