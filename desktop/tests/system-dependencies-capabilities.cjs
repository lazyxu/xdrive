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
    'loadMediaWorkerConfig', 'saveMediaWorkerConfig',
    'loadPhotoHostConfig', 'savePhotoHostConfig', 'loadPhotoHostPreflight',
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
  assert.deepEqual(resolve('storage', [row('storage', 'deployment')], {}), {
    configTarget: undefined, verifyTarget: { service: 'storage', tab: 'status' },
  })
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
