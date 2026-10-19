const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const source = read('ui/shared/src/system-dependencies-overview.ts')
const compiled = ts.transpileModule(source, {
  fileName: 'system-dependencies-overview.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(x =>
  x.category === ts.DiagnosticCategory.Error), [])
const compiledModule = {}
new Function('exports', 'require', compiled.outputText)(compiledModule, () => {
  throw Error('Caddy overview signal must not require host/network access')
})
const { xDriveSystemDependencyOverviewSignals: signals,
  xDriveSystemDependenciesOverviewSummary: summary } = compiledModule

test('deployed Caddy is observed even without a saved administrator desired revision', () => {
  const caddy = {
    id: 'caddy', group: 'core', status: 'ready',
    configuration_state: 'configured',
    installation_state: 'observed',
    health_state: 'ready',
    activation_state: 'deployment-only',
  }
  const entries = signals(caddy)
  assert.deepEqual(entries.map(item => item.value),
    ['已配置', '已观测', '正常', '宿主已观测'])
  // A healthy physical gateway is NOT proof a later administrator revision
  // was applied. It must not increment verified-activation counters.
  assert.equal(summary([caddy]).activationPending, 0)
  assert.equal(summary([caddy]).activationUnverified, 1)

  const unknown = { ...caddy, status: 'unknown', installation_state: 'unknown',
    configuration_state: 'unknown', health_state: 'unknown' }
  assert.deepEqual(signals(unknown).map(item => item.value),
    ['未确认', '未确认', '未确认', '需受控部署'])
  const other = { ...caddy, id: 'media-worker' }
  assert.equal(signals(other)[3].value, '需受控部署')

  const detail = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(detail, /当前缺少可信网关观测/)
  assert.match(detail, /已观测到宿主网关/)
  assert.match(detail, /应用内目标修订仍须单独验证/)
})

test('older Host Control is reconciled read-only, never by restarting Caddy', () => {
  const source = read('scripts/server-control.sh')
  const installer = read('deploy/install-server.sh')
  assert.match(installer, /server-control\.sh" install/)
  for (const name of ['caddy_host_control_script_sha', 'caddy_host_control_current_runner',
    'caddy_compat_observe_cmd', 'start_caddy_compat_observer']) {
    assert.ok(source.includes(name), 'missing upgrade bridge: ' + name)
  }
  assert.match(source, /caddy-observe\) caddy_compat_observe_cmd/)
  assert.match(source, /caddy_host_refresh \|\| true/)
  assert.match(source, /flock -n 7/)
  assert.match(source, /caddy-runner-source\.sha/)
  const observer = source.slice(source.indexOf('caddy_compat_observe_cmd() {'),
    source.indexOf('\nstart_caddy_compat_observer() {'))
  assert.ok(observer.length > 500)
  assert.doesNotMatch(observer, /docker (?:stop|restart)|docker compose|source.*\.env|ALIYUN_ACCESS_KEY_SECRET|rm -rf/)
})
