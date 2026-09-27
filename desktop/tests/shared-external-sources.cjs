const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadSharedModule(filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, require)
  return mod.exports
}

function loadSharedExternalSources() {
  const root = path.join(__dirname, '..', '..', 'ui', 'shared', 'src')
  return {
    ...loadSharedModule(path.join(root, 'external-sources.ts')),
    ...loadSharedModule(path.join(root, 'synology-dsm-guide.ts')),
  }
}

const shared = loadSharedExternalSources()

function source(overrides = {}) {
  return {
    id: 1,
    name: '来源',
    kind: 'synology_photos',
    direction: 'push',
    sync_mode: 'backup',
    run_mode: 'scan',
    status: 'active',
    revision: 1,
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
    ...overrides,
  }
}

test('shared external-source state ordering is connector neutral', () => {
  assert.deepEqual(
    shared.getExternalSourceState({ source: source({ status: 'paused' }) }),
    { key: 'paused', tone: 'neutral', label: '已暂停' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ run_requested_at: '2026-09-26T01:00:00Z' }),
    }),
    { key: 'pending', tone: 'busy', label: '等待执行' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ last_error: 'boom' }),
    }),
    { key: 'error', tone: 'bad', label: '异常' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    { key: 'credential_missing', tone: 'warning', label: 'Cookie 未配置' },
  )

  assert.deepEqual(
    shared.getExternalSourceState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: true },
    }),
    { key: 'credential_ready', tone: 'good', label: 'Cookie 已配置' },
  )
})

test('shared external-source trigger gating matches connector execution model', () => {
  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source(),
    }),
    {
      ready: true,
      label: '提交请求，由群晖 source-agent 下一次任务检查执行',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: false },
    }),
    {
      ready: false,
      label: '请先配置 Cookie',
    },
  )

  assert.deepEqual(
    shared.getExternalSourceTriggerState({
      source: source({ kind: 'yike_photos', direction: 'pull' }),
      credential: { configured: true },
      latestRun: { status: 'running' },
    }),
    {
      ready: false,
      label: '来源正在运行',
    },
  )
})

test('shared trigger action label promotes retries without hiding pending state', () => {
  assert.equal(shared.externalSourceTriggerActionLabel({ source: source() }), '立即扫描')
  assert.equal(shared.externalSourceTriggerActionLabel({
    source: source(),
    latestRun: { failed_items: 3 },
  }), '重试失败项')
  assert.equal(shared.externalSourceTriggerActionLabel({
    source: source({ run_requested_at: '2026-09-26T01:00:00Z' }),
    latestRun: { failed_items: 3 },
  }), '已请求')
})

test('shared connector profiles own credential and trigger semantics', () => {
  assert.deepEqual(shared.externalSourceConnectorProfile('synology_photos'), {
    kind: 'synology_photos',
    label: '群晖 Photos',
    direction: 'push',
    credential: null,
    manualTriggerExecutor: 'source_agent',
    defaultName: '群晖 Photos',
    defaultIgnoreRules: '@eaDir/\n\\#recycle/\n',
  })
  assert.deepEqual(shared.externalSourceConnectorProfile('yike_photos'), {
    kind: 'yike_photos',
    label: '一刻相册',
    direction: 'pull',
    credential: 'cookie',
    manualTriggerExecutor: 'pull_worker',
    defaultName: '一刻相册',
    defaultIgnoreRules: '',
  })

  const unknown = shared.externalSourceConnectorProfile('future_connector')
  assert.equal(unknown.label, 'future_connector')
  assert.equal(unknown.credential, null)
})

test('shared source card view derives display data once for both UIs', () => {
  const row = {
    source: source({
      run_mode: 'scan',
      last_run_at: '2026-09-26T18:32:00Z',
    }),
    latestRun: {
      status: 'completed',
      scanned_items: 128493,
      scanned_bytes: 2800000000000,
      failed_items: 2,
    },
  }
  const view = shared.externalSourceCardView(row)
  assert.equal(view.modeLabel, 'Push · 仅扫描')
  assert.equal(view.lastActivityLabel, '上次扫描')
  assert.equal(view.lastActivityAt, '2026-09-26T18:32:00Z')
  assert.equal(view.scannedItems, 128493)
  assert.equal(view.scannedBytes, 2800000000000)
  assert.equal(view.failedItems, 2)
  assert.equal(view.connector.manualTriggerExecutor, 'source_agent')
  assert.equal(view.trigger.ready, true)
})

test('shared source detail view keeps connector and credential semantics aligned', () => {
  const row = {
    source: source({
      kind: 'yike_photos',
      direction: 'pull',
      run_mode: 'sync',
      target_node_id: 42,
      last_run_at: '2026-09-26T17:10:00Z',
      last_success_at: '2026-09-26T16:00:00Z',
      ignore_rules: '*.tmp',
      revision: 7,
    }),
    credential: { configured: true },
  }

  const detail = shared.externalSourceDetailView(row)
  assert.equal(detail.kindLabel, '一刻相册')
  assert.equal(detail.modeLabel, 'Pull · 同步')
  assert.equal(detail.targetNodeID, 42)
  assert.equal(detail.lastRunAt, '2026-09-26T17:10:00Z')
  assert.equal(detail.lastSuccessAt, '2026-09-26T16:00:00Z')
  assert.deepEqual(detail.credential, { label: 'Cookie', configured: true })
  assert.equal(detail.revision, 7)
  assert.equal(detail.ignoreRules, '*.tmp')
})

