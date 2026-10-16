const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function load(file) {
  const compiled = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const failures = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(failures.length, 0, failures.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  const exports = {}
  new Function('exports', 'require', compiled.outputText)(exports, () => {
    throw new Error('static service capability contract must not import runtime clients')
  })
  return exports
}

test('all eleven global services have bounded configuration/activation/verification/history guidance', () => {
  const nav = load('ui/shared/src/system-dependencies-navigation.ts')
  const support = load('ui/shared/src/system-dependencies-capabilities.ts')
  const matrix = support.XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES
  const ids = nav.XDRIVE_SYSTEM_DEPENDENCY_IDS
  assert.deepEqual(Object.keys(matrix).sort(), [...ids].sort())
  for (const id of ids) {
    for (const field of ['configure', 'enable', 'verify', 'history']) {
      assert.ok(typeof matrix[id][field] === 'string' && matrix[id][field].length >= 5,
        id + ' missing explicit support boundary: ' + field)
    }
    for (const target of [matrix[id].configTarget, matrix[id].verifyTarget]) {
      if (!target) continue
      assert.ok(ids.includes(target.service), id + ' must navigate to a fixed global service')
      assert.ok(['status', 'config', 'verify', 'history'].includes(target.tab))
    }
  }
  assert.ok(!Object.keys(matrix).some(x => /source|synology|yike|sync.folder|photo-auto/i.test(x)))
  assert.ok(matrix['baidu-map'].enable.includes('开关'))
  assert.ok(matrix['photo-face'].enable.includes('只允许经审计安全启用'))
  for (const id of ['photo-smart', 'photo-semantic', 'photo-creative']) {
    assert.deepEqual(matrix[id].configTarget, { service: 'photo-face', tab: 'config' })
    assert.match(matrix[id].enable, /无独立启停/)
  }
  assert.match(matrix.storage.enable, /不提供在线/)
  assert.match(matrix.caddy.enable, /尚未开放/)
  assert.match(matrix.database.enable, /部署管理/)
  assert.match(matrix.geonames.enable, /部署管理/)
})

test('Web and Desktop share one optional capability table, never a fake online toggle or effective state', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const backend = read('internal/api/admin_service_config_contract.go')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.match(page, /XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES/)
  assert.match(page, /data-xdrive-system-dependencies-capability-matrix/)
  assert.match(page, /显示 11 项配置能力/)
  assert.match(page, /隐藏配置能力/)
  assert.match(page, /item\.service && item\.service\.config_mode && item\.service\.apply_mode/)
  assert.match(page, /navigateTo\(configTarget\)/)
  assert.match(page, /navigateTo\(verifyTarget\)/)
  assert.match(page, /不代表服务运行、已应用或全实例生效/)
  assert.ok(web.includes('XDriveServiceDependenciesPage'))
  assert.ok(desktop.includes('XDriveServiceDependenciesPage'))
  assert.ok(backend.includes('"controlled-restart"'))
  for (const forbidden of ['docker.sock', 'adminStopHost', 'adminRestartHost', 'localStorage.setItem']) {
    assert.equal(page.includes(forbidden), false)
  }
})


