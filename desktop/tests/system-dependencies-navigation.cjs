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
  assert.ok(page.includes("onDirtyChange={currentTab === 'config' ? setChildDirty : undefined}"))
  assert.ok(page.includes("onDirtyChange={currentTab === 'config' ? setCaddyHTTPSDirty : undefined}"))
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
  assert.ok(web.includes('onUnsavedChange={setSystemDependenciesDraftDirty}'))
  assert.ok(web.includes('onBack={exitWebApp}'), 'Mobile Web back must be guarded')
  assert.ok(web.includes("if (pending.kind === 'exit') exitApp()"))
  assert.ok(web.includes('else launchWebAppRuntime(pending.next, pending.options)'))
  assert.ok(desktop.includes('const [view, setViewActual]'))
  assert.ok(desktop.includes('xDriveSystemDependenciesNeedsExitConfirmation('))
  assert.ok(desktop.includes('onUnsavedChange={setSystemDependenciesDraftDirty}'))
  assert.ok(desktop.includes('setViewActual(next)'))
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
  for (const service of ['media-worker', 'database', 'background-worker']) {
    assert.ok(page.includes("selectedPage === '" + service + "' && currentTab !== 'status'"))
  }
  assert.ok(page.includes("section={selectedRuntimeSection} onDirtyChange={currentTab === 'config' ? setChildDirty : undefined}"))
  assert.ok(page.includes('refreshID={0}'),
    'read-only inventory refresh must not bump editor instance generations')
  assert.ok(page.includes('refreshID={caddyEvidenceRevision}'),
    'Caddy preflight changes only when its own target credentials/revision changes')
})

test('Runtime verification tabs load exact service-specific status without eager history or edit controls', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.ok(page.includes("const selectedRuntimeSection = currentTab === 'verify' ? 'verify'"))
  for (const [name, key] of [
    ['PostgresPoolConfigPanel.tsx', 'PostgresPool'],
    ['SourceWorkerConfigPanel.tsx', 'SourceWorker'],
    ['MediaWorkerConfigPanel.tsx', 'MediaWorker'],
  ]) {
    const panel = read('ui/shared/src/mui/' + name)
    assert.ok(panel.includes("section?: 'config' | 'history' | 'verify'"), name)
    assert.ok(panel.includes("section === 'config'"), name)
    assert.ok(panel.includes("section === 'history'"), name)
    assert.ok(panel.includes("if (section === 'history' && source.load" + key + "Revisions)"),
      'verification must not load audit history for '+ name)
    assert.ok(panel.includes('const reload = async () => {'), name)
  }
  assert.ok(page.includes("!['baidu-map', 'geonames']"),
    'Baidu and GeoNames keep separate bounded verification panels; Caddy also shows current Server evidence')
  for (const [service, proof] of [
    ['database', 'data-xdrive-postgres-liveness-scope'],
    ['background-worker', 'data-xdrive-pull-worker-liveness-scope'],
    ['media-worker', 'data-xdrive-media-worker-liveness-scope'],
    ['caddy', 'data-xdrive-caddy-liveness-scope'],
  ]) {
    assert.ok(page.includes("selectedPage === '" + service + "' ? ("),
      service + ' must own an explicit live read-only status scope')
    assert.ok(page.includes(proof), service + ' must describe actual proof scope')
  }
  assert.equal(page.includes('docker.sock'), false)
})


test('one shared detail page replaces status/config/verify/history tabs without eager history', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const caddy = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  assert.ok(page.includes("selectedTabs.map((currentTab) => {"),
    'each relevant capability is an in-page section of the same service')
  assert.ok(page.includes('data-xdrive-unified-detail-intro'))
  assert.ok(page.includes('data-xdrive-unified-detail-section={currentTab}'))
  assert.ok(page.includes('<AccordionSummary'))
  assert.ok(page.includes('<AccordionDetails'))
  assert.equal(page.includes('<Tabs'), false)
  assert.equal(page.includes('<Tab '), false)
  assert.ok(page.includes("const historyExpanded = selectedTabs.includes('history')"),
    'the audit history must be absent until the section opens or a history link targets it')
  assert.ok(page.includes("if (!historyExpanded) return"))
  assert.ok(page.includes("}, [source, selectedPage, historyExpanded])"))
  assert.ok(page.includes("}, [source, selectedPage])"),
    'within-page section switches must not reset a configuration draft')
  assert.ok(page.includes("if (!next && unsavedRef.current) return"),
    'collapsing an edited section must not unmount the draft')
  assert.ok(page.includes("disabled={currentTab === 'history' && hasUnsavedEdits}"),
    'history mutation must not overwrite a dirty in-page editor')
  assert.ok(page.includes("currentTab === 'verify' ? 'verify'"),
    'verify panel retains its restricted read-only contract')
  assert.ok(page.includes("selectedPage === 'caddy' && currentTab === 'config'"),
    'HTTPS and encrypted AliDNS inputs remain in the single Caddy detail page')
  assert.ok(page.includes("selectedPage === 'caddy' && currentTab === 'verify'"),
    'the seven existing Caddy preflight checks remain manual and separate from saving')
  assert.ok(page.includes("selectedPage === 'caddy' && (currentTab === 'config' || currentTab === 'history')"))
  assert.ok(page.includes("onDirtyChange={currentTab === 'config' ? setCaddyHTTPSDirty : undefined}"))
  assert.ok(page.includes('onConfigurationChanged={invalidateCaddyEvidence}'))
  assert.ok(page.includes('window.setTimeout(hideBaiduAK, seconds * 1000)'),
    'Baibu AK must expire even if its reveal child unmounts on section collapse')
  assert.ok(page.includes("!next && selectedPage === 'baidu-map' && currentTab === 'config'"),
    'closing the configuration accordion must immediately redact any exposed AK')
  assert.ok(caddy.includes('!lanEnabled && !enabled') || caddy.includes('!lanEnabled && !enabled'))
  assert.ok(caddy.includes("(lanEnabled || enabled)"))
  assert.ok(caddy.includes("期望配置未应用"))
  for (const forbidden of ['docker.sock', 'adminRestartHost', 'adminStopHost'])
    assert.equal(page.includes(forbidden), false)
});


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
  assert.ok(hostPanel.includes("if (section !== 'verify' || !source.loadPhotoHostPreflight"),
    'private model inference must remain behind an explicit administrator click')
  assert.ok(hostPanel.includes('source.loadPhotoHostPreflight()'))
})
