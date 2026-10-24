const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(read('ui/shared/src/service-dependencies.ts'), {
  fileName: 'service-dependencies.ts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [])
const result = { exports: {} }
new Function('exports', 'require', compiled.outputText)(result.exports, () => {
  throw Error('Unexpected runtime import in dependency state model')
})
const verified = result.exports.xDrivePhotoOCRVerified
const healthy = {
  id: 'photo-smart', status: 'ready', health_state: 'ready', configuration_state: 'configured',
  ocr_auto_state: 'enabled', ocr_reason: 'ready',
  automatic_policy_state: 'enabled', photo_host_runtime_state: 'healthy',
  photo_host_profile_configured: true,
}

test('OCR green requires real Info, applied policy and fresh healthy managed host', () => {
  assert.equal(verified(healthy), true)
  for (const mismatch of [
    { id: 'photo-face' },
    { status: 'unavailable' },
    // An Agent/Server packet can contain contradictory or missing
    // independent health/configuration evidence; neither is proof of OCR.
    { health_state: 'failed' },
    { health_state: undefined },
    { configuration_state: 'unconfigured' },
    { configuration_state: undefined },
    { ocr_auto_state: 'unavailable' },
    { ocr_reason: 'probe_auth_rejected' },
    { automatic_policy_state: 'paused' },
    { automatic_policy_state: 'unmanaged' },
    { photo_host_runtime_state: 'stopped' },
    { photo_host_runtime_state: undefined },
    { photo_host_profile_configured: false },
    { photo_host_profile_configured: undefined },
  ]) {
    assert.equal(verified({ ...healthy, ...mismatch }), false,
      'contradictory OCR cannot display as enabled: ' + JSON.stringify(mismatch))
  }
})

test('Web, Mobile Web and Desktop share sanitized OCR diagnostic codes and fail closed', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const agent = read('desktop/src/main/agent_client.cts')
  const go = read('internal/api/admin_photo_ocr_status.go')
  const server = read('internal/api/admin_service_dependencies.go')
  const client = read('internal/client/client.go')
  for (const code of ['probe_busy', 'probe_auth_rejected', 'probe_unreachable', 'probe_invalid_response',
    'probe_endpoint_missing', 'probe_server_error', 'auto_paused', 'host_unverified']) {
    assert.ok(page.includes(code), 'missing safe OCR diagnosis label: ' + code)
    assert.ok(agent.includes(code), 'desktop type dropped OCR reason: ' + code)
  }
  assert.match(page, /xDrivePhotoOCRVerified\(selectedItem\)/)
  assert.match(page, /!xDrivePhotoOCRVerified\(service\)/)
  assert.match(page, /data-xdrive-ocr-diagnostic-reason/)
  // No green sublabel or "model verified" text from an internally
  // contradictory legacy packet (the main enabled predicate also fails).
  assert.ok(page.includes("模型健康：{selectedItem.status === 'ready' && selectedItem.health_state === 'ready'"))
  assert.ok(page.includes("? '未就绪' : xDrivePhotoOCRVerified(selectedItem) ? '已核验' : '待确认'"))
  assert.match(server, /photoOCRAutoDiagnosis\(/)
  assert.ok(server.includes('runnerInitialized && s.BackgroundScheduler != nil'))
  assert.ok(page.includes('runner_unavailable'))
  assert.match(go, /photoOCRProbeFailureReason/)
  assert.match(go, /photointelligence\.SmartFailureCode\(err\)/)
  assert.match(client, /OCRAutoState/)
  for (const field of ['ocr_auto_state', 'ocr_reason']) {
    assert.ok(agent.includes(field + '?:'))
  }
  assert.equal(page.includes('docker.sock'), false)
})

// Executable TypeScript import guard: OCR predicate is used as a runtime value.
test('shared OCR verified predicate is imported as a value, not type only', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(page, /import \{ xDrivePhotoOCRVerified \} from '\.\.\/service-dependencies'/)
  const typeImports = page.match(/import type \{[^}]*\} from '\.\.\/service-dependencies'/g) ?? []
  assert.equal(typeImports.some((statement) => statement.includes('xDrivePhotoOCRVerified')),
    false, 'OCR runtime predicate cannot be imported with import type')
})

test('system dependency dashboard never shows green OCR when the model alone is healthy', () => {
  const source = read('ui/shared/src/system-dependencies-overview.ts')
  const js = ts.transpileModule(source, {
    fileName: 'system-dependencies-overview.ts',
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [])
  const module = { exports: {} }
  new Function('exports', 'require', js.outputText)(module.exports, () => {
    throw Error('Dashboard should remain a pure presentation classifier')
  })
  const assess = module.exports.xDriveDashboardAssessment
  const count = module.exports.xDriveDashboardCounts
  const ready = { ...healthy, health_state: 'ready', configuration_state: 'configured' }
  const cases = [
    ['all verified', ready, 'healthy', 'OCR 已启用'],
    ['automatic admission paused', { ...ready, ocr_auto_state: 'disabled', ocr_reason: 'auto_paused', automatic_policy_state: 'paused' }, 'disabled', 'OCR 未启用'],
    ['missing Host observation', { ...ready, ocr_auto_state: 'unknown', ocr_reason: 'host_unverified', photo_host_runtime_state: undefined }, 'attention', 'OCR 待确认'],
    ['runner unavailable', { ...ready, ocr_auto_state: 'unavailable', ocr_reason: 'runner_unavailable' }, 'failed', 'OCR 无法运行'],
    ['older Agent missing OCR diagnostics', { id: 'photo-smart', status: 'ready', health_state: 'ready' }, 'attention', 'OCR 待确认'],
    ['false positive from contradictory packet', { ...ready, automatic_policy_state: 'paused' }, 'attention', 'OCR 待确认'],
    ['true model health failure', { ...ready, status: 'unavailable', health_state: 'failed', ocr_auto_state: 'unavailable' }, 'failed', '健康异常'],
    ['unrelated model remains independent', { id: 'photo-face', status: 'ready', health_state: 'ready' }, 'healthy', '健康正常'],
  ]
  for (const [name, service, state, label] of cases) {
    const actual = assess(service)
    assert.deepEqual([actual.state, actual.label], [state, label], name)
  }
  // Detail and overview must agree when independent model health fails.
  const contradictoryHealth = { ...ready, health_state: 'failed' }
  assert.equal(verified(contradictoryHealth), false)
  assert.deepEqual(
    [assess(contradictoryHealth).state, assess(contradictoryHealth).label],
    ['failed', '健康异常'],
  )
  // A legacy Agent omitting configuration evidence must never make the
  // overview green when the detail predicate correctly stays unverified.
  for (const configuration_state of [undefined, 'unknown', 'unconfigured']) {
    const partial = { ...ready, configuration_state }
    assert.equal(verified(partial), false)
    assert.notEqual(assess(partial).state, 'healthy',
      'dashboard incorrectly trusted OCR without configuration proof')
  }
  const mixed = count(cases.map(([, service]) => ({ service })))
  assert.equal(mixed.total, 8)
  assert.deepEqual([mixed.healthy, mixed.failed, mixed.attention, mixed.disabled, mixed.unknown], [2, 2, 3, 1, 0])
})
