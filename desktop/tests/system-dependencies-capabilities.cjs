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
