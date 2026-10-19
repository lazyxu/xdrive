const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function diagnostic() {
  const src = read('ui/shared/src/caddy-read-error.ts')
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', js)(mod, mod.exports)
  return mod.exports.xDriveCaddyReadFailureMessage
}

test('Caddy config failures classify real HTTP statuses without reflecting secret-bearing transport errors', () => {
  const f = diagnostic()
  for (const [status, expected] of [
    [401, '重新登录'], [403, '管理员权限'], [404, '兼容版本'],
    [503, 'PostgreSQL'], [502, '网关或 Agent'], [504, '网关或 Agent'],
  ]) {
    const msg = f({ status, message: 'token=NEVER_PRINT_SECRET /private/path' }, 'https')
    assert.match(msg, new RegExp(expected))
    assert.ok(msg.includes(String(status)))
    assert.doesNotMatch(msg, /NEVER_PRINT_SECRET|\/private\/path/)
  }
  assert.match(f(new Error('HTTP 404 missing route'), 'alidns'), /AliDNS.*404/)
  assert.match(f(new Error('Failed to fetch'), 'history'), /无法连接/)
  assert.match(f(new Error('secret=value-should-never-appear'), 'alidns'), /无法确认具体 HTTP 状态/)
  assert.doesNotMatch(f(new Error('secret=value-should-never-appear'), 'alidns'), /value-should-never-appear/)
})

test('Caddy HTTPS and AliDNS failures do not masquerade as API unsupported or editable configuration', () => {
  const https = read('ui/shared/src/mui/CaddyHTTPSDesiredPanel.tsx')
  const alidns = read('ui/shared/src/mui/CaddyAliDNSPanel.tsx')
  const shared = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const inventory = read('internal/api/admin_service_dependencies.go')
  assert.match(https, /data-xdrive-caddy-https-read-failed/)
  assert.match(https, /重试读取 HTTPS 配置/)
  assert.match(https, /xDriveCaddyReadFailureMessage\(err, 'https'\)/)
  assert.match(https, /xDriveCaddyReadFailureMessage\(err, 'history'\)/)
  assert.match(https, /section === 'history' && historyError/)
  assert.ok(https.indexOf("source.loadCaddyHTTPSConfig ? (") > https.indexOf('data-xdrive-caddy-evidence-location'))
  assert.doesNotMatch(https, /当前 Server\/Agent 不支持 Caddy HTTPS 期望配置/)
  assert.match(alidns, /data-xdrive-caddy-alidns-read-failed/)
  assert.match(alidns, /重试读取 AliDNS 配置/)
  assert.match(alidns, /xDriveCaddyReadFailureMessage\(err, 'alidns'\)/)
  assert.match(alidns, /data-xdrive-caddy-alidns-no-keyring/)
  assert.doesNotMatch(alidns, /无法读取 AliDNS 配置，请检查 Server\/Agent 版本及加密密钥/)
  assert.match(shared, /数据库、文件存储、后台 Worker 与 HTTPS 网关/)
  assert.match(inventory, /未收到可信 Caddy Host Control 网关观测/)
  assert.match(https, /data-xdrive-caddy-draft-refresh-guard/)
  assert.match(https, /不允许同时关闭/)
  assert.match(https, /期望配置未应用/)
  assert.doesNotMatch(https + alidns, /adminRestartHost|docker.sock/)
})
