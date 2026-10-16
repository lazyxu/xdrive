const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const source = read('ui/shared/src/system-dependencies-overview.ts')
const compiled = ts.transpileModule(source, {
  fileName: 'system-dependencies-overview.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const diagnostics = (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
assert.equal(diagnostics.length, 0, diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
const moduleExports = {}
new Function('exports', 'require', compiled.outputText)(moduleExports, () => {
  throw new Error('overview status helpers must not need network or runtime dependencies')
})
const { xDriveSystemDependenciesOverviewSummary, xDriveSystemDependenciesOverviewCoverage,
  xDriveSystemDependencyOverviewSignals } = moduleExports

test('overview metrics distinguish observed health from unverified deployment and revision', () => {
  const services = [
    { id: 'database', status: 'ready', health_state: 'ready',
      configuration_state: 'configured', installation_state: 'external', activation_state: 'verified' },
    { id: 'storage', status: 'unavailable', health_state: 'failed',
      configuration_state: 'configured', installation_state: 'observed', activation_state: 'pending' },
    { id: 'photo-face', status: 'disabled', configuration_state: 'unconfigured',
      installation_state: 'unknown', health_state: 'unknown', activation_state: 'deployment-only' },
    { id: 'baidu-map', status: 'ready' }, // Legacy status alone does NOT prove any lifecycle axis.
  ]
  assert.deepEqual(xDriveSystemDependenciesOverviewSummary(services), {
    reported: 4,
    healthVerified: 1,
    healthFailed: 1,
    healthUnverified: 2,
    activationUnverified: 3,
    activationPending: 1,
  })
  assert.deepEqual(xDriveSystemDependenciesOverviewSummary([]), {
    reported: 0, healthVerified: 0, healthFailed: 0,
    healthUnverified: 0, activationUnverified: 0, activationPending: 0,
  })
})

test('missing fixed services count as unverified without fabricating healthy/apply', () => {
  const partial = [
    { id: 'database', health_state: 'ready', activation_state: 'verified' },
    { id: 'photo-smart', health_state: 'failed', activation_state: 'pending' },
    { id: 'baidu-map', status: 'ready' },
  ]
  assert.deepEqual(xDriveSystemDependenciesOverviewCoverage(partial, 11), {
    reported: 3, unreported: 8, healthVerified: 1, healthFailed: 1,
    healthUnverified: 9, activationUnverified: 10, activationPending: 1,
  })
  assert.deepEqual(xDriveSystemDependenciesOverviewCoverage([], 11), {
    reported: 0, unreported: 11, healthVerified: 0, healthFailed: 0,
    healthUnverified: 11, activationUnverified: 11, activationPending: 0,
  })
})

test("overview's four lifecycle axes never turn unknown or deployment-only into applied", () => {
  const legacy = xDriveSystemDependencyOverviewSignals({ id: 'baidu-map', status: 'ready' })
  assert.deepEqual(legacy.map((s) => s.value), ['未确认', '未确认', '未确认', '未核验'])
  assert.ok(legacy.every((axis) => axis.tone !== 'positive'))
  const deployment = xDriveSystemDependencyOverviewSignals({
    id: 'photo-face', status: 'disabled', configuration_state: 'configured',
    installation_state: 'observed', health_state: 'not-checked',
    activation_state: 'deployment-only',
  })
  assert.deepEqual(deployment.map((s) => s.value), ['已配置', '已观测', '未检测', '需受控部署'])
  assert.ok(deployment.every((axis) => axis.tone !== 'positive'))
  const verified = xDriveSystemDependencyOverviewSignals({
    id: 'database', status: 'ready', configuration_state: 'configured',
    installation_state: 'external', health_state: 'ready', activation_state: 'verified',
  })
  assert.equal(verified[2].tone, 'positive')
  assert.equal(verified[3].tone, 'positive')
})

test('shared overview follows fixed service navigation with compact cards and no duplicate notice', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.ok(page.includes('data-xdrive-system-dependencies-overview'))
  assert.ok(page.includes('data-xdrive-system-dependencies-metrics'))
  assert.ok(page.includes('data-xdrive-system-dependency-overview-card={service.id}'))
  assert.ok(page.includes('data-xdrive-service-lifecycle'))
  assert.ok(!page.includes('data-xdrive-service-overview-lifecycle'))
  assert.ok(page.includes('xDriveSystemDependenciesOverviewCoverage(systemServices, XDRIVE_SYSTEM_DEPENDENCY_IDS.length)'))
  assert.ok(page.includes('xDriveSystemDependenciesOverviewEntries(systemServices)'))
  assert.ok(page.includes('data-xdrive-system-dependency-unreported-card={id}'))
  assert.ok(page.includes('item.service !== null'))
  assert.ok(page.includes('overviewCounts.unreported'))
  assert.ok(page.includes('xDriveDashboardCounts(overviewEntries)'))
  assert.ok(page.includes('xDriveSystemDependencyOverviewSignals(service)'))
  assert.ok(page.includes('XDRIVE_SYSTEM_DEPENDENCY_IDS.length'))
  assert.ok(page.includes("xs: 'minmax(0,1fr)'"))
  assert.ok(page.includes("xl: 'repeat(4, minmax(0,1fr))'"))
  assert.ok(page.includes('pageLocalNavSx(selectedPage === service.id)'))
  assert.ok(page.includes('onClick={() => choosePage(\'overview\')}>返回总览'))
  assert.ok(page.includes('service.health_state'))
  assert.equal((page.match(/\{dependencyNote\}/g) || []).length, 1)
  assert.ok(page.includes('data-xdrive-system-dependencies-safety-note'))
  assert.ok(web.includes('XDriveServiceDependenciesPage'))
  assert.ok(desktop.includes('XDriveServiceDependenciesPage'))
  for (const forbidden of ['docker.sock', 'localStorage.setItem']) {
    assert.equal(page.includes(forbidden), false)
  }
})