test('quick actions fail closed for unknown ports, incomplete or duplicate lifecycle reports', () => {
  const support = load('ui/shared/src/system-dependencies-capabilities.ts')
  const resolve = support.xDriveSystemDependencyAvailableTargets
  const row = (id, mode = 'in-app') => ({
    id, config_mode: mode, apply_mode: 'immediate', status: 'ready',
  })
  const allPorts = Object.fromEntries([
    'loadPostgresPoolConfig', 'savePostgresPoolConfig',
    'loadSourceWorkerConfig', 'saveSourceWorkerConfig',
    'loadCaddyHTTPSConfig', 'saveCaddyHTTPSConfig', 'loadCaddyHTTPSPreflight',
    'loadMediaWorkerConfig', 'saveMediaWorkerConfig', 'applyMediaWorker',
    'loadPhotoHostConfig', 'savePhotoHostConfig', 'loadPhotoHostPreflight', 'applyPhotoHost',
    'loadBaiduMapConfig', 'saveBaiduMapConfig', 'verifyBaiduMap',
    'loadGeoNamesConfig', 'saveGeoNamesConfig',
  ].map((key) => [key, () => Promise.resolve()]))
  assert.deepEqual(resolve('caddy', [row('caddy')], {}), {})
  assert.deepEqual(resolve('caddy', [row('caddy')], allPorts), {
    configTarget: { service: 'caddy', tab: 'config' },
    verifyTarget: { service: 'caddy', tab: 'verify' },
  })
  assert.deepEqual(resolve('caddy', [row('caddy'), row('caddy')], allPorts), {})
  assert.deepEqual(resolve('caddy', [
    { id: 'caddy', config_mode: 'in-app', status: 'ready' },
  ], allPorts), {})
  assert.deepEqual(resolve('caddy', [row('caddy', 'planned')], allPorts), {})
  assert.deepEqual(resolve('caddy', [{
    ...row('caddy'), status: 'planned',
  }], allPorts), {})
  assert.deepEqual(resolve('caddy', [row('caddy')], {
    loadCaddyHTTPSConfig: allPorts.loadCaddyHTTPSConfig,
    saveCaddyHTTPSConfig: allPorts.saveCaddyHTTPSConfig,
  }), { configTarget: { service: 'caddy', tab: 'config' }, verifyTarget: undefined })
  assert.deepEqual(resolve('caddy', [row('caddy')], {
    loadCaddyHTTPSPreflight: allPorts.loadCaddyHTTPSPreflight,
  }), { configTarget: undefined, verifyTarget: { service: 'caddy', tab: 'verify' } })
  assert.deepEqual(resolve('storage', [row('storage', 'deployment')], {}), {})
  assert.deepEqual(resolve('storage', [row('storage', 'deployment')], {
    load: () => Promise.resolve(),
  }), {
    configTarget: undefined, verifyTarget: { service: 'storage', tab: 'verify' },
  })
  assert.deepEqual(resolve('storage', [{
    ...row('storage', 'deployment'), status: 'planned',
  }], { load: () => Promise.resolve() }), {})
  assert.deepEqual(resolve('photo-smart', [row('photo-smart', 'deployment')], allPorts), {
    configTarget: undefined,
    verifyTarget: { service: 'photo-smart', tab: 'verify' },
  })
  assert.deepEqual(resolve('photo-smart', [
    row('photo-smart', 'deployment'), row('photo-face'),
  ], allPorts), {
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-smart', tab: 'verify' },
  })
  assert.deepEqual(resolve('photo-smart', [
    row('photo-smart', 'deployment'), row('photo-face', 'deployment'),
  ], allPorts), {
    configTarget: undefined, verifyTarget: { service: 'photo-smart', tab: 'verify' },
  })
  assert.deepEqual(resolve('baidu-map', [row('baidu-map')], allPorts), {
    configTarget: { service: 'baidu-map', tab: 'config' },
    verifyTarget: { service: 'baidu-map', tab: 'verify' },
    activationTarget: { service: 'baidu-map', tab: 'config' },
  })
})

test('one shared Web/Desktop capability UI gates quick links, never creates host controls', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const cap = read('ui/shared/src/system-dependencies-capabilities.ts')
  assert.match(page, /xDriveSystemDependencyAvailableTargets/)
  assert.match(page, /data-xdrive-dependency-missing-action-port/)
  assert.match(page, /navigateTo\(configTarget\)/)
  assert.match(page, /navigateTo\(verifyTarget\)/)
  assert.match(cap, /reportedApplyModes\.has/)
  assert.match(cap, /typeof port\[method\] === 'function'/)
  assert.doesNotMatch(cap, /docker\.sock|StopHost|RestartHost|admin\.services\/.+apply/)
})


