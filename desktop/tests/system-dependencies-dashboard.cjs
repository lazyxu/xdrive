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
const errors = (compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0)
const dashboard = {}
new Function('exports', 'require', compiled.outputText)(dashboard, () => {
  throw Error('Dashboard classifier must be pure and have no network or runtime dependencies')
})
const { xDriveDashboardAssessment: assess, xDriveDashboardCounts: count,
  xDriveDashboardMatches: matches } = dashboard

test('single main state does not promote legacy, staged revisions or missing evidence', () => {
  const service = { status: 'ready', health_state: 'ready',
    configuration_state: 'configured', activation_state: 'deployment-only' }
  assert.equal(assess(service).state, 'healthy')
  assert.equal(assess(service).label, '健康正常')
  assert.match(assess(service).summary, /生效仍需独立核对/)
  assert.equal(assess({ ...service, activation_state: 'verified' }).state, 'healthy')
  assert.equal(assess({ ...service, activation_state: 'pending' }).state, 'attention')
  assert.equal(assess({ ...service, configuration_state: 'unconfigured' }).state, 'attention')
  assert.equal(assess({ ...service, health_state: 'failed' }).state, 'failed')
  assert.equal(assess({ ...service, status: 'disabled', health_state: 'failed' }).state, 'failed')
  assert.equal(assess({ status: 'disabled' }).state, 'disabled')
  assert.equal(assess({ status: 'planned' }).state, 'disabled')
  assert.equal(assess({ status: 'ready', health_state: 'not-checked' }).state, 'attention')
  assert.equal(assess({ status: 'ready' }).state, 'unknown')
  assert.equal(assess({ status: 'unavailable', health_state: 'unknown' }).state, 'unknown')
  assert.equal(assess(null).state, 'unknown')
  assert.equal(assess(null).label, '未报告')
})

test('eleven fixed rows have disjoint metrics; focus filter also includes confirmed failures', () => {
  const entries = [
    { service: { status: 'ready', health_state: 'ready' } },
    { service: { status: 'ready', health_state: 'ready', activation_state: 'pending' } },
    { service: { status: 'unavailable', health_state: 'failed' } },
    { service: { status: 'disabled' } },
    { service: { status: 'planned' } },
    { service: { status: 'ready' } },
    { service: null }, { service: null }, { service: null },
    { service: null }, { service: null },
  ]
  const stats = count(entries)
  assert.deepEqual(stats, { total: 11, healthy: 1, failed: 1, attention: 1, disabled: 2, unknown: 6 })
  assert.equal(stats.total, stats.healthy + stats.failed + stats.attention + stats.disabled + stats.unknown)
  assert.equal(count([]).total, 0)
  assert.equal(matches('failed', 'attention'), true)
  assert.equal(matches('attention', 'attention'), true)
  assert.equal(matches('healthy', 'attention'), false)
  assert.equal(matches('unknown', 'all'), true)
  assert.equal(matches('unknown', 'disabled'), false)
  assert.equal(matches('disabled', 'disabled'), true)
})

test('single shared responsive page has tinted cards, count-filters and four separate detail axes', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const nav = read('ui/shared/src/system-dependencies-navigation.ts')
  const cap = read('ui/shared/src/system-dependencies-capabilities.ts')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.match(page, /data-xdrive-system-dependency-overview-state=\{assessment.state\}/)
  assert.match(page, /alpha\(accent, theme.palette.mode/)
  assert.match(page, /chipColors\[assessment.state\]/)
  assert.match(page, /data-xdrive-system-dependencies-filter=\{metric.filter\}/)
  assert.match(page, /aria-pressed=\{overviewFilter === metric.filter\}/)
  assert.match(page, /data-xdrive-system-dependencies-active-filter/)
  assert.match(page, /xDriveDashboardCounts\(overviewEntries\)/)
  assert.match(page, /xDriveDashboardMatches/)
  assert.match(page, /data-xdrive-system-dependency-actions/)
  // Overview/detail shortcuts must use current server and bridge-method
  // evidence; never navigate from an unvalidated static capability alone.
  assert.equal((page.match(/xDriveSystemDependencyAvailableTargets\(/g) || []).length, 2)
  assert.match(page, /navigateTo\(configTarget\)/)
  assert.match(page, /navigateTo\(verifyTarget\)/)
  assert.doesNotMatch(page, /navigateTo\(capability\.(?:configTarget|verifyTarget)!?\)/)
  assert.match(page, /data-xdrive-service-lifecycle/)
  assert.match(page, /xDriveSystemDependencyOverviewSignals\(service\)/)
  assert.doesNotMatch(page, /data-xdrive-service-overview-lifecycle/)
  assert.match(page, /xs: 'minmax\(0,1fr\)'/)
  assert.match(page, /sm: 'repeat\(2, minmax\(0,1fr\)\)'/)
  assert.match(page, /lg: 'repeat\(3, minmax\(0,1fr\)\)'/)
  assert.match(page, /xl: 'repeat\(4, minmax\(0,1fr\)\)'/)
  assert.match(nav, /XDRIVE_SYSTEM_DEPENDENCY_IDS/)
  assert.match(cap, /'photo-face'/)
  assert.ok(web.includes('XDriveServiceDependenciesPage'))
  assert.ok(desktop.includes('XDriveServiceDependenciesPage'))
  for (const forbidden of ['docker.sock', 'localStorage.setItem', 'adminStopHost',
    'adminRestartHost', 'window.fetch(']) assert.ok(!page.includes(forbidden))
})