test('shared run detail view defines one metric order for Web and Desktop', () => {
  const detail = shared.externalSourceRunDetailView({
    id: 'run-1',
    source_id: 1,
    source_revision: 7,
    mode: 'sync',
    trigger: 'manual',
    status: 'completed',
    scanned_items: 100,
    scanned_bytes: 1000,
    ignored_items: 1,
    ignored_bytes: 10,
    new_items: 2,
    new_bytes: 20,
    changed_items: 3,
    changed_bytes: 30,
    moved_items: 4,
    unchanged_items: 90,
    unchanged_bytes: 900,
    missing_items: 5,
    missing_bytes: 50,
    planned_transfer_items: 6,
    planned_transfer_bytes: 60,
    created_items: 2,
    updated_items: 3,
    skipped_items: 0,
    transferred_items: 5,
    transferred_bytes: 50,
    failed_items: 1,
    started_at: '2026-09-26T18:00:00Z',
    finished_at: '2026-09-26T18:05:00Z',
  })

  assert.equal(detail.statusLabel, '已完成')
  assert.equal(detail.startedAt, '2026-09-26T18:00:00Z')
  assert.deepEqual(detail.metrics.map((metric) => metric.key), [
    'scanned',
    'planned_transfer',
    'transferred',
    'new',
    'changed',
    'moved',
    'missing',
    'failed',
  ])
  assert.deepEqual(detail.metrics[0], { key: 'scanned', label: '扫描', items: 100, bytes: 1000 })
  assert.deepEqual(detail.metrics[7], { key: 'failed', label: '失败', items: 1 })
})

test('shared Synology DSM guide binds the exact Source and keeps secrets out of scheduled task', () => {
  const guide = shared.synologyDsmSetupGuide({
    sourceID: 42,
    sourceName: '家庭照片',
    serverURL: 'https://drive.example.com',
    xdriveUsername: 'alice',
  })

  assert.equal(guide.sourceID, 42)
  assert.match(guide.subtitle, /Source #42/)
  const bind = guide.steps.find((step) => step.id === 'bind')
  assert.ok(bind)
  assert.match(bind.command, /setup --source-id 42/)
  assert.equal(bind.command.includes('--target'), false)
  assert.equal(bind.command.includes('--name'), false)

  const scheduler = guide.steps.find((step) => step.id === 'task-script')
  assert.ok(scheduler)
  assert.match(scheduler.command, /run --due --interval 6h/)
  assert.equal(scheduler.command.includes('XD_PASSWORD'), false)

  assert.deepEqual(
    guide.steps.filter((step) => step.visual).map((step) => step.visual),
    ['task-create', 'task-schedule', 'task-script'],
  )
})

test('shared external-source defaults preserve connector-specific setup rules', () => {
  assert.deepEqual(shared.externalSourceDefaults('yike_photos'), {
    kind: 'yike_photos',
    name: '一刻相册',
    direction: 'pull',
    ignoreRules: '',
  })
  assert.deepEqual(shared.externalSourceDefaults('synology_photos'), {
    kind: 'synology_photos',
    name: '群晖 Photos',
    direction: 'push',
    ignoreRules: '@eaDir/\n\\#recycle/\n',
  })
  assert.equal(shared.externalSourceModeLabel(source()), 'Push · 仅扫描')
  assert.equal(shared.externalSourceKindLabel('yike_photos'), '一刻相册')
  assert.equal(shared.externalSourceRunStatusLabel('partial'), '部分完成')
})


test('shared Yike credential test messages are actionable', () => {
  assert.equal(shared.externalSourceCredentialTestErrorLabel('yike_auth_failed'), '一刻相册登录已失效，请重新获取 Cookie')
  assert.equal(shared.externalSourceCredentialTestErrorLabel('yike_rate_limited'), '一刻相册请求过于频繁，请稍后重试')
  assert.equal(
    shared.externalSourceCredentialTestSuccessLabel({ valid: true, kind: 'yike_photos', account_name: 'Alice', account_external_id: '123' }),
    '连接成功：Alice（123）',
  )
})


test('shared Yike Cookie guide gives the full-header workflow', () => {
  assert.match(shared.yikeConnectorNotice, /未公开接口/)
  assert.match(shared.yikeConnectorNotice, /不会上传、删除或修改/)
  assert.equal(shared.yikeCookieHelp.title, '如何获取 Cookie')
  assert.equal(shared.yikeCookieHelp.steps.length, 8)
  assert.match(shared.yikeCookieHelp.summary, /完整 Cookie/)
  assert.match(shared.yikeCookieHelp.steps[4], /photo\.baidu\.com\/youai/)
  assert.match(shared.yikeCookieHelp.steps[7], /测试连接/)
})