test('only three current safe enable panels have optional navigation, never Caddy/DB/storage', () => {
  const support = load('ui/shared/src/system-dependencies-capabilities.ts')
  const matrix = support.XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES
  const resolve = support.xDriveSystemDependencyAvailableTargets
  const row = (id, apply_mode = 'controlled-restart') =>
    ({ id, config_mode: 'in-app', apply_mode, status: 'disabled' })
  const methods = [
    'load', // Media Worker live verification must read the current service inventory.
    'loadBaiduMapConfig', 'saveBaiduMapConfig',
    'loadMediaWorkerConfig', 'saveMediaWorkerConfig', 'applyMediaWorker',
    'loadPhotoHostConfig', 'savePhotoHostConfig', 'loadPhotoHostPreflight', 'applyPhotoHost',
  ]
  const port = Object.fromEntries(methods.map(name => [name, () => Promise.resolve()]))
  assert.deepEqual(Object.entries(matrix).filter(([, v]) => v.activationTarget)
    .map(([id]) => id).sort(), ['baidu-map', 'media-worker', 'photo-face'])
  for (const id of ['database', 'storage', 'background-worker', 'caddy', 'geonames',
    'photo-smart', 'photo-semantic', 'photo-creative']) {
    assert.equal(matrix[id].activationTarget, undefined, 'no fake service toggle: ' + id)
  }
  assert.deepEqual(resolve('baidu-map', [row('baidu-map', 'immediate')], port), {
    configTarget: { service: 'baidu-map', tab: 'config' }, verifyTarget: undefined,
    activationTarget: { service: 'baidu-map', tab: 'config' },
  })
  assert.deepEqual(resolve('media-worker', [row('media-worker')], port), {
    configTarget: { service: 'media-worker', tab: 'config' },
    verifyTarget: { service: 'media-worker', tab: 'verify' },
    activationTarget: { service: 'media-worker', tab: 'config' },
  })
  assert.deepEqual(resolve('photo-face', [row('photo-face')], port), {
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-face', tab: 'verify' },
    activationTarget: { service: 'photo-face', tab: 'config' },
  })
  const withoutApply = { ...port, applyMediaWorker: undefined, applyPhotoHost: undefined }
  assert.equal(resolve('media-worker', [row('media-worker')], withoutApply).activationTarget, undefined)
  assert.equal(resolve('photo-face', [row('photo-face')], withoutApply).activationTarget, undefined)
  assert.equal(resolve('photo-face', [row('photo-face', 'immediate')], port).activationTarget, undefined)
  assert.deepEqual(resolve('caddy', [row('caddy')], port), {})
})

test('Web/Desktop shared enable entry is navigation with a warning, not a one-click host start', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const cap = read('ui/shared/src/system-dependencies-capabilities.ts')
  assert.match(page, /data-xdrive-dependency-existing-activation/)
  assert.match(page, /activationTarget \? capability.activationLabel/)
  assert.match(page, /保存目标不等于已启用/)
  assert.match(cap, /activationOwner.apply_mode === activationApplyMode\[id\]/)
  assert.match(cap, /'media-worker': \['loadMediaWorkerConfig', 'saveMediaWorkerConfig', 'applyMediaWorker'\]/)
  assert.doesNotMatch(page, /docker\.sock|adminStopHost|adminRestartHost/)
})


test('storage receives real bounded read-only Ready verification, not a fake apply or migration action', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const caps = read('ui/shared/src/system-dependencies-capabilities.ts')
  const server = read('internal/api/admin_service_dependencies.go')
  assert.match(page, /case 'storage': return \['status', 'verify'\]/)
  assert.match(page, /data-xdrive-storage-readiness-scope/)
  assert.match(page, /存储就绪检测/)
  assert.match(page, /setRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(caps, /storage: \['load'\]/)
  assert.match(caps, /verifyTarget: \{ service: 'storage', tab: 'verify' \}/)
  assert.match(server, /context.WithTimeout\(c.Request.Context\(\), 2\*time.Second\)/)
  assert.match(server, /checker.Ready\(ctx\)/)
  assert.doesNotMatch(caps, /activationTarget: \{ service: 'storage'/)
  assert.doesNotMatch(page, /docker\.sock|adminStopHost|adminRestartHost/)
})


test('PostgreSQL and Pull Worker live verification requires a current authorized service snapshot', () => {
  const support = load('ui/shared/src/system-dependencies-capabilities.ts')
  const resolve = support.xDriveSystemDependencyAvailableTargets
  const db = { id: 'database', config_mode: 'in-app', apply_mode: 'immediate', status: 'ready' }
  const worker = { id: 'background-worker', config_mode: 'in-app',
    apply_mode: 'task-boundary', status: 'unknown' }
  const loadSnapshot = () => Promise.resolve()
  const readPostgres = () => Promise.resolve()
  const readWorker = () => Promise.resolve()
  const postgres = { load: loadSnapshot, loadPostgresPoolConfig: readPostgres }
  const pull = { load: loadSnapshot, loadSourceWorkerConfig: readWorker }
  assert.deepEqual(resolve('database', [db], postgres), {
    configTarget: undefined,
    verifyTarget: { service: 'database', tab: 'verify' },
  })
  assert.deepEqual(resolve('background-worker', [worker], pull), {
    configTarget: undefined,
    verifyTarget: { service: 'background-worker', tab: 'verify' },
  })
  assert.deepEqual(resolve('database', [db], { loadPostgresPoolConfig: readPostgres }), {})
  assert.deepEqual(resolve('background-worker', [worker], { loadSourceWorkerConfig: readWorker }), {})
  assert.deepEqual(resolve('database', [db, db], postgres), {})
  assert.deepEqual(resolve('background-worker', [{ ...worker, status: 'planned' }], pull), {})
  assert.deepEqual(resolve('database', [db], { load: loadSnapshot }), {})
})

test('shared PostgreSQL and Pull Worker verification shows actual current-instance probes without host controls', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const caps = read('ui/shared/src/system-dependencies-capabilities.ts')
  const api = read('internal/api/admin_service_dependencies.go')
  assert.match(page, /data-xdrive-postgres-liveness-scope/)
  assert.match(page, /data-xdrive-pull-worker-liveness-scope/)
  assert.match(page, /setRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(caps, /database: \['load', 'loadPostgresPoolConfig'\]/)
  assert.match(caps, /'background-worker': \['load', 'loadSourceWorkerConfig'\]/)
  assert.match(api, /sqlDB.PingContext\(ctx\)/)
  assert.match(api, /sourceWorkerServiceStatus\(ctx, time.Now\(\).UTC\(\)\)/)
  assert.match(api, /context.WithTimeout\(c.Request.Context\(\), 2\*time.Second\)/)
  for (const forbidden of ['docker.sock', 'adminStopHost', 'adminRestartHost']) {
    assert.equal(page.includes(forbidden), false)
  }
})


test('Media Worker explicit live check needs the real current inventory, not just desired Host config', () => {
  const support = load('ui/shared/src/system-dependencies-capabilities.ts')
  const resolve = support.xDriveSystemDependencyAvailableTargets
  const service = { id: 'media-worker', config_mode: 'in-app',
    apply_mode: 'controlled-restart', status: 'unavailable' }
  const fn = () => Promise.resolve()
  const all = { load: fn, loadMediaWorkerConfig: fn,
    saveMediaWorkerConfig: fn, applyMediaWorker: fn }
  const configure = { service: 'media-worker', tab: 'config' }
  const verify = { service: 'media-worker', tab: 'verify' }
  assert.deepEqual(resolve('media-worker', [service], all), {
    configTarget: configure, verifyTarget: verify, activationTarget: configure,
  })
  // Missing fresh health inventory must remove the VERIFY quick link even when
  // the old safe configuration and Host Manager entry remain available.
  assert.deepEqual(resolve('media-worker', [service], { ...all, load: undefined }), {
    configTarget: configure, verifyTarget: undefined, activationTarget: configure,
  })
  assert.deepEqual(resolve('media-worker', [service], { load: fn }), {})
  assert.deepEqual(resolve('media-worker', [service, service], all), {})
  assert.deepEqual(resolve('media-worker', [{ ...service, status: 'planned' }], all), {})
  assert.deepEqual(resolve('media-worker', [{ ...service, apply_mode: 'planned' }], all), {})
  assert.deepEqual(resolve('media-worker', [{ ...service, config_mode: 'deployment' }], all), {
    configTarget: undefined, verifyTarget: verify,
  })
})

test('shared Media Worker verify explicitly separates real health from applied Host revision', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const caps = read('ui/shared/src/system-dependencies-capabilities.ts')
  const panel = read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx')
  const server = read('internal/api/admin_service_dependencies.go')
  assert.match(page, /data-xdrive-media-worker-liveness-scope/)
  assert.match(page, /selectedPage === 'media-worker' \? \(/)
  assert.match(page, /setRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(caps, /'media-worker': \['load', 'loadMediaWorkerConfig'\]/)
  assert.match(server, /mediaWorkerApplied\(desired, host, s\.mediaWorkerRuntimeReady\(ctx\)\)/)
  assert.match(server, /s\.MediaWorkerProbe\.Info\(ctx\)/)
  assert.match(server, /context.WithTimeout\(c.Request.Context\(\), 2\*time.Second\)/)
  assert.match(panel, /config\.host\.memory_verified/)
  assert.match(panel, /config\.host\.cpu_verified/)
  assert.match(panel, /config\.host\.pids_verified/)
  assert.match(panel, /config\.host\.applied_revision/)
  assert.match(panel, /\{section === 'config' && \(<>/)
  assert.match(panel, /\{section === 'history' && source\.loadMediaWorkerRevisions/)
  // Readonly snapshot refresh deliberately must not remount editor or submit apply.
  assert.match(page, /<XDriveMediaWorkerConfigPanel source=\{source\} refreshID=\{0\}/)
  for (const forbidden of ['docker.sock', 'adminStopHost', 'adminRestartHost']) {
    assert.equal(page.includes(forbidden), false)
  }
})
